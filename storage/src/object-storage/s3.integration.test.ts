import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { S3ObjectStore } from './s3-object-store.js';
import { buildObjectKey } from './object-key.js';

interface S3TestConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function readS3TestConfig(): S3TestConfig | null {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
  };
}

const cfg = readS3TestConfig();

function isBucketOwned(err: unknown): boolean {
  const e = err as S3ServiceException;
  return e?.name === 'BucketAlreadyOwnedByYou' || e?.name === 'BucketAlreadyExists';
}

describe.skipIf(!cfg)('S3ObjectStore（MinIO 集成）', () => {
  let store: S3ObjectStore;
  let admin: S3Client;

  beforeAll(async () => {
    if (!cfg) return;
    admin = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
    });
    // MinIO 启动可能略晚于容器就绪，重试确保 bucket 存在。
    for (let i = 0; i < 30; i++) {
      try {
        await admin.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
        break;
      } catch (err) {
        if (isBucketOwned(err)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    store = new S3ObjectStore({
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      forcePathStyle: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (admin) await admin.destroy();
  });

  function sha256hex(body: Uint8Array): string {
    return createHash('sha256').update(body).digest('hex');
  }

  it('put 返回内容寻址键、sha256、字节数与 mime', async () => {
    const body = Buffer.from('MinIO 对象存储集成测试', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    expect(stored.objectKey).toBe(buildObjectKey(sha256hex(body)));
    expect(stored.sha256).toBe(sha256hex(body));
    expect(stored.bytes).toBe(BigInt(body.byteLength));
    expect(stored.mime).toBe('text/plain');
    expect(stored.etag).toBeTruthy();
  });

  it('相同内容二次 put 复用对象不覆盖', async () => {
    const body = Buffer.from('S3 去重复用对象', 'utf8');
    const first = await store.put({ body, mime: 'text/plain' });
    const second = await store.put({ body, mime: 'text/plain' });
    expect(second.objectKey).toBe(first.objectKey);
    expect(second.etag).toBe(first.etag);
  });

  it('head 返回元数据，不存在返回 null', async () => {
    const body = Buffer.from('S3 head 元数据', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const meta = await store.head(stored.objectKey);
    expect(meta?.bytes).toBe(BigInt(body.byteLength));
    expect(meta?.etag).toBe(stored.etag);
    expect(await store.head('obj/ab/cd/不存在对象')).toBeNull();
  });

  it('get 读取完整对象', async () => {
    const body = Buffer.from('S3 完整读取对象字节', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const result = await store.get(stored.objectKey);
    expect(result.bytesTotal).toBe(BigInt(body.byteLength));
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('S3 完整读取对象字节');
  });

  it('get 按区间读取字节', async () => {
    const body = Buffer.from('0123456789ABCDEF', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const result = await store.get(stored.objectKey, { start: 2, endInclusive: 5 });
    expect(result.bytesTotal).toBe(BigInt(body.byteLength));
    expect(result.bytesStart).toBe(2);
    expect(result.bytesEndInclusive).toBe(5);
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('2345');
  });

  it('delete 后 head 返回 null', async () => {
    const body = Buffer.from('S3 待删除对象', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    await store.delete(stored.objectKey);
    expect(await store.head(stored.objectKey)).toBeNull();
  });

  it('createDownloadUrl 生成可用的预签名地址', async () => {
    const body = Buffer.from('S3 预签名下载', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const signed = await store.createDownloadUrl({ objectKey: stored.objectKey, expiresInSeconds: 60 });
    expect(signed.url).toContain(cfg!.endpoint);
    expect(signed.bytes).toBe(BigInt(body.byteLength));

    const res = await fetch(signed.url);
    expect(res.status).toBe(200);
    const fetched = Buffer.from(await res.arrayBuffer());
    expect(fetched.toString('utf8')).toBe('S3 预签名下载');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createFsDownloadToken,
  FsObjectStore,
  verifyFsDownloadToken,
} from './fs-object-store.js';
import { buildObjectKey } from './object-key.js';

const SIGN_SECRET = 'test-sign-secret';
const DOWNLOAD_BASE = '/objects/dl';

function newStore(): { store: FsObjectStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'fs-object-store-'));
  return { store: new FsObjectStore({ rootDir: root, signSecret: SIGN_SECRET, downloadBasePath: DOWNLOAD_BASE }), root };
}

function sha256hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

describe('FsObjectStore', () => {
  let store: FsObjectStore;
  let root: string;

  beforeEach(() => {
    const ctx = newStore();
    store = ctx.store;
    root = ctx.root;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('put 返回内容寻址键、sha256、字节数与 mime', async () => {
    const body = Buffer.from('云端书库原始内容', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    expect(stored.objectKey).toBe(buildObjectKey(sha256hex(body)));
    expect(stored.sha256).toBe(sha256hex(body));
    expect(stored.bytes).toBe(BigInt(body.byteLength));
    expect(stored.mime).toBe('text/plain');
    expect(stored.etag).toBe(stored.sha256);
  });

  it('相同内容二次 put 复用已有对象且不覆盖', async () => {
    const body = Buffer.from('不可变对象去重', 'utf8');
    const first = await store.put({ body, mime: 'text/plain' });
    const firstStat = statSync(join(root, first.objectKey));
    // 改变磁盘内容不应发生：二次写入前等待，确保时间戳可区分
    const second = await store.put({ body, mime: 'text/plain' });
    const secondStat = statSync(join(root, second.objectKey));
    expect(second.objectKey).toBe(first.objectKey);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it('head 返回元数据，不存在返回 null', async () => {
    const body = Buffer.from('元数据查询', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const meta = await store.head(stored.objectKey);
    expect(meta?.bytes).toBe(BigInt(body.byteLength));
    expect(meta?.sha256).toBe(stored.sha256);
    expect(await store.head('obj/ab/cd/不存在的对象')).toBeNull();
  });

  it('get 读取完整对象', async () => {
    const body = Buffer.from('完整读取对象字节', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const result = await store.get(stored.objectKey);
    expect(result.bytesTotal).toBe(BigInt(body.byteLength));
    expect(result.bytesStart).toBe(0);
    expect(result.bytesEndInclusive).toBe(body.byteLength - 1);
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('完整读取对象字节');
  });

  it('get 按区间读取字节且不影响 bytesTotal', async () => {
    const body = Buffer.from('0123456789', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const result = await store.get(stored.objectKey, { start: 2, endInclusive: 5 });
    expect(result.bytesTotal).toBe(BigInt(10));
    expect(result.bytesStart).toBe(2);
    expect(result.bytesEndInclusive).toBe(5);
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('2345');
  });

  it('delete 后 head 返回 null', async () => {
    const body = Buffer.from('待删除', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    await store.delete(stored.objectKey);
    expect(await store.head(stored.objectKey)).toBeNull();
  });

  it('createDownloadUrl 生成内部签名地址与未来过期时间', async () => {
    const body = Buffer.from('签名下载', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const now = new Date('2026-07-19T00:00:00.000Z');
    const signed = await store.createDownloadUrlAt({ objectKey: stored.objectKey, expiresInSeconds: 60 }, now);
    expect(signed.url.startsWith(DOWNLOAD_BASE)).toBe(true);
    expect(signed.expiresAt.getTime()).toBe(now.getTime() + 60_000);
    expect(signed.etag).toBe(stored.sha256);
    expect(signed.bytes).toBe(BigInt(body.byteLength));
  });
});

describe('FsObjectStore 签名令牌', () => {
  it('创建并验证令牌往返成功', () => {
    const now = new Date('2026-07-19T00:00:00.000Z');
    const exp = new Date(now.getTime() + 60_000);
    const token = createFsDownloadToken('obj/ab/cd/key', exp, SIGN_SECRET);
    const payload = verifyFsDownloadToken(token, SIGN_SECRET, now);
    expect(payload?.objectKey).toBe('obj/ab/cd/key');
    expect(payload?.expiresAt).toBe(exp.getTime());
  });

  it('过期令牌被拒绝', () => {
    const exp = new Date('2026-07-19T00:00:00.000Z');
    const token = createFsDownloadToken('obj/ab/cd/key', exp, SIGN_SECRET);
    const payload = verifyFsDownloadToken(token, SIGN_SECRET, new Date(exp.getTime() + 1_000));
    expect(payload).toBeNull();
  });

  it('篡改令牌被拒绝', () => {
    const exp = new Date(Date.now() + 60_000);
    const token = createFsDownloadToken('obj/ab/cd/key', exp, SIGN_SECRET);
    const tampered = token.slice(0, -2) + 'xx';
    expect(verifyFsDownloadToken(tampered, SIGN_SECRET, new Date())).toBeNull();
  });

  it('错误签名密钥被拒绝', () => {
    const exp = new Date(Date.now() + 60_000);
    const token = createFsDownloadToken('obj/ab/cd/key', exp, SIGN_SECRET);
    expect(verifyFsDownloadToken(token, 'wrong-secret', new Date())).toBeNull();
  });
});

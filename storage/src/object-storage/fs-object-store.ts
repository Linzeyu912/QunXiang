/**
 * 本地文件系统对象存储实现。
 *
 * 对象键映射到 {rootDir}/{objectKey}；内容寻址保证相同内容只存一份，
 * 二次写入直接复用已有对象（不覆盖）。签名下载为内部 HMAC 短时令牌，
 * 由 API 的内部下载端点验证后流式返回（支持 Range）。
 *
 * mime 不在文件系统持久化——真实内容类型以数据库 AssetObject.mime 为准；
 * head/get 的 sha256 与 etag 由对象键解析得到。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  ByteRange,
  FsDownloadTokenPayload,
  ObjectBody,
  ObjectMetadata,
  ObjectStore,
  PutObjectInput,
  SignedDownload,
  SignedDownloadInput,
  StoredObject,
} from '@novel-agent/core';
import { buildObjectKey, resolveObjectPath, sha256FromObjectKey } from './object-key.js';

export interface FsObjectStoreOptions {
  rootDir: string;
  signSecret: string;
  downloadBasePath: string;
}

function sha256hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function createFsDownloadToken(objectKey: string, expiresAt: Date, signSecret: string): string {
  const payload = JSON.stringify({ k: objectKey, e: expiresAt.getTime() });
  const payloadB64 = base64url(payload);
  const sig = createHmac('sha256', signSecret).update(payloadB64).digest();
  return `${payloadB64}.${sig.toString('base64url')}`;
}

export function verifyFsDownloadToken(token: string, signSecret: string, now: Date): FsDownloadTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const expectedSig = createHmac('sha256', signSecret).update(payloadB64).digest();
  let givenSig: Buffer;
  try {
    givenSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (givenSig.length !== expectedSig.length || !timingSafeEqual(givenSig, expectedSig)) return null;
  let payload: { k?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.k !== 'string' || typeof payload.e !== 'number') return null;
  if (payload.e <= now.getTime()) return null;
  return { objectKey: payload.k, expiresAt: payload.e };
}

export class FsObjectStore implements ObjectStore {
  constructor(private readonly options: FsObjectStoreOptions) {}

  async put(input: PutObjectInput): Promise<StoredObject> {
    const body = input.body;
    const sha256 = input.sha256 ?? sha256hex(body);
    const objectKey = buildObjectKey(sha256);
    const target = resolveObjectPath(this.options.rootDir, objectKey);

    const existing = await this.head(objectKey);
    if (existing && existing.bytes === BigInt(body.byteLength)) {
      return { objectKey, sha256, bytes: existing.bytes, mime: input.mime, etag: existing.etag ?? sha256 };
    }

    await mkdir(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(tmp, body);
    try {
      await rename(tmp, target);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      const concurrent = await this.head(objectKey);
      if (concurrent && concurrent.bytes === BigInt(body.byteLength)) {
        return { objectKey, sha256, bytes: concurrent.bytes, mime: input.mime, etag: sha256 };
      }
      throw err;
    }
    return { objectKey, sha256, bytes: BigInt(body.byteLength), mime: input.mime, etag: sha256 };
  }

  async head(objectKey: string): Promise<ObjectMetadata | null> {
    let path: string;
    try {
      path = resolveObjectPath(this.options.rootDir, objectKey);
    } catch {
      return null;
    }
    try {
      const st = await stat(path);
      const sha = sha256FromObjectKey(objectKey) ?? undefined;
      return { objectKey, bytes: BigInt(st.size), mime: '', sha256: sha, etag: sha };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async get(objectKey: string, range?: ByteRange): Promise<ObjectBody> {
    const path = resolveObjectPath(this.options.rootDir, objectKey);
    const st = await stat(path);
    const total = Number(st.size);
    const start = range?.start ?? 0;
    const endInclusive = range?.endInclusive ?? total - 1;
    if (total === 0 || start < 0 || endInclusive >= total || start > endInclusive) {
      throw new Error('对象读取区间越界');
    }
    const length = endInclusive - start + 1;
    const buf = Buffer.alloc(length);
    const fd = await open(path, 'r');
    try {
      await fd.read(buf, 0, length, start);
    } finally {
      await fd.close();
    }
    const sha = sha256FromObjectKey(objectKey) ?? undefined;
    return {
      bytes: buf,
      bytesTotal: BigInt(total),
      bytesStart: start,
      bytesEndInclusive: endInclusive,
      mime: '',
      etag: sha,
    };
  }

  async delete(objectKey: string): Promise<void> {
    let path: string;
    try {
      path = resolveObjectPath(this.options.rootDir, objectKey);
    } catch {
      return;
    }
    await unlink(path).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    });
  }

  async createDownloadUrl(input: SignedDownloadInput): Promise<SignedDownload> {
    return this.createDownloadUrlAt(input, new Date());
  }

  /** 测试可注入当前时间的签名地址生成。 */
  async createDownloadUrlAt(input: SignedDownloadInput, now: Date): Promise<SignedDownload> {
    const expiresAt = new Date(now.getTime() + input.expiresInSeconds * 1000);
    const token = createFsDownloadToken(input.objectKey, expiresAt, this.options.signSecret);
    const url = `${this.options.downloadBasePath}?t=${token}`;
    const meta = await this.head(input.objectKey);
    const sha = sha256FromObjectKey(input.objectKey) ?? undefined;
    return { url, expiresAt, etag: sha, bytes: meta?.bytes };
  }
}

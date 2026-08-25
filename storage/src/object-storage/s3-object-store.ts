/**
 * S3 兼容对象存储实现（本地 MinIO、Cloudflare R2、AWS S3、阿里云 OSS 等）。
 *
 * 业务代码只依赖 ObjectStore 接口；本实现绑定 @aws-sdk/client-s3 的标准 S3 API，
 * 不使用任何厂商专有扩展。内容寻址对象键跨实现一致，Fs 与 S3 可互换。
 * 对象去重靠 put 前 head 检查内容寻址键是否已存在。
 */
import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ByteRange,
  ObjectBody,
  ObjectMetadata,
  ObjectStore,
  PutObjectInput,
  SignedDownload,
  SignedDownloadInput,
  StoredObject,
} from '@qunxiang/core';
import { buildObjectKey } from './object-key.js';

export interface S3ObjectStoreOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

function sha256hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

function stripEtagQuotes(etag?: string): string | undefined {
  return etag ? etag.replace(/"/g, '') : etag;
}

function isNotFound(err: unknown): boolean {
  const e = err as S3ServiceException;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

function parseTotalBytes(contentRange?: string, contentLength?: number): number {
  if (contentRange) {
    const match = /\/(\d+)$/.exec(contentRange);
    if (match) return Number(match[1]);
  }
  return contentLength ?? 0;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectStoreOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      forcePathStyle: options.forcePathStyle ?? false,
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const sha256 = input.sha256 ?? sha256hex(input.body);
    const objectKey = buildObjectKey(sha256);
    const existing = await this.head(objectKey);
    if (existing && existing.bytes === BigInt(input.body.byteLength)) {
      return {
        objectKey,
        sha256,
        bytes: existing.bytes,
        mime: input.mime,
        etag: existing.etag,
        versionId: existing.versionId,
      };
    }
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        Body: input.body,
        ContentType: input.mime,
      }),
    );
    return {
      objectKey,
      sha256,
      bytes: BigInt(input.body.byteLength),
      mime: input.mime,
      etag: stripEtagQuotes(res.ETag),
      versionId: res.VersionId,
    };
  }

  async head(objectKey: string): Promise<ObjectMetadata | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      );
      return {
        objectKey,
        bytes: BigInt(res.ContentLength ?? 0),
        mime: res.ContentType ?? '',
        etag: stripEtagQuotes(res.ETag),
        versionId: res.VersionId,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async get(objectKey: string, range?: ByteRange): Promise<ObjectBody> {
    const Range = range ? `bytes=${range.start}-${range.endInclusive}` : undefined;
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey, Range }),
    );
    if (!res.Body) throw new Error('对象存储返回空响应体');
    const buf = Buffer.from(await res.Body.transformToByteArray());
    const total = parseTotalBytes(res.ContentRange, res.ContentLength);
    const start = range?.start ?? 0;
    // 请求区间 end 可能越界，S3 服务端会 clamp 实际返回字节，元数据也按真实 total-1 对齐（P1-6）
    const endInclusive = range ? Math.min(range.endInclusive, Number(total) - 1) : Number(total) - 1;
    return {
      bytes: buf,
      bytesTotal: BigInt(total),
      bytesStart: start,
      bytesEndInclusive: endInclusive,
      mime: res.ContentType ?? '',
      etag: stripEtagQuotes(res.ETag),
      versionId: res.VersionId,
    };
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
  }

  async createDownloadUrl(input: SignedDownloadInput): Promise<SignedDownload> {
    const meta = await this.head(input.objectKey);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: input.objectKey }),
      { expiresIn: input.expiresInSeconds },
    );
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    return {
      url,
      expiresAt,
      etag: meta?.etag,
      versionId: meta?.versionId,
      bytes: meta?.bytes,
    };
  }
}

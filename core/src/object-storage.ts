/**
 * 对象存储公共契约。
 *
 * 业务代码只依赖 {@link ObjectStore} 接口，不绑定具体厂商 SDK 的扩展能力。
 * 对象键采用内容寻址（sha256），实现跨书籍去重；ZIP 内的人类可读逻辑路径
 * 在快照层（SnapshotObject.logicalPath）表达，不进入对象键。
 */

/** 字节区间：0-based 起止，endInclusive 为包含的末字节偏移。 */
export interface ByteRange {
  start: number;
  endInclusive: number;
}

export interface PutObjectInput {
  body: Uint8Array;
  mime: string;
  /** 内容 sha256（十六进制）。未提供时由实现计算。 */
  sha256?: string;
  /** 对象版本标识；S3 上传后由服务端返回，FsObjectStore 以 sha256 充当。 */
  etag?: string;
  versionId?: string;
}

export interface StoredObject {
  objectKey: string;
  sha256: string;
  bytes: bigint;
  mime: string;
  etag?: string;
  versionId?: string;
}

export interface ObjectMetadata {
  objectKey: string;
  bytes: bigint;
  mime: string;
  sha256?: string;
  etag?: string;
  versionId?: string;
}

export interface ObjectBody {
  bytes: Uint8Array;
  /** 对象总字节数（不受 range 影响）。 */
  bytesTotal: bigint;
  /** 本次返回的字节区间（0-based，endInclusive 包含）。 */
  bytesStart: number;
  bytesEndInclusive: number;
  mime: string;
  etag?: string;
  versionId?: string;
}

export interface SignedDownloadInput {
  objectKey: string;
  expiresInSeconds: number;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
  etag?: string;
  versionId?: string;
  bytes?: bigint;
}

/**
 * 对象存储最小接口。业务服务不得持有 bucket 内部永久公开地址，
 * 也不得把签名地址写入数据库、日志或前端查询缓存。
 */
export interface ObjectStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  head(objectKey: string): Promise<ObjectMetadata | null>;
  get(objectKey: string, range?: ByteRange): Promise<ObjectBody>;
  delete(objectKey: string): Promise<void>;
  createDownloadUrl(input: SignedDownloadInput): Promise<SignedDownload>;
}

export type ObjectStoreProvider = 'fs' | 's3';

/** FsObjectStore 签名下载令牌的解析结果。 */
export interface FsDownloadTokenPayload {
  objectKey: string;
  expiresAt: number;
}

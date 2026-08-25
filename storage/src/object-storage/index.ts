import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObjectStore, ObjectStoreProvider } from '@qunxiang/core';
import { FsObjectStore } from './fs-object-store.js';
import { S3ObjectStore } from './s3-object-store.js';

export * from './object-key.js';
export * from './fs-object-store.js';
export * from './s3-object-store.js';

// storage/src/object-storage/index.ts → 上溯 3 级到项目根 D:\entity
const _dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FS_ROOT = resolve(_dirname, '..', '..', '..', 'storage', 'objects');

export interface ObjectStoreConfig {
  provider: ObjectStoreProvider;
  fsRootDir?: string;
  fsSignSecret?: string;
  downloadBasePath?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
}

export function createObjectStore(config: ObjectStoreConfig): ObjectStore {
  if (config.provider === 'fs') {
    if (!config.fsRootDir) throw new Error('未配置对象存储根目录');
    if (!config.fsSignSecret) throw new Error('未配置对象存储签名密钥');
    return new FsObjectStore({
      rootDir: config.fsRootDir,
      signSecret: config.fsSignSecret,
      downloadBasePath: config.downloadBasePath ?? '/objects/dl',
    });
  }
  if (config.provider === 's3') {
    if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
      throw new Error('未配置对象存储 S3 凭据');
    }
    return new S3ObjectStore({
      endpoint: config.s3Endpoint,
      region: config.s3Region ?? 'us-east-1',
      bucket: config.s3Bucket,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
      forcePathStyle: config.s3ForcePathStyle,
    });
  }
  throw new Error(`不支持的对象存储类型：${config.provider as string}`);
}

/** 按环境变量构造对象存储（fs 默认，s3 兼容 MinIO/R2/AWS/OSS）。 */
export function createObjectStoreFromEnv(): ObjectStore {
  const provider = (process.env.OBJECT_STORAGE_PROVIDER ?? 'fs') as ObjectStoreProvider;
  if (provider === 'fs') {
    const signSecret = process.env.OBJECT_STORAGE_SIGN_SECRET;
    if (!signSecret) {
      throw new Error('未配置对象存储签名密钥（OBJECT_STORAGE_SIGN_SECRET）');
    }
    return new FsObjectStore({
      rootDir: process.env.OBJECT_STORAGE_FS_ROOT ?? DEFAULT_FS_ROOT,
      signSecret,
      downloadBasePath: process.env.OBJECT_STORAGE_DOWNLOAD_PATH ?? '/objects/dl',
    });
  }
  if (provider === 's3') {
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    const bucket = process.env.OBJECT_STORAGE_BUCKET;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('未配置对象存储 S3 凭据（需 OBJECT_STORAGE_ACCESS_KEY_ID/OBJECT_STORAGE_SECRET_ACCESS_KEY/OBJECT_STORAGE_BUCKET）');
    }
    return new S3ObjectStore({
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE === 'true',
    });
  }
  throw new Error(`不支持的对象存储类型：${provider as string}`);
}

let sharedStore: ObjectStore | null = null;
/** 进程级共享对象存储（懒加载，避免顶层创建在缺失环境变量时破坏测试导入）。 */
export function getSharedObjectStore(): ObjectStore {
  if (!sharedStore) sharedStore = createObjectStoreFromEnv();
  return sharedStore;
}

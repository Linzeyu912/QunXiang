import { readFile } from 'node:fs/promises';
import type { ObjectStore } from '@novel-agent/core';
import { getSharedObjectStore } from './object-storage/index.js';

export interface BookSourceRef {
  sourceObjectKey?: string | null;
  filePath?: string | null;
}

/**
 * 资产来源解析器：优先从对象存储读取（sourceObjectKey），旧资产回退本机只读（filePath）。
 * 新资产禁止回退到调用方提交的任意绝对路径——只接受数据库记录自带的来源字段。
 */
export class AssetSourceResolver {
  private _objectStore?: ObjectStore;

  constructor(objectStore?: ObjectStore) {
    this._objectStore = objectStore;
  }

  private store(): ObjectStore {
    if (!this._objectStore) this._objectStore = getSharedObjectStore();
    return this._objectStore;
  }

  async readSourceBuffer(book: BookSourceRef): Promise<Buffer> {
    if (book.sourceObjectKey) {
      const body = await this.store().get(book.sourceObjectKey);
      return Buffer.from(body.bytes);
    }
    if (book.filePath) {
      return readFile(book.filePath);
    }
    throw new Error('书籍没有可读的原始内容来源');
  }

  async readSourceText(book: BookSourceRef): Promise<string> {
    return (await this.readSourceBuffer(book)).toString('utf-8');
  }
}

export function createAssetSourceResolver(objectStore?: ObjectStore): AssetSourceResolver {
  return new AssetSourceResolver(objectStore);
}

const sharedResolver = new AssetSourceResolver();
export function getSharedAssetSourceResolver(): AssetSourceResolver {
  return sharedResolver;
}

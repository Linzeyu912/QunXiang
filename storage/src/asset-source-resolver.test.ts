import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSourceResolver, createAssetSourceResolver } from './asset-source-resolver.js';
import { FsObjectStore } from './object-storage/fs-object-store.js';

describe('AssetSourceResolver', () => {
  let root: string;
  let store: FsObjectStore;
  let resolver: AssetSourceResolver;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'resolver-'));
    store = new FsObjectStore({ rootDir: root, signSecret: 's', downloadBasePath: '/objects/dl' });
    resolver = createAssetSourceResolver(store);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sourceObjectKey 优先从对象存储读取', async () => {
    const body = Buffer.from('云端原始内容', 'utf8');
    const stored = await store.put({ body, mime: 'text/plain' });
    const text = await resolver.readSourceText({ sourceObjectKey: stored.objectKey });
    expect(text).toBe('云端原始内容');
  });

  it('无 sourceObjectKey 时回退本机 filePath 只读', async () => {
    const file = join(root, 'legacy.txt');
    await writeFile(file, '旧书本机内容', 'utf8');
    const text = await resolver.readSourceText({ filePath: file });
    expect(text).toBe('旧书本机内容');
  });

  it('既无对象键也无路径抛中文错误', async () => {
    await expect(resolver.readSourceText({})).rejects.toThrow('没有可读的原始内容来源');
  });
});

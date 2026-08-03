import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createArchiveZip } from './zip.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('createArchiveZip', () => {
  it('重复打包同一内容字节一致', async () => {
    const entries = [
      { logicalPath: 'manifest.json', body: Buffer.from('{"schemaVersion":"1"}') },
      { logicalPath: 'source/原始书籍.txt', body: Buffer.from('第一章 测试内容') },
      { logicalPath: 'entities/characters.json', body: Buffer.from('[]') },
    ];
    const first = await createArchiveZip(entries);
    const second = await createArchiveZip([...entries].reverse());
    expect(first.equals(second)).toBe(true);
    expect(sha256(first)).toBe(sha256(second));
  });

  it('确定性哈希为 64 位十六进制', async () => {
    const buf = await createArchiveZip([{ logicalPath: 'a.txt', body: Buffer.from('x') }]);
    expect(sha256(buf)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('内容变化产生不同字节', async () => {
    const a = await createArchiveZip([{ logicalPath: 'a.txt', body: Buffer.from('x') }]);
    const b = await createArchiveZip([{ logicalPath: 'a.txt', body: Buffer.from('y') }]);
    expect(a.equals(b)).toBe(false);
  });

  it('拒绝路径穿越条目', async () => {
    await expect(
      createArchiveZip([{ logicalPath: '../escape.txt', body: Buffer.from('x') }]),
    ).rejects.toThrow();
  });

  it('生成有效的 ZIP（PK 头）', async () => {
    const buf = await createArchiveZip([{ logicalPath: 'a.txt', body: Buffer.from('x') }]);
    expect(buf.subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4b])); // "PK"
  });
});

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROUTE_FILES = [
  'books.ts',
  'characters.ts',
  'locations.ts',
  'items.ts',
  'extract.ts',
  'export.ts',
  'images.ts',
  'stories.ts',
  'director.ts',
  'artifacts.ts',
];

describe('用户可见文案', () => {
  it('Task 8 公开路由新增的错误字面量全部包含中文', async () => {
    const violations: string[] = [];
    for (const file of ROUTE_FILES) {
      const source = await readFile(resolve('api/src/routes', file), 'utf8');
      for (const match of source.matchAll(/error:\s*'([^']+)'/g)) {
        if (!/[\u4e00-\u9fff]/.test(match[1])) violations.push(`${file}: ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('公开授权错误使用统一中文响应', async () => {
    const source = await readFile(resolve('api/src/lib/api-errors.ts'), 'utf8');
    expect(source).toContain("code: 'BOOK_NOT_FOUND'");
    expect(source).toContain("error: '书籍不存在或无权访问'");
    expect(source).toContain("error: '请先登录'");
  });
});

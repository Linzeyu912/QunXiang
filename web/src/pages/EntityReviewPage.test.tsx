import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('世界观审核页', () => {
  it('会把书籍编号传给世界观梳理面板', async () => {
    const source = await readFile(new URL('./EntityReviewPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<WorldviewSynthesisPanel bookId={bookId} />');
  });

  it('只展示当前产品需要的四个梳理分区', async () => {
    const source = await readFile(
      new URL('../components/review/WorldviewSynthesisPanel.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('世界观总览');
    expect(source).toContain('历史背景');
    expect(source).toContain('规则与法则');
    expect(source).toContain('修炼体系');
    expect(source).not.toContain('组织势力');
    expect(source).not.toContain('地理格局');
    expect(source).not.toContain('世界观实体');
  });
});

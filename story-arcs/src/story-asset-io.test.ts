import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { storyAssetDirectory } from './story-asset-io.js';

describe('故事资产目录边界', () => {
  it('拒绝故事编号和书籍目录中的路径分隔符', () => {
    expect(() => storyAssetDirectory('output', 'book-a', '../../book-b/stories/story-1'))
      .toThrow('故事编号无效');
    expect(() => storyAssetDirectory('output', '..\\book-b', 'story-1'))
      .toThrow('书籍目录无效');
  });

  it('合法故事编号只能落在当前书籍 stories 目录下', () => {
    expect(storyAssetDirectory('output', 'book-a', 'story-1'))
      .toBe(resolve('output', 'book-a', 'stories', 'story-1'));
  });
});

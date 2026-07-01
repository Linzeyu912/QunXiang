import { describe, expect, it } from 'vitest';
import { CHARACTER_EXTRACTION_PROMPT } from './character.js';

describe('CHARACTER_EXTRACTION_PROMPT', () => {
  it('requires source-grounded complete character descriptions', () => {
    expect(CHARACTER_EXTRACTION_PROMPT).toContain('只能根据原文已经出现的信息概括');
    expect(CHARACTER_EXTRACTION_PROMPT).toContain('不要补充原文没有明示或暗示的信息');
    expect(CHARACTER_EXTRACTION_PROMPT).toContain('不要省略原文中已经出现的身份、关系、能力、经历或关键行为');
    expect(CHARACTER_EXTRACTION_PROMPT).toContain('description 必须输出完整句或完整短语');
  });
});

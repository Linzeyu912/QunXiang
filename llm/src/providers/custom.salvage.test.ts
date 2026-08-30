import { describe, expect, it } from 'vitest';
import { salvageTruncatedJson } from './custom.js';

describe('salvageTruncatedJson 截断 JSON 自愈', () => {
  it('数组中途截断：救回已完成元素，丢弃残缺尾元素', () => {
    const truncated = '{"characters":[{"name":"韩立","mentionCount":10},{"name":"墨大夫","mentionCount":5},{"name":"残';
    const salvaged = salvageTruncatedJson(truncated) as { characters: unknown[] };
    expect(salvaged.characters).toHaveLength(2);
    expect((salvaged.characters[0] as { name: string }).name).toBe('韩立');
  });

  it('对象字段值后截断：补全闭合符后可解析', () => {
    const salvaged = salvageTruncatedJson('{"name":"韩立","stats":{"total":5},"extra') as { name: string; stats: { total: number } };
    expect(salvaged.name).toBe('韩立');
    expect(salvaged.stats.total).toBe(5);
  });

  it('尾随逗号被截掉：原样前缀可直接解析', () => {
    const salvaged = salvageTruncatedJson('{"items":[{"a":1},{"a":2}],') as { items: unknown[] };
    expect(salvaged.items).toHaveLength(2);
  });

  it('嵌套结构截断：跨层救回', () => {
    const truncated = '{"prompts":[{"key":"甲::日常","polishedPrompt":"四视图……"},{"key":"乙';
    const salvaged = salvageTruncatedJson(truncated) as { prompts: unknown[] };
    expect(salvaged.prompts).toHaveLength(1);
    expect((salvaged.prompts[0] as { key: string }).key).toBe('甲::日常');
  });

  it('无任何完整边界时返回 undefined', () => {
    expect(salvageTruncatedJson('{"name":')).toBeUndefined();
    expect(salvageTruncatedJson('完全不是 JSON')).toBeUndefined();
    expect(salvageTruncatedJson('')).toBeUndefined();
  });

  it('字符串内的 } 不被误判为边界', () => {
    const truncated = '{"desc":"含}花括号","name":"X"},{"n';
    const salvaged = salvageTruncatedJson(truncated) as { desc: string; name: string };
    expect(salvaged.desc).toBe('含}花括号');
    expect(salvaged.name).toBe('X');
  });
});

import { describe, expect, it, vi } from 'vitest';

// 与 extraction.empty-result.test.ts 相同的依赖隔离：本测试只关心纯格式化函数
vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
  LLM_PROVIDERS: {},
}));
vi.mock('@qunxiang/scheduler', () => ({
  TaskDispatcher: vi.fn().mockImplementation(() => ({
    startWorker: vi.fn(),
    startWorkers: vi.fn(),
    stopWorkers: vi.fn(),
    stopWorker: vi.fn(),
    getWorkerCount: vi.fn(() => 1),
  })),
  DatabaseTaskQueue: vi.fn().mockImplementation(() => ({ enqueue: vi.fn(), dequeue: vi.fn() })),
  eventBus: { emit: vi.fn() },
}));

import { buildExtractionWarnings } from './extraction.service.js';

describe('buildExtractionWarnings 丢章警告格式化', () => {
  it('章节范围（多章/单章）与错误原因转成用户可读文案', () => {
    const warnings = buildExtractionWarnings([
      { error: 'LLM 接口返回 HTTP 429', chapterFrom: 12, chapterTo: 15 },
      { error: 'parse error', chapterFrom: 30, chapterTo: 30 },
    ]);
    expect(warnings).toEqual([
      '第 12–15 章提取失败（LLM 接口返回 HTTP 429），这些章节的角色、场景、道具可能缺失',
      '第 30 章提取失败（parse error），这些章节的角色、场景、道具可能缺失',
    ]);
  });

  it('缺章节范围时降级为"部分章节"，缺错误原因时省略括号', () => {
    expect(buildExtractionWarnings([{ error: '' }])).toEqual([
      '部分章节提取失败，这些章节的角色、场景、道具可能缺失',
    ]);
  });

  it('超长错误信息截断到 80 字，条数上限 10', () => {
    const longError = 'x'.repeat(200);
    const many = Array.from({ length: 15 }, (_, i) => ({ error: `e${i}`, chapterFrom: i, chapterTo: i }));
    const warnings = buildExtractionWarnings([{ error: longError, chapterFrom: 1, chapterTo: 2 }, ...many]);
    expect(warnings).toHaveLength(10);
    expect(warnings[0]).toContain('（' + 'x'.repeat(80) + '）');
    expect(warnings[0]).not.toContain('x'.repeat(81));
  });
});

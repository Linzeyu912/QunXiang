import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { booksKey } from './books';
import { entitiesKey } from './entities';
import { applyExtractionStreamEvent, extractionKey } from './extraction';
import type { ExtractionStagesResult } from '@/types';

describe('提取进度完整快照', () => {
  it('完成快照会更新阶段并刷新书籍与实体缓存', () => {
    const queryClient = new QueryClient();
    const bookId = 'book-1';
    queryClient.setQueryData(booksKey.all, [{ id: bookId }]);
    queryClient.setQueryData(entitiesKey.all(bookId), [{ id: 'old-entity' }]);

    applyExtractionStreamEvent(queryClient, bookId, JSON.stringify({
      bookId,
      overallProgress: 100,
      isRunning: false,
      isComplete: true,
      isFailed: false,
      stages: [],
    }));

    expect(queryClient.getQueryData(extractionKey.stages(bookId))).toMatchObject({
      isComplete: true,
      overallProgress: 100,
    });
    expect(queryClient.getQueryState(booksKey.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(entitiesKey.all(bookId))?.isInvalidated).toBe(true);
  });

  it('stage_progress 事件只更新批次 detail，不切换阶段状态', () => {
    const queryClient = new QueryClient();
    const bookId = 'book-p1';
    queryClient.setQueryData(extractionKey.stages(bookId), {
      isComplete: false,
      isFailed: false,
      stages: [{ id: 'extractor', name: '角色提取', weight: 1, status: 'running' }],
    });

    applyExtractionStreamEvent(queryClient, bookId, JSON.stringify({
      type: 'stage_progress',
      bookId,
      stageId: 'extractor',
      detail: '第 2/5 批',
      timestamp: Date.now(),
    }), 'stage_progress');

    const stage = queryClient
      .getQueryData<ExtractionStagesResult>(extractionKey.stages(bookId))
      ?.stages.find((s) => s.id === 'extractor');
    expect(stage?.status).toBe('running');
    expect(stage?.detail).toBe('第 2/5 批');
  });

  it('失败快照也会刷新书籍与实体缓存', () => {
    const queryClient = new QueryClient();
    const bookId = 'book-2';
    queryClient.setQueryData(booksKey.all, [{ id: bookId }]);
    queryClient.setQueryData(entitiesKey.all(bookId), [{ id: 'old-entity' }]);

    applyExtractionStreamEvent(queryClient, bookId, JSON.stringify({
      bookId,
      overallProgress: 25,
      isRunning: false,
      isComplete: false,
      isFailed: true,
      stages: [],
    }));

    expect(queryClient.getQueryState(booksKey.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(entitiesKey.all(bookId))?.isInvalidated).toBe(true);
  });

  it('error 事件会失效 stages 与当前运行缓存，等待服务端权威终态', () => {
    const queryClient = new QueryClient();
    const bookId = 'book-3';
    queryClient.setQueryData(extractionKey.stages(bookId), {
      isComplete: false,
      isFailed: false,
      isRunning: true,
      stages: [{ id: 'extractor', name: '角色提取', weight: 1, status: 'running' }],
    });
    queryClient.setQueryData(extractionKey.currentRun(bookId), { run: { status: 'RUNNING' } });
    queryClient.setQueryData(entitiesKey.all(bookId), [{ id: 'old-entity' }]);

    applyExtractionStreamEvent(queryClient, bookId, JSON.stringify({
      type: 'error',
      bookId,
      message: 'LLM 调用失败',
      timestamp: Date.now(),
    }), 'error');

    // error 事件常不带 stageId，本地 merge 无法还原终态：必须失效缓存走重新拉取
    expect(queryClient.getQueryState(extractionKey.stages(bookId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(extractionKey.currentRun(bookId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(entitiesKey.all(bookId))?.isInvalidated).toBe(true);
  });

  it('reviewer 阶段完成即刷新书籍/实体/产物缓存，不等待 completed 事件', () => {
    const queryClient = new QueryClient();
    const bookId = 'book-4';
    queryClient.setQueryData(extractionKey.stages(bookId), {
      isComplete: false,
      isFailed: false,
      isRunning: true,
      stages: [
        { id: 'reviewer', name: '审核入库', weight: 1, status: 'running' },
      ],
    });
    queryClient.setQueryData(booksKey.all, [{ id: bookId }]);
    queryClient.setQueryData(entitiesKey.all(bookId), [{ id: 'old-entity' }]);
    queryClient.setQueryData(['artifacts', bookId], { available: false });

    applyExtractionStreamEvent(queryClient, bookId, JSON.stringify({
      type: 'stage_complete',
      bookId,
      stageId: 'reviewer',
      progress: 100,
      timestamp: Date.now(),
    }), 'stage_complete');

    // SSE 在 isComplete 翻 true 后即断开，后置 completed 事件可能收不到，
    // reviewer 完成时就必须刷新下游缓存
    expect(queryClient.getQueryData<ExtractionStagesResult>(extractionKey.stages(bookId))?.isComplete).toBe(true);
    expect(queryClient.getQueryState(booksKey.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(entitiesKey.all(bookId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['artifacts', bookId])?.isInvalidated).toBe(true);
  });
});

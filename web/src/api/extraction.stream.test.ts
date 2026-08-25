import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { booksKey } from './books';
import { entitiesKey } from './entities';
import { applyExtractionStreamEvent, extractionKey } from './extraction';

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
});

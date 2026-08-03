import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createBookRepository } from './book.repository.js';
import { createCharacterRepository } from './character.repository.js';
import { createLocationRepository } from './location.repository.js';
import { createItemRepository } from './item.repository.js';
import { createEntityImageRepository } from './entity-image.repository.js';
import { createNoiseOverrideRepository } from './noise-override.repository.js';
import { createTaskRepository } from './task.repository.js';

const asPrisma = (value: object) => value as PrismaClient;

describe('所有权条件下推', () => {
  it('书籍读取和删除在同一条查询中匹配 ownerId', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'book-a', userId: 'owner-a', filePath: '' });
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createBookRepository(asPrisma({ book: { findFirst, deleteMany } }));

    await repo.findOwnedById('book-a', 'owner-a');
    await repo.deleteOwned('book-a', 'owner-a');

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'book-a', userId: 'owner-a' } });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'book-a', userId: 'owner-a' } });
  });

  it.each([
    ['character', createCharacterRepository],
    ['location', createLocationRepository],
    ['item', createItemRepository],
  ])('%s 仓储用 book.userId 在单条查询中匹配 ownerId', async (model, factory) => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = factory(asPrisma({ [model]: { findFirst } }) as never) as {
      findOwnedById(id: string, ownerId: string): Promise<unknown>;
    };

    await repo.findOwnedById('entity-a', 'owner-a');

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'entity-a', book: { userId: 'owner-a' } },
    });
  });

  it('实体图片读取在单条查询中匹配书籍和 ownerId', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = createEntityImageRepository(asPrisma({ entityImage: { findFirst } }));

    await repo.findOwnedById('image-a', 'book-a', 'owner-a');

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'image-a', bookId: 'book-a', book: { userId: 'owner-a' } },
    });
  });

  it('噪声覆盖和任务按 book.userId 过滤', async () => {
    const noiseFindMany = vi.fn().mockResolvedValue([]);
    const taskFindFirst = vi.fn().mockResolvedValue(null);
    const noiseRepo = createNoiseOverrideRepository(asPrisma({ noiseOverride: { findMany: noiseFindMany } }));
    const taskRepo = createTaskRepository(asPrisma({ task: { findFirst: taskFindFirst } }));

    await noiseRepo.listByOwnedBook('book-a', 'owner-a');
    await taskRepo.findOwnedById('task-a', 'owner-a');

    expect(noiseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookId: 'book-a', book: { userId: 'owner-a' } },
    }));
    expect(taskFindFirst).toHaveBeenCalledWith({
      where: { id: 'task-a', book: { userId: 'owner-a' } },
    });
  });
});

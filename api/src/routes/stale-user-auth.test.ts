import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from './auth.js';
import { booksRoutes } from './books.js';

const storageMock = vi.hoisted(() => ({
  bookCreate: vi.fn(),
  bookFindAll: vi.fn(),
  bookFindById: vi.fn(),
  bookDelete: vi.fn(),
  userFindById: vi.fn(),
  isTransientDatabaseBusyError: vi.fn(),
  objectStorePut: vi.fn(),
}));

const fileSystemMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('@novel-agent/storage', () => ({
  BookRepository: {
    create: storageMock.bookCreate,
    findAll: storageMock.bookFindAll,
    findById: storageMock.bookFindById,
    delete: storageMock.bookDelete,
  },
  UserRepository: {
    findById: storageMock.userFindById,
  },
  isTransientDatabaseBusyError: storageMock.isTransientDatabaseBusyError,
  getSharedObjectStore: () => ({ put: storageMock.objectStorePut }),
  getSharedAssetSourceResolver: () => ({ readSourceText: async () => '' }),
}));

vi.mock('fs/promises', () => ({
  mkdir: fileSystemMock.mkdir,
  writeFile: fileSystemMock.writeFile,
  rename: fileSystemMock.rename,
  unlink: fileSystemMock.unlink,
  readFile: fileSystemMock.readFile,
  rm: fileSystemMock.rm,
}));

vi.mock('../services/image-generation.service.js', () => ({
  bookImageDir: (bookId: string) => `storage/uploads/entity-images/${bookId}`,
}));

function staleUser() {
  return {
    userId: '00000000-0000-4000-8000-000000000000',
    email: 'old@example.com',
    name: 'old',
  };
}

function existingUser() {
  return {
    id: '17467a59-5944-43f3-830b-7c365393655b',
    email: 'test@example.com',
    name: 'test',
    passwordHash: 'hash',
  };
}

function authenticatedUser() {
  const user = existingUser();
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
  };
}

function multipartPayload(filename = 'test.txt', content = '第一章\n测试内容') {
  const boundary = '----novel-agent-test-boundary';
  const body = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: text/plain',
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );
  return {
    boundary,
    body,
  };
}

describe('stale user auth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.userFindById.mockResolvedValue(null);
    storageMock.isTransientDatabaseBusyError.mockImplementation((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return /SQLITE_BUSY|SQLITE_LOCKED|database\s+(?:is\s+)?locked/i.test(message);
    });
    storageMock.objectStorePut.mockResolvedValue({ objectKey: 'obj/aa/bb/test-key' });
    fileSystemMock.mkdir.mockResolvedValue(undefined);
    fileSystemMock.writeFile.mockResolvedValue(undefined);
    fileSystemMock.rename.mockResolvedValue(undefined);
    fileSystemMock.unlink.mockResolvedValue(undefined);
    fileSystemMock.readFile.mockResolvedValue('');
    fileSystemMock.rm.mockResolvedValue(undefined);
  });

  it('/auth/me rejects a valid token whose user row no longer exists', async () => {
    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
      request.user = staleUser();
    });
    await fastify.register(authRoutes, { prefix: '/auth' });

    const response = await fastify.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '登录状态已失效，请重新登录' });
  });

  it('book upload rejects a stale user before attempting to create a book', async () => {
    storageMock.bookCreate.mockRejectedValue(new Error('Foreign key constraint failed'));

    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
      request.user = staleUser();
    });
    await fastify.register(multipart);
    await fastify.register(booksRoutes, { prefix: '/books' });

    const { boundary, body } = multipartPayload();

    const response = await fastify.inject({
      method: 'POST',
      url: '/books',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '登录状态已失效，请重新登录' });
    expect(storageMock.bookCreate).not.toHaveBeenCalled();
  });

  it('book upload succeeds for an existing token user', async () => {
    const user = existingUser();
    const book = {
      id: 'book-1',
      title: 'test',
      filePath: 'D:\\entity\\storage\\uploads\\book-1.txt',
      fileSize: 22,
      mimeType: 'text/plain',
      status: 'UPLOADED',
      userId: user.id,
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
      updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    };
    storageMock.userFindById.mockResolvedValue(user);
    storageMock.bookCreate.mockResolvedValue(book);

    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
      request.user = authenticatedUser();
    });
    await fastify.register(multipart);
    await fastify.register(booksRoutes, { prefix: '/books' });

    const { boundary, body } = multipartPayload();
    const response = await fastify.inject({
      method: 'POST',
      url: '/books',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ book: { ...book, createdAt: book.createdAt.toISOString(), updatedAt: book.updatedAt.toISOString() } });
    expect(storageMock.bookCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'test',
      mimeType: 'text/plain',
      userId: user.id,
    }));
    expect(storageMock.objectStorePut).toHaveBeenCalledTimes(1);
  });

  it('book upload keeps returning database busy for transient write locks', async () => {
    storageMock.userFindById.mockResolvedValue(existingUser());
    storageMock.bookCreate.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));

    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
      request.user = authenticatedUser();
    });
    await fastify.register(multipart);
    await fastify.register(booksRoutes, { prefix: '/books' });

    const { boundary, body } = multipartPayload();
    const response = await fastify.inject({
      method: 'POST',
      url: '/books',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: '数据库繁忙，请稍后重试' });
    expect(storageMock.objectStorePut).toHaveBeenCalledTimes(1);
  });
});

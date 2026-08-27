import type { FastifyInstance } from 'fastify';
import { BookRepository, UserRepository, getSharedObjectStore, getSharedAssetSourceResolver, isTransientDatabaseBusyError, prisma } from '@qunxiang/storage';
import { parseTxt, decodeText, parseChapterOutline, normalize, detectNoise } from '@qunxiang/import';
import { rm } from 'fs/promises';
import { join } from 'path';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { bookImageDir } from '../services/image-generation.service.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { persistBookArtifact } from '@qunxiang/storage';
import type { Book } from '@qunxiang/core';

export async function booksRoutes(fastify: FastifyInstance) {
  // 上传书籍（写入对象存储，不再依赖本机绝对路径）
  fastify.post('/', async (request, reply) => {
    try {
      const userId = request.user.userId;
      const user = await UserRepository.findById(userId);
      if (!user) {
        return reply.status(401).send({ error: '登录状态已失效，请重新登录' });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: '未检测到文件，请重新选择 TXT 文件上传' });
      }

      let filename: string;
      try {
        filename = decodeURIComponent(data.filename);
      } catch {
        filename = data.filename;
      }
      const buffer = await data.toBuffer();

      if (buffer.length === 0) {
        return reply.status(400).send({ error: '文件内容为空，请检查文件后再上传' });
      }

      // 解码检测仅用于解析标题；原始字节写入对象存储
      const content = decodeText(buffer);
      const { title } = parseTxt(content, filename);

      // 统一转成 UTF-8 后写入对象存储，避免后续按 UTF-8 读取国内常见
      // GBK/GB18030 小说时出现乱码。
      const normalizedBuffer = Buffer.from(content, 'utf-8');
      let stored;
      try {
        stored = await getSharedObjectStore().put({ body: normalizedBuffer, mime: 'text/plain' });
      } catch {
        return reply.status(503).send({ error: '对象存储暂时不可用，请稍后再试' });
      }

      const book = await BookRepository.create({
        title,
        filePath: '',
        fileSize: normalizedBuffer.length,
        mimeType: 'text/plain',
        userId,
        sourceObjectKey: stored.objectKey,
      });
      // 上传即确认初始版本（实施包 C1）；此后噪声覆盖变化会使版本 +1 并要求重新确认
      const confirmed = await BookRepository.confirmPreprocess(book.id);

      return { book: confirmed ?? book };
    } catch (err) {
      request.log.error(err);
      const message = err instanceof Error ? err.message : String(err);

      if (/文件内容过长|超出解析上限/i.test(message)) {
        return reply.status(413).send({ error: message });
      }
      if (/encoding|编码|utf-?8|invalid character|parse.*fail|解析/i.test(message)) {
        return reply.status(400).send({ error: message });
      }
      if (isTransientDatabaseBusyError(err)) {
        return reply.status(503).send({ error: '数据库繁忙，请稍后重试' });
      }
      const hasChinese = /[一-鿿]/.test(message);
      return reply.status(500).send({
        error: hasChinese ? message : '上传失败，请查看服务端日志',
      });
    }
  });

  // 确认当前原文版本（实施包 C1）：确认后才能启动提取
  fastify.post('/:id/preprocess/confirm', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    const book = ownerId ? await BookRepository.findOwnedById(id, ownerId) : null;
    if (!book) return sendBookNotFound(reply);
    if (book.preprocessConfirmedRevision === book.sourceRevision) {
      return { book, alreadyConfirmed: true };
    }
    const confirmed = await prisma.book.update({
      where: { id },
      data: { preprocessConfirmedRevision: book.sourceRevision ?? 0 },
    });
    // 确认时保存版本化预处理产物（实施包 C4）：preprocess/{sourceRevision}/…
    // 失败不回滚确认本身（best-effort，与产物双写语义一致）
    try {
      await persistPreprocessArtifacts(confirmed);
    } catch (err) {
      request.log.warn(err, '版本化预处理产物保存失败');
    }
    return { book: confirmed, alreadyConfirmed: false };
  });

  // 列出书籍
  fastify.get('/', async (request) => {
    const books = await BookRepository.findAll(request.user.userId);
    return { books };
  });

  // 单本书
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    const book = await loadOwnedBook(id, ownerId);
    if (!book) return sendBookNotFound(reply);
    return { book };
  });

  // 读取书籍正文（经 AssetSourceResolver：对象存储优先，旧书 filePath 只读回退）
  fastify.get('/:id/content', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(id, ownerId);
      if (!book) return sendBookNotFound(reply);

      const content = await getSharedAssetSourceResolver().readSourceText(book);
      return { content };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '读取书籍内容失败，请稍后重试' });
    }
  });

  // 删除书籍
  fastify.delete('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(id, ownerId);
      if (!book) return sendBookNotFound(reply);

      if (!ownerId || !(await BookRepository.deleteOwned(id, ownerId))) {
        return sendBookNotFound(reply);
      }
      await rm(join('output', id), { recursive: true, force: true });
      await rm(join('.intermediate', 'story', id), { recursive: true, force: true });
      await rm(bookImageDir(id), { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '删除书籍失败，请稍后重试' });
    }
  });
}

/** 确认版本时落盘 4 个版本化预处理产物（实施包 C4）。 */
async function persistPreprocessArtifacts(bookRow: { id: string; title: string; sourceRevision: number; sourceObjectKey: string | null; filePath: string }): Promise<void> {
  const book = bookRow as unknown as Book;
  const revision = book.sourceRevision ?? 0;
  const content = await getSharedAssetSourceResolver().readSourceText(book);
  const norm = normalize(content.trim());
  const noiseReport = detectNoise(norm.text);
  const outline = parseChapterOutline(content, book.title);
  const prefix = `preprocess/${revision}`;

  await persistBookArtifact({
    bookId: book.id,
    logicalPath: `${prefix}/outline.json`,
    category: 'preprocess',
    body: JSON.stringify(outline, null, 2),
    sourceRevision: revision,
  });
  await persistBookArtifact({
    bookId: book.id,
    logicalPath: `${prefix}/normalized.txt`,
    category: 'preprocess',
    body: norm.text,
    mime: 'text/plain',
    sourceRevision: revision,
  });
  await persistBookArtifact({
    bookId: book.id,
    logicalPath: `${prefix}/report.json`,
    category: 'preprocess',
    body: JSON.stringify({
      sourceRevision: revision,
      generatedAt: new Date().toISOString(),
      removedNoiseLines: outline.removedNoiseLines,
      suspectLinesTotal: outline.suspectLinesTotal,
      byCategory: outline.byCategory,
      suspectLines: outline.suspectLines,
    }, null, 2),
    sourceRevision: revision,
  });
  await persistBookArtifact({
    bookId: book.id,
    logicalPath: `${prefix}/line-map.json`,
    category: 'preprocess',
    body: JSON.stringify({
      sourceRevision: revision,
      sourceLineCount: content.split('\n').length,
      normalizedLineCount: norm.text.split('\n').length,
      note: '规范化文本 1-based 行号与 detectNoise/noise-override 行号一致',
    }, null, 2),
    sourceRevision: revision,
  });
}

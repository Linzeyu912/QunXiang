import type { FastifyInstance } from 'fastify';
import { BookRepository } from '@novel-agent/storage';
import { parseTxt } from '@novel-agent/import';
import { decodeText } from '@novel-agent/import';
import { writeFile, rename, unlink, readFile, mkdir, rm } from 'fs/promises';
import { join, resolve } from 'path';
import crypto from 'crypto';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';

const UPLOAD_DIR = resolve(process.cwd(), '..', 'storage', 'uploads');

export async function booksRoutes(fastify: FastifyInstance) {
  // Upload book
  fastify.post('/', async (request, reply) => {
    let tempPath = '';
    try {
      const userId = request.user.userId;

      // Get file from multipart
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const filename = decodeURIComponent(data.filename);
      const buffer = await data.toBuffer();

      // Decode with automatic encoding detection (UTF-8 / GBK / GB18030)
      const content = decodeText(buffer);

      // Parse TXT
      const { title } = parseTxt(content, filename);

      // Write file to disk (temp path first)
      // 注意：写盘的是已解码为 UTF-8 的 content，而非原始 buffer。
      // 这样下游所有读取处（extractor.agent / artifacts / story 等）用
      // readFile(path, 'utf-8') 都能拿到正确文本，无需各自再 decodeText。
      // 国内小说 TXT 常见 GBK/GB18030 编码，若写原始 buffer 则抽取阶段必然乱码。
      await mkdir(UPLOAD_DIR, { recursive: true });
      const bookId = crypto.randomUUID();
      tempPath = resolve(UPLOAD_DIR, `.tmp-${bookId}.txt`);
      const finalPath = resolve(UPLOAD_DIR, `${bookId}.txt`);
      await writeFile(tempPath, content, 'utf-8');

      // Create book record in DB (userId 直接用真实 user.id，H1 后已无影子用户)
      const book = await BookRepository.create({
        title,
        filePath: finalPath,
        fileSize: Buffer.byteLength(content, 'utf-8'),
        mimeType: 'text/plain',
        userId,
      });

      // Atomic rename after DB success
      await rename(tempPath, finalPath);

      return { book };
    } catch (err) {
      request.log.error(err);
      if (tempPath) {
        await unlink(tempPath).catch(() => {});
      }
      return reply.status(500).send({ error: '上传失败，请查看服务端日志' });
    }
  });

  // List books
  fastify.get('/', async (request) => {
    const books = await BookRepository.findAll(request.user.userId);
    return { books };
  });

  // Get single book
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    const book = await loadOwnedBook(id, ownerId);

    if (!book) {
      return reply.status(404).send({ error: 'Book not found' });
    }

    return { book };
  });

  // Get book content from disk
  fastify.get('/:id/content', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(id, ownerId);

      if (!book) {
        return reply.status(404).send({ error: 'Book not found' });
      }

      const content = await readFile(book.filePath, 'utf-8');
      return { content };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Failed to read book content' });
    }
  });

  // Delete book (cascades to disk file)
  fastify.delete('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(id, ownerId);

      if (!book) {
        return reply.status(404).send({ error: 'Book not found' });
      }

      await BookRepository.delete(id);
      // 级联清理故事管线产物（切分/资产/剧本，目录名即 bookId）
      await rm(join('output', id), { recursive: true, force: true });
      await rm(join('.intermediate', 'story', id), { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete book' });
    }
  });
}
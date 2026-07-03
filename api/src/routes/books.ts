import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BookRepository, UserRepository } from '@novel-agent/storage';
import { parseTxt } from '@novel-agent/import';
import { decodeText } from '@novel-agent/import';
import { writeFile, rename, unlink, readFile, mkdir, rm } from 'fs/promises';
import { join, resolve } from 'path';
import crypto from 'crypto';

const UPLOAD_DIR = resolve(process.cwd(), '..', 'storage', 'uploads');

function getEffectiveUserId(request: FastifyRequest): string {
  // 鉴权已由全局 onRequest 钩子强制，request.user 即权威身份。
  // 不再接受客户端的 x-user-id 头，避免身份伪造。
  return request.user.userId;
}

export async function booksRoutes(fastify: FastifyInstance) {
  // Upload book
  fastify.post('/', async (request, reply) => {
    let tempPath = '';
    try {
      const effectiveUserId = getEffectiveUserId(request);

      // Ensure user exists (get the actual User record with UUID)
      const user = await UserRepository.findOrCreate({ email: `${effectiveUserId}@example.com`, name: effectiveUserId });

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
      await mkdir(UPLOAD_DIR, { recursive: true });
      const bookId = crypto.randomUUID();
      tempPath = resolve(UPLOAD_DIR, `.tmp-${bookId}.txt`);
      const finalPath = resolve(UPLOAD_DIR, `${bookId}.txt`);
      await writeFile(tempPath, buffer);

      // Create book record in DB (use user.id UUID for foreign key)
      const book = await BookRepository.create({
        title,
        filePath: finalPath,
        fileSize: buffer.length,
        mimeType: 'text/plain',
        userId: user.id,
      });

      // Atomic rename after DB success
      await rename(tempPath, finalPath);

      return { book };
    } catch (err) {
      request.log.error(err);
      if (tempPath) {
        await unlink(tempPath).catch(() => {});
      }
      const message = err instanceof Error ? err.message : 'Upload failed';
      return reply.status(500).send({ error: message });
    }
  });

  // List books
  fastify.get('/', async (request) => {
    const effectiveUserId = getEffectiveUserId(request);
    const user = await UserRepository.findByEmail(`${effectiveUserId}@example.com`);
    if (!user) {
      return { books: [] };
    }
    const books = await BookRepository.findAll(user.id);
    return { books };
  });

  // Get single book
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const book = await BookRepository.findById(id);

    if (!book) {
      return reply.status(404).send({ error: 'Book not found' });
    }

    return { book };
  });

  // Get book content from disk
  fastify.get('/:id/content', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const book = await BookRepository.findById(id);

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
      const book = await BookRepository.findById(id);

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
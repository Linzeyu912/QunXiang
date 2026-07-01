import type { FastifyInstance } from 'fastify';
import { CharacterRepository, BookRepository } from '@novel-agent/storage';
import { exportCharacters, type ExportFormat, type Book as ExporterBook } from '@novel-agent/exporters';

export async function exportRoutes(fastify: FastifyInstance) {
  // Export characters for a book in specified format
  fastify.get<{
    Params: { bookId: string };
    Querystring: { format?: ExportFormat };
  }>('/:bookId', async (request, reply) => {
    const { bookId } = request.params;
    const { format = 'json' } = request.query;

    if (!['json', 'markdown', 'csv'].includes(format)) {
      return reply.status(400).send({ error: 'Invalid format. Must be json, markdown, or csv' });
    }

    const book = await BookRepository.findById(bookId);
    if (!book) {
      return reply.status(404).send({ error: 'Book not found' });
    }

    const characters = await CharacterRepository.findByBookId(bookId);

    const content = exportCharacters(characters, book as unknown as ExporterBook, format);

    const contentType = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/markdown';
    const filename = `${book.title.replace(/[^a-zA-Z0-9]/g, '_')}_characters.${format}`;

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  });
}

import type { FastifyInstance } from 'fastify';
import {
  CharacterRepository,
  LocationRepository,
  ItemRepository,
} from '@novel-agent/storage';
import { exportEntities, type ExportFormat, type ExportEntity, type EntityKind, type Book as ExporterBook } from '@novel-agent/exporters';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';

const VALID_TYPES: EntityKind[] = ['character', 'location', 'item'];

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { bookId: string };
    Querystring: { format?: ExportFormat; type?: string };
  }>('/:bookId', async (request, reply) => {
    const { bookId } = request.params;
    const format = (request.query.format ?? 'json') as ExportFormat;
    const type = (request.query.type ?? 'character') as EntityKind;

    if (!['json', 'markdown', 'csv'].includes(format)) {
      return reply.status(400).send({ error: 'Invalid format. Must be json, markdown, or csv' });
    }
    if (!VALID_TYPES.includes(type)) {
      return reply.status(400).send({ error: 'Invalid type. Must be character, location, or item' });
    }

    const ownerId = await resolveOwnerId(request);
    const book = await loadOwnedBook(bookId, ownerId);
    if (!book) {
      return reply.status(404).send({ error: 'Book not found' });
    }

    let entities: ExportEntity[];
    if (type === 'character') {
      entities = (await CharacterRepository.findByBookId(bookId)) as unknown as ExportEntity[];
    } else if (type === 'location') {
      entities = (await LocationRepository.findByBookId(bookId)) as unknown as ExportEntity[];
    } else {
      entities = (await ItemRepository.findByBookId(bookId)) as unknown as ExportEntity[];
    }

    const content = exportEntities(entities, book as unknown as ExporterBook, type, format);

    const contentType =
      format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/markdown';
    const kindFile = type === 'character' ? 'characters' : type === 'location' ? 'locations' : 'items';
    const filename = `${book.title.replace(/[^a-zA-Z0-9]/g, '_')}_${kindFile}.${format}`;

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  });
}

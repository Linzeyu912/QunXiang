import type { FastifyInstance } from 'fastify';
import {
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  WorldviewRepository,
} from '@novel-agent/storage';
import { exportEntities, type ExportFormat, type ExportEntity, type EntityKind, type Book as ExporterBook } from '@novel-agent/exporters';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';

const VALID_TYPES: EntityKind[] = ['character', 'location', 'item', 'worldview'];

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { bookId: string };
    Querystring: { format?: ExportFormat; type?: string };
  }>('/:bookId', async (request, reply) => {
    const { bookId } = request.params;
    const format = (request.query.format ?? 'json') as ExportFormat;
    const type = (request.query.type ?? 'character') as EntityKind;

    if (!['json', 'markdown', 'csv'].includes(format)) {
      return reply.status(400).send({ error: '格式无效，必须为 json、markdown 或 csv' });
    }
    if (!VALID_TYPES.includes(type)) {
      return reply.status(400).send({ error: '类型无效，必须为角色、场景、道具或世界观' });
    }

    try {
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(bookId, ownerId);
      if (!book) {
        return sendBookNotFound(reply);
      }

      let entities: ExportEntity[];
      if (type === 'character') {
        entities = (await CharacterRepository.findByOwnedBookId(bookId, ownerId!)) as unknown as ExportEntity[];
      } else if (type === 'location') {
        entities = (await LocationRepository.findByOwnedBookId(bookId, ownerId!)) as unknown as ExportEntity[];
      } else if (type === 'worldview') {
        entities = (await WorldviewRepository.findByOwnedBookId(bookId, ownerId!)) as unknown as ExportEntity[];
      } else {
        entities = (await ItemRepository.findByOwnedBookId(bookId, ownerId!)) as unknown as ExportEntity[];
      }

      const content = exportEntities(entities, book as unknown as ExporterBook, type, format);

      const contentType =
        format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/markdown';
      const kindFile =
        type === 'character' ? 'characters'
        : type === 'location' ? 'locations'
        : type === 'worldview' ? 'worldviews'
        : 'items';
      const filename = `${book.title.replace(/[^a-zA-Z0-9]/g, '_')}_${kindFile}.${format}`;

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return content;
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}

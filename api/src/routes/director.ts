import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BadRequestError,
  ConflictError,
  createAssignment,
  listAssignments,
  NotFoundError,
  type CreateAssignmentBody,
} from '../services/story.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
  if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
  if (err instanceof BadRequestError) return reply.status(400).send({ error: err.message });
  reply.log.error(err);
  return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
}

const ASSIGNMENT_TYPES = new Set(['single_story', 'story_batch', 'episode_revision']);
const OBJECTIVES = new Set(['draft_script', 'revise_script', 'create_storyboard_prompts']);

export async function directorRoutes(fastify: FastifyInstance) {
  // 两条路由都以 :id 作为 bookId，统一校验归属
  fastify.addHook('preHandler', async (request, reply) => {
    const { id } = request.params as { id?: string };
    if (!id) return;
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
  });

  fastify.post('/:id/director/assignments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as CreateAssignmentBody;

    if (!ASSIGNMENT_TYPES.has(body?.assignmentType)) {
      return reply.status(400).send({ error: 'invalid assignmentType' });
    }
    if (!OBJECTIVES.has(body?.objective)) {
      return reply.status(400).send({ error: 'invalid objective' });
    }
    try {
      // 导演管线为确定性同步计算，直接在请求内完成并返回结果记录
      return await createAssignment(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/director/assignments', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await listAssignments(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

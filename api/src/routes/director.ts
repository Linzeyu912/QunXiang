import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BadRequestError,
  ConflictError,
  createAssignment,
  listAssignments,
  NotFoundError,
  type CreateAssignmentBody,
} from '../services/story.service.js';

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
  if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
  if (err instanceof BadRequestError) return reply.status(400).send({ error: err.message });
  return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
}

const ASSIGNMENT_TYPES = new Set(['single_story', 'story_batch', 'episode_revision']);
const OBJECTIVES = new Set(['draft_script', 'revise_script', 'create_storyboard_prompts']);

export async function directorRoutes(fastify: FastifyInstance) {
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

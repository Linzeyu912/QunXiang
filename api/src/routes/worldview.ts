import type { FastifyInstance } from 'fastify';
import {
  WorldviewRepository,
  parseReviewBucket,
  EntityReviewRepository,
  prisma,
  getSharedAssetSourceResolver,
  persistBookArtifact,
  readBookArtifactText,
} from '@qunxiang/storage';
import { worldviewUpdateSchema, worldviewSynthesisSchema } from '@qunxiang/schemas';
import { getDefaultProvider } from '@qunxiang/llm';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { isEnrichmentAvailable, requestEntityEnrichment } from '../services/entity-enrichment.service.js';

const VALID_CATEGORIES = new Set(['worldview', 'power-system', 'realm', 'faction', 'rule']);

/** 世界观体系梳理的系统提示词——让模型读完正文后产出结构化总结。 */
const WORLDVIEW_SYNTHESIS_SYSTEM_PROMPT = `你是一位中文小说世界观分析专家。请通读以下小说文本，对整个世界观体系进行结构化梳理和总结。

你需要输出一个 JSON 对象，包含以下字段（如果某个类别在原文中没有涉及，对应字段输出 null）：

{
  "overview": "世界观总览——用 2-3 段话完整描述这个世界的基本面貌。包括：世界是什么样的（大陆/星球/位面）、力量体系的核心是什么（斗气/灵气/魔法等）、社会结构是怎样的（帝国/门派/家族）、故事的核心矛盾或主线是什么。要写得像百科词条一样完整、有深度。",
  "cultivationSystem": {
    "summary": "修炼体系总结——这个世界的修炼者追求的是什么（如斗气、灵气、魔法），修炼的本质是什么",
    "details": "修炼体系的详细说明——能量来源、修炼方式、突破条件、使用规则、禁忌等",
    "levels": [
      {"name": "境界名或功法名", "totalLevels": "总层数（如：九层、三段，无则填 null）", "description": "该境界/功法的特征、能力范围和特点"}
    ]
  },
  "factions": {
    "summary": "组织势力总结——世界中有哪些重要的组织、门派、势力",
    "groups": [
      {"name": "势力名", "description": "该势力的性质、地位和作用", "relation": "与其他势力的关系"}
    ]
  },
  "rules": {
    "summary": "世界规则/法则总结——这个世界有哪些独特的规则或法则",
    "items": ["规则一", "规则二"]
  },
  "geography": {
    "summary": "地理格局总结——世界的地理分布和重要区域",
    "regions": [
      {"name": "区域名", "description": "该区域的特点和地位"}
    ]
  },
  "history": "历史背景——原文中提及的重要历史事件或背景设定（没有则输出 null）"
}

要求：
1. 只总结原文中已明确出现的信息，不要推测或补写
2. overview 必须是完整的、有深度的描述，不是一句话概括
3. cultivationSystem.levels 分两种情况：
   - 如果原文有明确的境界/等级体系（如斗者→斗师→大斗师，或炼气期→筑基期→金丹期），levels 列出各境界，name 填境界名，totalLevels 填 null
   - 如果原文没有明确的境界体系，但有重要功法（如正阳劲、象甲功、无名口诀），levels 列出各功法，name 填功法名，totalLevels 填总层数（如「九层」），description 填该功法的介绍和特点
   - 不要把同一功法的每一层单独列为一个 level
4. cultivationSystem.levels 按从低到高（或从基础到高深）的顺序排列
5. 每个字段的 description/summary 必须是完整的段落，不是零散的词条
6. 如果某个类别在原文中信息很少，可以合并到 overview 中，对应字段输出 null
7. 输出必须是合法的 JSON，不要包裹在 markdown 代码块中
8. 所有文本使用中文`;

/** 世界观与体系设定路由。 */
export async function worldviewRoutes(fastify: FastifyInstance) {
  // 列表（可按审核集合 / 状态 / 类别过滤）
  fastify.get('/', async (request, reply) => {
    const { bookId, status, category, reviewBucket, confidence, cursor, limit } = request.query as {
      bookId?: string; status?: string; category?: string; reviewBucket?: string; confidence?: string; cursor?: string; limit?: string;
    };
    if (!bookId) return reply.status(400).send({ error: '缺少书籍编号' });

    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(bookId, ownerId))) return sendBookNotFound(reply);

    if (category && !VALID_CATEGORIES.has(category)) {
      return reply.status(400).send({ error: '类别只允许 worldview、power-system、realm、faction 或 rule' });
    }

    // reviewBucket=MAIN|LOW_CONFIDENCE|REJECTED；confidence=low 保留为兼容别名。
    const bucket = parseReviewBucket({ reviewBucket, confidence });
    if (!bucket) {
      return reply.status(400).send({ error: 'reviewBucket 必须为 MAIN、LOW_CONFIDENCE 或 REJECTED' });
    }

    const parsedLimit = limit ? Math.min(Math.max(Number(limit) || 0, 1), 500) : undefined;
    const [{ worldviews, total, nextCursor }, counts] = await Promise.all([
      WorldviewRepository.findByReviewBucket({ bookId, ownerId: ownerId!, bucket, status, category, cursor, limit: parsedLimit }),
      WorldviewRepository.countReviewBuckets(bookId, ownerId!),
    ]);
    return { worldviews, total, nextCursor, counts };
  });

  // 批量改状态。
  fastify.post('/batch', async (request, reply) => {
    const { ids, status } = request.body as { ids?: string[]; status?: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: '至少选择一条世界观设定' });
    }
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return reply.status(400).send({ error: '状态只允许通过或拒绝' });
    }

    const ownerId = await resolveOwnerId(request);
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const worldview = ownerId ? await WorldviewRepository.findOwnedById(id, ownerId) : null;
      if (!worldview) {
        skipped.push({ id, reason: '不存在' });
        continue;
      }
      await WorldviewRepository.updateOwnedStatus(id, ownerId!, status);
      updated.push(id);
    }
    return { updated, skipped };
  });

  // 单条更新。
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const rawBody = (request.body ?? {}) as Record<string, unknown>;
      const body = worldviewUpdateSchema.parse(rawBody);
      const expectedVersion = typeof rawBody.expectedVersion === 'number' ? rawBody.expectedVersion : undefined;
      const ownerId = await resolveOwnerId(request);
      const worldview = ownerId ? await WorldviewRepository.findOwnedById(id, ownerId) : null;
      if (!worldview) return sendBookNotFound(reply);
      // 乐观锁（实施包 E2）：版本冲突返回 409
      if (expectedVersion !== undefined && (worldview.version ?? 1) !== expectedVersion) {
        return reply.status(409).send({ error: '该实体已被其他操作修改，请刷新后重试' });
      }

      const updated = await WorldviewRepository.updateOwned(id, ownerId!, body);
      if (!updated) return sendBookNotFound(reply);

      // 人工审核动作：标记 USER 来源、版本 +1，并写统一审核历史
      const isReviewAction = body.status === 'APPROVED' || body.status === 'REJECTED';
      if (isReviewAction) {
        await prisma.worldviewSetting.updateMany({
          where: { id },
          data: { reviewSource: 'USER', version: { increment: 1 } },
        });
        await EntityReviewRepository.create({
          bookId: worldview.bookId,
          entityType: 'worldview',
          entityId: id,
          entityName: worldview.name,
          actorId: request.user.userId,
          actorType: 'USER',
          action: body.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
          beforeValue: { status: worldview.status },
          afterValue: { status: body.status },
          changedFields: ['status'],
        });
      }
      const enrichmentAvailable = body.status === 'APPROVED' && isEnrichmentAvailable(updated);
      return { worldview: updated, enrichmentAvailable };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
  // 人工通过后的独立补写（实施包 A3）：入队后台任务，失败不影响已通过的实体
  fastify.post('/:id/enrichment', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });
    const entity = await WorldviewRepository.findOwnedById(id, ownerId);
    if (!entity) return sendBookNotFound(reply);
    if (entity.status !== 'APPROVED') {
      return reply.status(409).send({ error: '仅人工通过的实体可以补写' });
    }
    try {
      const jobId = await requestEntityEnrichment({
        bookId: entity.bookId,
        ownerId,
        entityType: 'worldview',
        entityId: id,
        actorId: request.user.userId,
      });
      return { queued: true, jobId };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });


  // 获取已保存的梳理结果。
  fastify.get('/synthesis', async (request, reply) => {
    const { bookId } = request.query as { bookId?: string };
    if (!bookId) return reply.status(400).send({ error: '缺少书籍编号' });

    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(bookId, ownerId))) return sendBookNotFound(reply);

    const text = await readBookArtifactText(bookId, 'worldview-synthesis.json');
    if (!text) return { synthesis: null };
    try {
      return { synthesis: worldviewSynthesisSchema.parse(JSON.parse(text)) };
    } catch {
      return { synthesis: null };
    }
  });

  // 全文梳理并保存结果。
  fastify.post('/synthesize', async (request, reply) => {
    try {
      const { bookId } = request.body as { bookId?: string };
      if (!bookId) return reply.status(400).send({ error: '缺少书籍编号' });

      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(bookId, ownerId);
      if (!book) return sendBookNotFound(reply);

      const sourceText = await getSharedAssetSourceResolver().readSourceText(book);
      if (!sourceText || sourceText.trim().length === 0) {
        return reply.status(400).send({ error: '书籍内容为空，无法进行世界观梳理' });
      }

      const maxCharacters = 40_000;
      const text = sourceText.length > maxCharacters
        ? `${sourceText.slice(0, maxCharacters)}\n\n……（文本过长，已截取前部分进行梳理）`
        : sourceText;
      const provider = await getDefaultProvider();
      const result = await provider.chatExtract(
        WORLDVIEW_SYNTHESIS_SYSTEM_PROMPT,
        `请对书籍《${book.title}》的以下文本进行世界观体系梳理。按系统提示给出的 JSON 对象结构返回。\n\n${text}`,
        worldviewSynthesisSchema,
      );

      await persistBookArtifact({
        bookId,
        logicalPath: 'worldview-synthesis.json',
        category: 'worldview-synthesis',
        body: JSON.stringify(result),
      });
      return { synthesis: result };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}

import { CharacterRepository, ReviewRepository } from '@qunxiang/storage';
import { buildCharacterMergeCandidates, type CharacterMergeCandidate } from '@qunxiang/entity-resolution';
import { z } from 'zod';
import { getDefaultProvider } from '@qunxiang/llm';

/** 单次裁决最多处理的角色对数量（控制 LLM 调用成本）。 */
const MAX_JUDGE_PAIRS = 20;

/** LLM 判定为高置信（可自动执行合并/排除）的最低置信度 */
const AUTO_DECIDE_CONFIDENCE = 0.7;

/** 查询当前待人工审核的疑似重复角色对（排除已被人工拒绝过的对）。 */
export async function findActiveMergeCandidates(bookId: string, ownerId: string): Promise<CharacterMergeCandidate[]> {
  const [characters, rejections] = await Promise.all([
    CharacterRepository.findByOwnedBookId(bookId, ownerId),
    ReviewRepository.findMergeRejectionsByOwnedBook(bookId, ownerId),
  ]);
  const rejectedPairs = new Set(rejections.map((review) => `${review.characterId}:${review.newValue}`));
  return buildCharacterMergeCandidates(characters).filter(
    (candidate) => !rejectedPairs.has(`${candidate.primaryId}:${candidate.secondaryId}`)
  );
}

/** LLM 对单个角色对的裁决结果 */
const mergeJudgeSchema = z.object({
  verdict: z.enum(['same', 'different', 'uncertain']),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

const MERGE_JUDGE_SYSTEM_PROMPT = [
  '你是小说角色消歧助手。根据两个角色条目的信息，判断它们是否指同一个角色。',
  '判断要点：',
  '1. 称谓变体（如"萧炎"与"萧炎哥"、"古德里安"与"古德里安教授"、"薰儿"与"萧薰儿"）通常是同一角色。',
  '2. 名称带"小/老/大"前缀需谨慎：可能指幼体、后代或另一个独立个体（如"紫晶翼狮王"与"小紫晶翼狮王"可能是两代魔兽），必须结合描述判断，描述冲突时倾向 different。',
  '3. 别名互相包含对方名字时，强烈倾向 same。',
  '4. 两个角色的描述若指向明显不同的身份、实力或经历，应为 different。',
  '5. 信息不足以判断时返回 uncertain，不要猜测。',
  '只返回 JSON，格式：{"verdict": "same" | "different" | "uncertain", "confidence": 0.0-1.0, "reason": "简短中文理由"}',
].join('\n');

function summarizeForPrompt(candidate: CharacterMergeCandidate, side: 'primary' | 'secondary'): string {
  const entity = candidate[side];
  const chapters = entity.chapterAppearances ?? [];
  return [
    `名称：${entity.name}`,
    `别名：${entity.aliases.length > 0 ? entity.aliases.join('、') : '无'}`,
    `描述：${entity.description || '无'}`,
    `出现章节：${chapters.length > 0 ? `第 ${chapters.slice(0, 10).join('、')} 章${chapters.length > 10 ? ` 等共 ${chapters.length} 章` : ''}` : '未知'}`,
  ].join('\n');
}

export interface MergeJudgeOutcome {
  /** LLM 高置信判定同一角色，已自动合并 */
  merged: Array<{ primary: string; secondary: string }>;
  /** LLM 高置信判定不同角色，已自动排除（不再出现在候选列表） */
  separated: Array<{ primary: string; secondary: string; reason?: string }>;
  /** LLM 无法确定或模型不可用，仍需人工判断 */
  pending: Array<{ primary: string; secondary: string }>;
  /** 整体降级原因（模型未配置/格式异常时给出） */
  message?: string;
}

/**
 * LLM 智能裁决疑似重复角色对：
 * 高置信「同一角色」自动合并，高置信「不同角色」自动排除，
 * 其余留给前端人工确认。识别失败不阻断，全部回退为人工判断。
 */
export async function judgeMergeCandidates(
  bookId: string,
  ownerId: string,
  reviewerId: string,
): Promise<MergeJudgeOutcome> {
  const candidates = await findActiveMergeCandidates(bookId, ownerId);
  const outcome: MergeJudgeOutcome = { merged: [], separated: [], pending: [] };
  if (candidates.length === 0) {
    outcome.message = '当前没有待裁决的疑似重复角色';
    return outcome;
  }

  // 模型可用性检查（未配置时全部转人工）
  let provider: Awaited<ReturnType<typeof getDefaultProvider>> | null = null;
  try {
    const candidateProvider = await getDefaultProvider();
    if (await candidateProvider.isConfigured()) {
      provider = candidateProvider;
    } else {
      outcome.message = '模型服务未配置，全部候选已转人工判断';
    }
  } catch {
    outcome.message = '模型服务不可用，全部候选已转人工判断';
  }

  const toJudge = candidates.slice(0, MAX_JUDGE_PAIRS);
  if (candidates.length > MAX_JUDGE_PAIRS) {
    const limitNote = `候选较多，本次仅裁决前 ${MAX_JUDGE_PAIRS} 对`;
    outcome.message = outcome.message ? `${outcome.message}；${limitNote}` : limitNote;
  }

  for (const candidate of toJudge) {
    const pair = { primary: candidate.primary.name, secondary: candidate.secondary.name };

    if (!provider) {
      outcome.pending.push(pair);
      continue;
    }

    let verdict: z.infer<typeof mergeJudgeSchema> | null = null;
    try {
      const userPrompt = [
        '请判断以下两个角色条目是否指同一角色。',
        '',
        '【角色一】',
        summarizeForPrompt(candidate, 'primary'),
        '',
        '【角色二】',
        summarizeForPrompt(candidate, 'secondary'),
      ].join('\n');
      const raw = await provider.chatExtract(MERGE_JUDGE_SYSTEM_PROMPT, userPrompt, mergeJudgeSchema);
      // 部分 provider（如 mock）不按契约校验 schema，这里再验一次结果
      const parsed = mergeJudgeSchema.safeParse(raw);
      if (parsed.success) verdict = parsed.data;
    } catch {
      verdict = null;
    }

    if (!verdict || verdict.verdict === 'uncertain' || verdict.confidence < AUTO_DECIDE_CONFIDENCE) {
      outcome.pending.push(pair);
      continue;
    }

    try {
      if (verdict.verdict === 'same') {
        const merged = await CharacterRepository.mergeOwned(
          candidate.primaryId, candidate.secondaryId, ownerId, reviewerId,
        );
        if (merged) outcome.merged.push(pair);
        else outcome.pending.push(pair);
      } else {
        const rejected = await CharacterRepository.rejectMergeOwned(
          candidate.primaryId, candidate.secondaryId, ownerId, reviewerId,
        );
        if (rejected) outcome.separated.push({ ...pair, reason: verdict.reason });
        else outcome.pending.push(pair);
      }
    } catch {
      outcome.pending.push(pair);
    }
  }

  return outcome;
}

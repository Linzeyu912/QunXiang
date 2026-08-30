import { CharacterRepository, ReviewRepository, EntityReviewRepository } from '@qunxiang/storage';
import { buildCharacterMergeCandidates, type CharacterMergeCandidate } from '@qunxiang/entity-resolution';
import { z } from 'zod';
import { getDefaultProvider } from '@qunxiang/llm';

/** 单次裁决最多处理的角色对数量（控制 LLM 调用成本）。 */
const MAX_JUDGE_PAIRS = 50;

/** 建议的可信展示阈值：不低于该值的建议直接标注结论，低置信仍展示但标为不确定 */
const SUGGESTION_DISPLAY_CONFIDENCE = 0.7;

/** 查询当前待人工审核的疑似重复角色对（排除已被人工拒绝过的对）。 */
export interface MergeSuggestion {
  primaryId: string;
  secondaryId: string;
  verdict: 'same' | 'different' | 'uncertain';
  confidence: number;
  reason?: string;
}

export async function findActiveMergeCandidates(
  bookId: string,
  ownerId: string,
): Promise<{ candidates: CharacterMergeCandidate[]; suggestions: MergeSuggestion[] }> {
  const [characters, rejections, reviews] = await Promise.all([
    CharacterRepository.findByOwnedBookId(bookId, ownerId),
    ReviewRepository.findMergeRejectionsByOwnedBook(bookId, ownerId),
    EntityReviewRepository.findByBook(bookId, 500),
  ]);
  const rejectedPairs = new Set(rejections.map((review) => `${review.characterId}:${review.newValue}`));
  const candidates = buildCharacterMergeCandidates(characters).filter(
    (candidate) => !rejectedPairs.has(`${candidate.primaryId}:${candidate.secondaryId}`)
  );
  // 取每对最近一次模型建议（MERGE_SUGGESTED），供前端展示；不自动执行
  const latest = new Map<string, MergeSuggestion>();
  for (const review of reviews as Array<{ entityType: string; action: string; entityId: string; afterValue: unknown }>) {
    if (review.entityType !== 'character' || review.action !== 'MERGE_SUGGESTED') continue;
    const value = review.afterValue as { primaryId?: string; secondaryId?: string; verdict?: string; confidence?: number; reason?: string } | null;
    if (!value?.primaryId || !value?.secondaryId || !value.verdict) continue;
    latest.set(`${value.primaryId}:${value.secondaryId}`, {
      primaryId: value.primaryId,
      secondaryId: value.secondaryId,
      verdict: value.verdict as MergeSuggestion['verdict'],
      confidence: value.confidence ?? 0,
      reason: value.reason,
    });
  }
  const suggestions = candidates
    .map((c) => latest.get(`${c.primaryId}:${c.secondaryId}`))
    .filter((s): s is MergeSuggestion => Boolean(s));
  return { candidates, suggestions };
}

/** 合并字段预览：不执行合并，展示将保留与合并的字段（实施包 A4）。 */
export async function buildMergePreview(
  primaryId: string,
  secondaryId: string,
  ownerId: string,
): Promise<{
  keep: { id: string; name: string; description?: string | null; status: string };
  mergeInto: { id: string; name: string };
  mergedFields: Array<{ field: string; strategy: string; value: string }>;
} | null> {
  const [primary, secondary] = await Promise.all([
    CharacterRepository.findOwnedById(primaryId, ownerId),
    CharacterRepository.findOwnedById(secondaryId, ownerId),
  ]);
  if (!primary || !secondary || primary.bookId !== secondary.bookId) return null;
  const aliases = [...new Set([...primary.aliases, ...secondary.aliases, secondary.name])]
    .filter((alias) => alias.trim().toLowerCase() !== primary.name.trim().toLowerCase());
  const mergedFields = [
    { field: '名称', strategy: '保留主角色', value: primary.name },
    { field: '别名', strategy: '合并去重', value: aliases.join('、') || '无' },
    { field: '描述', strategy: '拼接保留', value: [primary.description, secondary.description].filter(Boolean).join('; ') || '无' },
    { field: '置信度', strategy: '取较高者', value: String(Math.max(primary.confidence, secondary.confidence)) },
    { field: '出现章节', strategy: '合并去重', value: [...new Set([...primary.chapterAppearances, ...secondary.chapterAppearances])].sort((a, b) => a - b).join('、') || '未知' },
    { field: '提及/对话次数', strategy: '相加', value: `${primary.mentionCount + secondary.mentionCount} / ${primary.dialogueCount + secondary.dialogueCount}` },
  ];
  return {
    keep: { id: primary.id, name: primary.name, description: primary.description, status: primary.status },
    mergeInto: { id: secondary.id, name: secondary.name },
    mergedFields,
  };
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
  '',
  '置信度必须按证据强度分档，不要一律给高分：',
  '- 0.90 以上：仅限"别名互相指认（A 的别名恰为 B 的正名或反之）且描述身份/经历一致"这种有硬证据的情形。',
  '- 0.75~0.89：名称高度相近、描述不冲突但一方信息有限。',
  '- 0.70 以下：仅凭称谓风格相近、描述几乎无信息——此时应直接返回 uncertain 而不是给低置信结论。',
  '- different 的置信度同理：描述指向明确不同身份才可给 0.85 以上。',
  '只返回 JSON，格式：{"verdict": "same" | "different" | "uncertain", "confidence": 0.0-1.0, "reason": "简短中文理由，须点名依据（名称/别名/描述/章节）"}',
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

/**
 * 证据校准：LLM 自报置信度有锚定倾向（无锚点时一律 0.9+），
 * 用客观信号（候选成对原因 + 章节重叠率）给显示值设上限。
 * 别名互指是硬证据（0.99）；仅称谓归一是弱证据（0.90）；
 * same 判定但两实体出现章节几乎零重叠时再降 0.15（同人不可能不同框）。
 */
export function calibrateJudgeConfidence(
  candidate: Pick<CharacterMergeCandidate, 'reasons' | 'primary' | 'secondary'>,
  selfReported: number,
): number {
  const hasAliasLink = candidate.reasons.includes('已提取别名匹配');
  const hasNameNorm = candidate.reasons.includes('称谓归一化');
  let cap = hasAliasLink && hasNameNorm ? 0.99 : hasAliasLink ? 0.95 : 0.9;
  const a = new Set(candidate.primary.chapterAppearances ?? []);
  const b = candidate.secondary.chapterAppearances ?? [];
  const overlap = b.filter((ch) => a.has(ch)).length;
  const minLen = Math.min(a.size, b.length);
  if (minLen > 0 && overlap / minLen < 0.1) {
    cap = Math.max(0.7, cap - 0.15);
  }
  return Math.round(Math.min(selfReported, cap) * 100) / 100;
}

export interface MergeJudgeOutcome {
  /** 模型建议「同一角色」的对（仅建议，等待人工确认合并） */
  suggestedMerge: Array<{ primary: string; secondary: string; confidence: number; reason?: string }>;
  /** 模型建议「不同角色」的对（仅建议，等待人工确认保持独立） */
  suggestedSeparate: Array<{ primary: string; secondary: string; confidence: number; reason?: string }>;
  /** 模型无法确定，仍需人工判断 */
  pending: Array<{ primary: string; secondary: string }>;
  /** 整体降级原因（模型未配置/格式异常时给出） */
  message?: string;
}

/**
 * 模型对疑似重复角色对只做建议（实施包 A4）：
 * 输出建议 + 理由 + 置信度并写入统一审核历史（MERGE_SUGGESTED，actorType=SYSTEM），
 * 不自动调用合并/排除；所有合并与排除必须由人工确认。
 */
export async function judgeMergeCandidates(
  bookId: string,
  ownerId: string,
  reviewerId: string,
): Promise<MergeJudgeOutcome> {
  const { candidates } = await findActiveMergeCandidates(bookId, ownerId);
  const outcome: MergeJudgeOutcome = { suggestedMerge: [], suggestedSeparate: [], pending: [] };
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

  // 并发 3 路裁决（单次 LLM 调用秒级，串行 50 对要数分钟）；结果按候选顺序回填
  const CONCURRENCY = 3;
  const verdicts: Array<{ candidate: (typeof toJudge)[number]; verdict: z.infer<typeof mergeJudgeSchema> | null }> = new Array(toJudge.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= toJudge.length) return;
      const candidate = toJudge[index];
      if (!provider) {
        verdicts[index] = { candidate, verdict: null };
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
      verdicts[index] = { candidate, verdict };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toJudge.length) }, () => worker()));

  for (const { candidate, verdict: rawVerdict } of verdicts) {
    const pair = { primary: candidate.primary.name, secondary: candidate.secondary.name };
    const verdict = rawVerdict && rawVerdict.verdict !== 'uncertain' && rawVerdict.confidence >= SUGGESTION_DISPLAY_CONFIDENCE
      ? { ...rawVerdict, confidence: calibrateJudgeConfidence(candidate, rawVerdict.confidence) }
      : null;

    if (!verdict) {
      outcome.pending.push(pair);
      continue;
    }

    // 只保存建议，不执行任何合并/排除
    const suggestion = {
      primary: candidate.primary.name,
      secondary: candidate.secondary.name,
      confidence: verdict.confidence,
      reason: verdict.reason,
    };
    if (verdict.verdict === 'same') outcome.suggestedMerge.push(suggestion);
    else outcome.suggestedSeparate.push(suggestion);
    try {
      await EntityReviewRepository.create({
        bookId,
        entityType: 'character',
        entityId: candidate.primaryId,
        entityName: candidate.primary.name,
        actorType: 'SYSTEM',
        action: 'MERGE_SUGGESTED',
        afterValue: {
          primaryId: candidate.primaryId,
          secondaryId: candidate.secondaryId,
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          reason: verdict.reason,
        },
        changedFields: [],
        reason: verdict.reason ?? null,
      });
    } catch {
      // 审核历史写入失败不阻断建议返回
    }
  }

  return outcome;
}

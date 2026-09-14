import type { AgentType, Character } from '@qunxiang/core';
import { CharacterRepository, ReviewRepository, EntityReviewRepository } from '@qunxiang/storage';
import {
  buildCharacterMergeCandidates,
  calibrateJudgeConfidence,
  dropRedundantHonorificAliases,
  isSurnameStrippedNameVariant,
  MERGE_JUDGE_SYSTEM_PROMPT,
  mergeJudgeSchema,
  pickCanonicalName,
  summarizeMergeCandidateForPrompt,
  type CharacterMergeCandidate,
  type MergeJudgeVerdict,
} from '@qunxiang/entity-resolution';
import { getDefaultProvider } from '@qunxiang/llm';

export const reviewerAgentType: AgentType = 'reviewer';

export interface ReviewerPayload {
  bookId: string;
  userId: string;
  /** 本次运行绑定的 LLM 配置档案（多服务商支持；缺省用全局默认） */
  llmProfileId?: string;
  /** 兼容旧管线：prompt-generation 的整包结果，此处只用于日志计数，不再透传加工 */
  characters?: unknown[];
}

export interface ReviewerResult {
  message: string;
  count: number;
  /** 最终审核是否真正执行（模型不可用/无候选时为 false） */
  audited: boolean;
  /** 自动合并的对数（≥0.9 高置信，全部留痕 EntityReview） */
  autoMerged: number;
  /** 生成的合并建议数（0.7~0.9，待人工确认） */
  suggested: number;
  /** 正名修正次数（别名换成规范全名做正名） */
  canonicalSwapped: number;
  /** 别名降噪次数（删除称谓后缀冗余别名） */
  aliasCleaned: number;
}

/** 单次最终审核最多裁决的角色对数量（控制 LLM 调用成本） */
const MAX_AUDIT_PAIRS = 50;
/** 自动合并的校准置信度阈值：硬证据（名称包含变体/别名互指）+ 模型判定一致才够格 */
const AUTO_MERGE_CONFIDENCE = 0.9;
/** 裁决并发数（与人工触发的逐对裁决保持一致） */
const JUDGE_CONCURRENCY = 3;

/** 实体是否可参与自动合并：仅 AI 来源、未经人工审核/锁定（人工数据必须走建议） */
function isAutoMergeEligible(character: Character | undefined): boolean {
  if (!character) return false;
  if (character.status !== 'PENDING') return false;
  if (character.reviewSource && character.reviewSource !== 'AI') return false;
  if (character.lockedFields && character.lockedFields.length > 0) return false;
  return true;
}

/** 正名字段是否被用户锁定（锁定则跳过正名交换） */
function isNameLocked(character: Character): boolean {
  return Boolean(character.lockedFields?.includes('name'));
}

/**
 * 选自动合并的 primary：去姓变体对（宁荣荣/荣荣）规则优先——带姓氏的全名固定
 * 保留为正名，不采信 LLM 的 canonicalName 反向裁决（候选生成时 comparePrimary
 * 已按同一规则排序，这里做双保险）；非变体对才用 LLM 的 canonicalName（A=角色一
 * /primary，B=角色二/secondary），无裁决则沿用候选默认顺序。
 */
function pickAutoMergeOrder(
  candidate: CharacterMergeCandidate,
  verdict: MergeJudgeVerdict,
): [string, string] {
  const primaryFirst: [string, string] = [candidate.primaryId, candidate.secondaryId];
  const secondaryFirst: [string, string] = [candidate.secondaryId, candidate.primaryId];
  const canonical = pickCanonicalName(candidate.primary.name, candidate.secondary.name);
  if (canonical) {
    return canonical === candidate.primary.name.trim() ? primaryFirst : secondaryFirst;
  }
  if (verdict.canonicalName === 'A') return primaryFirst;
  if (verdict.canonicalName === 'B') return secondaryFirst;
  return primaryFirst;
}

interface AuditJudgeOutcome {
  verdict: MergeJudgeVerdict | null;
}

/** 并发裁决候选对（结果按候选顺序回填；单对失败记 null 不影响其他对） */
async function judgeCandidates(
  candidates: CharacterMergeCandidate[],
  profileId: string | undefined,
): Promise<{ outcomes: AuditJudgeOutcome[]; providerUnavailable: boolean; message?: string }> {
  let provider: Awaited<ReturnType<typeof getDefaultProvider>> | null = null;
  let providerUnavailable = false;
  let message: string | undefined;
  try {
    const candidateProvider = await getDefaultProvider(profileId);
    if (await candidateProvider.isConfigured()) {
      provider = candidateProvider;
    } else {
      providerUnavailable = true;
      message = '模型服务未配置，本次全部候选转人工判断';
    }
  } catch {
    providerUnavailable = true;
    message = '模型服务不可用，本次全部候选转人工判断';
  }

  const outcomes: AuditJudgeOutcome[] = new Array(candidates.length).fill(null).map(() => ({ verdict: null }));
  if (!provider) return { outcomes, providerUnavailable, message };

  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      let verdict: MergeJudgeVerdict | null = null;
      try {
        const userPrompt = [
          '请判断以下两个角色条目是否指同一角色。',
          '',
          '【角色一】',
          summarizeMergeCandidateForPrompt(candidate, 'primary'),
          '',
          '【角色二】',
          summarizeMergeCandidateForPrompt(candidate, 'secondary'),
        ].join('\n');
        const raw = await provider!.chatExtract(MERGE_JUDGE_SYSTEM_PROMPT, userPrompt, mergeJudgeSchema);
        const parsed = mergeJudgeSchema.safeParse(raw);
        if (parsed.success) verdict = parsed.data;
      } catch (error) {
        verdict = null;
        // 留痕：裁决调用失败此前被静默吞掉，用户只看到"无建议"却不知 LLM 调用挂了
        console.warn(`[ReviewerAgent] 裁决调用失败（${candidate.primary.name}/${candidate.secondary.name}）：${error instanceof Error ? error.message : error}`);
      }
      outcomes[index] = { verdict };
    }
  }
  await Promise.all(Array.from({ length: Math.min(JUDGE_CONCURRENCY, candidates.length) }, () => worker()));
  return { outcomes, providerUnavailable: false, message };
}

/**
 * 正名与别名治理（确定性规则，不调 LLM）：
 * 1. 正名交换：正名是昵称、别名里有带姓氏的规范全名（name=荣荣、aliases 含 宁荣荣）时
 *    交换两者，保证「正式全名在前、昵称作别名」；
 * 2. 别名降噪：删除与正名/其他别名只差称谓后缀的冗余别名（已有 宁荣荣 时删
 *    宁荣荣小姐/宁荣荣姑娘；已有 荣荣 时删 荣荣姐）。
 * 字段被用户锁定（lockedFields 含 name/aliases）时对应动作跳过。
 */
async function applyNameAndAliasNormalization(
  bookId: string,
  ownerId: string,
): Promise<{ swapped: number; aliasCleaned: number }> {
  const characters = await CharacterRepository.findByOwnedBookId(bookId, ownerId);
  let swapped = 0;
  let aliasCleaned = 0;
  for (const character of characters) {
    if (character.archivedAt || character.status === 'REJECTED') continue;
    const nameLocked = isNameLocked(character);
    const aliasesLocked = Boolean(character.lockedFields?.includes('aliases'));

    const cleanedAliases = aliasesLocked
      ? character.aliases
      : dropRedundantHonorificAliases(character.name, character.aliases);
    const canonicalAlias = nameLocked
      ? undefined
      : cleanedAliases.find(
          (alias) => isSurnameStrippedNameVariant(character.name, alias) && alias.length > character.name.length,
        );

    const aliasChanged = cleanedAliases.length !== character.aliases.length;
    if (!canonicalAlias && !aliasChanged) continue;

    const previousName = character.name;
    const nextName = canonicalAlias ?? character.name;
    const nextAliases = canonicalAlias
      ? [...new Set([previousName, ...cleanedAliases.filter((alias) => alias !== canonicalAlias)])]
      : [...new Set(cleanedAliases)];

    const updated = await CharacterRepository.updateOwned(character.id, ownerId, {
      name: nextName,
      aliases: nextAliases,
    });
    if (!updated) continue;
    if (canonicalAlias) swapped++;
    if (aliasChanged) aliasCleaned++;
    try {
      await EntityReviewRepository.create({
        bookId,
        entityType: 'character',
        entityId: character.id,
        entityName: nextName,
        actorType: 'SYSTEM',
        action: 'EDIT',
        beforeValue: { name: previousName, aliases: character.aliases },
        afterValue: { name: nextName, aliases: nextAliases },
        changedFields: canonicalAlias ? ['name', 'aliases'] : ['aliases'],
        reason: canonicalAlias
          ? `最终审核正名修正：${previousName} → ${nextName}（规范全名作正名，昵称转入别名）`
          : '最终审核别名降噪：删除与正名/其他别名只差称谓后缀的冗余别名',
      });
    } catch {
      // 审核历史写入失败不阻断修正
    }
    console.log(`[ReviewerAgent] 正名/别名治理：${previousName}${canonicalAlias ? ` → ${nextName}` : ''}${aliasChanged ? `（清理 ${character.aliases.length - cleanedAliases.length} 个冗余别名）` : ''}（书籍 ${bookId}）`);
  }
  return { swapped, aliasCleaned };
}

/**
 * 最终实体审核（管线的 reviewer 阶段，publishEntitiesStable 之后执行）：
 * 1. 用扩展后的候选检测（含姓氏剥离变体，宁荣荣/荣荣型）找出疑似同一人物的对；
 * 2. LLM 逐对裁决，校准置信度 ≥0.9 且双方均为 AI 来源待审实体时自动合并
 *    （primary 取规范正名，解决"昵称当正名"），全程写 EntityReview 留痕；
 * 3. 其余判定生成 MERGE_SUGGESTED 建议，留在审核页等人工确认；
 * 4. 正名修正：昵称作正名、别名里有规范全名的做确定性交换。
 *
 * 审核是增值步骤：任何异常只记日志降级返回，绝不使整条管线失败。
 */
async function auditFinalCharacters(
  bookId: string,
  ownerId: string,
  profileId: string | undefined,
): Promise<ReviewerResult> {
  const base: Omit<ReviewerResult, 'message'> = { count: 0, audited: false, autoMerged: 0, suggested: 0, canonicalSwapped: 0, aliasCleaned: 0 };
  const [allCharacters, rejections] = await Promise.all([
    CharacterRepository.findByOwnedBookId(bookId, ownerId),
    ReviewRepository.findMergeRejectionsByOwnedBook(bookId, ownerId),
  ]);
  const characters = allCharacters.filter((c) => !c.archivedAt && c.status !== 'REJECTED');
  const byId = new Map(characters.map((c) => [c.id, c]));

  const rejectedPairs = new Set(rejections.map((review) => `${review.characterId}:${review.newValue}`));
  const candidates = buildCharacterMergeCandidates(characters).filter(
    (candidate) => !rejectedPairs.has(`${candidate.primaryId}:${candidate.secondaryId}`),
  );
  if (candidates.length === 0) {
    // 无候选也跑一遍正名/别名治理（合并产生的 name/alias 关系可能需要修正）
    const { swapped, aliasCleaned } = await applyNameAndAliasNormalization(bookId, ownerId);
    return {
      ...base,
      count: characters.length,
      canonicalSwapped: swapped,
      aliasCleaned,
      message: `最终审核完成：无待裁决候选，正名修正 ${swapped} 处、别名降噪 ${aliasCleaned} 处`,
    };
  }

  const toJudge = candidates.slice(0, MAX_AUDIT_PAIRS);
  const { outcomes, providerUnavailable, message: providerMessage } = await judgeCandidates(toJudge, profileId);
  if (providerUnavailable) {
    return { ...base, count: characters.length, message: `最终审核跳过：${providerMessage}` };
  }

  let autoMerged = 0;
  let suggested = 0;
  const mergedEntityIds = new Set<string>();
  for (let index = 0; index < toJudge.length; index++) {
    const candidate = toJudge[index];
    const { verdict: rawVerdict } = outcomes[index];
    if (!rawVerdict || rawVerdict.verdict === 'uncertain') continue;

    const calibrated = calibrateJudgeConfidence(candidate, rawVerdict.confidence);
    if (calibrated < 0.7) continue;

    const primaryEntity = byId.get(candidate.primaryId);
    const secondaryEntity = byId.get(candidate.secondaryId);
    // 自动合并后该实体可能已被并入其他实体（链式候选），跳过已消失的实体
    if (!primaryEntity || !secondaryEntity) continue;

    if (rawVerdict.verdict === 'same' && calibrated >= AUTO_MERGE_CONFIDENCE
      && isAutoMergeEligible(primaryEntity) && isAutoMergeEligible(secondaryEntity)) {
      const [primaryId, secondaryId] = pickAutoMergeOrder(candidate, rawVerdict);
      const merged = await CharacterRepository.mergeOwned(primaryId, secondaryId, ownerId, ownerId);
      if (merged) {
        autoMerged++;
        mergedEntityIds.add(merged.id);
        try {
          await EntityReviewRepository.create({
            bookId,
            entityType: 'character',
            entityId: primaryId,
            entityName: merged.name,
            actorType: 'SYSTEM',
            action: 'MERGE_ACCEPTED',
            afterValue: { primaryId, secondaryId, confidence: calibrated, source: 'final-audit' },
            changedFields: [],
            reason: `最终审核自动合并（置信度 ${calibrated}）：${rawVerdict.reason ?? '同一人物'}`,
          });
        } catch {
          // 审核历史写入失败不回滚合并
        }
        console.log(`[ReviewerAgent] 自动合并：${candidate.primary.name} + ${candidate.secondary.name} → 保留 ${merged.name}（书籍 ${bookId}）`);
        continue;
      }
      // mergeOwned 失败（并发冲突等）→ 降级为建议
    }

    // 建议（same 但证据不足 / 涉人工数据；different 高置信标注）
    suggested++;
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
          verdict: rawVerdict.verdict,
          confidence: calibrated,
          reason: rawVerdict.reason,
        },
        changedFields: [],
        reason: rawVerdict.reason ?? null,
      });
    } catch {
      // 审核历史写入失败不影响统计
    }
  }

  const { swapped, aliasCleaned } = await applyNameAndAliasNormalization(bookId, ownerId);
  const summary = [
    `最终审核完成：裁决 ${toJudge.length} 对`,
    `自动合并 ${autoMerged} 对`,
    `生成建议 ${suggested} 条`,
    `正名修正 ${swapped} 处`,
    `别名降噪 ${aliasCleaned} 处`,
  ].join('，');
  console.log(`[ReviewerAgent] ${summary}（书籍 ${bookId}）`);
  return { count: characters.length, audited: true, autoMerged, suggested, canonicalSwapped: swapped, aliasCleaned, message: summary };
}

export async function executeReviewer(payload: unknown): Promise<ReviewerResult> {
  const { bookId, userId, llmProfileId, characters } = (payload ?? {}) as Partial<ReviewerPayload>;
  const legacyCount = Array.isArray(characters) ? characters.length : 0;

  // payload 中的整包实体结果（可达 MB 级）不再使用，只留定位日志（与 dispatcher 的任务日志一致）。
  console.log(`[ReviewerAgent] 收到审核入库任务：书籍 ${bookId ?? '未知'}，上游实体 ${legacyCount} 个`);

  if (!bookId || !userId) {
    return {
      message: '缺少 bookId/userId，跳过最终审核（提取结果已正常入库）',
      count: legacyCount,
      audited: false,
      autoMerged: 0,
      suggested: 0,
      canonicalSwapped: 0,
      aliasCleaned: 0,
    };
  }

  try {
    return await auditFinalCharacters(bookId, userId, llmProfileId);
  } catch (error) {
    // 审核是增值步骤：失败只降级，不阻断管线收尾
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[ReviewerAgent] 最终审核执行失败（提取结果不受影响）：书籍 ${bookId}，原因：${reason}`);
    return {
      message: `最终审核执行失败（提取结果不受影响）：${reason}`,
      count: legacyCount,
      audited: false,
      autoMerged: 0,
      suggested: 0,
      canonicalSwapped: 0,
      aliasCleaned: 0,
    };
  }
}

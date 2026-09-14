import { z } from 'zod';
import type { CharacterMergeCandidate } from './review-candidates.js';

/**
 * 共享的角色合并裁决逻辑：API 层（人工触发逐对裁决）与调度器 reviewer 阶段
 * （管线收尾最终审核）都基于同一套 prompt / 输出结构 / 置信度校准，
 * 保证两条链路的判定口径一致。
 */

/** LLM 对单个角色对的裁决结果 */
export const mergeJudgeSchema = z.object({
  verdict: z.enum(['same', 'different', 'uncertain']),
  confidence: z.number().min(0).max(1),
  /** 规范正名在哪个条目（A=角色一，B=角色二）；无法判断或 different 时为 unknown */
  canonicalName: z.enum(['A', 'B', 'unknown']).optional(),
  reason: z.string().optional(),
});

export type MergeJudgeVerdict = z.infer<typeof mergeJudgeSchema>;

/** 把候选对某一侧的实体摘要成裁决 prompt 的一行块（API 与最终审核共用同一格式）。 */
export function summarizeMergeCandidateForPrompt(
  candidate: CharacterMergeCandidate,
  side: 'primary' | 'secondary',
): string {
  const entity = candidate[side];
  const chapters = entity.chapterAppearances ?? [];
  return [
    `名称：${entity.name}`,
    `别名：${entity.aliases.length > 0 ? entity.aliases.join('、') : '无'}`,
    `描述：${entity.description || '无'}`,
    `出现章节：${chapters.length > 0 ? `第 ${chapters.slice(0, 10).join('、')} 章${chapters.length > 10 ? ` 等共 ${chapters.length} 章` : ''}` : '未知'}`,
  ].join('\n');
}

export const MERGE_JUDGE_SYSTEM_PROMPT = [
  '你是小说角色消歧助手。根据两个角色条目的信息，判断它们是否指同一个角色。',
  '判断要点：',
  '1. 称谓变体（如"萧炎"与"萧炎哥"、"古德里安"与"古德里安教授"、"薰儿"与"萧薰儿"）通常是同一角色。',
  '2. 名称带"小/老/大"前缀需谨慎：可能指幼体、后代或另一个独立个体（如"紫晶翼狮王"与"小紫晶翼狮王"可能是两代魔兽），必须结合描述判断，描述冲突时倾向 different。',
  '3. 别名互相包含对方名字时，强烈倾向 same。',
  '4. 一方名字恰是另一方去掉姓氏后的本名（如"宁荣荣"与"荣荣"）时，倾向 same。',
  '5. 两个角色的描述若指向明显不同的身份、实力或经历，应为 different。',
  '6. 信息不足以判断时返回 uncertain，不要猜测。',
  '',
  '若判定 same，同时用 canonicalName 指出哪个是规范正名（通常是带姓氏的正式全名，',
  '如"宁荣荣"是规范正名而"荣荣"是昵称；两边都是全名时选描述更完整、更像正式称呼的一边）。',
  '',
  '置信度必须按证据强度分档，不要一律给高分：',
  '- 0.90 以上：仅限"别名互相指认（A 的别名恰为 B 的正名或反之）、去掉姓氏后名字相同且描述身份/经历一致"这种有硬证据的情形。',
  '- 0.75~0.89：名称高度相近、描述不冲突但一方信息有限。',
  '- 0.70 以下：仅凭称谓风格相近、描述几乎无信息——此时应直接返回 uncertain 而不是给低置信结论。',
  '- different 的置信度同理：描述指向明确不同身份才可给 0.85 以上。',
  '只返回 JSON，格式：{"verdict": "same" | "different" | "uncertain", "confidence": 0.0-1.0, "canonicalName": "A" | "B" | "unknown", "reason": "简短中文理由，须点名依据（名称/别名/描述/章节）"}',
].join('\n');

/**
 * 证据校准：LLM 自报置信度有锚定倾向（无锚点时一律 0.9+），
 * 用客观信号（候选成对原因 + 章节重叠率）给显示值设上限。
 * 别名互指是最硬证据（0.99）；姓氏剥离变体（宁荣荣/荣荣）是强证据（0.95），
 * 多重证据叠加可到 0.98/0.99；仅称谓归一是弱证据（0.90）；
 * same 判定但两实体出现章节几乎零重叠时再降 0.15（同人不可能不同框）。
 */
export function calibrateJudgeConfidence(
  candidate: Pick<CharacterMergeCandidate, 'reasons' | 'primary' | 'secondary'>,
  selfReported: number,
): number {
  const hasAliasLink = candidate.reasons.includes('已提取别名匹配');
  const hasNameNorm = candidate.reasons.includes('称谓归一化');
  const hasVariant = candidate.reasons.includes('名称包含变体');

  let cap = 0.9;
  if (hasAliasLink && hasNameNorm) {
    cap = 0.99;
  } else if (hasAliasLink && hasVariant) {
    cap = 0.98;
  } else if (hasVariant && hasNameNorm) {
    cap = 0.98;
  } else if (hasAliasLink || hasVariant) {
    cap = 0.95;
  }

  const a = new Set(candidate.primary.chapterAppearances ?? []);
  const b = candidate.secondary.chapterAppearances ?? [];
  const overlap = b.filter((ch) => a.has(ch)).length;
  const minLen = Math.min(a.size, b.length);
  if (minLen > 0 && overlap / minLen < 0.1) {
    cap = Math.max(0.7, cap - 0.15);
  }
  return Math.round(Math.min(selfReported, cap) * 100) / 100;
}

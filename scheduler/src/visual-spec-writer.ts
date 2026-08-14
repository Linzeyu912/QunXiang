import { VisualSpecRepository } from '@novel-agent/storage';
import {
  buildVisualSpecDrafts,
  collectPromptsFromResult,
  versionKey,
} from './visual-spec-persist.js';

/** 重提时 SUPERSEDE 全书旧 ACTIVE，再按 prompts 写入新版本。失败由调用方决定是否吞掉。 */
export async function persistVisualSpecsFromResult(bookId: string, result: unknown): Promise<number> {
  const drafts = buildVisualSpecDrafts(bookId, collectPromptsFromResult(result));
  if (drafts.length === 0) return 0;
  await VisualSpecRepository.supersedeActive(bookId);
  const versions = await VisualSpecRepository.maxVersionsForBook(bookId);
  const rows = drafts.map((draft) => {
    const key = versionKey(draft.entityType, draft.entityName, draft.variantKey);
    const next = (versions.get(key) ?? 0) + 1;
    versions.set(key, next);
    return { ...draft, version: next, status: 'ACTIVE' as const };
  });
  return VisualSpecRepository.createMany(rows);
}

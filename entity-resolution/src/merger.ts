import type { Character, Outfit } from './types.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

const norm = (s: string): string => s.toLowerCase().trim();
const minDefined = (a?: number, b?: number): number | undefined =>
  a == null ? b : b == null ? a : Math.min(a, b);
const maxDefined = (a?: number, b?: number): number | undefined =>
  a == null ? b : b == null ? a : Math.max(a, b);

/**
 * Merge two outfit lists (cross-alias). Same set when scene labels match or one
 * description contains the other; union the chapter range and keep longer text.
 */
function mergeOutfits(a?: Outfit[] | null, b?: Outfit[] | null): Outfit[] {
  const acc: Outfit[] = (a || []).map((o) => ({ ...o }));
  for (const o of b || []) {
    const oScene = o.scene ? norm(o.scene) : '';
    const oDesc = norm(o.description);
    const match = acc.find((x) => {
      const xScene = x.scene ? norm(x.scene) : '';
      if (oScene && xScene && oScene === xScene) return true;
      const xDesc = norm(x.description);
      return Boolean(xDesc && oDesc && (xDesc.includes(oDesc) || oDesc.includes(xDesc)));
    });
    if (match) {
      if ((o.description || '').length > (match.description || '').length) match.description = o.description;
      if (!match.scene && o.scene) match.scene = o.scene;
      match.firstChapter = minDefined(match.firstChapter, o.firstChapter);
      match.lastChapter = maxDefined(match.lastChapter, o.lastChapter);
    } else {
      acc.push({ ...o });
    }
  }
  return acc;
}

/**
 * Merge two characters into one.
 * - description: concatenate with '; '
 * - confidence: take max
 * - chapterAppearances: merge and deduplicate
 * - aliases: merge and deduplicate
 * - outfits: merge by scene/description-containment
 * - other fields: take from primary character
 */
export function mergeCharacters(primary: CharacterInput, secondary: CharacterInput) {
  return {
    name: primary.name,
    // 合并别名时，把被吞并方（secondary）的 name 也纳入——
    // 否则 secondary 的名字会彻底丢失（它不再是独立实体，但应作为别名保留以便回溯）。
    // primary.name 自身不进 aliases（由 sanitizeEntityAliases 负责清理）。
    aliases: [...new Set([
      ...primary.aliases,
      ...secondary.aliases,
      ...(secondary.name && secondary.name !== primary.name ? [secondary.name] : []),
    ])],
    description: [primary.description, secondary.description]
      .filter(Boolean)
      .join('; '),
    confidence: Math.max(primary.confidence, secondary.confidence),
    status: primary.status,
    chapterRef: primary.chapterRef ?? secondary.chapterRef,
    // 用 minDefined/maxDefined：两者都 undefined 时保持 undefined，
    // 不再产生 Infinity（firstChapter）或 0（lastChapter）污染下游章节范围显示。
    firstChapter: minDefined(primary.firstChapter, secondary.firstChapter),
    lastChapter: maxDefined(primary.lastChapter, secondary.lastChapter),
    chapterAppearances: [
      ...new Set([...primary.chapterAppearances, ...secondary.chapterAppearances]),
    ].sort((a, b) => a - b),
    mentionCount: primary.mentionCount + secondary.mentionCount,
    dialogueCount: primary.dialogueCount + secondary.dialogueCount,
    coCharacters: [...new Set([...primary.coCharacters, ...secondary.coCharacters])],
    outfits: mergeOutfits(primary.outfits, secondary.outfits),
  };
}

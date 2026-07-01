import type { Chapter } from './extractor.js';

export interface CharacterSignals {
  name: string;
  mentionCount: number;
  dialogueCount: number;
  coCharacters: string[];
}

/**
 * 从章节文本中提取角色的信号
 * - mentionCount: 角色名+别名出现的总次数
 * - dialogueCount: 对话行数（通过引号匹配）
 * - coCharacters: 同章节出现的其他角色
 */
export function extractCharacterSignals(
  chapters: Chapter[],
  characterNames: string[]
): Map<string, CharacterSignals> {
  const signals = new Map<string, CharacterSignals>();

  // 初始化所有角色的信号
  for (const name of characterNames) {
    signals.set(name, {
      name,
      mentionCount: 0,
      dialogueCount: 0,
      coCharacters: [],
    });
  }

  for (const chapter of chapters) {
    const chapterCharsInThisChapter: string[] = [];

    // 1. 统计 mentionCount
    for (const charName of characterNames) {
      // \b doesn't work for CJK characters in JavaScript, so skip it for
      // names containing Chinese characters
      const hasCJK = /[一-鿿]/.test(charName);
      const boundary = hasCJK ? '' : '\\b';
      const pattern = new RegExp(`${boundary}${escapeRegex(charName)}${boundary}`, 'gi');
      const matches = chapter.content.match(pattern);
      if (matches) {
        const existing = signals.get(charName)!;
        existing.mentionCount += matches.length;
        chapterCharsInThisChapter.push(charName);
      }
    }

    // 2. 统计 dialogueCount（整章的对话数平分给该章出现的角色）
    // 网文多用全角弯引号 “…”（U+201C/U+201D），角括号「」/『』与 ASCII " 一并兼容
    const dialogueMatches = chapter.content.match(/[“「『"][^”」』"]*[”」』"]/g) || [];
    const dialogueCount = dialogueMatches.length;
    const charsInChapter = chapterCharsInThisChapter.length;

    if (charsInChapter > 0) {
      const perCharDialogue = Math.ceil(dialogueCount / charsInChapter);
      for (const charName of chapterCharsInThisChapter) {
        signals.get(charName)!.dialogueCount += perCharDialogue;
      }
    }

    // 3. 记录共现角色
    for (const charA of chapterCharsInThisChapter) {
      for (const charB of chapterCharsInThisChapter) {
        if (charA !== charB) {
          const charSignals = signals.get(charA)!;
          if (!charSignals.coCharacters.includes(charB)) {
            charSignals.coCharacters.push(charB);
          }
        }
      }
    }
  }

  return signals;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

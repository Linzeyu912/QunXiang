import type { Character } from '@novel-agent/core';
import type { Chapter } from './extractor.js';
import type { ExtractResult } from './extractor.js';

// Mock data from Journey to the West (西游记)
const MOCK_CHARACTERS: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: '唐僧',
    aliases: ['玄奘', '金蝉子', '唐三藏'],
    description: '取经团队领袖，原金蝉子转世，为西天取经而被选中',
    confidence: 0.95,
    status: 'PENDING',
    chapterAppearances: [1, 5, 10, 15, 20, 25],
    mentionCount: 150,
    dialogueCount: 45,
    coCharacters: ['孙悟空', '猪八戒', '沙悟净', '白龙马'],
  },
  {
    name: '孙悟空',
    aliases: ['齐天大圣', '美猴王', '猴哥', '弼马温'],
    description: '取经团队核心战力，大闹天宫后被压五指山五百年，后保护唐僧取经',
    confidence: 0.93,
    status: 'PENDING',
    chapterAppearances: [1, 2, 3, 5, 7, 10, 12, 14, 15, 17, 20, 22, 25],
    mentionCount: 300,
    dialogueCount: 120,
    coCharacters: ['唐僧', '猪八戒', '沙悟净', '白龙马'],
  },
  {
    name: '猪八戒',
    aliases: ['猪悟能', '天蓬元帅', '呆子'],
    description: '取经团队成员，因调戏嫦娥被贬下凡，错投猪胎',
    confidence: 0.91,
    status: 'PENDING',
    chapterAppearances: [5, 10, 15, 20, 25],
    mentionCount: 180,
    dialogueCount: 65,
    coCharacters: ['唐僧', '孙悟空', '沙悟净'],
  },
  {
    name: '沙悟净',
    aliases: ['沙僧', '卷帘大将'],
    description: '取经团队成员，原天宫卷帘大将，因打破琉璃盏被贬下凡',
    confidence: 0.88,
    status: 'PENDING',
    chapterAppearances: [10, 15, 20, 25],
    mentionCount: 90,
    dialogueCount: 25,
    coCharacters: ['唐僧', '孙悟空', '猪八戒'],
  },
  {
    name: '白龙马',
    aliases: ['小白龙'],
    description: '取经团队脚力，西海龙王三太子所化，因纵火烧了明珠被贬',
    confidence: 0.85,
    status: 'PENDING',
    chapterAppearances: [15, 20, 25],
    mentionCount: 40,
    dialogueCount: 8,
    coCharacters: ['唐僧', '孙悟空'],
  },
];

/**
 * Mock character extraction
 * In MVP, this returns hardcoded Journey to the West characters
 * In production, this would call LLM API
 */
export async function extractCharacters(
  _bookTitle: string,
  _chapters: Chapter[]
): Promise<ExtractResult> {
  // Simulate async LLM call
  await new Promise(resolve => setTimeout(resolve, 500));

  const totalBatches = Math.ceil(_chapters.length / 30) || 1;

  // Return mock data - in production this would be actual LLM extraction
  return {
    characters: MOCK_CHARACTERS.map(c => ({ ...c })),
    items: [],
    locations: [],
    failedBatches: [],
    totalBatches,
    successfulBatches: totalBatches,
  };
}

export { MOCK_CHARACTERS };

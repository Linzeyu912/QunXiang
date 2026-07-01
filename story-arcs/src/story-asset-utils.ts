import type { DescriptionQuality, StoryAssetStatus, StorySegment } from './types.js';

/**
 * Convert a book title into a clean, human-readable directory name.
 * Keeps CJK characters (readable), removes path-illegal chars, spaces → hyphens.
 * e.g. "斗破苍穹 1-10" → "斗破苍穹-1-10"
 */
export function bookSlug(title: string): string {
  return title
    .trim()
    .replace(/[/\\:*?"<>|]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function findEvidence(text: string, needle: string, fallback: string): string[] {
  const sentences = splitSentences(text);
  const matched = sentences.filter((sentence) => sentence.includes(needle)).slice(0, 3);
  return matched.length > 0 ? matched : [fallback];
}

export function chaptersFor(story: StorySegment): number[] {
  const chapters: number[] = [];
  for (let chapter = story.startChapter; chapter <= story.endChapter; chapter++) {
    chapters.push(chapter);
  }
  return chapters;
}

export function qualityFor(description: string): {
  descriptionQuality: DescriptionQuality;
  needsDescriptionRepair: boolean;
} {
  const length = description.trim().length;
  if (length === 0) {
    return { descriptionQuality: 'missing', needsDescriptionRepair: true };
  }
  if (length < 18) {
    return { descriptionQuality: 'thin', needsDescriptionRepair: true };
  }
  return { descriptionQuality: 'sufficient', needsDescriptionRepair: false };
}

export function statusFor(confidence: number): StoryAssetStatus {
  return confidence >= 0.75 ? 'confirmed' : 'candidate';
}

export function sourceRangeHint(story: StorySegment): string {
  return `chapters ${story.startChapter}-${story.endChapter}`;
}

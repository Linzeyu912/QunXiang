import type { ParsedChapter, ParseResult } from '@novel-agent/import';
import type { ChapterSegment, SegmentChapter } from './arc-types.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_MIN_CHAPTER_LENGTH = 500;
const DIALOGUE_PATTERNS = [
  /["""]([^"""]+)["""]/g,
  /[']([^']+)[']/g,
  /["]([^"]+)["]/g,
  /^["""].*["""]/gm,
];

const SCENE_TRANSITION_PATTERNS = [
  /^(===.*===)$/gm,
  /^(第.+章.*)$/gm,
  /^(Chapter\s+\d+.*)$/gim,
  /^\*\*\*$/gm,
];

const TIME_MARKERS = [
  /(\d+\s*(秒|分钟|小时|天|周|月|年|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*(后|前|later|ago|earlier))/i,
  /(早上|中午|下午|晚上|凌晨|黎明|黄昏|早晨|夜晚| morning| noon| afternoon| evening| night| dawn| dusk| sunrise| sunset)/i,
  /(星期一|星期二|星期三|星期四|星期五|星期六|星期日|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
];

const LOCATION_MARKERS = [
  /(在|来到|到达|前往|来到|进入|出了|出了| from| to| at| in| into| out of)/i,
  /^(地点|场景|位置|场景切换|Scene|Location):/gim,
];

function detectSceneChanges(content: string): boolean[] {
  const changes: boolean[] = new Array(content.length).fill(false);
  let lastType = 'description';

  for (const pattern of SCENE_TRANSITION_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match.index !== undefined) {
        changes[match.index] = true;
      }
    }
  }

  return changes;
}

function segmentChapterContent(
  chapter: ParsedChapter,
  options: { minChapterLength?: number; sceneChangeThreshold?: number } = {}
): ChapterSegment[] {
  const { minChapterLength = DEFAULT_MIN_CHAPTER_LENGTH } = options;
  const content = chapter.content;
  const segments: ChapterSegment[] = [];

  if (content.length < minChapterLength) {
    segments.push({
      id: uuidv4(),
      chapterIndex: chapter.index,
      segmentIndex: 0,
      content: content,
      type: 'DESCRIPTION',
      sceneChange: false,
      startPosition: 0,
      endPosition: content.length,
    });
    return segments;
  }

  const sceneChanges = detectSceneChanges(content);
  let currentSegmentStart = 0;
  let currentSegmentType: ChapterSegment['type'] = 'DESCRIPTION';
  let segmentIndex = 0;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const isDialogue = DIALOGUE_PATTERNS.some(p => {
      const matches = [...content.matchAll(p)];
      return matches.some(m => i >= (m.index || 0) && i < (m.index || 0) + m[0].length);
    });

    const isTimeChange = TIME_MARKERS.some(p => p.test(content.substring(Math.max(0, i - 20), i + 20)));
    const isLocationChange = LOCATION_MARKERS.some(p => p.test(content.substring(Math.max(0, i - 20), i + 20)));
    const isSceneTransition = sceneChanges[i];

    let newType: ChapterSegment['type'] = currentSegmentType;

    if (isDialogue) {
      newType = 'DIALOGUE';
    } else if (isSceneTransition || isTimeChange || isLocationChange) {
      newType = 'TRANSITION';
    } else if (isTimeChange) {
      newType = 'SCENE';
    } else {
      newType = 'DESCRIPTION';
    }

    if (newType !== currentSegmentType && i > currentSegmentStart + 50) {
      segments.push({
        id: uuidv4(),
        chapterIndex: chapter.index,
        segmentIndex: segmentIndex++,
        content: content.substring(currentSegmentStart, i).trim(),
        type: currentSegmentType,
        sceneChange: currentSegmentType === 'TRANSITION',
        startPosition: currentSegmentStart,
        endPosition: i,
      });

      currentSegmentStart = i;
      currentSegmentType = newType;
    }
  }

  if (currentSegmentStart < content.length) {
    segments.push({
      id: uuidv4(),
      chapterIndex: chapter.index,
      segmentIndex: segmentIndex,
      content: content.substring(currentSegmentStart).trim(),
      type: currentSegmentType,
      sceneChange: currentSegmentType === 'TRANSITION',
      startPosition: currentSegmentStart,
      endPosition: content.length,
    });
  }

  return segments;
}

export function segmentChapters(
  chapters: ParsedChapter[],
  options: { minChapterLength?: number; sceneChangeThreshold?: number } = {}
): SegmentChapter[] {
  return chapters.map(chapter => {
    const segments = segmentChapterContent(chapter, options);
    return {
      index: chapter.index,
      title: chapter.title,
      segments,
      fullContent: chapter.content,
    };
  });
}

export function segmentParseResult(
  parseResult: ParseResult,
  options: { minChapterLength?: number; sceneChangeThreshold?: number } = {}
): SegmentChapter[] {
  return segmentChapters(parseResult.chapters, options);
}

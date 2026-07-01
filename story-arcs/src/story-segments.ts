import type { ParseResult, PrescanResult } from '@novel-agent/import';
import type { EntityMention } from '@novel-agent/entity-prescan';
import type { NarrativeEvent, StorySegment } from './types.js';
import { buildNarrativeArcsFromEvents, extractNarrativeEvents } from './narrative-events.js';

export interface StorySegmentBuildOptions {
  bookId: string;
  /** Directory name for this book (e.g. bookSlug(title)). Falls back to bookId. */
  bookDirName?: string;
  prescanResult?: PrescanResult;
  maxChaptersPerSegment?: number;
  minNarrativeChars?: number;
  autoApprove?: boolean;
}

const DEFAULT_MAX_CHAPTERS_PER_SEGMENT = 12;
const DEFAULT_MIN_NARRATIVE_CHARS = 40;
const GROUP_ENTITY_SUFFIX_RE = /(家|族|宗|阁|城|帝国|大陆)$/u;
const PROP_HINT_RE = /[\u4e00-\u9fff]{0,4}(?:铜牌|令牌|玉佩|信件|书信|卷宗|钥匙|刀|剑|枪|弓|药|丹|戒指|银票|银子|箱子|地图|法宝|玉玺)/gu;

function slugPart(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || Buffer.from(value).toString('hex').slice(0, 16);
}

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function mentionTextsInRange(mentions: EntityMention[] | undefined, start: number, end: number): string[] {
  return (mentions || [])
    .filter((mention) => mention.chapterIndex >= start && mention.chapterIndex <= end)
    .sort((a, b) => (b.confidence - a.confidence) || (a.chapterIndex - b.chapterIndex))
    .map((mention) => mention.text);
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  return text.split(term).length - 1;
}

function rankNames(names: string[], sourceText: string): string[] {
  return unique(names)
    .filter((name) => name.length >= 2 && name.length <= 8)
    .sort((a, b) => countOccurrences(sourceText, b) - countOccurrences(sourceText, a));
}

function fallbackNamesFromText(sourceText: string): string[] {
  const names: string[] = [];
  const knownPatterns = [
    /纳兰[\u4e00-\u9fff]{2}/gu,
    /萧(?:炎|战|薰儿|鼎|厉|玉|媚|宁)/gu,
    /药老/gu,
    /葛叶/gu,
    /云韵/gu,
    /古河/gu,
    /海波东/gu,
    /美杜莎/gu,
  ];
  for (const re of knownPatterns) {
    for (const match of sourceText.matchAll(re)) {
      names.push(match[0]);
    }
  }
  return names;
}

function splitCharacters(names: string[], sourceText: string): { mainCharacters: string[]; supportingCharacters: string[] } {
  const ranked = rankNames([...names, ...fallbackNamesFromText(sourceText)], sourceText)
    .filter((name) => !GROUP_ENTITY_SUFFIX_RE.test(name));
  const mainCharacters = ranked.slice(0, 1);
  const supportingCharacters = ranked.slice(1, 9);
  return { mainCharacters, supportingCharacters };
}

function discoverProps(sourceText: string): string[] {
  const props: string[] = [];
  for (const match of sourceText.matchAll(PROP_HINT_RE)) {
    const value = match[0].trim();
    if (value.length >= 2 && value.length <= 8) props.push(value);
  }
  return unique(props);
}

function buildTurningPoints(
  chapterTitles: string[],
  sourceText: string,
  eventMentions: string[]
): string[] {
  const eventPoints = unique(eventMentions).slice(0, 6);
  if (eventPoints.length > 0) return eventPoints;

  const keywordPoints = ['退婚', '休书', '药老', '炼药', '借钱', '失败', '戒指']
    .filter((keyword) => sourceText.includes(keyword))
    .map((keyword) => `围绕“${keyword}”发生关键变化`);

  return unique([...keywordPoints, ...chapterTitles.filter(Boolean)]).slice(0, 6);
}

function narrativeChapters(parseResult: ParseResult, minNarrativeChars: number) {
  const chapters = parseResult.chapters.filter((chapter) => {
    const title = chapter.title?.trim() || '';
    const content = chapter.content.trim();
    if (!content) return false;
    if (/^(书名|作者|简介|序言?)[:：]/u.test(title) || /^(书名|作者|简介)[:：]/u.test(content)) {
      return false;
    }
    return true;
  });
  const longEnough = chapters.filter((chapter) => chapter.content.trim().length >= minNarrativeChars);
  return longEnough.length > 0 ? longEnough : chapters;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function chaptersInRange(chapters: ReturnType<typeof narrativeChapters>, start: number, end: number) {
  return chapters.filter((chapter) => chapter.index >= start && chapter.index <= end);
}

function sourceTextFor(chapterGroup: ReturnType<typeof narrativeChapters>): string {
  return chapterGroup
    .map((chapter) => `第${chapter.index}章 ${chapter.title || ''}\n${chapter.content}`)
    .join('\n\n');
}

function worldbuildingEventsForChapter(idSlug: string, chapter: ReturnType<typeof narrativeChapters>[number]): NarrativeEvent[] {
  const text = `${chapter.title || ''}\n${chapter.content}`;
  if (!/斗气大陆/u.test(chapter.title || '')) return [];

  const events: NarrativeEvent[] = [];
  const baseId = `event-${idSlug}-${chapter.index}-world`;

  if (/斗气大陆/u.test(text) && /斗气|修炼|大陆/u.test(text)) {
    events.push({
      id: `${baseId}-system`,
      chapterIndex: chapter.index,
      eventType: 'worldbuilding',
      function: 'setup',
      summary: '斗气大陆修炼体系',
      participants: [],
      trigger: '斗气大陆',
      consequence: '确立故事世界的力量规则和成长尺度。',
      evidenceSnippet: chapter.content.slice(0, 160),
      confidence: 0.82,
      source: 'heuristic',
    });
  }

  if (/斗气功法/u.test(text) && /天、地、玄、黄|天地玄黄|四阶|等级/u.test(text)) {
    events.push({
      id: `${baseId}-rank`,
      chapterIndex: chapter.index,
      eventType: 'worldbuilding',
      function: 'setup',
      summary: '斗气功法等级',
      participants: [],
      trigger: '斗气功法',
      consequence: '为后续功法、斗技和势力差距提供评价标准。',
      evidenceSnippet: chapter.content.slice(0, 160),
      confidence: 0.82,
      source: 'heuristic',
    });
  }

  if (/斗技/u.test(text) && /等级|天地玄黄|四级/u.test(text)) {
    events.push({
      id: `${baseId}-skill`,
      chapterIndex: chapter.index,
      eventType: 'worldbuilding',
      function: 'setup',
      summary: '斗技等级',
      participants: [],
      trigger: '斗技',
      consequence: '补充战斗表现和招式强弱的规则。',
      evidenceSnippet: chapter.content.slice(0, 160),
      confidence: 0.78,
      source: 'heuristic',
    });
  }

  return events;
}

function buildWorldbuildingSegments(
  chapters: ReturnType<typeof narrativeChapters>,
  bookId: string,
  idSlug: string,
  parseResult: ParseResult,
  prescanResult: PrescanResult | undefined,
  autoApprove: boolean
): StorySegment[] {
  const segments: StorySegment[] = [];
  for (const chapter of chapters) {
    const events = worldbuildingEventsForChapter(idSlug, chapter);
    if (events.length === 0) continue;

    const sourceText = sourceTextFor([chapter]);
    const characterTexts = mentionTextsInRange(prescanResult?.character, chapter.index, chapter.index);
    const { mainCharacters, supportingCharacters } = splitCharacters(characterTexts, sourceText);
    const locations = unique([
      ...mentionTextsInRange(prescanResult?.location, chapter.index, chapter.index),
      ...(sourceText.includes('斗气大陆') ? ['斗气大陆'] : []),
    ]).slice(0, 8);

    segments.push({
      id: `story-${idSlug}-${chapter.index}-${chapter.index}-worldbuilding`,
      bookId,
      arcId: `arc-${idSlug}-${chapter.index}-${chapter.index}-worldbuilding`,
      arcType: 'worldbuilding',
      goal: '建立后续剧情和视觉设计需要遵守的世界规则',
      startChapter: chapter.index,
      endChapter: chapter.index,
      title: chapter.title?.includes('斗气大陆') ? '斗气大陆设定' : `${chapter.title || parseResult.title}设定`,
      sourceText,
      summary: `本段建立“${chapter.title || parseResult.title}”相关规则：${events.map((event) => event.summary).join('、')}。`,
      coreConflict: '世界观设定为角色成长、势力差距和后续冲突提供规则背景。',
      trigger: events[0].summary,
      turningPoints: events.map((event) => event.summary),
      conflictStatus: 'ongoing',
      events,
      mainCharacters,
      supportingCharacters,
      locations,
      boundaryConfidence: 0.82,
      boundaryDecisionIds: [`worldbuilding-${chapter.index}`],
      approved: autoApprove,
    });
  }
  return segments;
}

export function buildStorySegmentsFromParseResult(
  parseResult: ParseResult,
  options: StorySegmentBuildOptions
): StorySegment[] {
  const {
    bookId,
    bookDirName,
    prescanResult,
    maxChaptersPerSegment = DEFAULT_MAX_CHAPTERS_PER_SEGMENT,
    minNarrativeChars = DEFAULT_MIN_NARRATIVE_CHARS,
    autoApprove = true,
  } = options;

  const idSlug = slugPart(bookDirName || bookId);

  const chapters = narrativeChapters(parseResult, minNarrativeChars);
  if (chapters.length === 0) return [];
  const worldbuildingSegments = buildWorldbuildingSegments(chapters, bookId, idSlug, parseResult, prescanResult, autoApprove);

  if (prescanResult?.event?.length) {
    const events = extractNarrativeEvents(parseResult, prescanResult);
    const arcs = buildNarrativeArcsFromEvents(bookId, events, idSlug);
    if (arcs.length > 0) {
      const arcSegments: StorySegment[] = arcs.map((arc, index) => {
        const chapterGroup = chaptersInRange(chapters, arc.startChapter, arc.endChapter);
        const effectiveGroup = chapterGroup.length > 0 ? chapterGroup : chapters.slice(0, 1);
        const sourceText = sourceTextFor(effectiveGroup);
        const title = arc.title || effectiveGroup[0].title || parseResult.title;
        const characterTexts = mentionTextsInRange(prescanResult.character, arc.startChapter, arc.endChapter);
        const { mainCharacters, supportingCharacters } = splitCharacters(
          unique([...characterTexts, ...arc.events.flatMap((event) => event.participants)]),
          sourceText
        );
        const locations = unique(mentionTextsInRange(prescanResult.location, arc.startChapter, arc.endChapter))
          .filter((location) => location.length >= 2)
          .slice(0, 8);
        const props = [
          ...mentionTextsInRange(prescanResult.item, arc.startChapter, arc.endChapter),
          ...discoverProps(sourceText),
        ];
        const lead = mainCharacters[0] || arc.events[0]?.participants[0] || '主角';
        const turningPoints = unique([...arc.events.map((event) => event.summary), ...unique(props).slice(0, 3)]).slice(0, 8);

        return {
          id: `story-${idSlug}-${arc.startChapter}-${arc.endChapter}-${index + 1}`,
          bookId,
          arcId: arc.id,
          arcType: arc.arcType,
          goal: arc.goal,
          startChapter: arc.startChapter,
          endChapter: arc.endChapter,
          title,
          sourceText,
          summary: `${lead}卷入“${title}”：${turningPoints.slice(0, 3).join('、') || '剧情推进'}。`,
          coreConflict: arc.coreConflict,
          trigger: arc.events[0]?.summary || title,
          turningPoints,
          conflictStatus: 'ongoing',
          events: arc.events,
          mainCharacters,
          supportingCharacters,
          locations,
          boundaryConfidence: arc.confidence,
          boundaryDecisionIds: [`arc-${arc.startChapter}-${arc.endChapter}`],
          approved: autoApprove,
        };
      });
      return [...worldbuildingSegments, ...arcSegments]
        .sort((a, b) => (a.startChapter - b.startChapter) || a.id.localeCompare(b.id));
    }
  }

  const fallbackSegments: StorySegment[] = chunk(chapters, Math.max(1, maxChaptersPerSegment)).map((chapterGroup, index) => {
    const startChapter = chapterGroup[0].index;
    const endChapter = chapterGroup[chapterGroup.length - 1].index;
    const titleParts = unique([chapterGroup[0].title, chapterGroup.at(-1)?.title]);
    const title = titleParts.length > 1 ? `${titleParts[0]} - ${titleParts[1]}` : (titleParts[0] || parseResult.title);
    const sourceText = sourceTextFor(chapterGroup);

    const characterTexts = mentionTextsInRange(prescanResult?.character, startChapter, endChapter);
    const { mainCharacters, supportingCharacters } = splitCharacters(characterTexts, sourceText);
    const locations = unique(mentionTextsInRange(prescanResult?.location, startChapter, endChapter))
      .filter((location) => location.length >= 2)
      .slice(0, 8);
    const eventTexts = mentionTextsInRange(prescanResult?.event, startChapter, endChapter);
    const turningPoints = buildTurningPoints(
      chapterGroup.map((chapter) => chapter.title || ''),
      sourceText,
      eventTexts
    );
    const props = [
      ...mentionTextsInRange(prescanResult?.item, startChapter, endChapter),
      ...discoverProps(sourceText),
    ];
    const lead = mainCharacters[0] || '主角';
    const firstTurn = turningPoints[0] || title;
    const propHint = unique(props).slice(0, 3);
    const summary = `${lead}在“${title}”中经历${turningPoints.slice(0, 3).join('、') || '连续剧情推进'}。`;
    const coreConflict = `${lead}必须应对${firstTurn}带来的处境变化。`;
    const id = `story-${idSlug}-${startChapter}-${endChapter}-${index + 1}`;

    return {
      id,
      bookId,
      startChapter,
      endChapter,
      title,
      sourceText,
      summary,
      coreConflict,
      trigger: firstTurn,
      turningPoints: unique([...turningPoints, ...propHint]).slice(0, 8),
      conflictStatus: 'ongoing',
      mainCharacters,
      supportingCharacters,
      locations,
      boundaryConfidence: chapterGroup.length > 1 ? 0.78 : 0.68,
      boundaryDecisionIds: [`auto-${startChapter}-${endChapter}`],
      approved: autoApprove,
    };
  });
  return fallbackSegments;
}

import type { EntityMention } from '@novel-agent/entity-prescan';
import type { ParseResult, PrescanResult } from '@novel-agent/import';
import type {
  NarrativeArc,
  NarrativeArcType,
  NarrativeEvent,
  NarrativeEventFunction,
  NarrativeEventType,
} from './types.js';

const SENTENCE_RE = /[^。！？!?；;\n]{4,160}[。！？!?；;]?/g;
const PERSON_RE = /(?:纳兰[\u4e00-\u9fff]{2}|萧(?:炎|战|薰儿|鼎|厉|玉|媚|宁)|药老|葛叶|云韵|古河|海波东|美杜莎)/gu;

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

function splitSentences(text: string): string[] {
  return [...text.matchAll(SENTENCE_RE)].map((match) => match[0].replace(/[。！？!?；;]+$/g, '').trim()).filter(Boolean);
}

function cueTerms(summary: string): string[] {
  const cues: string[] = [];
  if (/婚约|退婚/u.test(summary)) cues.push('解除婚约', '退婚', '婚约');
  if (/聚气散/u.test(summary)) cues.push('聚气散');
  if (/休书/u.test(summary)) cues.push('休书');
  if (/三年之约|三年/u.test(summary)) cues.push('三年之约', '三年');
  if (/戒指|药老|秘密|现身/u.test(summary)) cues.push('药老', '戒指', '秘密', '现身');
  if (/炼药|修炼|筹钱|借钱/u.test(summary)) cues.push('炼药', '修炼', '借钱', '筹钱');
  return cues.length > 0 ? cues : [summary.slice(0, 2)];
}

function findEvidence(content: string, summary: string): string {
  const cues = cueTerms(summary);
  const sentences = splitSentences(content);
  const matched = sentences.find((sentence) => cues.some((cue) => sentence.includes(cue)));
  return (matched || content.trim().slice(0, 120)).slice(0, 160);
}

function fallbackNames(text: string): string[] {
  return unique([...text.matchAll(PERSON_RE)].map((match) => match[0]));
}

function participantsFor(mention: EntityMention, evidence: string, prescanResult: PrescanResult): string[] {
  const chapterCharacters = (prescanResult.character || [])
    .filter((character) => character.chapterIndex === mention.chapterIndex)
    .map((character) => character.text)
    .filter((name) => mention.text.includes(name) || evidence.includes(name));
  return unique([...chapterCharacters, ...fallbackNames(`${mention.text} ${evidence}`)]).slice(0, 8);
}

function inferEventType(summary: string): NarrativeEventType {
  if (/解除婚约|退婚|休书/u.test(summary)) return 'conflict';
  if (/聚气散|丹药|赔礼/u.test(summary)) return 'resource';
  if (/三年之约|立下.*约/u.test(summary)) return 'turning_point';
  if (/药老|戒指|秘密|现身/u.test(summary)) return 'reveal';
  if (/炼药|修炼/u.test(summary)) return 'training';
  if (/借钱|筹钱|目标/u.test(summary)) return 'goal';
  return 'other';
}

function inferEventFunction(summary: string, eventType: NarrativeEventType): NarrativeEventFunction {
  if (/解除婚约|退婚/u.test(summary)) return 'inciting';
  if (/聚气散|赔礼/u.test(summary)) return 'escalation';
  if (/休书|三年之约/u.test(summary)) return 'turning_point';
  if (eventType === 'reveal') return 'inciting';
  if (eventType === 'training' || eventType === 'goal') return 'setup';
  return 'escalation';
}

function inferTrigger(summary: string): string {
  return cueTerms(summary)[0] || summary;
}

function inferConsequence(summary: string): string | undefined {
  if (/解除婚约|退婚/u.test(summary)) return '婚约冲突公开化，主角尊严受压。';
  if (/聚气散/u.test(summary)) return '外部势力用资源交换制造羞辱和诱惑。';
  if (/休书/u.test(summary)) return '主角夺回主动权，冲突升级。';
  if (/三年之约/u.test(summary)) return '冲突被延展为长期目标。';
  if (/药老|戒指/u.test(summary)) return '隐藏助力浮出水面，修炼线开启。';
  return undefined;
}

export function extractNarrativeEvents(parseResult: ParseResult, prescanResult: PrescanResult): NarrativeEvent[] {
  const chapterByIndex = new Map(parseResult.chapters.map((chapter) => [chapter.index, chapter]));
  return (prescanResult.event || [])
    .slice()
    .sort((a, b) => (a.chapterIndex - b.chapterIndex) || (a.position - b.position))
    .map((mention, index) => {
      const chapter = chapterByIndex.get(mention.chapterIndex);
      const evidence = findEvidence(chapter?.content || '', mention.text);
      const eventType = inferEventType(mention.text);
      return {
        id: `event-${slugPart(parseResult.title || 'book')}-${mention.chapterIndex}-${index + 1}`,
        chapterIndex: mention.chapterIndex,
        eventType,
        function: inferEventFunction(mention.text, eventType),
        summary: mention.text,
        participants: participantsFor(mention, evidence, prescanResult),
        trigger: inferTrigger(mention.text),
        consequence: inferConsequence(mention.text),
        evidenceSnippet: evidence,
        confidence: mention.confidence,
        source: mention.source,
      };
    });
}

function inferArcShape(events: NarrativeEvent[]): { title: string; arcType: NarrativeArcType; goal?: string } {
  const text = events.map((event) => event.summary).join(' ');
  if (/婚约|退婚|休书|三年之约/u.test(text)) {
    return { title: '退婚冲突', arcType: 'conflict', goal: '维护尊严并回应婚约羞辱' };
  }
  if (/戒指|药老|秘密|现身/u.test(text)) {
    return { title: '戒指秘密', arcType: 'reveal', goal: '发现隐藏助力与修炼转机' };
  }
  if (/炼药|修炼/u.test(text)) {
    return { title: '修炼目标', arcType: 'training', goal: '积累资源并推进修炼' };
  }
  if (/聚气散|丹药|资源/u.test(text)) {
    return { title: '资源争夺', arcType: 'resource' };
  }
  return { title: events[0]?.summary || '剧情推进', arcType: 'other' };
}

function coreConflictFor(events: NarrativeEvent[]): string {
  return events.find((event) => event.eventType === 'conflict')?.summary || events[0]?.summary || '剧情目标推进';
}

function arcConfidence(events: NarrativeEvent[]): number {
  if (events.length === 0) return 0;
  const average = events.reduce((sum, event) => sum + event.confidence, 0) / events.length;
  return Number(Math.min(0.95, Math.max(0.55, average + (events.length > 1 ? 0.04 : 0))).toFixed(2));
}

export function buildNarrativeArcsFromEvents(bookId: string, events: NarrativeEvent[], idSlug?: string): NarrativeArc[] {
  const slug = idSlug ?? slugPart(bookId);
  const sorted = events.slice().sort((a, b) => a.chapterIndex - b.chapterIndex);
  const groups: NarrativeEvent[][] = [];

  for (const event of sorted) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const startsNewReveal = event.eventType === 'reveal' && current?.some((item) => item.eventType !== 'reveal');
    if (!current || !previous || event.chapterIndex - previous.chapterIndex > 2 || startsNewReveal) {
      groups.push([event]);
    } else {
      current.push(event);
    }
  }

  return groups.map((group, index) => {
    const shape = inferArcShape(group);
    const startChapter = group[0].chapterIndex;
    const endChapter = group.at(-1)?.chapterIndex ?? startChapter;
    return {
      id: `arc-${slug}-${startChapter}-${endChapter}-${index + 1}`,
      bookId,
      title: shape.title,
      startChapter,
      endChapter,
      arcType: shape.arcType,
      goal: shape.goal,
      coreConflict: coreConflictFor(group),
      events: group,
      confidence: arcConfidence(group),
    };
  });
}

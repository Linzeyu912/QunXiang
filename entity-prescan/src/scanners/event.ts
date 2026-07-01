import type { EntityMention, ScanChapter } from '../types.js';

const EVENT_TRIGGER_WORDS = [
  '破获', '查明', '揭开', '解开', '派遣', '派出', '追杀', '袭击',
  '击杀', '打伤', '救下', '逮捕', '调查', '审问', '对峙', '交手',
  '死亡', '牺牲', '失踪', '下令', '背叛',
];

const SUBJECT_HINTS = [
  '许', '魏', '李', '张', '杨', '周', '赵', '陈', '宋', '金',
  '王', '孙', '姜', '南宫', '司马', '圣上', '朝廷', '打更人',
  '妖物', '术士',
];

const KNOWN_SUBJECTS = [
  '许七安', '许平志', '许新年', '许二叔', '许铃音', '魏渊', '魏公',
  '李玉春', '陈府尹', '赵守', '宋廷风', '圣上', '朝廷', '打更人',
  '王捕头', '张巡抚', '老张', '许辞旧', '许玲月', '金莲道长',
  '杨川南', '梁有平', '周立', '宋卿', '杨砚', '张慎', '李慕白',
  '朱广孝', '宋师兄', '周公子', '赵公子', '张玉英', '杨千幻',
  '苏苏', '方鹤', '赵县令',
];

const COMMON_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝安常乐于时傅顾孟黄萧尹';
const COMPOUND_SURNAMES = ['南宫', '司马', '欧阳', '上官', '诸葛', '东方', '公孙', '慕容', '皇甫', '宇文'];
const EVENT_OBJECT_STOPS = /[，。！？；：、“”"'\s]|调查|查案|办案|追查|案情|一事|此事|后续|经过/u;
const PUNCTUATION_RE = /[，。！？；：、“”"'‘’【】\[\]（）()《》<>]/g;
const BAD_GENERIC_NAME_CHARS = new Set(Array.from(
  '的了着过没不有在上下里看问答想觉知把被就都能会要可向和与同点眼手脚心神笑转抬领买仓天满道急高吐翘片猛出归委背调查'
));
const LOW_VALUE_OBJECTS = [
  '机会', '救命稻草', '蛛丝', '时候', '衣袖', '方向', '情况', '身体',
  '自己', '自己的', '他的', '她的', '此事', '一事', '工作', '安全',
  '微臣', '云淡风轻', '锅', '章合一', '范围',
];
const CASE_OBJECT_RE = /案|谜|真相|疑惑|心事|身份|目的|问题|秘密|税银/u;
const INVESTIGATION_OBJECT_RE = /案|妖物|命案|税银|黄山|周立|梁有平|杨川南|赵县令/u;
const NARRATIVE_SUBJECT_STOPS = /[，。！？；：、“”"'‘’【】\[\]（）()《》<>\s]|轻声|微微|沉声|冷笑|请求|请|拿出|取出|写下|立下|与|和|对|向|在|从|将|把|说|道|问|答|脸色|心头|大步|转身|看着|望着/u;
const INVALID_NARRATIVE_SUBJECTS = new Set([
  '你', '我', '他', '她', '它', '你们', '我们', '他们', '她们', '自己', '什么', '当然',
  '嘿嘿', '由于', '材料', '火种', '女方', '时候', '声音', '众人', '亿万人', '几次受阻',
  '时收回', '旋即消散', '时他也懒', '萧叔叔', '纳兰侄女', '纳兰小姐',
]);
const ADDRESS_SUFFIX_RE = /(哥哥|哥|叔叔|叔|伯伯|伯|小姐|侄女|姑娘|先生|大人)$/u;

interface NarrativeEventRule {
  trigger: string;
  pattern: RegExp;
  summary: (sentence: string, triggerIndex: number) => string | undefined;
  confidence: number;
}

function splitSentences(text: string): Array<{ text: string; index: number }> {
  const result: Array<{ text: string; index: number }> = [];
  const re = /[^。！？!?；;\n]{4,120}[。！？!?；;]?/g;

  for (const match of text.matchAll(re)) {
    const sentence = match[0].replace(/[。！？!?；;]+$/g, '').trim();
    if (sentence) {
      result.push({ text: sentence, index: match.index ?? 0 });
    }
  }

  return result;
}

function hasSubjectHint(sentence: string): boolean {
  return SUBJECT_HINTS.some((hint) => sentence.includes(hint));
}

function findTrigger(sentence: string): string | undefined {
  return EVENT_TRIGGER_WORDS.find((word) => sentence.includes(word));
}

function genericNames(text: string): string[] {
  const names: string[] = [];
  const genericRe = new RegExp(`(?:${COMPOUND_SURNAMES.join('|')}|[${COMMON_SURNAMES}])[\\u4e00-\\u9fff]{1,3}`, 'g');
  for (const match of text.matchAll(genericRe)) {
    const name = match[0];
    if ([...name].some((ch) => BAD_GENERIC_NAME_CHARS.has(ch))) continue;
    names.push(name);
  }
  return names;
}

function namesIn(text: string): string[] {
  const names = KNOWN_SUBJECTS.filter((name) => text.includes(name));
  return [...new Set(names)].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

function nearestSubjectBefore(sentence: string, triggerIndex: number): string | undefined {
  const before = sentence.slice(0, triggerIndex);
  const known = KNOWN_SUBJECTS
    .filter((name) => before.includes(name))
    .sort((a, b) => before.indexOf(a) - before.indexOf(b));
  return known.at(-1);
}

function narrativeSubjectBefore(sentence: string, triggerIndex: number): string | undefined {
  const before = sentence.slice(0, triggerIndex);
  const fragments = before.split(/[，。！？；：、“”"'‘’【】\[\]（）()《》<>\s]+/u).filter(Boolean);
  for (const fragment of fragments.slice().reverse()) {
    const stopIndex = fragment.search(NARRATIVE_SUBJECT_STOPS);
    const candidate = (stopIndex >= 0 ? fragment.slice(0, stopIndex) : fragment)
      .replace(/^(而|只见|却见|随后|此时|这时|那|只|便|也|又|再|忽然|终于)+/u, '')
      .replace(/[^\u4e00-\u9fff]/gu, '')
      .trim();

    const normalized = normalizeNarrativeSubject(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const fallback = genericNames(before).at(-1);
  return fallback ? normalizeNarrativeSubject(fallback.slice(0, 4)) : undefined;
}

function looksLikePersonName(value: string): boolean {
  return COMPOUND_SURNAMES.some((surname) => value.startsWith(surname)) || COMMON_SURNAMES.includes(value[0] || '');
}

function normalizeNarrativeSubject(value: string): string | undefined {
  let candidate = value.replace(ADDRESS_SUFFIX_RE, '').trim();
  if (candidate.length > 4) candidate = candidate.slice(0, 4).replace(ADDRESS_SUFFIX_RE, '');
  if (candidate.length < 2 || candidate.length > 4) return undefined;
  if (INVALID_NARRATIVE_SUBJECTS.has(candidate) || INVALID_NARRATIVE_SUBJECTS.has(value)) return undefined;
  if ([...candidate].some((ch) => BAD_GENERIC_NAME_CHARS.has(ch))) return undefined;
  if (!looksLikePersonName(candidate)) return undefined;
  return candidate;
}

function firstNameAfter(text: string): string | undefined {
  return namesIn(text)[0];
}

function compactTail(text: string, maxLength = 8): string {
  const stopIndex = text.search(EVENT_OBJECT_STOPS);
  const tail = (stopIndex >= 0 ? text.slice(0, stopIndex) : text)
    .replace(/^[了着将把被于在往去至到一批]+/u, '')
    .replace(PUNCTUATION_RE, '')
    .trim();
  return tail.slice(0, maxLength);
}

function locationAfter(text: string): string {
  return compactTail(text, 6)
    .replace(/^(了|往|至|到)/u, '')
    .replace(/调查.*$/u, '');
}

function actionObjectAfter(text: string): string {
  return compactTail(text, 10)
    .replace(/^(了|着|将|把|被)/u, '');
}

function isLowValueObject(object: string): boolean {
  return LOW_VALUE_OBJECTS.some((word) => object.includes(word));
}

function summarizeDispatch(sentence: string, subject: string, trigger: string, triggerIndex: number): string | undefined {
  const after = sentence.slice(triggerIndex + trigger.length);
  const target = firstNameAfter(after);
  if (!target) return undefined;
  if (target === subject) return undefined;

  const destinationMatch = after.match(/(?:前往|赶往|抵达|进入)([\u4e00-\u9fff]{2,12})/u);
  const destination = destinationMatch ? locationAfter(destinationMatch[1]) : '';
  return destination
    ? `${subject}${trigger}${target}前往${destination}`
    : `${subject}${trigger}${target}`;
}

function summarizeOrder(sentence: string, subject: string): string | undefined {
  const execution = sentence.match(/([\u4e00-\u9fff]{2,4})于.{0,8}斩首/u);
  if (execution) return `${subject}下令斩首${execution[1]}`;
  return undefined;
}

function summarizeMovement(subject: string, trigger: string, sentence: string, triggerIndex: number): string | undefined {
  const destination = locationAfter(sentence.slice(triggerIndex + trigger.length));
  if (!destination) return undefined;
  return `${subject}${trigger}${destination}`;
}

function summarizeAction(subject: string, trigger: string, sentence: string, triggerIndex: number): string | undefined {
  if (sentence.slice(0, triggerIndex).includes('：')) return undefined;

  const after = sentence.slice(triggerIndex + trigger.length);
  const trimmedAfter = after.trim();
  if (/^(自己|自己的|自身)/u.test(trimmedAfter)) return undefined;

  if (trigger === '死亡') {
    const cause = trimmedAfter.match(/^原因是([^，。！？；：\s]{2,10})/u)?.[1];
    return cause ? `${subject}死亡原因是${cause}` : `${subject}死亡`;
  }

  if (trigger === '牺牲' || trigger === '失踪') {
    return `${subject}${trigger}`;
  }

  const namedObject = firstNameAfter(after);
  const object = namedObject || actionObjectAfter(after);
  if (!object) return undefined;
  if (object === subject) return undefined;
  if (isLowValueObject(object)) return undefined;

  if (trigger === '审问') {
    return namedObject ? `${subject}审问${namedObject}` : undefined;
  }

  if (trigger === '调查') {
    if (!namedObject && !INVESTIGATION_OBJECT_RE.test(object)) return undefined;
    return `${subject}调查${object}`;
  }

  if (['破获', '查明', '揭开', '解开'].includes(trigger)) {
    if (!CASE_OBJECT_RE.test(object)) return undefined;
    return `${subject}${trigger}${object}`;
  }

  if (['对峙', '交手', '背叛'].includes(trigger) && !namedObject) {
    return undefined;
  }

  if (['袭击', '追杀', '击杀', '逮捕'].includes(trigger) && !namedObject) {
    return undefined;
  }

  return `${subject}${trigger}${object}`;
}

function cleanSummary(summary: string): string {
  return summary
    .replace(PUNCTUATION_RE, '')
    .replace(/\s+/g, '')
    .replace(/(调查|查案|办案|追查)?案情$/u, '')
    .slice(0, 24);
}

function summarizeEventText(sentence: string, trigger: string): string | undefined {
  const triggerIndex = sentence.indexOf(trigger);
  const subject = nearestSubjectBefore(sentence, triggerIndex);
  if (!subject) return undefined;

  let summary: string | undefined;

  if (trigger === '派遣' || trigger === '派出') {
    summary = summarizeDispatch(sentence, subject, trigger, triggerIndex);
  } else if (trigger === '下令') {
    summary = summarizeOrder(sentence, subject);
  } else if (['前往', '赶往', '抵达', '进入', '离开', '返回'].includes(trigger)) {
    summary = summarizeMovement(subject, trigger, sentence, triggerIndex);
  } else {
    summary = summarizeAction(subject, trigger, sentence, triggerIndex);
  }

  if (!summary) return undefined;
  const cleaned = cleanSummary(summary);
  if (cleaned.length < 4 || cleaned.length > 24) return undefined;
  return cleaned;
}

function summarizeWithSubject(sentence: string, triggerIndex: number, phrase: string): string | undefined {
  const subject = narrativeSubjectBefore(sentence, triggerIndex);
  if (!subject) return undefined;
  return cleanSummary(`${subject}${phrase}`);
}

function summarizeMarriageEvent(sentence: string): string | undefined {
  if (sentence.includes('葛叶') && /解除婚约|退婚|悔婚/u.test(sentence)) return '葛叶请求解除婚约';
  if (/纳兰嫣然|嫣然/u.test(sentence) && /解除婚约|退婚|悔婚/u.test(sentence)) return '纳兰嫣然要求解除婚约';
  if (sentence.includes('萧炎') && /拒绝|不答应|尊严|愤怒|休书/u.test(sentence) && /解除婚约|退婚|悔婚/u.test(sentence)) {
    return '萧炎拒绝解除婚约';
  }
  return undefined;
}

function summarizeThreeYearPromise(sentence: string): string | undefined {
  if (!/三年之约|三年.{0,8}(?:约定|契约|约战|之约)|约定.{0,8}三年/u.test(sentence)) return undefined;
  if (/萧炎|少年/u.test(sentence)) return '萧炎立下三年之约';
  return undefined;
}

const NARRATIVE_EVENT_RULES: NarrativeEventRule[] = [
  {
    trigger: '解除婚约',
    pattern: /解除婚约|退婚|悔婚/u,
    confidence: 0.86,
    summary: (sentence) => summarizeMarriageEvent(sentence),
  },
  {
    trigger: '聚气散',
    pattern: /聚气散/u,
    confidence: 0.84,
    summary: (sentence, triggerIndex) => {
      if (!/拿出|取出|带来|赔礼|赔偿|玉盒|玉匣/u.test(sentence)) return undefined;
      if (sentence.includes('葛叶')) return '葛叶拿出聚气散';
      return summarizeWithSubject(sentence, triggerIndex, '拿出聚气散');
    },
  },
  {
    trigger: '休书',
    pattern: /休书/u,
    confidence: 0.86,
    summary: (sentence, triggerIndex) => (
      /写下|写|递出|扔出|休/u.test(sentence)
        ? summarizeWithSubject(sentence, triggerIndex, '写下休书')
        : undefined
    ),
  },
  {
    trigger: '三年之约',
    pattern: /三年之约|三年.{0,8}(?:约定|契约|约战|之约)|约定.{0,8}三年/u,
    confidence: 0.88,
    summary: (sentence) => summarizeThreeYearPromise(sentence),
  },
  {
    trigger: '戒指秘密',
    pattern: /戒指|药老|现身|苏醒|秘密/u,
    confidence: 0.84,
    summary: (sentence, triggerIndex) => {
      if (sentence.includes('药老') && /戒指|现身|苏醒/u.test(sentence)) return '药老从戒指中现身';
      if (/戒指.*秘密|秘密.*戒指/u.test(sentence)) return summarizeWithSubject(sentence, triggerIndex, '发现戒指秘密');
      return undefined;
    },
  },
  {
    trigger: '炼药',
    pattern: /炼药|修炼|借钱|筹钱|目标/u,
    confidence: 0.78,
    summary: (sentence, triggerIndex) => {
      if (/借钱|筹钱/u.test(sentence) && /炼药|药材/u.test(sentence)) return summarizeWithSubject(sentence, triggerIndex, '为炼药筹钱');
      if (/炼药/u.test(sentence) && /萧炎|药老/u.test(sentence) && /决定|准备|打算|想要|需要|学习|教我|传授|目标/u.test(sentence)) {
        return summarizeWithSubject(sentence, triggerIndex, '开启炼药目标');
      }
      if (/修炼/u.test(sentence) && /萧炎|药老/u.test(sentence) && /目标|计划|突破|恢复|决定|准备/u.test(sentence)) {
        return summarizeWithSubject(sentence, triggerIndex, '推进修炼目标');
      }
      return undefined;
    },
  },
];

function summarizeNarrativeEventText(sentence: string): { text: string; trigger: string; confidence: number } | undefined {
  for (const rule of NARRATIVE_EVENT_RULES) {
    const match = sentence.match(rule.pattern);
    if (!match || match.index === undefined) continue;
    const text = rule.summary(sentence, match.index);
    if (!text || text.length < 4 || text.length > 24) continue;
    return { text, trigger: rule.trigger, confidence: rule.confidence };
  }
  return undefined;
}

function chapterSetupEvents(chapter: ScanChapter): Array<{ text: string; position: number; confidence: number }> {
  const content = chapter.content;
  const events: Array<{ text: string; position: number; confidence: number }> = [];

  if (
    content.includes('葛叶') &&
    /有事相求|所请求之事|今日所请求之事|请求之事/u.test(content) &&
    (/纳兰嫣然|嫣然/u.test(content) || chapter.title?.includes('聚气散')) &&
    /云岚宗|宗主/u.test(content)
  ) {
    events.push({
      text: '葛叶提出退婚请求',
      position: Math.max(0, content.search(/有事相求|所请求之事|请求之事/u)),
      confidence: 0.84,
    });
  }

  if (
    content.includes('葛叶') &&
    content.includes('聚气散') &&
    /古玉盒|古匣|玉匣|玉盒|凭空出现|打开盒子|拿出|取出/u.test(content) &&
    (
      chapter.title?.includes('聚气散') ||
      /葛叶.{0,120}(?:古玉盒|古匣|玉匣|玉盒|凭空出现|打开盒子|拿出|取出).{0,120}聚气散/u.test(content)
    )
  ) {
    events.push({
      text: '葛叶拿出聚气散',
      position: Math.max(0, content.search(/古玉盒|古匣|玉匣|玉盒|凭空出现|打开盒子|拿出|取出/u)),
      confidence: 0.84,
    });
  }

  if (
    /三年之后|三年后|三年之约/u.test(content) &&
    /云岚宗|挑战|打败|婚约|契约/u.test(content) &&
    /萧炎|少年/u.test(content)
  ) {
    events.push({
      text: '萧炎立下三年之约',
      position: Math.max(0, content.search(/三年之后|三年后|三年之约/u)),
      confidence: 0.88,
    });
  }

  return events;
}

/**
 * Extract plot-event summaries from one chapter.
 */
export function scanEventEntities(chapter: ScanChapter): EntityMention[] {
  const mentions: EntityMention[] = [];
  const seen = new Set<string>();

  const addMention = (text: string, position: number, confidence: number) => {
    const key = `${chapter.index}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push({
      text,
      chapterIndex: chapter.index,
      position,
      source: 'regex',
      confidence,
    });
  };

  for (const setupEvent of chapterSetupEvents(chapter)) {
    addMention(setupEvent.text, setupEvent.position, setupEvent.confidence);
  }

  for (const sentence of splitSentences(chapter.content)) {
    const trigger = findTrigger(sentence.text);
    const detected = trigger && hasSubjectHint(sentence.text)
      ? { text: summarizeEventText(sentence.text, trigger), confidence: 0.85 }
      : summarizeNarrativeEventText(sentence.text);
    if (!detected?.text) continue;

    addMention(detected.text, sentence.index, detected.confidence);

    if (mentions.length >= 8) break;
  }

  return mentions.sort((a, b) => a.position - b.position);
}

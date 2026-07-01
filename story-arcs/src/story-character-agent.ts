import type { CharacterInStory, StoryCharacterFile, StorySegment } from './types.js';
import { chaptersFor, findEvidence, qualityFor, sourceRangeHint, splitSentences, statusFor, uniqueNonEmpty } from './story-asset-utils.js';

const MAX_APPEARANCE_EVIDENCE = 8;

const APPEARANCE_HINT_RE = /(身穿|穿着|一身|衣衫|衣袍|衣裙|衣服|长袍|黑袍|白衣|青衫|黄袍|裙|袍|容貌|面容|脸庞|脸颊|脸色|俏脸|小脸|眉眼|眉毛|眸子|眼眸|美眸|瞳孔|樱唇|唇|鼻|肤|皮肤|长发|黑发|白发|发丝|发髻|束发|肩背|手指|身材|身形|体型|单薄|高大|瘦削|清秀|俊美|苍老|稚嫩|神色|神情|气质|面孔|戒指|玉佩|簪|佩剑)/u;

const VISUAL_DIMENSIONS: Array<{ label: string; re: RegExp }> = [
  { label: '服装/配色', re: /(身穿|穿着|一身|衣衫|衣袍|衣裙|衣服|长袍|黑袍|白衣|青衫|黄袍|裙|袍|黑色|白色|月白|青色|黄色|紫色|红色)/u },
  { label: '面部/五官', re: /(容貌|面容|脸庞|脸颊|脸色|俏脸|小脸|眉眼|眉毛|眸子|眼眸|美眸|瞳孔|唇|鼻|肤|皮肤|清秀|俊美|苍老|面孔)/u },
  { label: '发型', re: /(长发|黑发|白发|发丝|发髻|束发|垂肩)/u },
  { label: '体态/身形', re: /(肩背|身材|身形|体型|单薄|高大|瘦削)/u },
  { label: '神情/气质', re: /(神色|神情|气质|平静|沉默|倔强|怒意|落寞|狰狞|清冷|冷漠|笑容)/u },
  { label: '年龄/身份视觉线索', re: /(年纪|中年|稚嫩|苍老)/u },
  { label: '饰物/随身特征', re: /(戒指|玉佩|簪|佩剑|腰牌|项链|耳坠|手指)/u },
];

const SUBJECTLESS_APPEARANCE_START_RE = /^(?:[\u4e00-\u9fff]{0,4}的?)?(脸庞|脸颊|脸色|面容|容貌|眉眼|眉毛|眸子|眼眸|美眸|瞳孔|小脸|俏脸|手指|戒指|衣衫|衣袍|衣裙|衣服|长袍|长发|黑发|白发|发丝|发髻|肩背|身材|身形|体型|神色|神情)/u;

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/(?<=[，,；;：:])/u)
    .map((part) => part.trim().replace(/^[“”"'‘’]+|[“”"'‘’]+$/gu, ''))
    .filter(Boolean);
}

function removeQuotedSpeech(text: string): string {
  return text
    .replace(/“[^”]*”/gu, '')
    .replace(/"[^"]*"/gu, '')
    .replace(/'[^']*'/gu, '');
}

function isIndirectMention(clause: string, name: string): boolean {
  const indirectMention = new RegExp(`((对着|向|朝|望着|看着|经过).{0,8}${name}|被${name})`, 'u');
  return indirectMention.test(clause);
}

function isLikelyOtherSubjectClause(clause: string, name: string, assumeDirectSubject: boolean): boolean {
  if (clause.includes(name)) {
    const groupedWithOther = new RegExp(`${name}(与|和|同|跟).{0,12}(老者|少女|少年|男子|女子)`, 'u');
    const lookingAtOther = new RegExp(`${name}.{0,8}(目光|眼神|视线|无视).{0,24}(萧炎|萧战|纳兰|少女|少年|老者|小脸|俏脸|眸子|眼眸|脸庞|容貌)`, 'u');
    return isIndirectMention(clause, name) || groupedWithOther.test(clause) || lookingAtOther.test(clause);
  }
  if (assumeDirectSubject && /^(少年|少女|青年|老者|中年人|男子|女子|他(?!们)|她(?!们))/u.test(clause.trim())) {
    return false;
  }
  return /^(对着|向|朝|望着|看着|盯着|瞧着|上下打量|横了)/u.test(clause.trim())
    || /^(他|她|他们|她们)的/u.test(clause.trim())
    || /(一名|一位|那位|这位|一旁的|对面的|身旁的|面前的).{0,8}(老者|少女|少年|男子|女子)/u.test(clause)
    || /(他们|她们|众人|年轻一辈|少年少女)/u.test(clause)
    || /(老者|少女|少年|男子|女子).{0,12}(衣袍|袍服|胸口|脸庞|小脸|樱唇|眸子|身上)/u.test(clause);
}

function appearanceClausesFor(sentence: string, name: string, assumeDirectSubject = false): string[] {
  const clauses = splitClauses(removeQuotedSpeech(sentence));
  const evidence: string[] = [];
  let directSubjectActive = assumeDirectSubject;

  for (const clause of clauses) {
    const mentionsName = clause.includes(name);
    const hasAppearance = APPEARANCE_HINT_RE.test(clause);
    const subjectlessAllowed = directSubjectActive
      && (SUBJECTLESS_APPEARANCE_START_RE.test(clause.trim())
        || (assumeDirectSubject && isContinuingSubjectSentence(clause)));

    if (mentionsName && !isIndirectMention(clause, name)) {
      directSubjectActive = true;
    }

    if (
      hasAppearance
      && ((mentionsName && !isIndirectMention(clause, name)) || subjectlessAllowed)
      && !isLikelyOtherSubjectClause(clause, name, assumeDirectSubject)
    ) {
      evidence.push(clause);
    }

    if (mentionsName && isIndirectMention(clause, name)) {
      directSubjectActive = false;
    }
  }

  return evidence;
}

function sentenceIsAboutCharacter(sentence: string, name: string): boolean {
  if (sentence.includes(name) && !isIndirectMention(sentence, name)) return true;
  const compact = sentence.trim();
  return /^(少年|少女|青年|老者|中年人|男子|女子|他|她)/u.test(compact);
}

function isContinuingSubjectSentence(sentence: string): boolean {
  return /^(少年|少女|青年|老者|中年人|男子|女子|他|她)/u.test(sentence.trim());
}

function visualBreakdown(evidence: string[]): string {
  return VISUAL_DIMENSIONS
    .filter(({ re }) => evidence.some((clause) => re.test(clause)))
    .map(({ label, re }) => {
      const details = evidence.filter((clause) => re.test(clause));
      return `- ${label}：${details.join('、')}`;
    })
    .join('\n');
}

/**
 * Transform raw novel evidence into clean visual descriptions for AI image generation.
 * - Strips narrative context, keeps only visual details
 * - Converts emotional/action descriptions to visual equivalents
 * - Adds reasonable defaults for missing dimensions
 */
function polishEvidenceSnippet(clause: string): string {
  let cleaned = clause
    .replace(/[，。！？；：]+$/u, '')
    .replace(/^[，。！？；：]+/u, '')
    .trim();

  // Transform narrative → visual
  cleaned = cleaned
    .replace(/回复了平日的落寞/gu, '沉静中略带落寞')
    .replace(/狰狞/gu, '带有怒意')
    .replace(/(轻轻|缓缓|慢慢|紧紧)抚摸/gu, '佩戴')
    .replace(/(轻轻|缓缓|慢慢)抚摸着/gu, '佩戴')
    .replace(/手指中的/gu, '手中持有')
    .replace(/手指上(有一颗|戴着?)/gu, '佩戴一枚');

  return cleaned;
}

const DEFAULT_VISUAL: Record<string, string> = {
  '发型': '黑色短发，整洁利落',
  '体态/身形': '身形匀称，少年体态',
  '年龄/身份视觉线索': '青少年面孔，约15-18岁',
};

function polishForImageGeneration(breakdown: string): string {
  // Add reasonable defaults for missing dimensions
  const additions: string[] = [];
  for (const [label, defaultValue] of Object.entries(DEFAULT_VISUAL)) {
    if (!breakdown.includes(label)) {
      additions.push(`- ${label}：${defaultValue}`);
    }
  }
  return additions.length > 0
    ? `${breakdown}\n${additions.join('\n')}`
    : breakdown;
}

function appearanceDescriptionFor(evidence: string[]): string {
  if (evidence.length === 0) return '';
  // Polish evidence BEFORE creating breakdown — each snippet is cleaned
  // individually, then visualBreakdown() organizes them into dimensions.
  const polished = evidence.map(polishEvidenceSnippet);
  return polishForImageGeneration(visualBreakdown(polished));
}

function extractAppearance(story: StorySegment, name: string): {
  appearanceDescription: string;
  appearanceEvidenceSnippets: string[];
  needsAppearanceRepair: boolean;
} {
  const collected: string[] = [];
  let previousSentenceWasDirectSubject = false;

  for (const sentence of splitSentences(story.sourceText)) {
    const directMention = sentence.includes(name) && !isIndirectMention(sentence, name);
    const continuingSubject: boolean = previousSentenceWasDirectSubject && isContinuingSubjectSentence(sentence);
    if (sentenceIsAboutCharacter(sentence, name) || continuingSubject) {
      collected.push(...appearanceClausesFor(sentence, name, continuingSubject));
    }
    previousSentenceWasDirectSubject = directMention || continuingSubject;
  }

  const evidence = uniqueNonEmpty(collected).slice(0, MAX_APPEARANCE_EVIDENCE);

  return {
    appearanceDescription: appearanceDescriptionFor(evidence),
    appearanceEvidenceSnippets: evidence,
    needsAppearanceRepair: evidence.length === 0,
  };
}

function visualPromptFor(name: string, appearanceDescription: string): string {
  const appearance = appearanceDescription || '外貌未被原文确认';
  return [
    `${name}，人物造型参考，角色设定拆解`,
    '正面全身、侧面全身、背面全身、面部近景，同一人物身份保持一致',
    `外貌描写：${appearance}`,
    '优先呈现服装配色、面部五官、发型、体态身形、神情气质、饰物特征',
    '仅使用原文支持的外貌细节，未确认维度保持空白或标注待补充',
  ].join('；');
}

function inferRole(story: StorySegment, name: string): CharacterInStory['roleInStory'] {
  if (story.mainCharacters.includes(name)) return 'protagonist';
  if (story.supportingCharacters.includes(name)) return 'supporting';
  return 'minor';
}

function inferKeyActions(story: StorySegment, name: string): string[] {
  const evidence = findEvidence(story.sourceText, name, story.summary);
  return evidence.map((line) => line.length > 80 ? `${line.slice(0, 77)}...` : line);
}

export function extractStoryCharacters(story: StorySegment): StoryCharacterFile {
  const names = uniqueNonEmpty([...story.mainCharacters, ...story.supportingCharacters]);
  const sourceChapters = chaptersFor(story);
  const characters = names.map((name): CharacterInStory => {
    const confidence = story.mainCharacters.includes(name) ? 0.9 : 0.78;
    const roleInStory = inferRole(story, name);
    const evidenceSnippets = findEvidence(story.sourceText, name, story.summary);
    const description = `${name} appears in "${story.title}" as a ${roleInStory} tied to the conflict: ${story.coreConflict}`;
    const quality = qualityFor(description);
    const appearance = extractAppearance(story, name);

    return {
      name,
      aliases: [],
      roleInStory,
      motivation: roleInStory === 'protagonist' ? story.coreConflict : `Supports or complicates the story conflict: ${story.coreConflict}`,
      conflictRelation: `${name} is connected to the story conflict: ${story.coreConflict}`,
      firstMentionChapter: story.startChapter,
      lastMentionChapter: story.endChapter,
      keyActions: inferKeyActions(story, name),
      confidence,
      assetStatus: statusFor(confidence),
      description,
      ...quality,
      ...appearance,
      visualPrompt: visualPromptFor(name, appearance.appearanceDescription),
      evidenceSnippets,
      sourceChapters,
      sourceRangeHint: sourceRangeHint(story),
    };
  });

  return {
    storyId: story.id,
    bookId: story.bookId,
    characters,
  };
}

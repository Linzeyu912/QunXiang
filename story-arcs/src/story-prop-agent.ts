import type { PropInStory, StoryPropFile, StorySegment } from './types.js';
import { chaptersFor, findEvidence, qualityFor, sourceRangeHint, statusFor, uniqueNonEmpty } from './story-asset-utils.js';

const PROP_PATTERNS = [
  /[\u4e00-\u9fff]{0,4}(?:铜牌|令牌|玉佩|信件|书信|卷宗|钥匙|青木剑|银剑|短剑|长剑|刀|剑|枪|弓|丹药|聚气散|筑基灵液|药材|戒指|银票|银子|箱子|地图|法宝|玉玺)/gu,
];

const CORE_PROP_TERMS = [
  '铜牌', '令牌', '玉佩', '信件', '书信', '卷宗', '钥匙', '银票', '银子',
  '箱子', '地图', '法宝', '玉玺', '青木剑', '银剑', '短剑', '长剑', '丹药', '聚气散',
  '筑基灵液', '药材', '戒指', '刀', '剑', '枪', '弓',
];

function normalizePropName(raw: string): string | undefined {
  const value = raw
    .trim()
    .replace(/^(拿出|拔出|取出|掏出|祭出|炼制|一把|一柄|这把|那把|出)/u, '');
  const term = CORE_PROP_TERMS.find((candidate) => value.includes(candidate));
  if (!term) return undefined;
  if (['铜牌', '令牌', '玉佩', '信件', '书信', '卷宗', '钥匙', '银票', '银子', '箱子', '地图', '法宝', '玉玺'].includes(term)) return term;
  if (['丹药', '聚气散', '筑基灵液', '药材', '戒指'].includes(term)) return term;
  if (['青木剑', '银剑', '短剑', '长剑'].includes(term)) return term;
  if (term === '剑' && /炼药|学习|成为|一名|一位|品的|几品/u.test(value)) return undefined;
  if (term === '剑' && /(的剑|这剑|有关|凌厉|锋利)/u.test(value)) return undefined;
  if (term === '刀' && /犹如/u.test(value)) return undefined;
  if (value.endsWith(term) && value.length <= 6) return value;
  return term;
}

function inferPropType(name: string): PropInStory['propType'] {
  if (/[刀剑枪弓]/u.test(name)) return 'weapon';
  if (/(信件|书信|卷宗|地图)/u.test(name)) return 'document';
  if (/(铜牌|令牌|玉佩|玉玺)/u.test(name)) return 'token';
  if (/(银票|银子)/u.test(name)) return 'money';
  if (/(钥匙|箱子)/u.test(name)) return 'tool';
  return 'other';
}

function discoverProps(text: string): string[] {
  const props: string[] = [];
  for (const pattern of PROP_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizePropName(match[0].trim());
      if (value && value.length >= 2 && value.length <= 8) props.push(value);
    }
  }
  return uniqueNonEmpty(props);
}

export function extractStoryProps(story: StorySegment): StoryPropFile {
  const sourceChapters = chaptersFor(story);
  const props = discoverProps(story.sourceText).map((name): PropInStory => {
    const confidence = 0.8;
    const evidenceSnippets = findEvidence(story.sourceText, name, story.summary);
    const propType = inferPropType(name);
    const description = `${name} functions as a ${propType} in "${story.title}", connected to: ${story.coreConflict}`;
    const quality = qualityFor(description);

    return {
      name,
      aliases: [],
      propType,
      storyFunction: `${name} supports, reveals, or complicates the story conflict: ${story.coreConflict}`,
      ownerOrHolder: story.mainCharacters[0],
      firstAppearance: sourceRangeHint(story),
      keyMoments: evidenceSnippets,
      confidence,
      assetStatus: statusFor(confidence),
      description,
      ...quality,
      visualPrompt: `${name}, prop type: ${propType}, story function: ${story.coreConflict}, preserve source-supported material and shape details`,
      evidenceSnippets,
      sourceChapters,
      sourceRangeHint: sourceRangeHint(story),
    };
  });

  return {
    storyId: story.id,
    bookId: story.bookId,
    props,
  };
}

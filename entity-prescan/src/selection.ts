import { stratifyAndRoute } from './scoring.js';
import type { EntityImportance } from './importance.js';
import type { ConfidenceScore, ScoringParams } from './scoring.js';
import type { EntityMention, EntityType } from './types.js';

type ScoringResults = Map<EntityType, Map<string, {
  params?: ScoringParams;
  confidence: ConfidenceScore;
}>>;

const REAL_COMMON_SURNAMES = new Set(Array.from(
  '\u8d75\u94b1\u5b59\u674e\u5468\u5434\u90d1\u738b\u51af\u9648\u891a\u536b\u848b\u6c88\u97e9\u6768' +
  '\u6731\u79e6\u5c24\u8bb8\u4f55\u5415\u65bd\u5f20\u5b54\u66f9\u4e25\u534e\u91d1\u9b4f\u9676' +
  '\u59dc\u621a\u8c22\u90b9\u55bb\u67cf\u6c34\u7aa6\u7ae0\u4e91\u82cf\u6f58\u845b\u595a\u8303' +
  '\u5f6d\u90ce\u9c81\u97e6\u660c\u9a6c\u82d7\u51e4\u82b1\u65b9\u4fde\u4efb\u8881\u67f3\u9146' +
  '\u9c8d\u53f2\u5510\u8d39\u5ec9\u5c91\u859b\u96f7\u8d3a\u502a\u6c64\u6ed5\u6bb7\u7f57\u6bd5' +
  '\u90dd\u90ac\u5b89\u5e38\u4e50\u4e8e\u65f6\u5085\u76ae\u535e\u9f50\u5eb7\u4f0d\u4f59\u5143' +
  '\u535c\u987e\u5b5f\u5e73\u9ec4\u548c\u7a46\u8427\u5c39\u6b27\u6881\u6b66\u9f99\u53f6\u53f8'
));

const REAL_COMPOUND_SURNAMES = [
  '\u6b27\u9633', '\u53f8\u9a6c', '\u4e0a\u5b98', '\u8bf8\u845b', '\u4e1c\u65b9',
  '\u897f\u95e8', '\u5357\u5bab', '\u5317\u51a5', '\u516c\u5b59', '\u6155\u5bb9',
  '\u53f8\u5f92', '\u4ee4\u72d0', '\u7687\u752b', '\u5b87\u6587', '\u957f\u5b59',
  '\u590f\u4faf', '\u95fb\u4eba',
];

const EXTRA_NAME_STARTS = new Set(Array.from('\u6000\u6155\u6d1b'));

const CHARACTER_OUTPUT_STOP_WORDS = new Set([
  '\u6210\u529f', '\u6bd5\u7adf', '\u53e4\u602a', '\u76f8\u4fe1', '\u7ec8\u7a76',
  '\u8bb8\u4e45', '\u5c24\u5176', '\u8bf8\u4f4d', '\u65b9\u624d', '\u65b9\u9762',
  '\u65b9\u662f', '\u65f6\u4e5f', '\u65f6\u8fb0', '\u5e73\u9759', '\u5e73\u65f6',
  '\u5e73\u5e73\u65e0', '\u5e73\u5fd7', '\u5e73\u6c11', '\u6c34\u5e73',
  '\u5bb6\u4f19', '\u5b98\u5458', '\u5b98\u573a', '\u5b98\u663e\u8d35',
  '\u53cc\u65b9', '\u65f6\u4ee3', '\u7ecf\u5386', '\u7ecf\u7eaa', '\u89e3\u51b3',
  '\u5305\u62ec', '\u5b89\u5168', '\u6210\u5458', '\u4f55\u5904', '\u4f55\u65f6',
  '\u4f55\u7b49', '\u4f55\u610f', '\u4e8e\u6b64', '\u65f6\u5e38', '\u65f6\u673a',
  '\u4f59\u5149', '\u5b89\u6392', '\u9ec4\u660f',
  '\u8bb8\u5bb6', '\u8bb8\u5e9c', '\u8bb8\u73b2', '\u4e8e\u8bb8\u4e03',
  '\u94b1\u94f6', '\u94b1\u94f6\u5b50', '\u77f3\u5c0f\u955c', '\u4e91\u5dde',
  '\u4e91\u9e7f\u4e66', '\u4e91\u9e7f\u4e66\u9662', '\u4e07\u5996\u56fd', '\u9f99\u5bfa',
  '\u4e50\u53bf', '\u4e50\u53bf\u8859', '\u5eb7\u53bf', '\u9ec4\u5c71', '\u9a6c\u5339',
  '\u53f2\u4e66', '\u91d1\u5c5e\u94a0', '\u91d1\u724c', '\u91d1\u6b65', '\u738b\u515a',
  '\u91d1\u5200', '\u6b66\u529b', '\u6b66\u592b', '\u6b66\u8005', '\u6b66\u592b\u4f53',
  '\u65bd\u4e3b', '\u516c\u5b50', '\u516c\u4e3b',
  '\u738b\u5983', '\u5e08\u5144', '\u5e08\u7236', '\u5e08\u59d0', '\u5deb\u5e08',
  '\u767d\u8863', '\u767d\u8863\u672f\u58eb', '\u9ec4\u88d9', '\u9ec4\u88d9\u5c11\u5973',
  '\u5f20\u5634', '\u738b\u6355', '\u6731\u53bf', '\u5468\u5e9c',
  '\u534e\u6a2a\u6ea2', '\u8bb8\u8f9e', '\u5415\u6355', '\u9b4f\u6e0a\u6e29',
  '\u9b4f\u6e0a\u6447', '\u9a6c\u8f66\u9a76', '\u65b9\u5996\u65cf',
  '\u8d75\u53bf', '\u5e73\u9633\u90e1', '\u4e91\u5dde\u532a', '\u9f50\u515a',
  '\u9ec4\u4f2f\u8857', '\u4e91\u5dde\u5b98\u573a', '\u82cf\u82cf\u59d1',
]);

const BAD_CHARACTER_OUTPUT_CHARS = new Set(Array.from(
  '\u7684\u4e86\u7740\u8fc7\u6ca1\u4e0d\u6709\u5728\u4e0a\u4e0b\u91cc\u591a\u5c11' +
  '\u5411\u5ea6\u6cd5\u5f0f\u95f4\u770b\u95ee\u7b54\u60f3\u89c9\u77e5\u628a\u88ab' +
  '\u5c31\u90fd\u80fd\u4f1a\u8981\u53ef\u5e94'
));

function isCharacterOutputName(text: string): boolean {
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(text)) return false;
  if (CHARACTER_OUTPUT_STOP_WORDS.has(text)) return false;
  if (text.startsWith('\u5b89')) return false;
  if (
    !REAL_COMMON_SURNAMES.has(text[0])
    && !EXTRA_NAME_STARTS.has(text[0])
    && !REAL_COMPOUND_SURNAMES.some((surname) => text.startsWith(surname))
  ) {
    return false;
  }

  for (const ch of text) {
    if (BAD_CHARACTER_OUTPUT_CHARS.has(ch)) return false;
  }

  return true;
}

/**
 * Select entities that should be written to final output files.
 *
 * importance.txt remains the audit report for every scored entity. The per-type
 * output files are the routed working set, so archive-tier entities stay out.
 */
export function selectOutputEntities(
  filteredResults: Map<EntityType, EntityMention[]>,
  importanceResults: Map<EntityType, EntityImportance[]>,
  scoringResults: ScoringResults
): Map<EntityType, EntityMention[]> {
  const selected = new Map<EntityType, EntityMention[]>();

  for (const [type, mentions] of filteredResults) {
    const importanceByText = new Map(
      (importanceResults.get(type) || []).map((imp) => [imp.text, imp])
    );
    const typeScoring = scoringResults.get(type);

    selected.set(type, mentions.filter((mention) => {
      if (type === 'character' && !isCharacterOutputName(mention.text)) {
        return false;
      }

      const imp = importanceByText.get(mention.text);
      if (!imp) return true;

      const confidence = typeScoring?.get(mention.text)?.confidence.overall ?? 0;
      const { route } = stratifyAndRoute(imp.importance, confidence, imp.storyScore);
      return route !== 'archive';
    }));
  }

  return selected;
}

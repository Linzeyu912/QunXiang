const DESCRIPTION_SEPARATOR = '；';

const TRAILING_DELIMITERS_RE = /[，,；;、。！？!?]+$/u;
const DANGLING_END_RE = /(?:被|把|将|以|为|与|和|及|并|但|却|因|在|从|向|对|由|让|令|使|其|该|这|那)$/u;
const BROKEN_NUMERIC_TAIL_RE = /(?:反将一|[将把给对向为以于至在从]一)$/u;

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function collapseAdjacentRepeatedPhrases(value: string): string {
  let text = value;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/([\u4e00-\u9fff]{2,4})\1/gu, '$1');
  } while (text !== previous);
  return text;
}

function lastDelimiterIndex(value: string): number {
  return Math.max(
    value.lastIndexOf('，'),
    value.lastIndexOf(','),
    value.lastIndexOf('；'),
    value.lastIndexOf(';'),
    value.lastIndexOf('。'),
    value.lastIndexOf('！'),
    value.lastIndexOf('？'),
    value.lastIndexOf('!'),
    value.lastIndexOf('?')
  );
}

function looksIncompleteTrailingFragment(fragment: string): boolean {
  const text = fragment.trim().replace(TRAILING_DELIMITERS_RE, '');
  if (!text) return true;
  return DANGLING_END_RE.test(text) || BROKEN_NUMERIC_TAIL_RE.test(text);
}

function trimIncompleteTrailingFragment(value: string): string | undefined {
  let text = compactWhitespace(value);
  if (!text) return undefined;

  while (looksIncompleteTrailingFragment(text.slice(lastDelimiterIndex(text) + 1))) {
    const delimiterIndex = lastDelimiterIndex(text);
    if (delimiterIndex < 0) return undefined;
    text = text.slice(0, delimiterIndex).trim().replace(TRAILING_DELIMITERS_RE, '');
    if (!text) return undefined;
  }

  return text;
}

function comparableDescription(value: string): string {
  return value.replace(/[，,；;、。！？!?\s]/gu, '');
}

export function cleanEntityDescription(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const text = trimIncompleteTrailingFragment(value);
  return text ? collapseAdjacentRepeatedPhrases(text) : undefined;
}

export function mergeEntityDescriptions(...values: Array<string | null | undefined>): string | undefined {
  const descriptions: string[] = [];

  for (const value of values) {
    const description = cleanEntityDescription(value);
    if (!description) continue;

    const comparable = comparableDescription(description);
    const existingIndex = descriptions.findIndex((existing) => {
      const existingComparable = comparableDescription(existing);
      return existingComparable.includes(comparable) || comparable.includes(existingComparable);
    });

    if (existingIndex >= 0) {
      if (description.length > descriptions[existingIndex].length) {
        descriptions[existingIndex] = description;
      }
    } else {
      descriptions.push(description);
    }
  }

  return descriptions.length > 0 ? descriptions.join(DESCRIPTION_SEPARATOR) : undefined;
}

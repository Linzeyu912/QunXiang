export { resolve } from './resolver.js';
export type { ResolutionResult, ResolvedCharacter } from './types.js';
export { isSameName, sameNameDetector } from './detectors/same-name.js';
export { isAliasMatch, aliasMatchDetector } from './detectors/alias-match.js';
export {
  chooseCanonicalCharacterName,
  isCollectiveCharacterAlias,
  isGenericCharacterAlias,
  isSafeAliasMatch,
  isSafeSharedAliasMatch,
  sanitizeCharacterAliases,
} from './detectors/alias-safety.js';
export { isSameChineseName, normalizeChineseName } from './detectors/same-chinese-name.js';
export { mergeCharacters } from './merger.js';

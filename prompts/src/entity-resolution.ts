/**
 * Prompt for resolving entity aliases to canonical names
 */
export const ENTITY_RESOLUTION_PROMPT = `You are an expert at resolving entity references in novels.

Given a list of character names and their aliases, identify which names refer to the same entity.
Return a JSON object mapping each alias to its canonical character name.`;

export const SAME_ENTITY_PROMPT = (name1: string, name2: string, context: string): string =>
  `Are "${name1}" and "${name2}" the same character?

Context:
${context}

Answer YES or NO only.`;

/**
 * Prompt for determining if two names refer to the same entity
 */
export const NAME_MATCH_PROMPT = `You are an expert at determining if two character names refer to the same person.

Given two names and optional context, determine if they refer to the same entity.
Consider:
- Exact name matches (case-insensitive)
- Partial name matches (e.g., "John" and "John Smith")
- Nickname to formal name mappings
- Aliases and epithets

Return YES if they are the same entity, NO otherwise.`;

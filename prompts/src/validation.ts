/**
 * Prompt for confidence evaluation
 */
export const CONFIDENCE_EVALUATION_PROMPT = `You are an expert at evaluating character extraction confidence.

Based on the following signals, evaluate the confidence that this is a real character:
- mentionCount: Number of times the character is mentioned
- dialogueCount: Number of dialogue lines
- chapterAppearances: Number of chapters where they appear
- descriptionQuality: Quality of character description

Return a confidence score between 0.0 and 1.0.`;

/**
 * Prompt for validating character data completeness
 */
export const CHARACTER_VALIDATION_PROMPT = `You are an expert at validating character data quality.

Check if a character entry is valid:
1. Has a meaningful name (not just a pronoun or generic term)
2. Has sufficient description (at least one sentence)
3. Has meaningful appearances (appears in at least 2 chapters OR has at least 3 dialogues)
4. Aliases are actually different from the main name

Return a validation result with reasons for any failures.`;

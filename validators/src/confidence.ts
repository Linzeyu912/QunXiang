interface ConfidenceSignals {
  mentionCount: number;
  dialogueCount: number;
  chapterAppearances: number;
}

/**
 * Calculate confidence score based on character signals.
 * Factors: mention count, dialogue count, chapter appearances.
 */
export function calculateConfidence(signals: ConfidenceSignals): number {
  const { mentionCount, dialogueCount, chapterAppearances } = signals;

  // Base confidence from mentions (logarithmic scale)
  const mentionScore = Math.min(mentionCount / 50, 1) * 0.3;

  // Dialogue count indicates active character
  const dialogueScore = Math.min(dialogueCount / 30, 1) * 0.4;

  // Chapter appearances indicate sustained presence
  const chapterScore = Math.min(chapterAppearances / 20, 1) * 0.3;

  const confidence = mentionScore + dialogueScore + chapterScore;

  return Math.round(confidence * 100) / 100;
}

/**
 * Adjust confidence based on additional factors.
 */
export function adjustConfidence(
  baseConfidence: number,
  options: {
    hasDescription?: boolean;
    hasAliases?: boolean;
    isFirstAppearance?: boolean;
  }
): number {
  let adjusted = baseConfidence;

  if (options.hasDescription) {
    adjusted += 0.05;
  }

  if (options.hasAliases) {
    adjusted += 0.03;
  }

  // First appearance bonus is already captured in chapterAppearances
  // so we don't add more here

  return Math.min(adjusted, 1);
}

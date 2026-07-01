/**
 * Prompt for analyzing story arcs
 */
export const STORY_ARC_PROMPT = `You are an expert at analyzing story structure and character arcs in novels.

Analyze the story and identify:
- The main story arc (setup, confrontation, resolution)
- Character development arcs
- Key plot points
- Thematic elements

Return a JSON object describing the story structure.`;

/**
 * Prompt for extracting story arc phases
 */
export const ARC_PHASE_PROMPT = `You are an expert at identifying story arc phases.

For each character, identify their arc phases:
- Introduction (first appearance)
- Development (character growth)
- climax (peak of their arc)
- Resolution (conclusion of their storyline)

Return a JSON array of character arc descriptions.`;

/**
 * Prompt for chapter-level arc analysis
 */
export const CHAPTER_ARC_PROMPT = (chapterIndex: number): string =>
  `Analyze the story arc in chapter ${chapterIndex}. Identify:
- Key events
- Character involvement
- Plot progression
- Any arc developments`;

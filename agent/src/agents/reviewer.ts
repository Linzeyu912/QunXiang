import type { AgentPayload, AgentResult } from '../types.js';
import { CharacterRepository } from '@novel-agent/storage';

interface Character {
  name: string;
  aliases?: string[];
  description?: string;
  confidence?: number;
  chapterRef?: string;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances?: number[];
  mentionCount?: number;
  dialogueCount?: number;
  coCharacters?: string[];
}

export async function executeReviewer(payload: AgentPayload): Promise<AgentResult> {
  try {
    const bookId = payload.bookId;
    const previousResult = payload.previousResult as {
      characters?: Character[];
    } | undefined;

    const characters = previousResult?.characters || [];

    if (!Array.isArray(characters)) {
      return {
        success: false,
        error: 'No characters found for review',
      };
    }

    const reviewResults = await Promise.all(
      characters.map(async (char) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        if (!char.name || char.name.trim().length === 0) {
          issues.push('Missing character name');
        }

        if (char.name && char.name.length > 100) {
          issues.push('Character name exceeds 100 characters');
        }

        if (!char.description || char.description.trim().length === 0) {
          suggestions.push('Consider adding a character description');
        }

        if (!char.firstChapter && !char.chapterAppearances?.length) {
          suggestions.push('Missing chapter reference information');
        }

        const confidence = char.confidence ?? 0.5;
        if (confidence < 0.3) {
          issues.push('Low confidence score');
        }

        return {
          character: char,
          issues,
          suggestions,
          approved: issues.length === 0,
        };
      })
    );

    const approvedCharacters = reviewResults.filter(r => r.approved);
    const rejectedCharacters = reviewResults.filter(r => !r.approved);

    if (approvedCharacters.length > 0) {
      await CharacterRepository.createMany(
        approvedCharacters.map(r => ({
          bookId,
          name: r.character.name,
          aliases: r.character.aliases || [],
          description: r.character.description,
          confidence: r.character.confidence || 0.5,
          chapterRef: r.character.chapterRef,
          firstChapter: r.character.firstChapter,
          lastChapter: r.character.lastChapter,
          chapterAppearances: r.character.chapterAppearances || [],
          mentionCount: r.character.mentionCount ?? 0,
          dialogueCount: r.character.dialogueCount ?? 0,
          coCharacters: r.character.coCharacters || [],
        }))
      );
    }

    return {
      success: true,
      data: {
        reviewResults,
        totalCharacters: characters.length,
        approvedCount: approvedCharacters.length,
        rejectedCount: rejectedCharacters.length,
        canProceed: approvedCharacters.length > 0,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

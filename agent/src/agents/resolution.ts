import type { AgentPayload, AgentResult } from '../types.js';

interface Character {
  name: string;
  aliases?: string[];
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances?: number[];
  coCharacters?: string[];
}

export async function executeResolution(payload: AgentPayload): Promise<AgentResult> {
  try {
    const previousResult = payload.previousResult as {
      characters?: Character[];
    } | undefined;

    const characters = previousResult?.characters || [];

    if (!Array.isArray(characters)) {
      return {
        success: false,
        error: 'No characters found for entity resolution',
      };
    }

    const resolvedCharacters: Character[] = [];
    const nameToCharacter = new Map<string, Character>();
    const processedNames = new Set<string>();

    for (const char of characters) {
      if (processedNames.has(char.name.toLowerCase())) {
        continue;
      }

      const canonicalName = char.name.trim();
      const aliases = char.aliases || [];
      const allNames = [canonicalName, ...aliases.map(a => a.trim())].filter(
        n => n.toLowerCase() !== canonicalName.toLowerCase()
      );

      for (const name of allNames) {
        nameToCharacter.set(name.toLowerCase(), char);
      }

      resolvedCharacters.push({
        ...char,
        name: canonicalName,
        aliases: aliases.filter(a => a.trim() !== canonicalName),
      });

      processedNames.add(canonicalName.toLowerCase());
    }

    for (const char of resolvedCharacters) {
      if (char.coCharacters && Array.isArray(char.coCharacters)) {
        const resolvedCoChars: string[] = [];
        for (const coCharName of char.coCharacters) {
          const resolved = nameToCharacter.get(coCharName.toLowerCase());
          if (resolved) {
            resolvedCoChars.push(resolved.name);
          }
        }
        char.coCharacters = [...new Set(resolvedCoChars)];
      }
    }

    return {
      success: true,
      data: {
        characters: resolvedCharacters,
        resolvedCount: resolvedCharacters.length,
        originalCount: characters.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

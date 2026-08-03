import type { AgentPayload, AgentResult } from '../types.js';

interface Character {
  name: string;
  aliases?: string[];
  description?: string;
}

/**
 * Validator agent — 置信度校验.
 *
 * 消费 extractor 产出的 characters（payload.previousResult.characters），
 * 逐个校验名称/别名的合法性，过滤无效角色，把有效角色继续向下传递。
 */
export async function executeValidator(payload: AgentPayload): Promise<AgentResult> {
  try {
    const previousResult = payload.previousResult as { characters?: Character[] } | undefined;
    const characters = previousResult?.characters || [];

    if (!Array.isArray(characters)) {
      return {
        success: false,
        error: 'No characters found to validate',
      };
    }

    const validationResults = await Promise.all(
      characters.map(async (char) => {
        const issues: string[] = [];
        const warnings: string[] = [];

        if (!char.name || char.name.trim().length === 0) {
          issues.push('Character name is empty');
        }

        if (char.name && char.name.length > 100) {
          issues.push('Character name too long');
        }

        if (char.aliases && char.aliases.length > 20) {
          warnings.push('Too many aliases');
        }

        return {
          character: char,
          isValid: issues.length === 0,
          issues,
          warnings,
        };
      })
    );

    const validCharacters = validationResults.filter(r => r.isValid).map(r => r.character);
    const invalidCharacters = validationResults.filter(r => !r.isValid);

    return {
      success: true,
      data: {
        // 把有效角色继续传递给下游（entity-resolution）
        characters: validCharacters,
        validationResults,
        totalCharacters: characters.length,
        validCount: validCharacters.length,
        invalidCount: invalidCharacters.length,
        canProceed: invalidCharacters.length === 0,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

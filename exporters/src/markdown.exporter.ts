import type { Character, Book } from './types.js';
import { BaseExporter } from './base.js';

export class MarkdownExporter extends BaseExporter {
  export(characters: Character[], book: Book): string {
    const lines: string[] = [];

    lines.push(`# ${book.title}`);
    lines.push('');
    lines.push(`> Exported on ${new Date().toLocaleDateString()}`);
    lines.push('');
    lines.push(`## Characters (${characters.length})`);
    lines.push('');

    for (const char of characters) {
      lines.push(`### ${char.name}`);
      lines.push('');

      if (char.aliases.length > 0) {
        lines.push(`**Aliases:** ${char.aliases.join(', ')}`);
        lines.push('');
      }

      if (char.description) {
        lines.push(`${char.description}`);
        lines.push('');
      }

      lines.push(`| Property | Value |`);
      lines.push(`|----------|-------|`);
      lines.push(`| Confidence | ${(char.confidence * 100).toFixed(1)}% |`);
      lines.push(`| Status | ${char.status} |`);

      if (char.chapterAppearances.length > 0) {
        lines.push(`| Chapters | ${char.chapterAppearances.join(', ')} |`);
      }

      if (char.mentionCount > 0) {
        lines.push(`| Mentions | ${char.mentionCount} |`);
      }

      if (char.dialogueCount > 0) {
        lines.push(`| Dialogues | ${char.dialogueCount} |`);
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}

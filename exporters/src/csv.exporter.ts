import type { Character, Book } from './types.js';
import { BaseExporter } from './base.js';

export class CsvExporter extends BaseExporter {
  export(characters: Character[], book: Book): string {
    const lines: string[] = [];

    // Header
    lines.push('name,aliases,description,confidence,status,chapterAppearances,mentionCount,dialogueCount');

    // Rows
    for (const char of characters) {
      const row = [
        this.escapeCsv(char.name),
        this.escapeCsv(char.aliases.join('; ')),
        this.escapeCsv(char.description ?? ''),
        char.confidence.toFixed(3),
        char.status,
        this.escapeCsv(char.chapterAppearances.join('; ')),
        char.mentionCount.toString(),
        char.dialogueCount.toString(),
      ];
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

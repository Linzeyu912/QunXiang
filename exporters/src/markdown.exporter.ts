import type { ExportEntity, Book, EntityKind } from './types.js';
import { KIND_LABEL } from './types.js';
import { BaseExporter } from './base.js';

export class MarkdownExporter extends BaseExporter {
  export(entities: ExportEntity[], book: Book, kind: EntityKind): string {
    const lines: string[] = [];

    lines.push(`# ${book.title}`);
    lines.push('');
    lines.push(`> Exported on ${new Date().toLocaleDateString()}`);
    lines.push('');
    lines.push(`## ${KIND_LABEL[kind]} (${entities.length})`);
    lines.push('');

    for (const e of entities) {
      lines.push(`### ${e.name}`);
      lines.push('');

      if (e.aliases && e.aliases.length > 0) {
        lines.push(`**Aliases:** ${e.aliases.join(', ')}`);
        lines.push('');
      }

      if (e.description) {
        lines.push(`${e.description}`);
        lines.push('');
      }

      lines.push(`| Property | Value |`);
      lines.push(`|----------|-------|`);
      lines.push(`| Confidence | ${((e.confidence ?? 0) * 100).toFixed(1)}% |`);
      lines.push(`| Status | ${e.status} |`);

      if (e.chapterAppearances && e.chapterAppearances.length > 0) {
        lines.push(`| Chapters | ${e.chapterAppearances.join(', ')} |`);
      }
      if (e.firstChapter != null) {
        lines.push(`| First Chapter | ${e.firstChapter} |`);
      }
      if (e.lastChapter != null) {
        lines.push(`| Last Chapter | ${e.lastChapter} |`);
      }
      if (e.mentionCount && e.mentionCount > 0) {
        lines.push(`| Mentions | ${e.mentionCount} |`);
      }

      if (kind === 'character') {
        if (e.dialogueCount && e.dialogueCount > 0) {
          lines.push(`| Dialogues | ${e.dialogueCount} |`);
        }
        if (e.coCharacters && e.coCharacters.length > 0) {
          lines.push(`| Co-Characters | ${e.coCharacters.join(', ')} |`);
        }
      } else {
        if (e.tier) lines.push(`| Tier | ${e.tier} |`);
        if (e.importanceScore != null) {
          lines.push(`| Importance | ${e.importanceScore.toFixed(3)} |`);
        }
        if (e.pillarCausal != null) lines.push(`| Pillar · Causal | ${e.pillarCausal} |`);
        if (e.pillarUniqueness != null) lines.push(`| Pillar · Uniqueness | ${e.pillarUniqueness} |`);
        if (e.pillarTransition != null) lines.push(`| Pillar · Transition | ${e.pillarTransition} |`);
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}

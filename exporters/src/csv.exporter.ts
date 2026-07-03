import type { ExportEntity, Book, EntityKind } from './types.js';
import { BaseExporter } from './base.js';

type Col = { header: string; get: (e: ExportEntity) => string };

const COMMON_COLS: Col[] = [
  { header: 'name', get: (e) => e.name },
  { header: 'aliases', get: (e) => (e.aliases ?? []).join('; ') },
  { header: 'description', get: (e) => e.description ?? '' },
  { header: 'confidence', get: (e) => (e.confidence ?? 0).toFixed(3) },
  { header: 'status', get: (e) => e.status },
  { header: 'mentionCount', get: (e) => (e.mentionCount ?? 0).toString() },
  { header: 'firstChapter', get: (e) => (e.firstChapter ?? '').toString() },
  { header: 'lastChapter', get: (e) => (e.lastChapter ?? '').toString() },
];

const CHARACTER_COLS: Col[] = [
  { header: 'dialogueCount', get: (e) => (e.dialogueCount ?? 0).toString() },
  { header: 'coCharacters', get: (e) => (e.coCharacters ?? []).join('; ') },
];

const TIERED_COLS: Col[] = [
  { header: 'tier', get: (e) => e.tier ?? '' },
  { header: 'importanceScore', get: (e) => (e.importanceScore ?? 0).toFixed(3) },
  { header: 'pillarCausal', get: (e) => (e.pillarCausal ?? 0).toString() },
  { header: 'pillarUniqueness', get: (e) => (e.pillarUniqueness ?? 0).toString() },
  { header: 'pillarTransition', get: (e) => (e.pillarTransition ?? 0).toString() },
];

export class CsvExporter extends BaseExporter {
  export(entities: ExportEntity[], _book: Book, kind: EntityKind): string {
    const cols = [...COMMON_COLS, ...(kind === 'character' ? CHARACTER_COLS : TIERED_COLS)];
    const lines: string[] = [];

    lines.push(cols.map((c) => c.header).join(','));

    for (const e of entities) {
      lines.push(cols.map((c) => this.escapeCsv(c.get(e))).join(','));
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

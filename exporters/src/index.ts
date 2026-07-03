export type { Character, ExportEntity, Book, Exporter, ExportFormat, EntityKind } from './types.js';
export { KIND_LABEL, KIND_PLURAL_KEY } from './types.js';
export { BaseExporter } from './base.js';
export { JsonExporter } from './json.exporter.js';
export { MarkdownExporter } from './markdown.exporter.js';
export { CsvExporter } from './csv.exporter.js';

import type { ExportEntity, Book, EntityKind } from './types.js';
import type { ExportFormat } from './types.js';
import { createExporter } from './factory.js';

/** 按种类导出任意一类实体（角色/场景/道具）。 */
export function exportEntities(
  entities: ExportEntity[],
  book: Book,
  kind: EntityKind,
  format: ExportFormat,
): string {
  const exporter = createExporter(format, book);
  return exporter.export(entities, book, kind);
}

/** 向后兼容：仅导出角色。 */
export function exportCharacters(
  characters: ExportEntity[],
  book: Book,
  format: ExportFormat,
): string {
  return exportEntities(characters, book, 'character', format);
}

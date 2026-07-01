export type { Character, Book } from './types.js';
export type { Exporter, ExportFormat } from './types.js';
export { BaseExporter } from './base.js';
export { JsonExporter } from './json.exporter.js';
export { MarkdownExporter } from './markdown.exporter.js';
export { CsvExporter } from './csv.exporter.js';

import type { Character, Book } from './types.js';
import type { ExportFormat } from './types.js';
import { JsonExporter } from './json.exporter.js';
import { MarkdownExporter } from './markdown.exporter.js';
import { CsvExporter } from './csv.exporter.js';

export function createExporter(format: ExportFormat, book: Book) {
  switch (format) {
    case 'json':
      return new JsonExporter(book);
    case 'markdown':
      return new MarkdownExporter(book);
    case 'csv':
      return new CsvExporter(book);
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

export function exportCharacters(
  characters: Character[],
  book: Book,
  format: ExportFormat
): string {
  const exporter = createExporter(format, book);
  return exporter.export(characters, book);
}

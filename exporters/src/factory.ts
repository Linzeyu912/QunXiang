import type { Book, ExportFormat } from './types.js';
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

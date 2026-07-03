import type { ExportEntity, Book, EntityKind, Exporter } from './types.js';

export abstract class BaseExporter implements Exporter {
  protected book: Book;

  constructor(book: Book) {
    this.book = book;
  }

  abstract export(entities: ExportEntity[], book: Book, kind: EntityKind): string;
}

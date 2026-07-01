import type { Character, Book } from './types.js';
import type { Exporter } from './types.js';

export abstract class BaseExporter implements Exporter {
  protected book: Book;

  constructor(book: Book) {
    this.book = book;
  }

  abstract export(characters: Character[], book: Book): string;
}

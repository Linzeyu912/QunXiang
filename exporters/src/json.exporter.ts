import type { Character, Book } from './types.js';
import { BaseExporter } from './base.js';

export class JsonExporter extends BaseExporter {
  export(characters: Character[], book: Book): string {
    const data = {
      book: {
        id: book.id,
        title: book.title,
        status: book.status,
      },
      characters,
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(data, null, 2);
  }
}

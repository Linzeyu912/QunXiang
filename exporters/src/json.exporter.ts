import type { ExportEntity, Book, EntityKind } from './types.js';
import { KIND_LABEL, KIND_PLURAL_KEY } from './types.js';
import { BaseExporter } from './base.js';

export class JsonExporter extends BaseExporter {
  export(entities: ExportEntity[], book: Book, kind: EntityKind): string {
    const data = {
      book: {
        id: book.id,
        title: book.title,
        status: book.status,
      },
      kind,
      kindLabel: KIND_LABEL[kind],
      [KIND_PLURAL_KEY[kind]]: entities,
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(data, null, 2);
  }
}

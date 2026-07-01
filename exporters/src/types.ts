// Re-export Character and Book types locally
// Note: Using local type definitions due to stale build in core package
export interface Character {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;
  createdAt: Date;
  updatedAt?: Date;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
  mentionCount: number;
  dialogueCount: number;
  coCharacters: string[];
}

export interface Book {
  id: string;
  title: string;
  content: string;
  status: 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED';
  userId: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Exporter {
  export(characters: Character[], book: Book): string;
}

export type ExportFormat = 'json' | 'markdown' | 'csv';

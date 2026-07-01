// Re-export Character and Book types from core
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

export type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

export interface ResolutionResult {
  characters: CharacterInput[];
  merged: number;
}

export type ResolvedCharacter = CharacterInput;

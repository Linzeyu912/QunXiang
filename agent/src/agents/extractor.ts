import type { AgentPayload, AgentResult } from '../types.js';
import { createExtractor } from '@novel-agent/extractors';
import { BookRepository } from '@novel-agent/storage';
import { parseTxt } from '@novel-agent/import';
import { readFile } from 'fs/promises';

export async function executeExtractor(payload: AgentPayload): Promise<AgentResult> {
  try {
    const bookId = payload.bookId;

    const book = await BookRepository.findById(bookId);
    if (!book) {
      return {
        success: false,
        error: `Book not found: ${bookId}`,
      };
    }

    const content = await readFile(book.filePath, 'utf-8');
    const { title, chapters } = parseTxt(content, book.title);

    const extractCharacters = createExtractor();
    const result = await extractCharacters(title, chapters);

    return {
      success: true,
      data: {
        characters: result.characters,
        chapterCount: chapters.length,
        bookTitle: title,
        failedBatches: result.failedBatches,
        totalBatches: result.totalBatches,
        successfulBatches: result.successfulBatches,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

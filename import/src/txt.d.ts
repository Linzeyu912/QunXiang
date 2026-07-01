export interface ParsedChapter {
    index: number;
    title?: string;
    content: string;
}
export interface ParseResult {
    title: string;
    chapters: ParsedChapter[];
    fullText: string;
}
/**
 * Parse TXT content into chapters
 * - Split by "---" chapter markers
 * - If no markers found, split by ~2000 characters
 */
export declare function parseTxt(content: string, filename: string): ParseResult;
//# sourceMappingURL=txt.d.ts.map
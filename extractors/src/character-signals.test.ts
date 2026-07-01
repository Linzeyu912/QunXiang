import { describe, it, expect } from 'vitest';
import { extractCharacterSignals, type CharacterSignals } from './character-signals.js';

describe('extractCharacterSignals', () => {
  describe('mentionCount', () => {
    it('should count mentions of a character name', () => {
      const chapters = [
        { index: 1, content: 'Alice went to the market. Alice bought apples.' },
        { index: 2, content: 'Alice met Bob at the store.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice']);

      expect(signals.get('Alice')?.mentionCount).toBe(3);
    });

    it('should count mentions with case insensitivity', () => {
      const chapters = [
        { index: 1, content: 'alice went to the market. ALICE bought apples.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice']);

      expect(signals.get('Alice')?.mentionCount).toBe(2);
    });

    it('should return 0 for characters not in text', () => {
      const chapters = [
        { index: 1, content: 'Alice went to the market.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Bob']);

      expect(signals.get('Bob')?.mentionCount).toBe(0);
    });
  });

  describe('dialogueCount', () => {
    it('should count dialogue lines per character', () => {
      const chapters = [
        { index: 1, content: '"Hello!" said Alice. "How are you?" asked Bob.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice', 'Bob']);

      // 2 dialogue lines split between 2 characters = 1 each
      expect(signals.get('Alice')?.dialogueCount).toBe(1);
      expect(signals.get('Bob')?.dialogueCount).toBe(1);
    });

    it('should handle characters appearing in same dialogue', () => {
      const chapters = [
        { index: 1, content: '"I love you," said Alice to Bob.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice', 'Bob']);

      // 1 dialogue line, both characters present = 1 each
      expect(signals.get('Alice')?.dialogueCount).toBe(1);
      expect(signals.get('Bob')?.dialogueCount).toBe(1);
    });

    it('should handle no dialogue', () => {
      const chapters = [
        { index: 1, content: 'Alice went to the market.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice']);

      expect(signals.get('Alice')?.dialogueCount).toBe(0);
    });
  });

  describe('coCharacters', () => {
    it('should track characters appearing in the same chapter', () => {
      const chapters = [
        { index: 1, content: 'Alice and Bob went to the market together.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice', 'Bob']);

      const aliceCoChars = signals.get('Alice')?.coCharacters || [];
      const bobCoChars = signals.get('Bob')?.coCharacters || [];

      expect(aliceCoChars).toContain('Bob');
      expect(bobCoChars).toContain('Alice');
    });

    it('should not include self in coCharacters', () => {
      const chapters = [
        { index: 1, content: 'Alice went to the market.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice']);

      const aliceCoChars = signals.get('Alice')?.coCharacters || [];

      expect(aliceCoChars).not.toContain('Alice');
    });

    it('should track coCharacters across multiple chapters', () => {
      const chapters = [
        { index: 1, content: 'Alice and Bob had lunch.' },
        { index: 2, content: 'Bob and Charlie went shopping.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice', 'Bob', 'Charlie']);

      const bobCoChars = signals.get('Bob')?.coCharacters || [];

      expect(bobCoChars).toContain('Alice');
      expect(bobCoChars).toContain('Charlie');
    });
  });

  describe('edge cases', () => {
    it('should handle empty chapters', () => {
      const chapters: Array<{ index: number; content: string }> = [];

      const signals = extractCharacterSignals(chapters, ['Alice']);

      expect(signals.get('Alice')?.mentionCount).toBe(0);
      expect(signals.get('Alice')?.dialogueCount).toBe(0);
    });

    it('should handle special regex characters in names', () => {
      const chapters = [
        { index: 1, content: 'Dr. Smith went to the office. Dr. Smith returned home.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Dr. Smith']);

      expect(signals.get('Dr. Smith')?.mentionCount).toBe(2);
    });

    it('should handle multiple characters in same text', () => {
      const chapters = [
        { index: 1, content: 'Alice, Bob, and Charlie all went to the park.' },
        { index: 2, content: 'Alice and Bob played chess while Charlie read a book.' },
      ];

      const signals = extractCharacterSignals(chapters, ['Alice', 'Bob', 'Charlie']);

      expect(signals.get('Alice')?.mentionCount).toBe(2);
      expect(signals.get('Bob')?.mentionCount).toBe(2);
      expect(signals.get('Charlie')?.mentionCount).toBe(2);
    });
  });
});

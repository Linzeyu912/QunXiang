import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildEntityMarkdown, buildPipelineSummary, writePipelineFinalSummary } from './pipeline-summary.js';

describe('pipeline summary', () => {
  it('builds a single final result summary from reviewer payload', () => {
    const summary = buildPipelineSummary('book-1', {
      characters: [{ name: '萧炎' }, { name: '萧战' }],
      locations: [{ name: '乌坦城' }],
      items: [{ name: '青木剑' }],
    }, { count: 2 });

    expect(summary).toMatchObject({
      bookId: 'book-1',
      status: 'completed',
      officialResult: true,
      counts: {
        characters: 2,
        locations: 1,
        items: 1,
      },
      outputs: {
        finalSummary: 'output/book-1/final/run-summary.json',
        prescanIntermediate: '.intermediate/book-1/prescan',
        entities: 'output/book-1/entities',
      },
      entities: {
        characters: ['萧炎', '萧战'],
        locations: ['乌坦城'],
        items: ['青木剑'],
      },
    });
    expect(summary.outputs).not.toHaveProperty('storyAssets');
  });

  it('writes final summary under the final output directory', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pipeline-summary-'));

    try {
      const filePath = await writePipelineFinalSummary(
        'book-1',
        { characters: [{ name: '萧炎' }], locations: [], items: [] },
        { count: 1 },
        outputRoot
      );
      const content = JSON.parse(await readFile(filePath, 'utf-8'));

      expect(filePath).toBe(join(outputRoot, 'book-1', 'final', 'run-summary.json'));
      expect(content.officialResult).toBe(true);
      expect(content.entities.characters).toEqual(['萧炎']);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('writes entity description packs from the pipeline payload', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pipeline-summary-descriptions-'));

    try {
      await writePipelineFinalSummary(
        'book-visuals',
        {
          runDirName: 'book-visuals-run',
          characters: [{ name: '萧炎' }],
          locations: [{ name: '乌坦城大厅' }],
          items: [{ name: '青木剑' }],
          characterDescriptions: [{
            entityType: 'character',
            name: '萧炎',
            aliases: ['炎儿'],
            sourceDescription: '萧炎身穿黑色衣衫。',
            fields: {
              appearance: '',
              clothing: '萧炎身穿黑色衣衫',
              body: '',
              temperament: '',
              signatureItems: '',
              abilityVisuals: '',
              statusMarkers: '',
            },
            missingFields: ['appearance'],
            evidenceSnippets: [{
              chapterIndex: 1,
              text: '萧炎身穿黑色衣衫。',
              matchedNames: ['萧炎'],
              fields: ['clothing'],
            }],
            sourceCoverage: 'partial',
            confidence: 0.28,
            needsReview: true,
          }],
          itemDescriptions: [{
            entityType: 'item',
            name: '青木剑',
            aliases: [],
            sourceDescription: '青木剑通体青色。',
            fields: {
              material: '',
              colorShape: '青木剑通体青色',
              condition: '',
              usage: '',
              visualEffects: '',
              ownership: '',
            },
            missingFields: ['material'],
            evidenceSnippets: [],
            sourceCoverage: 'partial',
            confidence: 0.2,
            needsReview: true,
          }],
          locationDescriptions: [{
            entityType: 'location',
            name: '乌坦城大厅',
            aliases: ['大厅'],
            sourceDescription: '大厅灯火明亮。',
            fields: {
              environment: '大厅',
              layout: '',
              atmosphere: '',
              lighting: '大厅灯火明亮',
              time: '',
              actionContext: '',
            },
            missingFields: ['layout'],
            evidenceSnippets: [],
            sourceCoverage: 'partial',
            confidence: 0.3,
            needsReview: true,
          }],
        },
        { count: 1 },
        outputRoot
      );

      const content = JSON.parse(await readFile(join(outputRoot, 'book-visuals-run', 'entities', 'character-descriptions.json'), 'utf-8'));
      expect(content[0].sourceDescription).toBe('萧炎身穿黑色衣衫。');
      const entitiesDir = join(outputRoot, 'book-visuals-run', 'entities');
      const itemContent = JSON.parse(await readFile(join(entitiesDir, 'item-descriptions.json'), 'utf-8'));
      const locationContent = JSON.parse(await readFile(join(entitiesDir, 'location-descriptions.json'), 'utf-8'));
      expect(itemContent[0].sourceDescription).toBe('青木剑通体青色。');
      expect(locationContent[0].sourceDescription).toBe('大厅灯火明亮。');
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('writes enhanced visual description packs from the pipeline payload', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pipeline-summary-visual-descriptions-'));

    try {
      await writePipelineFinalSummary(
        'book-visual-enhanced',
        {
          runDirName: 'book-visual-enhanced-run',
          characterVisualDescriptions: [{
            entityType: 'character',
            name: 'Xiao Yan',
            aliases: ['Yan'],
            sourceDescription: 'source black robe',
            enhancedDescription: 'source black robe; stubborn young fighter',
            fields: {
              appearance: '',
              clothing: 'source black robe',
              body: '',
              temperament: '',
              signatureItems: '',
              abilityVisuals: '',
              statusMarkers: '',
            },
            visualFields: {
              appearance: '',
              clothing: 'source black robe',
              body: '',
              temperament: 'stubborn young fighter',
              signatureItems: '',
              abilityVisuals: '',
              statusMarkers: '',
            },
            inferredFields: ['temperament'],
            missingFields: ['appearance'],
            evidenceSnippets: [],
            sourceCoverage: 'partial',
            completionStatus: 'llm_completed',
            llmSupplement: 'stubborn young fighter',
            confidence: 0.28,
            needsReview: true,
          }],
          itemVisualDescriptions: [{
            entityType: 'item',
            name: 'Black Ring',
            aliases: [],
            sourceDescription: 'plain black ring',
            enhancedDescription: 'plain black ring',
            fields: {
              material: '',
              colorShape: 'plain black ring',
              condition: '',
              usage: '',
              visualEffects: '',
              ownership: '',
            },
            visualFields: {
              material: '',
              colorShape: 'plain black ring',
              condition: '',
              usage: '',
              visualEffects: '',
              ownership: '',
            },
            inferredFields: [],
            missingFields: ['material'],
            evidenceSnippets: [],
            sourceCoverage: 'partial',
            completionStatus: 'source_only',
            llmSupplement: '',
            confidence: 0.2,
            needsReview: true,
          }],
          locationVisualDescriptions: [{
            entityType: 'location',
            name: 'Xiao Hall',
            aliases: [],
            sourceDescription: 'bright hall',
            enhancedDescription: 'bright hall',
            fields: {
              environment: 'hall',
              layout: '',
              atmosphere: '',
              lighting: 'bright hall',
              time: '',
              actionContext: '',
            },
            visualFields: {
              environment: 'hall',
              layout: '',
              atmosphere: '',
              lighting: 'bright hall',
              time: '',
              actionContext: '',
            },
            inferredFields: [],
            missingFields: ['layout'],
            evidenceSnippets: [],
            sourceCoverage: 'partial',
            completionStatus: 'source_only',
            llmSupplement: '',
            confidence: 0.3,
            needsReview: true,
          }],
        },
        { count: 1 },
        outputRoot
      );

      const entitiesDir = join(outputRoot, 'book-visual-enhanced-run', 'entities');
      const characterContent = JSON.parse(await readFile(join(entitiesDir, 'character-visual-descriptions.json'), 'utf-8'));
      const itemContent = JSON.parse(await readFile(join(entitiesDir, 'item-visual-descriptions.json'), 'utf-8'));
      const locationContent = JSON.parse(await readFile(join(entitiesDir, 'location-visual-descriptions.json'), 'utf-8'));
      expect(characterContent[0].enhancedDescription).toContain('stubborn young fighter');
      expect(characterContent[0].fields.clothing).toBe('source black robe');
      expect(itemContent[0].completionStatus).toBe('source_only');
      expect(locationContent[0].sourceDescription).toBe('bright hall');
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('writes entity markdown from fused pipeline payload when repository rows are unavailable', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pipeline-summary-payload-entities-'));

    try {
      await writePipelineFinalSummary(
        'book-fused-payload',
        {
          runDirName: 'book-fused-payload-run',
          characters: [{
            name: '韩立',
            aliases: ['小立'],
            description: '韩立是七玄门出身的谨慎修仙者，凭借长春功、神秘小瓶和医术逐步进入修仙世界。',
            confidence: 1,
            status: 'PENDING',
            chapterAppearances: [1, 150],
            mentionCount: 3000,
            dialogueCount: 530,
            firstChapter: 1,
            lastChapter: 150,
            coCharacters: [],
          }],
          items: [],
          locations: [],
          events: [],
        },
        { count: 1 },
        outputRoot
      );

      const summary = await readFile(join(outputRoot, 'book-fused-payload-run', 'entities', 'summary.md'), 'utf-8');
      expect(summary).toContain('韩立是七玄门出身的谨慎修仙者');
      expect(summary).toContain('| 韩立 | 小立 | 3000 | 530 | 1-150 |');
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('keeps full character descriptions in entity markdown instead of truncating them', () => {
    const longDescription = '萧家三少爷，曾被视为天才少年，后来斗之气倒退，身怀母亲遗留的黑色古戒，并在退婚冲突中写下休书。';

    const markdown = buildEntityMarkdown(
      '斗破苍穹',
      [{
        name: '萧炎',
        aliases: ['炎儿'],
        description: longDescription,
        mentionCount: 12,
        dialogueCount: 3,
        firstChapter: 1,
        lastChapter: 31,
      }],
      [],
      [],
      []
    );

    expect(markdown).toContain(longDescription);
    expect(markdown).not.toContain('萧家三少爷，曾被视为天才少年，后来斗之气倒退，身怀母亲遗留的黑色古戒，并在退婚冲突中写…');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatExtract = vi.fn();

vi.mock('@novel-agent/llm', () => ({
  getDefaultProvider: vi.fn(async () => ({ chatExtract })),
}));

describe('executeVisualDescription', () => {
  beforeEach(() => {
    chatExtract.mockReset();
  });

  it('keeps source fields unchanged and marks only LLM-filled fields as inferred', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Xiao Yan',
        visualFields: {
          appearance: 'young man with sharp eyes',
          clothing: 'wrong white robe',
          body: 'lean teenage build',
          temperament: 'quiet, stubborn intensity',
          signatureItems: 'black storage ring',
          abilityVisuals: 'pale flame aura',
          statusMarkers: '',
        },
        enhancedDescription: 'wrong white robe, young man with sharp eyes',
        llmSupplement: 'young man with sharp eyes; lean teenage build; quiet, stubborn intensity; pale flame aura',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: 'Xiao Yan',
        aliases: ['Yan'],
        description: 'Main character, fallen young genius from the Xiao clan.',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 20,
        dialogueCount: 4,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Xiao Yan',
        aliases: ['Yan'],
        sourceDescription: 'source black robe; source black storage ring',
        fields: {
          appearance: '',
          clothing: 'source black robe',
          body: '',
          temperament: '',
          signatureItems: 'source black storage ring',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['appearance', 'body', 'temperament', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'Xiao Yan wore a black robe and touched the black storage ring.',
          matchedNames: ['Xiao Yan'],
          fields: ['clothing', 'signatureItems'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.42,
        needsReview: true,
      }],
    });

    expect(result.characterVisualDescriptions).toHaveLength(1);
    const pack = result.characterVisualDescriptions[0];
    expect(pack.fields.clothing).toBe('source black robe');
    expect(pack.visualFields.clothing).toBe('source black robe');
    expect(pack.visualFields.signatureItems).toBe('source black storage ring');
    expect(pack.visualFields.appearance).toBe('young man with sharp eyes');
    expect(pack.inferredFields).toEqual(['appearance', 'body', 'temperament', 'abilityVisuals']);
    expect(pack.completionStatus).toBe('llm_completed');
    expect(pack.enhancedDescription).toContain('source black robe');
    expect(pack.enhancedDescription).not.toContain('wrong white robe');
    expect(pack.needsReview).toBe(true);
  });

  it('aligns alias-equivalent source packs to the final merged entity before completion', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Xun Er',
        visualFields: {
          appearance: '',
          clothing: '',
          body: '',
          temperament: 'quiet and reserved grace',
          signatureItems: '',
          abilityVisuals: 'faint golden presence',
          statusMarkers: '',
        },
        enhancedDescription: 'quiet and reserved grace, faint golden presence',
        llmSupplement: 'quiet and reserved grace; faint golden presence',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: 'Xun Er',
        aliases: ['Xiao Xun Er'],
        description: 'Close to Xiao Yan, with a mysterious background.',
        confidence: 0.9,
        status: 'PENDING',
        chapterAppearances: [1, 2],
        mentionCount: 20,
        dialogueCount: 1,
        coCharacters: ['Xiao Yan'],
      }],
      items: [],
      locations: [],
      characterDescriptions: [
        {
          entityType: 'character',
          name: 'Xiao Xun Er',
          aliases: [],
          sourceDescription: 'green lotus-like beauty',
          fields: {
            appearance: 'green lotus-like beauty',
            clothing: '',
            body: '',
            temperament: '',
            signatureItems: '',
            abilityVisuals: '',
            statusMarkers: '',
          },
          missingFields: ['clothing'],
          evidenceSnippets: [{
            chapterIndex: 1,
            text: 'Xiao Xun Er looked as graceful as a green lotus.',
            matchedNames: ['Xiao Xun Er'],
            fields: ['appearance'],
          }],
          sourceCoverage: 'partial',
          confidence: 0.3,
          needsReview: true,
        },
        {
          entityType: 'character',
          name: 'Xun Er',
          aliases: [],
          sourceDescription: 'pale green dress',
          fields: {
            appearance: '',
            clothing: 'pale green dress',
            body: '',
            temperament: '',
            signatureItems: '',
            abilityVisuals: '',
            statusMarkers: '',
          },
          missingFields: ['appearance'],
          evidenceSnippets: [{
            chapterIndex: 2,
            text: 'Xun Er wore a pale green dress.',
            matchedNames: ['Xun Er'],
            fields: ['clothing'],
          }],
          sourceCoverage: 'partial',
          confidence: 0.3,
          needsReview: true,
        },
      ],
    });

    const pack = result.characterVisualDescriptions[0];
    expect(pack.name).toBe('Xun Er');
    expect(pack.aliases).toContain('Xiao Xun Er');
    expect(pack.fields.appearance).toBe('green lotus-like beauty');
    expect(pack.fields.clothing).toBe('pale green dress');
    expect(pack.evidenceSnippets).toHaveLength(2);
    expect(pack.visualFields.temperament).toBe('quiet and reserved grace');
    expect(pack.inferredFields).toContain('temperament');
  });

  it('does not infer missing visual fields for secondary entities by default', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');

    const result = await executeVisualDescription({
      characters: [{
        name: 'Passing Guard',
        aliases: [],
        description: 'A briefly mentioned guard.',
        confidence: 0.99,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 1,
        dialogueCount: 0,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Passing Guard',
        aliases: [],
        sourceDescription: 'plain guard uniform',
        fields: {
          appearance: '',
          clothing: 'plain guard uniform',
          body: '',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['appearance', 'body', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'The passing guard wore a plain guard uniform.',
          matchedNames: ['Passing Guard'],
          fields: ['clothing'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.4,
        needsReview: true,
      }],
    });

    expect(chatExtract).not.toHaveBeenCalled();
    const pack = result.characterVisualDescriptions[0];
    expect(pack.visualFields.clothing).toBe('plain guard uniform');
    expect(pack.inferredFields).toEqual([]);
    expect(pack.completionStatus).toBe('source_only');
    expect(result.visualDescription).toMatchObject({
      requested: 0,
      completed: 1,
      sourceOnly: 1,
      inferred: 0,
    });
  });

  it('condenses very long source fields with the LLM without marking them as inferred', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    const longAppearance = Array.from({ length: 20 }, (_, index) => `source face detail ${index}`).join('; ');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Xiao Yan',
        visualFields: {
          appearance: 'concise source-grounded young face summary',
          clothing: 'wrong white robe',
          body: '',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        enhancedDescription: 'concise source-grounded young face summary',
        llmSupplement: 'process note that should stay out of the final visual description',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: 'Xiao Yan',
        aliases: [],
        description: 'Main character.',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 30,
        dialogueCount: 8,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Xiao Yan',
        aliases: [],
        sourceDescription: longAppearance,
        fields: {
          appearance: longAppearance,
          clothing: 'source black robe',
          body: 'source lean build',
          temperament: 'source stubborn gaze',
          signatureItems: 'source black ring',
          abilityVisuals: 'source pale flame',
          statusMarkers: 'source Xiao clan youth',
        },
        missingFields: [],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'Xiao Yan has many repeated source face details.',
          matchedNames: ['Xiao Yan'],
          fields: ['appearance'],
        }],
        sourceCoverage: 'strong',
        confidence: 0.95,
        needsReview: false,
      }],
    });

    const userPrompt = chatExtract.mock.calls[0]?.[1] as string;
    expect(userPrompt).toContain('source face detail 0');
    expect(userPrompt).not.toContain('source face detail 19');
    const pack = result.characterVisualDescriptions[0];
    expect(result.visualDescription.requested).toBe(1);
    expect(pack.visualFields.appearance).toBe('concise source-grounded young face summary');
    expect(pack.visualFields.clothing).toBe('source black robe');
    expect(pack.inferredFields).toEqual([]);
    expect(pack.summarizedFields).toEqual(['appearance']);
    expect(pack.completionStatus).toBe('llm_completed');
    expect(pack.enhancedDescription).not.toContain('source face detail 19');
    expect(pack.enhancedDescription).not.toContain('process note');
    expect(pack.llmSupplement).toBe('');
  });

  it('condenses repetitive multi-fragment source fields with the LLM', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Yao Lao',
        visualFields: {
          appearance: '透明苍老灵魂体，面容时而戏谑时而凝重',
          clothing: '',
          body: '',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        enhancedDescription: '透明苍老灵魂体，面容时而戏谑时而凝重，悬浮在黑色古戒旁',
        llmSupplement: '',
      }],
      items: [],
      locations: [],
    });

    const noisyAppearance = [
      '正飘荡着一道透明苍老人影',
      '药老脸庞笑容缓缓收敛',
      '药老脸庞一抖',
      '盯着药老戏谑的脸庞',
      '瞧着药老认真的面孔',
      '药老脸色凝重的道',
    ].join('；');

    const result = await executeVisualDescription({
      characters: [{
        name: 'Yao Lao',
        aliases: [],
        description: 'A mysterious soul in a ring.',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 30,
        dialogueCount: 8,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Yao Lao',
        aliases: [],
        sourceDescription: noisyAppearance,
        fields: {
          appearance: noisyAppearance,
          clothing: '',
          body: '',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['clothing', 'body', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'A transparent old soul hovered above the ring.',
          matchedNames: ['Yao Lao'],
          fields: ['appearance'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.42,
        needsReview: true,
      }],
    });

    const pack = result.characterVisualDescriptions[0];
    expect(pack.visualFields.appearance).toBe('透明苍老灵魂体，面容时而戏谑时而凝重');
    expect(pack.summarizedFields).toEqual(['appearance']);
    expect(pack.finalDescription).toBe('透明苍老灵魂体，面容时而戏谑时而凝重，悬浮在黑色古戒旁');
  });

  it('uses LLM enhanced descriptions as explicit final descriptions even without a field map', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Han Li',
        enhancedDescription: 'plain dark-skinned rural youth with a cautious, restrained presence and a hidden medicine pouch',
        llmSupplement: 'cautious, restrained presence; hidden medicine pouch',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: 'Han Li',
        aliases: [],
        description: 'Main character, a cautious cultivator from a rural background.',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 30,
        dialogueCount: 5,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Han Li',
        aliases: [],
        sourceDescription: 'dark-skinned rural youth',
        fields: {
          appearance: 'dark-skinned rural youth',
          clothing: '',
          body: '',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['clothing', 'body', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'Han Li looked like a dark-skinned rural youth.',
          matchedNames: ['Han Li'],
          fields: ['appearance'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.4,
        needsReview: true,
      }],
    });

    const pack = result.characterVisualDescriptions[0];
    expect(pack.enhancedDescription).toBe('plain dark-skinned rural youth with a cautious, restrained presence and a hidden medicine pouch');
    expect(pack.finalDescription).toBe(pack.enhancedDescription);
    expect(pack.supplementDescription).toBe('cautious, restrained presence；hidden medicine pouch');
    expect(pack.llmSupplement).toBe('cautious, restrained presence；hidden medicine pouch');
    expect(pack.completionStatus).toBe('llm_completed');
  });

  it('uses safe LLM enhanced descriptions as final descriptions when a field map is present', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Xiao Yan',
        visualFields: {
          appearance: 'clear-eyed teenage youth',
          clothing: 'wrong white robe',
          body: 'lean teenage build',
          temperament: 'withdrawn but stubborn',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        enhancedDescription: 'clear-eyed teenage youth in a source black robe, lean build, withdrawn but stubborn, carrying a source black storage ring',
        llmSupplement: 'lean build; withdrawn but stubborn',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: 'Xiao Yan',
        aliases: [],
        description: 'Main character.',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 30,
        dialogueCount: 8,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Xiao Yan',
        aliases: [],
        sourceDescription: 'source black robe; source black storage ring',
        fields: {
          appearance: '',
          clothing: 'source black robe',
          body: '',
          temperament: '',
          signatureItems: 'source black storage ring',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['appearance', 'body', 'temperament', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'Xiao Yan wore a black robe and touched the black storage ring.',
          matchedNames: ['Xiao Yan'],
          fields: ['clothing', 'signatureItems'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.42,
        needsReview: true,
      }],
    });

    const pack = result.characterVisualDescriptions[0];
    const systemPrompt = chatExtract.mock.calls[0]?.[0] as string;
    expect(systemPrompt).toContain('\u7b80\u4f53\u4e2d\u6587');
    expect(pack.visualFields.clothing).toBe('source black robe');
    expect(pack.enhancedDescription).toBe('clear-eyed teenage youth in a source black robe, lean build, withdrawn but stubborn, carrying a source black storage ring');
    expect(pack.finalDescription).toBe(pack.enhancedDescription);
    expect(pack.enhancedDescription).not.toContain('wrong white robe');
  });

  it('keeps detailed major character traits for later prompt conversion', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: '韩立',
        visualFields: {
          appearance: '面容普通但眉眼清醒，少年感朴素',
          clothing: '青灰色粗布衣',
          body: '身形偏瘦，肩背不宽但行动利落',
          temperament: '谨慎沉静，眼神克制',
          signatureItems: '随身药囊',
          abilityVisuals: '',
          statusMarkers: '七玄门出身的乡下少年',
        },
        visualDetails: {
          bodyBuild: '偏瘦的少年身材，肩背不宽',
          faceShape: '普通清瘦的少年脸',
          temperament: '谨慎沉静，克制内敛',
          hair: '黑发，简单束起',
          eyes: '眼神清醒警觉',
          nose: '鼻梁普通自然',
          lips: '唇形偏薄，表情少',
          skin: '肤色偏黑，带乡野粗粝感',
          makeupStyling: '无妆，朴素粗布少年装束',
        },
        enhancedDescription: '韩立是肤色偏黑、身形偏瘦的乡下少年，普通清瘦的脸，黑发简单束起，眼神清醒警觉，鼻梁普通自然，薄唇少表情，气质谨慎沉静，穿青灰色粗布衣，随身带药囊。',
        llmSupplement: '普通清瘦的少年脸；黑发简单束起；眼神清醒警觉；鼻梁普通自然；薄唇少表情；肤色偏黑；无妆朴素粗布装束',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: '韩立',
        aliases: [],
        description: '七玄门出身的谨慎乡下少年，主角。',
        confidence: 0.98,
        status: 'PENDING',
        tier: 'core',
        importanceScore: 0.95,
        chapterAppearances: [1, 2, 3],
        mentionCount: 50,
        dialogueCount: 8,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: '韩立',
        aliases: [],
        sourceDescription: '韩立肤色偏黑，神色谨慎',
        fields: {
          appearance: '肤色偏黑',
          clothing: '',
          body: '',
          temperament: '神色谨慎',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['clothing', 'body', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: '韩立肤色偏黑，神色谨慎。',
          matchedNames: ['韩立'],
          fields: ['appearance', 'temperament'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.45,
        needsReview: true,
      }],
    });

    const prompt = chatExtract.mock.calls[0]?.[1] as string;
    expect(prompt).toContain('主角或核心人物');
    expect(prompt).toContain('头发、眼睛、鼻子、嘴唇、皮肤、妆造');
    const pack = result.characterVisualDescriptions[0];
    expect(pack.visualDetails).toMatchObject({
      bodyBuild: '偏瘦的少年身材，肩背不宽',
      faceShape: '普通清瘦的少年脸',
      hair: '黑发，简单束起',
      eyes: '眼神清醒警觉',
      nose: '鼻梁普通自然',
      lips: '唇形偏薄，表情少',
      skin: '肤色偏黑，带乡野粗粝感',
      makeupStyling: '无妆，朴素粗布少年装束',
    });
    expect(pack.finalDescription).toContain('黑发简单束起');
    expect(pack.finalDescription).toContain('眼神清醒警觉');
    expect(pack.finalDescription).toContain('薄唇少表情');
  });

  it('keeps detailed item and location visual traits when the LLM supplies them', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [],
      items: [{
        name: '神秘小瓶',
        visualFields: {
          material: '玉石般温润的瓶身',
          colorShape: '小巧青绿色瓶子',
          condition: '表面古旧但完整',
          usage: '常被贴身收好',
          visualEffects: '瓶口有淡淡绿光',
          ownership: '韩立随身持有',
        },
        visualDetails: {
          materialTexture: '温润玉石质感',
          colorShape: '小巧青绿色瓶身',
          condition: '古旧完整',
          scale: '可握在掌心',
          effects: '淡淡绿光从瓶口透出',
        },
        enhancedDescription: '神秘小瓶呈小巧青绿色，玉石般温润，表面古旧但完整，可握在掌心，瓶口透出淡淡绿光，被韩立贴身收好。',
        llmSupplement: '可握在掌心；瓶口淡淡绿光',
      }],
      locations: [{
        name: '神手谷',
        visualFields: {
          environment: '山谷深处的药草之地',
          layout: '谷内有石屋和药田',
          atmosphere: '幽静偏僻',
          lighting: '晨雾中光线柔和',
          time: '清晨',
          actionContext: '适合采药修炼',
        },
        visualDetails: {
          environment: '山谷深处，草木和药田环绕',
          layout: '石屋、药田、小路层次分明',
          atmosphere: '幽静偏僻，带药草气息',
          lighting: '清晨薄雾里的柔光',
          keyVisualAnchors: '石屋、药田、谷中小路',
        },
        enhancedDescription: '神手谷位于山谷深处，草木和药田环绕，石屋、药田与谷中小路层次分明，清晨薄雾带来柔和光线，氛围幽静偏僻。',
        llmSupplement: '石屋、药田、小路层次分明；清晨薄雾柔光',
      }],
    });

    const result = await executeVisualDescription({
      characters: [],
      items: [{
        name: '神秘小瓶',
        aliases: [],
        description: '韩立随身的重要物品。',
        confidence: 0.95,
        status: 'PENDING',
        tier: 'core',
        importanceScore: 0.92,
        storyScore: 5,
        productionScore: 0.8,
        pillarCausal: 0.8,
        pillarUniqueness: 0.9,
        pillarTransition: 0.8,
        mentionCount: 10,
        chapterAppearances: [1, 2],
      }],
      locations: [{
        name: '神手谷',
        aliases: [],
        description: '韩立早期修炼与采药的重要地点。',
        confidence: 0.92,
        status: 'PENDING',
        tier: 'core',
        importanceScore: 0.88,
        storyScore: 4,
        productionScore: 0.8,
        pillarCausal: 0.7,
        pillarUniqueness: 0.7,
        pillarTransition: 0.7,
        mentionCount: 8,
        chapterAppearances: [1, 2],
      }],
      itemDescriptions: [{
        entityType: 'item',
        name: '神秘小瓶',
        aliases: [],
        sourceDescription: '青绿色小瓶',
        fields: {
          material: '',
          colorShape: '青绿色小瓶',
          condition: '',
          usage: '',
          visualEffects: '',
          ownership: '',
        },
        missingFields: ['material', 'condition', 'usage', 'visualEffects', 'ownership'],
        evidenceSnippets: [],
        sourceCoverage: 'partial',
        confidence: 0.3,
        needsReview: true,
      }],
      locationDescriptions: [{
        entityType: 'location',
        name: '神手谷',
        aliases: [],
        sourceDescription: '山谷深处',
        fields: {
          environment: '山谷深处',
          layout: '',
          atmosphere: '',
          lighting: '',
          time: '',
          actionContext: '',
        },
        missingFields: ['layout', 'atmosphere', 'lighting', 'time', 'actionContext'],
        evidenceSnippets: [],
        sourceCoverage: 'partial',
        confidence: 0.3,
        needsReview: true,
      }],
    });

    expect(result.itemVisualDescriptions[0].visualDetails).toMatchObject({
      materialTexture: '温润玉石质感',
      scale: '可握在掌心',
      effects: '淡淡绿光从瓶口透出',
    });
    expect(result.locationVisualDescriptions[0].visualDetails).toMatchObject({
      layout: '石屋、药田、小路层次分明',
      lighting: '清晨薄雾里的柔光',
      keyVisualAnchors: '石屋、药田、谷中小路',
    });
    expect(result.itemVisualDescriptions[0].finalDescription).toContain('瓶口透出淡淡绿光');
    expect(result.locationVisualDescriptions[0].finalDescription).toContain('清晨薄雾');
  });

  it('removes process narration from LLM visual supplements before composing final descriptions', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: 'Yao Lao',
        visualFields: {
          appearance: '',
          clothing: '透明灵魂体，衣着特征不显',
          body: '虚幻飘荡的人形轮廓',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        enhancedDescription: '',
        llmSupplement: 'signatureItems：原文未单独描写其随身道具，仅在clothing类证据片段中出现\'递过来一张黑色卡片\'，保守移入signatureItems作为视觉补写；body：原文未将身形独立描写，但在appearance类证据中出现\'透明苍老人影\'，保守将其移入body字段作为身形补写',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: 'Yao Lao',
        aliases: [],
        description: 'A mysterious soul in a ring.',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 30,
        dialogueCount: 8,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: 'Yao Lao',
        aliases: [],
        sourceDescription: 'transparent old soul hovering above a ring',
        fields: {
          appearance: 'transparent old soul hovering above a ring',
          clothing: '',
          body: '',
          temperament: '',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['clothing', 'body', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: 'A transparent old soul hovered above the ring.',
          matchedNames: ['Yao Lao'],
          fields: ['appearance'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.42,
        needsReview: true,
      }],
    });

    const pack = result.characterVisualDescriptions[0];
    expect(pack.llmSupplement).toBe('递过来一张黑色卡片；透明苍老人影');
    expect(pack.finalDescription).not.toContain('clothing');
    expect(pack.finalDescription).not.toContain('body');
    expect(pack.finalDescription).not.toContain('原文未描写');
    expect(pack.supplementDescription).not.toContain('原文未单独描写');
    expect(pack.supplementDescription).not.toContain('保守移入');
  });

  it('keeps source-only visual packs when an LLM completion group fails', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');
    chatExtract.mockRejectedValueOnce(new Error('visual timeout'));

    const result = await executeVisualDescription({
      characters: [{
        name: '韩立',
        aliases: [],
        description: '七玄门弟子，性格谨慎坚韧。',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 30,
        dialogueCount: 5,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: '韩立',
        aliases: [],
        sourceDescription: '面容普通，神色谨慎',
        fields: {
          appearance: '面容普通',
          clothing: '',
          body: '',
          temperament: '神色谨慎',
          signatureItems: '',
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['clothing', 'body', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [{
          chapterIndex: 1,
          text: '韩立面容普通，神色谨慎。',
          matchedNames: ['韩立'],
          fields: ['appearance', 'temperament'],
        }],
        sourceCoverage: 'partial',
        confidence: 0.4,
        needsReview: true,
      }],
    });

    const pack = result.characterVisualDescriptions[0];
    expect(pack.visualFields.appearance).toBe('面容普通');
    expect(pack.visualFields.temperament).toBe('神色谨慎');
    expect(pack.inferredFields).toEqual([]);
    expect(pack.llmSupplement).toBe('');
    expect(pack.completionStatus).toBe('source_only');
    expect(result.visualDescription).toEqual({
      requested: 1,
      completed: 1,
      sourceOnly: 1,
      inferred: 0,
    });
  });
});

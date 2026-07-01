import type { ParseResult } from '@novel-agent/import';
import { ArcType, ArcPhase } from './arc-types.js';
import type {
  ArcAnalysisResult,
  StoryArc,
  TurningPoint,
  SegmentChapter,
} from './arc-types.js';
import { segmentParseResult } from './chapter-segments.js';
import { v4 as uuidv4 } from 'uuid';

const ACT_1_RATIO = 0.25;
const ACT_2_RATIO = 0.5;
const ACT_3_RATIO = 0.25;

const TURNING_POINT_KEYWORDS = {
  INCITING: [
    '突然', '没想到', '意外', '就在这时', '突然发生', '出乎意料',
    'suddenly', 'unexpectedly', 'just then', 'out of nowhere',
  ],
  MIDPOINT: [
    '然而', '但是', '可是', '不过', '转折', '事情开始变得',
    'however', 'but', 'yet', '转折点', 'turning point',
  ],
  CLIMAX: [
    '终于', '最后', '关键时刻', '决定性', '生死关头', '高潮',
    'finally', 'at last', 'crucial moment', 'climax', 'turning point',
  ],
};

function detectTurningPoints(segments: SegmentChapter[]): TurningPoint[] {
  const turningPoints: TurningPoint[] = [];

  for (let i = 0; i < segments.length; i++) {
    const chapter = segments[i];
    const content = chapter.fullContent;

    for (const keyword of TURNING_POINT_KEYWORDS.INCITING) {
      if (content.includes(keyword) && i < segments.length * 0.15) {
        turningPoints.push({
          chapterIndex: i,
          type: 'INCITING',
          description: `Inciting incident detected near: "${keyword}"`,
        });
        break;
      }
    }

    for (const keyword of TURNING_POINT_KEYWORDS.MIDPOINT) {
      if (content.includes(keyword) && i >= segments.length * 0.4 && i <= segments.length * 0.6) {
        const existing = turningPoints.find(tp => tp.type === 'MIDPOINT');
        if (!existing) {
          turningPoints.push({
            chapterIndex: i,
            type: 'MIDPOINT',
            description: `Midpoint turning point detected near: "${keyword}"`,
          });
        }
        break;
      }
    }

    for (const keyword of TURNING_POINT_KEYWORDS.CLIMAX) {
      if (content.includes(keyword) && i >= segments.length * 0.7) {
        turningPoints.push({
          chapterIndex: i,
          type: 'CLIMAX',
          description: `Climax detected near: "${keyword}"`,
        });
        break;
      }
    }
  }

  return turningPoints;
}

function determineArcType(
  chapterIndex: number,
  totalChapters: number,
  hasTurningPoint: boolean,
  turningPointType?: 'INCITING' | 'MIDPOINT' | 'CLIMAX'
): { arcType: ArcType; phase: ArcPhase } {
  const ratio = chapterIndex / totalChapters;

  if (ratio < 0.1) {
    return { arcType: ArcType.ACT_1_SETUP, phase: ArcPhase.ACT_1 };
  } else if (ratio < ACT_1_RATIO) {
    if (hasTurningPoint && turningPointType === 'INCITING') {
      return { arcType: ArcType.ACT_1_INCITING, phase: ArcPhase.ACT_1 };
    }
    return { arcType: ArcType.ACT_1_SETUP, phase: ArcPhase.ACT_1 };
  } else if (ratio < ACT_1_RATIO + ACT_2_RATIO * 0.3) {
    return { arcType: ArcType.ACT_2_RISING, phase: ArcPhase.ACT_2 };
  } else if (ratio < ACT_1_RATIO + ACT_2_RATIO * 0.5) {
    if (hasTurningPoint && turningPointType === 'MIDPOINT') {
      return { arcType: ArcType.ACT_2_MIDPOINT, phase: ArcPhase.ACT_2 };
    }
    return { arcType: ArcType.ACT_2_COMPLICATIONS, phase: ArcPhase.ACT_2 };
  } else if (ratio < ACT_1_RATIO + ACT_2_RATIO * 0.8) {
    return { arcType: ArcType.ACT_2_CLIMAX_PREP, phase: ArcPhase.ACT_2 };
  } else if (ratio < ACT_1_RATIO + ACT_2_RATIO) {
    if (hasTurningPoint && turningPointType === 'CLIMAX') {
      return { arcType: ArcType.ACT_3_CLIMAX, phase: ArcPhase.ACT_3 };
    }
    return { arcType: ArcType.ACT_2_CLIMAX_PREP, phase: ArcPhase.ACT_2 };
  } else if (ratio < 0.9) {
    return { arcType: ArcType.ACT_3_FALLING, phase: ArcPhase.ACT_3 };
  } else {
    return { arcType: ArcType.ACT_3_RESOLUTION, phase: ArcPhase.ACT_3 };
  }
}

export function analyzeStoryArcs(
  parseResult: ParseResult,
  bookId: string,
  options: { minChapterLength?: number; sceneChangeThreshold?: number } = {}
): ArcAnalysisResult {
  const totalChapters = parseResult.chapters.length;
  const segments = segmentParseResult(parseResult, options);
  const turningPoints = detectTurningPoints(segments);

  const arcs: StoryArc[] = [];
  const act1Chapters: number[] = [];
  const act2Chapters: number[] = [];
  const act3Chapters: number[] = [];

  for (let i = 0; i < totalChapters; i++) {
    const nearbyTurningPoint = turningPoints.find(
      tp => Math.abs(tp.chapterIndex - i) <= 1
    );

    const { arcType, phase } = determineArcType(
      i,
      totalChapters,
      !!nearbyTurningPoint,
      nearbyTurningPoint?.type
    );

    const arc: StoryArc = {
      id: uuidv4(),
      bookId,
      type: arcType,
      phase,
      startChapter: i,
      endChapter: i,
      description: `Chapter ${i + 1} - ${arcType} (${phase})`,
      keyEvents: nearbyTurningPoint ? [nearbyTurningPoint.description] : [],
      confidence: nearbyTurningPoint ? 0.8 : 0.6,
    };

    arcs.push(arc);

    if (phase === ArcPhase.ACT_1) {
      act1Chapters.push(i);
    } else if (phase === ArcPhase.ACT_2) {
      act2Chapters.push(i);
    } else {
      act3Chapters.push(i);
    }
  }

  return {
    arcs,
    act1Chapters,
    act2Chapters,
    act3Chapters,
    turningPoints,
    totalChapters,
  };
}

export function getArcSummary(analysis: ArcAnalysisResult): string {
  const { act1Chapters, act2Chapters, act3Chapters, turningPoints } = analysis;

  const summary = [
    `Story Arc Analysis Summary:`,
    `- Act 1 (Setup): ${act1Chapters.length} chapters (${act1Chapters.length > 0 ? `Chapters ${act1Chapters[0] + 1}-${act1Chapters[act1Chapters.length - 1] + 1}` : 'None'})`,
    `- Act 2 (Development): ${act2Chapters.length} chapters (${act2Chapters.length > 0 ? `Chapters ${act2Chapters[0] + 1}-${act2Chapters[act2Chapters.length - 1] + 1}` : 'None'})`,
    `- Act 3 (Resolution): ${act3Chapters.length} chapters (${act3Chapters.length > 0 ? `Chapters ${act3Chapters[0] + 1}-${act3Chapters[act3Chapters.length - 1] + 1}` : 'None'})`,
    `- Turning Points Found: ${turningPoints.length}`,
  ];

  return summary.join('\n');
}

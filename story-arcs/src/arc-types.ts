import type { ParsedChapter } from '@novel-agent/import';

export enum ArcType {
  ACT_1_SETUP = 'ACT_1_SETUP',
  ACT_1_INCITING = 'ACT_1_INCITING',
  ACT_2_RISING = 'ACT_2_RISING',
  ACT_2_COMPLICATIONS = 'ACT_2_COMPLICATIONS',
  ACT_2_MIDPOINT = 'ACT_2_MIDPOINT',
  ACT_2_CLIMAX_PREP = 'ACT_2_CLIMAX_PREP',
  ACT_3_CLIMAX = 'ACT_3_CLIMAX',
  ACT_3_FALLING = 'ACT_3_FALLING',
  ACT_3_RESOLUTION = 'ACT_3_RESOLUTION',
}

export enum ArcPhase {
  ACT_1 = 'ACT_1',
  ACT_2 = 'ACT_2',
  ACT_3 = 'ACT_3',
}

export interface StoryArc {
  id: string;
  bookId: string;
  type: ArcType;
  phase: ArcPhase;
  startChapter: number;
  endChapter: number;
  description: string;
  keyEvents: string[];
  confidence: number;
}

export interface ArcAnalysisResult {
  arcs: StoryArc[];
  act1Chapters: number[];
  act2Chapters: number[];
  act3Chapters: number[];
  turningPoints: TurningPoint[];
  totalChapters: number;
}

export interface TurningPoint {
  chapterIndex: number;
  type: 'INCITING' | 'MIDPOINT' | 'CLIMAX';
  description: string;
}

export interface ChapterSegment {
  id: string;
  chapterIndex: number;
  segmentIndex: number;
  content: string;
  type: 'SCENE' | 'DIALOGUE' | 'DESCRIPTION' | 'TRANSITION';
  sceneChange: boolean;
  startPosition: number;
  endPosition: number;
}

export interface SegmentChapter {
  index: number;
  title?: string;
  segments: ChapterSegment[];
  fullContent: string;
}

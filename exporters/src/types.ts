// 通用实体导出形状：三类实体（角色/场景/道具）的并集，类型特有字段可选。
// 存储层返回的对象经路由层归一化为该形状后送入 exporter。

export type EntityKind = 'character' | 'location' | 'item';

export interface ExportEntity {
  id: string;
  name: string;
  aliases: string[];
  description?: string | null;
  confidence: number;
  status: string;
  chapterAppearances?: number[];
  mentionCount?: number;
  firstChapter?: number | null;
  lastChapter?: number | null;
  // 角色特有
  dialogueCount?: number;
  coCharacters?: string[];
  // 场景 / 道具特有
  tier?: string;
  importanceScore?: number;
  storyScore?: number;
  productionScore?: number;
  pillarCausal?: number;
  pillarUniqueness?: number;
  pillarTransition?: number;
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
  export(entities: ExportEntity[], book: Book, kind: EntityKind): string;
}

export type ExportFormat = 'json' | 'markdown' | 'csv';

// 向后兼容：旧的 Character 类型等价于角色形态的 ExportEntity。
export type Character = ExportEntity;

export const KIND_LABEL: Record<EntityKind, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
};

export const KIND_PLURAL_KEY: Record<EntityKind, string> = {
  character: 'characters',
  location: 'locations',
  item: 'items',
};

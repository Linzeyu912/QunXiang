import type { ExportEntity, Book, EntityKind } from './types.js';
import { KIND_LABEL } from './types.js';
import { BaseExporter } from './base.js';

/** 世界观/体系类别中文标签（导出展示用）。 */
const WORLDVIEW_CATEGORY_LABEL: Record<string, string> = {
  worldview: '世界观背景',
  'power-system': '力量体系',
  realm: '境界等级',
  faction: '组织势力',
  rule: '规则法则',
};

/** 道具大类中文标签（导出展示用）。 */
const ITEM_CATEGORY_LABEL: Record<string, string> = {
  weapon: '武器',
  skill: '技能功法',
  food: '食物',
  pill: '丹药消耗品',
  treasure: '法宝器物',
  other: '其他物品',
};

export class MarkdownExporter extends BaseExporter {
  export(entities: ExportEntity[], book: Book, kind: EntityKind): string {
    const lines: string[] = [];

    lines.push(`# ${book.title}`);
    lines.push('');
    lines.push(`> Exported on ${new Date().toLocaleDateString()}`);
    lines.push('');
    lines.push(`## ${KIND_LABEL[kind]} (${entities.length})`);
    lines.push('');

    for (const e of entities) {
      lines.push(`### ${e.name}`);
      lines.push('');

      if (e.aliases && e.aliases.length > 0) {
        lines.push(`**Aliases:** ${e.aliases.join(', ')}`);
        lines.push('');
      }

      if (e.description) {
        lines.push(`${e.description}`);
        lines.push('');
      }

      lines.push(`| Property | Value |`);
      lines.push(`|----------|-------|`);
      lines.push(`| Confidence | ${((e.confidence ?? 0) * 100).toFixed(1)}% |`);
      lines.push(`| Status | ${e.status} |`);

      if (e.chapterAppearances && e.chapterAppearances.length > 0) {
        lines.push(`| Chapters | ${e.chapterAppearances.join(', ')} |`);
      }
      if (e.firstChapter != null) {
        lines.push(`| First Chapter | ${e.firstChapter} |`);
      }
      if (e.lastChapter != null) {
        lines.push(`| Last Chapter | ${e.lastChapter} |`);
      }
      if (e.mentionCount && e.mentionCount > 0) {
        lines.push(`| Mentions | ${e.mentionCount} |`);
      }

      if (kind === 'character') {
        if (e.dialogueCount && e.dialogueCount > 0) {
          lines.push(`| Dialogues | ${e.dialogueCount} |`);
        }
        if (e.coCharacters && e.coCharacters.length > 0) {
          lines.push(`| Co-Characters | ${e.coCharacters.join(', ')} |`);
        }
      } else if (kind === 'worldview') {
        if (e.category) {
          lines.push(`| 类别 | ${WORLDVIEW_CATEGORY_LABEL[e.category] ?? e.category} |`);
        }
      } else {
        if (kind === 'item' && e.category) {
          lines.push(`| Category | ${ITEM_CATEGORY_LABEL[e.category] ?? e.category} |`);
        }
        if (e.tier) lines.push(`| Tier | ${e.tier} |`);
        if (e.importanceScore != null) {
          lines.push(`| Importance | ${e.importanceScore.toFixed(3)} |`);
        }
        if (e.pillarCausal != null) lines.push(`| Pillar · Causal | ${e.pillarCausal} |`);
        if (e.pillarUniqueness != null) lines.push(`| Pillar · Uniqueness | ${e.pillarUniqueness} |`);
        if (e.pillarTransition != null) lines.push(`| Pillar · Transition | ${e.pillarTransition} |`);
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * alias-safety / character-signals 性能基准
 *
 * 背景：2026-09-08 斗罗大陆（约 283 万字）提取时，批后同步分析块把 API 事件循环
 * 阻塞数小时。本脚本用于量化修复前后的耗时，防止回归。
 *
 * 用法：pnpm tsx scripts/bench-alias-safety.mts [文本字数 ...]
 * 默认跑 12 万 / 30 万 / 280 万（约一本长篇）三档。
 */
import { hrtime } from 'node:process';
import { chooseCanonicalCharacterName, isCollectiveCharacterAlias } from '../entity-resolution/src/detectors/alias-safety.js';
import { extractCharacterSignals } from '../extractors/src/character-signals.js';
import { calcImportance } from '../entity-prescan/src/importance.js';
import type { EntityMention, ScanChapter } from '../entity-prescan/src/types.js';

/** 合成仿网文文本：主角名高频 + 亲属称谓 + 长老称号 + 集合称谓 + 噪声 */
const PROTAGONISTS = ['唐三', '小舞', '戴沐白', '奥斯卡', '马红俊', '宁荣荣', '朱竹清'];

function buildSyntheticBook(targetChars: number): string {
  const protagonists = PROTAGONISTS;
  const elders = ['三长老', '大长老', '七长老'];
  const kinship = ['父亲', '母亲', '爷爷', '叔叔', '姐姐'];
  const collective = ['三位长老', '几位长老', '两名护卫', '一众弟子'];
  const surnames = '赵钱孙李周吴郑王冯陈蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜谢邹';
  const noiseVerbs = '说道看向走 出转身微微顿时轻轻缓缓忽然立刻随即顿时'.replace(/ /g, '');
  const parts: string[] = [];
  let total = 0;
  let seed = 12345;
  const rand = () => {
    // 简单线性同余，保证可复现
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  while (total < targetChars) {
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
    const lines: string[] = [];
    for (let i = 0; i < 6 && total < targetChars; i++) {
      const hero = pick(protagonists);
      const other = pick(protagonists);
      const sentence =
        `${hero}${pick(noiseVerbs.split(''))}了一声，${pick(kinship)}的脸上露出笑意。` +
        `${other}皱眉道：「${hero}，${pick(elders)}正在等你。」` +
        `远处${pick(collective)}纷纷侧目，${pick(surnames.split(''))}${pick(surnames.split(''))}也不例外观望。`;
      lines.push(sentence);
      total += sentence.length;
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n');
}

function timeMs(fn: () => void): number {
  const start = hrtime.bigint();
  fn();
  return Number(hrtime.bigint() - start) / 1e6;
}

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite);
const targets = sizes.length > 0 ? sizes : [120_000, 300_000, 2_800_000];

for (const size of targets) {
  const text = buildSyntheticBook(size);
  console.log(`\n===== 文本规模：${(size / 10000).toFixed(0)} 万字（实际 ${text.length} 字）=====`);

  // 1. isCollectiveCharacterAlias：随机 2-3 字候选（大多不命中，走完全部模式）
  const candidates: string[] = [];
  for (let i = 0; i < 2000; i++) {
    const at = Math.floor((i * 7919) % Math.max(1, text.length - 3));
    candidates.push(text.slice(at, at + (i % 2 ? 2 : 3)));
  }
  const t1 = timeMs(() => {
    let hits = 0;
    for (const c of candidates) if (isCollectiveCharacterAlias(c)) hits++;
    console.log(`  isCollectiveCharacterAlias 命中数: ${hits}`);
  });
  console.log(`  isCollectiveCharacterAlias ×2000 候选: ${t1.toFixed(0)} ms`);

  // 2. 卡死主路径：裸亲属称谓走全书 fallback 扫描 + 评分
  const t2 = timeMs(() => {
    const chosen = chooseCanonicalCharacterName('父亲', ['三长老'], {
      sourceText: text,
      knownCharacterNames: ['唐三', '小舞', '戴沐白'],
    });
    console.log(`  chooseCanonicalCharacterName('父亲') 结果: ${chosen}`);
  });
  console.log(`  chooseCanonicalCharacterName('父亲'): ${t2.toFixed(0)} ms`);

  // 3. 第二个嫌疑点：信号统计（章节 × 名字正则）
  const chapters = text.match(/[\s\S]{1,9000}/g) ?? [];
  const names = ['唐三', '小舞', '戴沐白', '奥斯卡', '马红俊', '宁荣荣', '朱竹清', '三长老', '父亲'];
  const t3 = timeMs(() => {
    extractCharacterSignals(
      chapters.map((content, i) => ({ index: i, title: `第${i}章`, content })),
      names,
    );
  });
  console.log(`  extractCharacterSignals（${chapters.length} 章 × ${names.length} 名字）: ${t3.toFixed(0)} ms`);

  // 4. 第三个嫌疑点：重要性评分（每实体原需对全书做逐字 bigram 扫描）
  const scanChapters = chapters.map((content, i) => ({ index: i, title: `第${i}章`, content }));
  const entityNames = [
    ...PROTAGONISTS,
    '三长老', '大长老', '武魂殿', '史莱克学院', '诺丁城', '圣魂村', '昊天锤', '蓝银草', '幽冥灵猫',
  ];
  const entityMap = new Map<string, EntityMention[]>();
  for (const name of entityNames) {
    const mentions: EntityMention[] = [];
    const seenChapters: number[] = [];
    let total = 0;
    for (const ch of scanChapters) {
      let idx = ch.content.indexOf(name);
      let countInChapter = 0;
      while (idx !== -1) {
        if (mentions.length < 30) mentions.push({ text: name, chapterIndex: ch.index, position: idx, source: 'regex', confidence: 0.9 });
        countInChapter++;
        idx = ch.content.indexOf(name, idx + name.length);
      }
      if (countInChapter > 0) { seenChapters.push(ch.index); total += countInChapter; }
    }
    for (const m of mentions) {
      m.totalCount = total;
      m.allChapters = seenChapters;
    }
    if (mentions.length > 0) {
      const list = entityMap.get('character') ?? [];
      list.push(...mentions);
      entityMap.set('character', list);
    }
  }
  const t4 = timeMs(() => {
    const result = calcImportance(entityMap, scanChapters);
    console.log(`  calcImportance 实体数: ${[...result.values()].flat().length}`);
  });
  console.log(`  calcImportance（${entityNames.length} 实体 × ${scanChapters.length} 章）: ${t4.toFixed(0)} ms`);
}

/**
 * Extract batch4 only (chapters 91-100) and merge into existing output
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getDefaultProvider } from '@novel-agent/llm';
import { z } from 'zod';
import { CHARACTER_EXTRACTION_PROMPT, CHARACTER_BATCH_PROMPT } from '@novel-agent/prompts';
import {
  chooseCanonicalCharacterName,
  isCollectiveCharacterAlias,
  isSafeAliasMatch,
  isSafeSharedAliasMatch,
  sanitizeCharacterAliases,
} from '@novel-agent/entity-resolution';

const extractionResultSchema = z.object({
  characters: z.array(z.object({
    name: z.string(), aliases: z.array(z.string()).optional().default([]),
    description: z.string().optional().default(''), confidence: z.number().optional().default(0.8),
    firstChapter: z.number().optional(), lastChapter: z.number().optional(),
    chapterAppearances: z.array(z.number()).optional().default([]),
  })).default([]),
  items: z.array(z.object({
    name: z.string(), aliases: z.array(z.string()).optional().default([]),
    description: z.string().optional().default(''), confidence: z.number().optional().default(0.8),
    firstChapter: z.number().optional(), lastChapter: z.number().optional(),
    chapterAppearances: z.array(z.number()).optional().default([]),
  })).default([]),
  locations: z.array(z.object({
    name: z.string(), aliases: z.array(z.string()).optional().default([]),
    description: z.string().optional().default(''), confidence: z.number().optional().default(0.8),
    firstChapter: z.number().optional(), lastChapter: z.number().optional(),
    chapterAppearances: z.array(z.number()).optional().default([]),
  })).default([]),
});

type Ch = z.infer<typeof extractionResultSchema.shape.characters.element>;
type Chapter = { index: number; title?: string; content: string };

function norm(s: string) { return s.toLowerCase().trim(); }
function unique<T>(v: Array<T | null | undefined>): T[] { return [...new Set(v.filter((x): x is T => x != null))]; }
function mergeDescriptions(...values: Array<string | null | undefined>): string | undefined {
  const descriptions: string[] = [];
  for (const value of values) {
    const description = value?.trim().replace(/\s+/gu, ' ');
    if (!description) continue;
    const existingIndex = descriptions.findIndex((existing) => existing.includes(description) || description.includes(existing));
    if (existingIndex >= 0) {
      if (description.length > descriptions[existingIndex].length) descriptions[existingIndex] = description;
    } else {
      descriptions.push(description);
    }
  }
  return descriptions.length > 0 ? descriptions.join('；') : undefined;
}

function findDup(c: Ch, map: Map<string, Ch>): Ch | null {
  if (map.has(norm(c.name))) return map.get(norm(c.name))!;
  for (const [, e] of map) {
    if (isSafeAliasMatch(e as any, c as any)) return e;
    if (isSafeSharedAliasMatch(e as any, c as any)) return e;
  }
  return null;
}

function mergeCh(a: Ch, b: Ch): Ch {
  const base = (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
  const other = base === a ? b : a;
  const chaps = unique([...(base.chapterAppearances || []), ...(other.chapterAppearances || [])]).sort((x, y) => x - y);
  return { ...base, aliases: unique([...(base.aliases || []), ...(other.aliases || []), other.name]).filter(al => al !== base.name),
    description: mergeDescriptions(base.description, other.description), confidence: Math.max(a.confidence ?? 0, b.confidence ?? 0),
    firstChapter: chaps[0] ?? base.firstChapter, lastChapter: chaps[chaps.length - 1] ?? base.lastChapter, chapterAppearances: chaps };
}

function dedupArr<T extends { name: string; aliases?: string[]; description?: string; confidence?: number; firstChapter?: number; lastChapter?: number; chapterAppearances?: number[] }>(arr: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of arr) {
    const key = norm(item.name);
    const e = map.get(key);
    if (!e) { map.set(key, { ...item }); } else {
      const chaps = unique([...(e.chapterAppearances || []), ...(item.chapterAppearances || [])]).sort((x, y) => x - y);
      map.set(key, { ...e, aliases: unique([...(e.aliases || []), ...(item.aliases || [])]).filter(al => al !== e.name),
        description: mergeDescriptions(e.description, item.description), confidence: Math.max(e.confidence ?? 0, item.confidence ?? 0),
        firstChapter: chaps[0] ?? e.firstChapter, lastChapter: chaps[chaps.length - 1] ?? e.lastChapter, chapterAppearances: chaps });
    }
  }
  return [...map.values()];
}

async function main() {
  const raw = readFileSync(resolve('test/斗破苍穹100章.txt'), 'utf-8');
  const blocks = raw.split(/(?=^第\d+章)/m).filter(s => s.trim());
  const chapters: Chapter[] = blocks.map((b, i) => {
    const end = b.indexOf('\n');
    const t = b.slice(0, end).trim();
    const m = t.match(/^第\d+章\s*(.*)/);
    return { index: i + 1, title: m?.[1] || t, content: b };
  });

  const batch4 = chapters.slice(90); // ch91-100
  console.log(`批次4: ${batch4.length} 章 (${batch4[0].index}-${batch4[batch4.length-1].index})`);

  const provider = await getDefaultProvider();
  console.log(`LLM: ${process.env.LLM_MODEL} @ ${process.env.LLM_BASE_URL}`);

  const content = batch4.map(c => `Chapter ${c.index}${c.title ? `: ${c.title}` : ''}\n${c.content}`).join('\n\n');
  const userPrompt = `${CHARACTER_BATCH_PROMPT('斗破苍穹', 4, 4)}\n\n${content}`;

  let batch4Res: z.infer<typeof extractionResultSchema> | null = null;
  for (let r = 0; r < 6; r++) {
    try {
      batch4Res = await provider.chatExtract(CHARACTER_EXTRACTION_PROMPT, userPrompt, extractionResultSchema);
      console.log(`✓ batch4 成功: ${batch4Res.characters.length}人物, ${batch4Res.items.length}物品, ${batch4Res.locations.length}地点`);
      writeFileSync('/tmp/batch4_result.json', JSON.stringify(batch4Res, null, 2));
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  重试${r+1}: ${msg.slice(0,200)}`);
      if (r < 5) await new Promise(r2 => setTimeout(r2, 3000 * Math.pow(2, r)));
      else { console.error('batch4 最终失败'); process.exit(1); }
    }
  }

  // Now run full extraction to merge
  console.log('\n运行全量提取 (4批并行，batch4走缓存)...');
  const BATCH = 30, MAX_CONC = 5, RETRIES = 3;
  const batches: { chapters: Chapter[]; num: number }[] = [
    { chapters: chapters.slice(0, 30),  num: 1 },
    { chapters: chapters.slice(30, 60), num: 2 },
    { chapters: chapters.slice(60, 90), num: 3 },
    { chapters: batch4,                num: 4 },
  ];

  const allCh: Ch[] = [];
  const allIt: any[] = [];
  const allLo: any[] = [];

  async function proc(batch: { chapters: Chapter[]; num: number }) {
    // Use cached batch4 result
    if (batch.num === 4 && batch4Res) {
      allCh.push(...(batch4Res.characters || []));
      allIt.push(...(batch4Res.items || []));
      allLo.push(...(batch4Res.locations || []));
      console.log(`  [批次4] 来自缓存: ${batch4Res.characters.length}人物`);
      return;
    }
    const c = batch.chapters.map(ch => `Chapter ${ch.index}${ch.title ? `: ${ch.title}` : ''}\n${ch.content}`).join('\n\n');
    const up = `${CHARACTER_BATCH_PROMPT('斗破苍穹', batch.num, 4)}\n\n${c}`;
    for (let r = 0; r < RETRIES; r++) {
      try {
        const res = await provider.chatExtract(CHARACTER_EXTRACTION_PROMPT, up, extractionResultSchema);
        allCh.push(...(res.characters || []));
        allIt.push(...(res.items || []));
        allLo.push(...(res.locations || []));
        console.log(`  [批次${batch.num}] ${(res.characters||[]).length}人物`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (r < RETRIES - 1) { console.warn(`  批次${batch.num} 重试${r+1}: ${msg.slice(0,150)}`); await new Promise(r2 => setTimeout(r2, 2000 * Math.pow(2, r))); }
        else console.error(`  批次${batch.num} 失败: ${msg.slice(0,300)}`);
      }
    }
  }

  const t0 = Date.now();
  await Promise.all(batches.map(b => proc(b)));
  console.log(`\n原始: ${allCh.length}人物, ${allIt.length}物品, ${allLo.length}地点`);

  // Dedup
  const charMap = new Map<string, Ch>();
  const sourceText = chapters.map(c => c.content).join('\n');
  const knownNames = allCh.map(c => c.name).filter(Boolean);
  const knownAliases = Object.fromEntries(allCh.map(c => [c.name, c.aliases ?? []]));

  for (const c of allCh) {
    if (isCollectiveCharacterAlias(c.name)) continue;
    const canon = chooseCanonicalCharacterName(c.name, c.aliases ?? [], { sourceText });
    const pool = canon === c.name ? (c.aliases ?? []) : [...(c.aliases ?? []), c.name];
    const clean = sanitizeCharacterAliases(canon, pool, { sourceText, knownCharacterNames: knownNames, knownAliasesByCharacter: knownAliases });
    const cand: Ch = { name: canon, aliases: clean, description: c.description || '', confidence: c.confidence ?? 0,
      firstChapter: c.firstChapter, lastChapter: c.lastChapter, chapterAppearances: c.chapterAppearances ?? [] };
    const dup = findDup(cand, charMap);
    if (dup) { const m = mergeCh(dup, cand); charMap.set(norm(m.name), m); }
    else charMap.set(norm(cand.name), cand);
  }

  const dCh = [...charMap.values()];
  const dIt = dedupArr(allIt);
  const dLo = dedupArr(allLo);

  for (const ch of chapters) {
    for (const c of dCh) {
      for (const n of [c.name, ...(c.aliases || [])]) {
        const rx = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const m = ch.content.match(rx);
        if (m) c.mentionCount = (c.mentionCount || 0) + m.length;
      }
    }
  }
  dCh.sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0));
  console.log(`去重后: ${dCh.length}人物, ${dIt.length}物品, ${dLo.length}地点`);
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const ts = Date.now();
  const entDir = resolve('output', `斗破苍穹-100章-${ts}`, 'entities');
  mkdirSync(entDir, { recursive: true });

  writeFileSync(resolve(entDir, 'characters.json'), JSON.stringify(dCh, null, 2), 'utf-8');
  writeFileSync(resolve(entDir, 'items.json'), JSON.stringify(dIt, null, 2), 'utf-8');
  writeFileSync(resolve(entDir, 'locations.json'), JSON.stringify(dLo, null, 2), 'utf-8');

  const lines: string[] = [`# 实体提取结果：斗破苍穹-100章`, '', `> 角色 ${dCh.length} | 物品 ${dIt.length} | 地点 ${dLo.length}`, ''];
  lines.push(`## 角色（${dCh.length}）`, '', '| 角色 | 别名 | 提及 | 章节 | 简介 |', '|---|---|---|---|---|');
  for (const c of dCh) {
    const a = (c.aliases||[]).join('、');
    const ch = c.firstChapter && c.lastChapter ? `${c.firstChapter}-${c.lastChapter}` : '?';
    const d = (c.description||'').replace(/\r?\n/g,'<br>').replace(/\|/g,'\\|');
    lines.push(`| ${c.name} | ${a} | ${c.mentionCount||0} | ${ch} | ${d} |`);
  }
  lines.push('', `## 物品（${dIt.length}）`, '', '| 物品 | 别名 | 章节 | 简介 |', '|---|---|---|---|');
  for (const i of dIt) {
    const a = (i.aliases||[]).join('、');
    const ch = i.firstChapter && i.lastChapter ? `${i.firstChapter}-${i.lastChapter}` : '?';
    const d = (i.description||'').replace(/\r?\n/g,'<br>').replace(/\|/g,'\\|');
    lines.push(`| ${i.name} | ${a} | ${ch} | ${d} |`);
  }
  lines.push('', `## 地点（${dLo.length}）`, '', '| 地点 | 别名 | 章节 | 简介 |', '|---|---|---|---|');
  for (const l of dLo) {
    const a = (l.aliases||[]).join('、');
    const ch = l.firstChapter && l.lastChapter ? `${l.firstChapter}-${l.lastChapter}` : '?';
    const d = (l.description||'').replace(/\r?\n/g,'<br>').replace(/\|/g,'\\|');
    lines.push(`| ${l.name} | ${a} | ${ch} | ${d} |`);
  }
  writeFileSync(resolve(entDir, 'summary.md'), lines.join('\n'), 'utf-8');
  console.log(`\n✓ 输出: ${entDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });

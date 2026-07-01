/**
 * Run full entity extraction on a text file.
 * Usage: npx tsx run-extract.ts <input-file> [output-dir]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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

const characterSchema = z.object({
  name: z.string(), aliases: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(''), confidence: z.number().optional().default(0.8),
  firstChapter: z.number().optional(), lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).optional().default([]),
});
const itemSchema = z.object({
  name: z.string(), aliases: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(''), confidence: z.number().optional().default(0.8),
  firstChapter: z.number().optional(), lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).optional().default([]),
});
const locationSchema = z.object({
  name: z.string(), aliases: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(''), confidence: z.number().optional().default(0.8),
  firstChapter: z.number().optional(), lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).optional().default([]),
});
const extractionResultSchema = z.object({
  characters: z.array(characterSchema).default([]),
  items: z.array(itemSchema).default([]),
  locations: z.array(locationSchema).default([]),
});

type Ch = z.infer<typeof characterSchema>;
interface Chapter { index: number; title?: string; content: string }

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
  const inputPath = process.argv[2] || 'test/斗破苍穹100章.txt';
  const outputDir = process.argv[3] || 'output';
  const bookTitle = '斗破苍穹';

  console.log(`输入: ${inputPath}`);
  console.log(`LLM: ${process.env.LLM_MODEL} @ ${process.env.LLM_BASE_URL}\n`);

  const raw = readFileSync(resolve(inputPath), 'utf-8');
  const blocks = raw.split(/(?=^第\d+章)/m).filter(s => s.trim());
  const chapters: Chapter[] = blocks.map((b, i) => {
    const end = b.indexOf('\n');
    const t = b.slice(0, end).trim();
    const m = t.match(/^第\d+章\s*(.*)/);
    return { index: i + 1, title: m?.[1] || t, content: b };
  });
  console.log(`共 ${chapters.length} 章`);

  const provider = await getDefaultProvider();
  console.log(`Provider: ${provider.name}\n`);

  const BATCH = 30, MAX_CONC = 5, RETRIES = 3;
  const batches: Chapter[][] = [];
  for (let i = 0; i < chapters.length; i += BATCH) batches.push(chapters.slice(i, i + BATCH));
  console.log(`分 ${batches.length} 批\n`);

  const allCh: Ch[] = [], allIt: z.infer<typeof itemSchema>[] = [], allLo: z.infer<typeof locationSchema>[] = [];
  let done = 0;

  async function proc(batch: Chapter[], num: number) {
    // 不截断，发送完整章节内容
    const content = batch.map(c => `Chapter ${c.index}${c.title ? `: ${c.title}` : ''}\n${c.content}`).join('\n\n');
    const userPrompt = `${CHARACTER_BATCH_PROMPT(bookTitle, num, batches.length)}\n\n${content}`;
    for (let r = 0; r < RETRIES; r++) {
      try {
        const res = await provider.chatExtract(CHARACTER_EXTRACTION_PROMPT, userPrompt, extractionResultSchema);
        allCh.push(...(res.characters || []) as Ch[]);
        allIt.push(...(res.items || []) as z.infer<typeof itemSchema>[]);
        allLo.push(...(res.locations || []) as z.infer<typeof locationSchema>[]);
        done++;
        console.log(`  [${done}/${batches.length}] 批次${num}: ${(res.characters||[]).length}人物, ${(res.items||[]).length}物品, ${(res.locations||[]).length}地点`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (r < RETRIES - 1) { console.warn(`  批次${num} 重试${r+1}: ${msg.slice(0,150)}`); await new Promise(r2 => setTimeout(r2, 2000 * Math.pow(2, r))); }
        else console.error(`  批次${num} 失败: ${msg.slice(0,300)}`);
      }
    }
  }

  const t0 = Date.now();
  for (let i = 0; i < batches.length; i += MAX_CONC) {
    await Promise.all(batches.slice(i, i + MAX_CONC).map((b, j) => proc(b, i + j + 1)));
  }

  console.log(`\n原始: ${allCh.length}人物, ${allIt.length}物品, ${allLo.length}地点`);

  // Dedup characters
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

  // Count mentions
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

  // Write output
  const ts = Date.now();
  const bookDir = resolve(outputDir, `${bookTitle}-${chapters.length}章-${ts}`);
  const entDir = resolve(bookDir, 'entities');
  mkdirSync(entDir, { recursive: true });

  writeFileSync(resolve(entDir, 'characters.json'), JSON.stringify(dCh, null, 2), 'utf-8');
  writeFileSync(resolve(entDir, 'items.json'), JSON.stringify(dIt, null, 2), 'utf-8');
  writeFileSync(resolve(entDir, 'locations.json'), JSON.stringify(dLo, null, 2), 'utf-8');

  const lines: string[] = [`# 实体提取结果：${bookTitle}-${chapters.length}章`, '', `> 角色 ${dCh.length} | 物品 ${dIt.length} | 地点 ${dLo.length}`, ''];
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
  console.log(`\n输出: ${entDir}`);
}

main().catch(e => { console.error('失败:', e); process.exit(1); });

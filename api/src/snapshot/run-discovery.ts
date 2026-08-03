import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DiscoveredRun {
  runDir: string;
  generatedAt: string;
}

interface RunSummary {
  bookId?: unknown;
  generatedAt?: unknown;
  officialResult?: unknown;
}

/**
 * 反查 bookId 当前最新一次官方提取运行。扫描 outputRoot 下每个 final/run-summary.json，
 * 过滤 bookId 匹配且 officialResult !== false，取 generatedAt 最大者。
 */
export async function discoverCurrentRun(outputRoot: string, bookId: string): Promise<DiscoveredRun | null> {
  let entries: string[];
  try {
    entries = await readdir(outputRoot);
  } catch {
    return null;
  }

  const candidates: DiscoveredRun[] = [];
  for (const entry of entries) {
    const summaryPath = join(outputRoot, entry, 'final', 'run-summary.json');
    let summary: RunSummary;
    try {
      summary = JSON.parse(await readFile(summaryPath, 'utf-8')) as RunSummary;
    } catch {
      continue;
    }
    if (summary.bookId !== bookId) continue;
    if (summary.officialResult === false) continue;
    if (typeof summary.generatedAt !== 'string') continue;
    candidates.push({ runDir: entry, generatedAt: summary.generatedAt });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return candidates[0];
}

import { createHash } from 'node:crypto';
import { stableStringify } from './stable-json.js';

/**
 * contentRevision 输入：由权威结构化数据更新时间、稳定运行、各类实体集合哈希、
 * 噪声覆盖集合哈希与故事产物哈希组成。禁止传入当前时间或本机绝对路径。
 */
export interface ContentRevisionInput {
  bookUpdatedAt: string;
  run: { runDir: string; generatedAt: string } | null;
  entityHashes: { characters: string; locations: string; items: string };
  noiseOverrideHash: string;
  storyHash: string;
}

/**
 * 计算确定性成果版本号。相同成果永远产生同一 revision；任一输入变化则 revision 变。
 * LF/CRLF、键顺序、本机路径不影响结果（基于内容哈希）。
 */
export function computeContentRevision(input: ContentRevisionInput): string {
  return createHash('sha256').update(stableStringify(input), 'utf8').digest('hex');
}

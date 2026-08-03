import { ChevronDown, ChevronRight, Quote } from 'lucide-react';
import { useState } from 'react';
import type { DescriptionEvidenceSnippet } from '@/types';

/** 证据片段可以是纯字符串（story-arcs 路径）或结构化对象（提取富产物路径）。 */
type SnippetItem = string | DescriptionEvidenceSnippet;

function isObjectSnippet(s: SnippetItem): s is DescriptionEvidenceSnippet {
  return typeof s === 'object' && s !== null && 'text' in s;
}

function snippetText(s: SnippetItem): string {
  return isObjectSnippet(s) ? s.text : s;
}

/** 折叠展示资产/事件的原文证据片段。 */
export function EvidenceSnippets({
  snippets,
  chapters,
}: {
  snippets: SnippetItem[];
  chapters?: number[];
}) {
  const [open, setOpen] = useState(false);
  if (snippets.length === 0) return null;

  // 优先用外部传入的 chapters，否则从结构化对象中提取
  const snippetChapters = snippets
    .map((s) => (isObjectSnippet(s) ? s.chapterIndex : null))
    .filter((c): c is number => typeof c === 'number');
  const displayChapters = chapters && chapters.length > 0 ? chapters : snippetChapters;

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        证据片段 ({snippets.length})
        {displayChapters.length > 0 && <span>· 来源第 {displayChapters.join('、')} 章</span>}
      </button>
      {open && (
        <ul className="space-y-1.5">
          {snippets.map((s, i) => {
            const text = snippetText(s);
            const obj = isObjectSnippet(s) ? s : null;
            return (
              <li
                key={i}
                className="flex gap-1.5 rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground"
              >
                <Quote className="h-3 w-3 shrink-0 opacity-50" />
                <span className="whitespace-pre-wrap">
                  {obj ? `【第${obj.chapterIndex}章】${text}` : text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { ChevronDown, ChevronRight, Quote } from 'lucide-react';
import { useState } from 'react';

/** 折叠展示资产/事件的原文证据片段。 */
export function EvidenceSnippets({
  snippets,
  chapters,
}: {
  snippets: string[];
  chapters?: number[];
}) {
  const [open, setOpen] = useState(false);
  if (snippets.length === 0) return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        证据片段 ({snippets.length})
        {chapters && chapters.length > 0 && <span>· 来源第 {chapters.join('、')} 章</span>}
      </button>
      {open && (
        <ul className="space-y-1.5">
          {snippets.map((s, i) => (
            <li
              key={i}
              className="flex gap-1.5 rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground"
            >
              <Quote className="h-3 w-3 shrink-0 opacity-50" />
              <span className="whitespace-pre-wrap">{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

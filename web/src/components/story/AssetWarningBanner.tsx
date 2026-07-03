import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { AssetWarning } from '@/types/story';

const ISSUE_LABEL: Record<AssetWarning['issue'], string> = {
  missing_description: '缺少描述',
  thin_description: '描述过薄',
  low_confidence: '低置信候选',
  weak_evidence: '证据不足',
};

const TYPE_LABEL: Record<AssetWarning['assetType'], string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

export function AssetWarningBanner({ warnings }: { warnings: AssetWarning[] }) {
  const [expanded, setExpanded] = useState(false);
  if (warnings.length === 0) return null;

  const preview = warnings
    .slice(0, 2)
    .map((w) => `${w.assetName}${ISSUE_LABEL[w.issue]}`)
    .join('；');

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {warnings.length} 条资产警告{!expanded && `：${preview}${warnings.length > 2 ? '…' : ''}`}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2 text-xs dark:border-amber-500/30">
          {warnings.map((w, i) => (
            <li key={`${w.assetType}-${w.assetName}-${w.issue}-${i}`}>
              [{TYPE_LABEL[w.assetType]}·{ISSUE_LABEL[w.issue]}] {w.assetName} — {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

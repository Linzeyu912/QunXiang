import { useEffect } from 'react';
import { Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import StageIndicator from './StageIndicator';
import type { ExtractionStage } from '../../hooks/useExtractionProgress';

interface ExtractionProgressProps {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStage[];
  onClose?: () => void;
}

export default function ExtractionProgress({
  bookId,
  overallProgress,
  isRunning,
  isComplete,
  isFailed,
  stages,
  onClose,
}: ExtractionProgressProps) {
  const currentStage = stages.find((s) => s.status === 'running');

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isRunning && <Loader2 size={18} className="text-blue-500 animate-spin" />}
          {isComplete && <CheckCircle size={18} className="text-green-500" />}
          {isFailed && <AlertCircle size={18} className="text-red-500" />}
          <h3 className="text-sm font-semibold text-[#0F172A]">
            {isRunning ? '正在提取角色...' : isComplete ? '提取完成' : isFailed ? '提取失败' : '准备提取'}
          </h3>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-[#64748B] mb-1.5">
          <span>总体进度</span>
          <span className="font-medium">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFailed ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Stage indicator */}
      <StageIndicator stages={stages} currentStageId={currentStage?.id} />

      {/* Current stage message */}
      {currentStage && (
        <p className="text-xs text-[#94A3B8] mt-3">
          当前阶段：{currentStage.name}
          {currentStage.message && ` — ${currentStage.message}`}
        </p>
      )}

      {/* Error message */}
      {isFailed && (
        <div className="mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
          {stages.find((s) => s.status === 'failed')?.message || '提取过程中发生错误'}
        </div>
      )}
    </div>
  );
}

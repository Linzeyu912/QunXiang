import { CheckCircle, Loader2, Circle, XCircle, AlertCircle } from 'lucide-react';

export interface Stage {
  id: string;
  name: string;
  weight: number;
  status: string;
  message?: string;
}

interface StageIndicatorProps {
  stages: Stage[];
  currentStageId?: string;
  compact?: boolean;
}

function StageIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={18} className="text-green-500" />;
    case 'running':
      return <Loader2 size={18} className="text-blue-500 animate-spin" />;
    case 'failed':
      return <XCircle size={18} className="text-red-500" />;
    default:
      return <Circle size={18} className="text-gray-300" />;
  }
}

function StageColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-500';
    case 'running':
      return 'bg-blue-500';
    case 'failed':
      return 'bg-red-500';
    default:
      return 'bg-gray-200';
  }
}

export default function StageIndicator({ stages, currentStageId, compact = false }: StageIndicatorProps) {
  return (
    <div className={`flex ${compact ? 'gap-2' : 'gap-4'} items-center`}>
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1;
        const isActive = stage.status === 'running' || stage.id === currentStageId;

        return (
          <div key={stage.id} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <StageIcon status={stage.status} />
              {!compact && (
                <span
                  className={`text-xs font-medium ${
                    isActive ? 'text-blue-600' : stage.status === 'completed' ? 'text-green-600' : 'text-gray-400'
                  }`}
                >
                  {stage.name}
                </span>
              )}
            </div>
            {!isLast && (
              <div className={`w-6 h-0.5 rounded ${StageColor(stage.status)}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

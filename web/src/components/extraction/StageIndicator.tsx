import { CheckCircle, Loader2, Circle, XCircle } from 'lucide-react';

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
      return <CheckCircle size={18} className="text-success" />;
    case 'running':
      return <Loader2 size={18} className="animate-spin text-info" />;
    case 'failed':
      return <XCircle size={18} className="text-destructive" />;
    default:
      return <Circle size={18} className="text-muted-foreground/40" />;
  }
}

function StageColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-success';
    case 'running':
      return 'bg-info';
    case 'failed':
      return 'bg-destructive';
    default:
      return 'bg-muted';
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
                    isActive ? 'text-info' : stage.status === 'completed' ? 'text-success' : 'text-muted-foreground'
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

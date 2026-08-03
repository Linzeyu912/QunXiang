export const BACKGROUND_JOB_MAX_ATTEMPTS = 3;
export const BACKGROUND_JOB_BACKOFF_BASE_MS = 1_000;

export type BackgroundJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface EnqueueBackgroundJobInput {
  kind: string;
  uniqueKey: string;
  payload: unknown;
  now?: Date;
  nextRunAt?: Date;
  /** 已存在的 failed/succeeded 同唯一键任务是否重置为 pending（用于幂等重投）。 */
  reactivate?: boolean;
}

export interface ClaimBackgroundJobInput {
  workerId: string;
  kinds: string[];
  leaseMs: number;
  now: Date;
}

export interface HeartbeatBackgroundJobInput {
  jobId: string;
  workerId: string;
  leaseMs: number;
  now: Date;
}

export interface CompleteBackgroundJobInput {
  jobId: string;
  workerId: string;
  result: unknown;
  now: Date;
}

export interface FailBackgroundJobInput {
  jobId: string;
  workerId: string;
  reason: string;
  retryable: boolean;
  now: Date;
}

export interface RecoverExpiredBackgroundJobsInput {
  now: Date;
}

export interface RecoveredBackgroundJob {
  id: string;
  status: Extract<BackgroundJobStatus, 'pending' | 'failed'>;
}

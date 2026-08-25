import type { BackgroundJob, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  BACKGROUND_JOB_BACKOFF_BASE_MS,
  BACKGROUND_JOB_MAX_ATTEMPTS,
  type ClaimBackgroundJobInput,
  type CompleteBackgroundJobInput,
  type EnqueueBackgroundJobInput,
  type FailBackgroundJobInput,
  type HeartbeatBackgroundJobInput,
  type RecoveredBackgroundJob,
  type RecoverExpiredBackgroundJobsInput,
} from '@qunxiang/core';
import { prisma } from './prisma.js';

export { BACKGROUND_JOB_BACKOFF_BASE_MS, BACKGROUND_JOB_MAX_ATTEMPTS } from '@qunxiang/core';

export interface BackgroundJobRepository {
  enqueue(input: EnqueueBackgroundJobInput): Promise<BackgroundJob>;
  claimNext(input: ClaimBackgroundJobInput): Promise<BackgroundJob | null>;
  heartbeat(input: HeartbeatBackgroundJobInput): Promise<BackgroundJob | null>;
  complete(input: CompleteBackgroundJobInput): Promise<BackgroundJob | null>;
  fail(input: FailBackgroundJobInput): Promise<BackgroundJob | null>;
  recoverExpired(input: RecoverExpiredBackgroundJobsInput): Promise<RecoveredBackgroundJob[]>;
}

function firstOrNull<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export function createBackgroundJobRepository(db: PrismaClient): BackgroundJobRepository {
  return {
    async enqueue(input) {
      const nextRunAt = input.nextRunAt ?? input.now ?? new Date();
      if (input.reactivate) {
        // 已存在的 failed/succeeded 同唯一键任务重置为 pending，用于幂等重投（如归档失败后重试）
        await db.backgroundJob.updateMany({
          where: { uniqueKey: input.uniqueKey, status: { in: ['failed', 'succeeded'] } },
          data: {
            status: 'pending',
            error: null,
            attempts: 0,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextRunAt,
          },
        });
      }
      return db.backgroundJob.upsert({
        where: { uniqueKey: input.uniqueKey },
        update: {},
        create: {
          kind: input.kind,
          uniqueKey: input.uniqueKey,
          payload: input.payload as Prisma.InputJsonValue,
          nextRunAt,
        },
      });
    },

    async claimNext(input) {
      if (input.kinds.length === 0) return null;

      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
      return db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<BackgroundJob[]>(Prisma.sql`
          WITH candidate AS (
            SELECT id
            FROM "BackgroundJob"
            WHERE status = 'pending'
              AND "nextRunAt" <= ${input.now}
              AND kind IN (${Prisma.join(input.kinds)})
            ORDER BY "createdAt", id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE "BackgroundJob" AS job
          SET status = 'running',
              attempts = job.attempts + 1,
              error = NULL,
              "leaseOwner" = ${input.workerId},
              "leaseExpiresAt" = ${leaseExpiresAt},
              "updatedAt" = ${input.now}
          FROM candidate
          WHERE job.id = candidate.id
          RETURNING job.*
        `);
        return firstOrNull(rows);
      });
    },

    async heartbeat(input) {
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
      const rows = await db.$queryRaw<BackgroundJob[]>(Prisma.sql`
        UPDATE "BackgroundJob"
        SET "leaseExpiresAt" = ${leaseExpiresAt},
            "updatedAt" = ${input.now}
        WHERE id = ${input.jobId}::uuid
          AND "leaseOwner" = ${input.workerId}
          AND status = 'running'
        RETURNING *
      `);
      return firstOrNull(rows);
    },

    async complete(input) {
      const rows = await db.$queryRaw<BackgroundJob[]>(Prisma.sql`
        UPDATE "BackgroundJob"
        SET status = 'succeeded',
            result = ${JSON.stringify(input.result)}::jsonb,
            error = NULL,
            "leaseOwner" = NULL,
            "leaseExpiresAt" = NULL,
            "updatedAt" = ${input.now}
        WHERE id = ${input.jobId}::uuid
          AND "leaseOwner" = ${input.workerId}
          AND status = 'running'
        RETURNING *
      `);
      return firstOrNull(rows);
    },

    async fail(input) {
      const reason = input.reason.trim() || '任务处理失败';
      const rows = await db.$queryRaw<BackgroundJob[]>(Prisma.sql`
        UPDATE "BackgroundJob"
        SET status = CASE
              WHEN ${input.retryable} AND attempts < ${BACKGROUND_JOB_MAX_ATTEMPTS}
                THEN 'pending'
              ELSE 'failed'
            END,
            error = ${reason},
            "nextRunAt" = CASE
              WHEN ${input.retryable} AND attempts < ${BACKGROUND_JOB_MAX_ATTEMPTS}
                THEN ${input.now} + (
                  ${BACKGROUND_JOB_BACKOFF_BASE_MS} * POWER(2, GREATEST(attempts - 1, 0))
                ) * INTERVAL '1 millisecond'
              ELSE "nextRunAt"
            END,
            "leaseOwner" = NULL,
            "leaseExpiresAt" = NULL,
            "updatedAt" = ${input.now}
        WHERE id = ${input.jobId}::uuid
          AND "leaseOwner" = ${input.workerId}
          AND status = 'running'
        RETURNING *
      `);
      return firstOrNull(rows);
    },

    async recoverExpired(input) {
      return db.$queryRaw<RecoveredBackgroundJob[]>(Prisma.sql`
        UPDATE "BackgroundJob"
        SET status = CASE
              WHEN attempts >= ${BACKGROUND_JOB_MAX_ATTEMPTS} THEN 'failed'
              ELSE 'pending'
            END,
            error = CASE
              WHEN attempts >= ${BACKGROUND_JOB_MAX_ATTEMPTS} THEN '任务租约已连续三次过期'
              ELSE '任务租约已过期，等待重试'
            END,
            "nextRunAt" = CASE
              WHEN attempts >= ${BACKGROUND_JOB_MAX_ATTEMPTS} THEN "nextRunAt"
              ELSE ${input.now} + (
                ${BACKGROUND_JOB_BACKOFF_BASE_MS} * POWER(2, GREATEST(attempts - 1, 0))
              ) * INTERVAL '1 millisecond'
            END,
            "leaseOwner" = NULL,
            "leaseExpiresAt" = NULL,
            "updatedAt" = ${input.now}
        WHERE status = 'running'
          AND "leaseExpiresAt" <= ${input.now}
        RETURNING id, status
      `);
    },
  };
}

export const BackgroundJobRepository = createBackgroundJobRepository(prisma);

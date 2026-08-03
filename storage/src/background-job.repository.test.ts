import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_JOB_BACKOFF_BASE_MS,
  createBackgroundJobRepository,
} from './background-job.repository.js';
import { cleanupTestDb, testPrisma } from './test-setup.js';

const repo = createBackgroundJobRepository(testPrisma);
const now = new Date('2026-07-15T08:00:00.000Z');

function uniqueKey(label: string): string {
  return `background-job:${label}:${randomUUID()}`;
}

describe('BackgroundJobRepository', () => {
  beforeEach(async () => {
    await testPrisma.backgroundJob.deleteMany();
  });

  afterAll(cleanupTestDb);

  it('unique_key_returns_existing_job', async () => {
    const key = uniqueKey('unique');
    const first = await repo.enqueue({ kind: 'test', uniqueKey: key, payload: { version: 1 }, now });
    const second = await repo.enqueue({ kind: 'other', uniqueKey: key, payload: { version: 2 }, now });

    expect(second.id).toBe(first.id);
    expect(second.kind).toBe('test');
    expect(second.payload).toEqual({ version: 1 });
    expect(second.updatedAt).toEqual(first.updatedAt);
  });

  it('empty_kinds_returns_null_without_query', async () => {
    const transaction = vi.fn();
    const isolatedRepo = createBackgroundJobRepository({ $transaction: transaction } as unknown as PrismaClient);

    await expect(isolatedRepo.claimNext({ workerId: 'worker-a', kinds: [], leaseMs: 30_000, now }))
      .resolves.toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('concurrent_workers_claim_only_once', async () => {
    await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('concurrent'), payload: {}, now });

    const [a, b] = await Promise.all([
      repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now }),
      repo.claimNext({ workerId: 'worker-b', kinds: ['test'], leaseMs: 30_000, now }),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((a ?? b)?.attempts).toBe(1);
  });

  it('non_owner_cannot_heartbeat_complete_or_fail', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('owner'), payload: {}, now });
    await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now });

    await expect(repo.heartbeat({ jobId: queued.id, workerId: 'worker-b', leaseMs: 60_000, now }))
      .resolves.toBeNull();
    await expect(repo.complete({ jobId: queued.id, workerId: 'worker-b', result: { ok: true }, now }))
      .resolves.toBeNull();
    await expect(repo.fail({ jobId: queued.id, workerId: 'worker-b', reason: '非持有者失败', retryable: true, now }))
      .resolves.toBeNull();

    const unchanged = await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(unchanged).toMatchObject({ status: 'running', leaseOwner: 'worker-a', attempts: 1 });
  });

  it('heartbeat_extends_lease_without_incrementing_attempts', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('heartbeat'), payload: {}, now });
    await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now });
    const heartbeatAt = new Date(now.getTime() + 10_000);

    const updated = await repo.heartbeat({
      jobId: queued.id,
      workerId: 'worker-a',
      leaseMs: 60_000,
      now: heartbeatAt,
    });

    expect(updated).toMatchObject({ status: 'running', attempts: 1, leaseOwner: 'worker-a' });
    expect(updated?.leaseExpiresAt).toEqual(new Date(heartbeatAt.getTime() + 60_000));
  });

  it('expired_lease_is_recovered_and_cleared', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('recover'), payload: {}, now });
    await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 1_000, now });
    const recoveredAt = new Date(now.getTime() + 1_001);

    const recovered = await repo.recoverExpired({ now: recoveredAt });

    expect(recovered).toEqual([{ id: queued.id, status: 'pending' }]);
    const stored = await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stored).toMatchObject({ status: 'pending', leaseOwner: null, leaseExpiresAt: null, attempts: 1 });
    expect(stored.nextRunAt).toEqual(new Date(recoveredAt.getTime() + BACKGROUND_JOB_BACKOFF_BASE_MS));
  });

  it('third_expired_lease_transitions_atomically_to_failed', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('third-expiry'), payload: {}, now });
    let claimAt = now;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 1, now: claimAt });
      expect(claimed?.attempts).toBe(attempt);
      const recoveredAt = new Date(claimAt.getTime() + 2);
      const recovered = await repo.recoverExpired({ now: recoveredAt });
      expect(recovered).toEqual([{ id: queued.id, status: attempt === 3 ? 'failed' : 'pending' }]);
      const stored = await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } });
      if (attempt < 3) claimAt = stored.nextRunAt;
    }

    const failed = await testPrisma.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 3,
      leaseOwner: null,
      leaseExpiresAt: null,
      error: '任务租约已连续三次过期',
    });
  });

  it('retryable_failure_backs_off_and_stops_after_third_claim', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('retry'), payload: {}, now });
    let claimAt = now;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now: claimAt });
      const failedAt = new Date(claimAt.getTime() + 500);
      const failed = await repo.fail({
        jobId: queued.id,
        workerId: 'worker-a',
        reason: `第${attempt}次处理失败`,
        retryable: true,
        now: failedAt,
      });
      expect(failed?.status).toBe(attempt === 3 ? 'failed' : 'pending');
      expect(failed).toMatchObject({ leaseOwner: null, leaseExpiresAt: null, attempts: attempt });
      if (attempt < 3) {
        expect(failed?.nextRunAt).toEqual(new Date(
          failedAt.getTime() + BACKGROUND_JOB_BACKOFF_BASE_MS * (2 ** (attempt - 1)),
        ));
        claimAt = failed!.nextRunAt;
      }
    }

    await expect(repo.claimNext({
      workerId: 'worker-b', kinds: ['test'], leaseMs: 30_000, now: new Date(claimAt.getTime() + 60_000),
    })).resolves.toBeNull();
  });

  it('permanent_failure_clears_lease_and_keeps_chinese_reason', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('permanent'), payload: {}, now });
    await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now });

    const failed = await repo.fail({
      jobId: queued.id,
      workerId: 'worker-a',
      reason: '任务数据格式不正确',
      retryable: false,
      now,
    });

    expect(failed).toMatchObject({
      status: 'failed', error: '任务数据格式不正确', leaseOwner: null, leaseExpiresAt: null,
    });
  });

  it('complete_clears_lease_and_persists_result', async () => {
    const queued = await repo.enqueue({ kind: 'test', uniqueKey: uniqueKey('complete'), payload: {}, now });
    await repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now });

    const completed = await repo.complete({
      jobId: queued.id,
      workerId: 'worker-a',
      result: { file: 'cloud/book.zip' },
      now,
    });

    expect(completed).toMatchObject({
      status: 'succeeded', result: { file: 'cloud/book.zip' }, error: null,
      leaseOwner: null, leaseExpiresAt: null,
    });
  });
});

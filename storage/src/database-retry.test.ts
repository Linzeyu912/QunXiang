import { describe, expect, it, vi } from 'vitest';
import { isTransientDatabaseBusyError, withDatabaseRetry } from './database-retry.js';

describe('withDatabaseRetry', () => {
  it('retries transient SQLite busy errors before returning the result', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      .mockResolvedValueOnce('ok');

    await expect(withDatabaseRetry(operation, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient database errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('unique constraint failed'));

    await expect(withDatabaseRetry(operation, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('unique constraint failed');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('throws the final busy error after attempts are exhausted', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('database is locked'));

    await expect(withDatabaseRetry(operation, { attempts: 2, baseDelayMs: 0 })).rejects.toThrow('database is locked');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('isTransientDatabaseBusyError', () => {
  it('recognizes Prisma connection timeout codes', () => {
    expect(isTransientDatabaseBusyError({ code: 'P1008', message: 'Timed out' })).toBe(true);
    expect(isTransientDatabaseBusyError({ code: 'P2024', message: 'Timed out fetching a new connection' })).toBe(true);
  });

  it('recognizes SQLITE_LOCKED as transient', () => {
    expect(isTransientDatabaseBusyError(new Error('SQLITE_LOCKED'))).toBe(true);
  });
});

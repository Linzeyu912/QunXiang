export interface DatabaseRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

function positiveEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isTransientDatabaseBusyError(error: unknown): boolean {
  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError?.code === 'string' ? maybeError.code : '';
  const message = error instanceof Error ? error.message : String(error);

  return code === 'P1008'
    || code === 'P2024'
    || /SQLITE_BUSY|SQLITE_LOCKED|database\s+(?:is\s+)?locked|connection.*timeout|timed out.*connection/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: DatabaseRetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? positiveEnvNumber('DATABASE_BUSY_RETRY_ATTEMPTS', 4);
  const baseDelayMs = options.baseDelayMs ?? positiveEnvNumber('DATABASE_BUSY_RETRY_DELAY_MS', 150);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseBusyError(error) || attempt >= attempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

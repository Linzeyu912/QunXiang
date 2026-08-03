export function decodeJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function encodeJsonField(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
import type { Prisma } from '@prisma/client';

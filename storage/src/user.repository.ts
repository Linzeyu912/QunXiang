import { prisma } from './prisma.js';
import type { User } from '@novel-agent/core';
import type { PrismaClient } from '@prisma/client';

export interface UserRepository {
  create(data: { email: string; name: string }): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findOrCreate(data: { email: string; name: string }): Promise<User>;
}

export function createUserRepository(db: PrismaClient): UserRepository {
  return {
    async create(data: { email: string; name: string }): Promise<User> {
      return db.user.create({ data }) as Promise<User>;
    },

    async findById(id: string): Promise<User | null> {
      return db.user.findUnique({ where: { id } }) as Promise<User | null>;
    },

    async findByEmail(email: string): Promise<User | null> {
      return db.user.findUnique({ where: { email } }) as Promise<User | null>;
    },

    async findOrCreate(data: { email: string; name: string }): Promise<User> {
      const existing = await db.user.findUnique({ where: { email: data.email } });
      if (existing) return existing as User;
      return db.user.create({ data }) as Promise<User>;
    },
  };
}

export const UserRepository = createUserRepository(prisma);

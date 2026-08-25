import { prisma } from './prisma.js';
import type { User } from '@qunxiang/core';
import type { PrismaClient } from '@prisma/client';

export interface CreateUserData {
  email: string;
  emailNormalized: string;
  name: string;
  passwordHash: string;
  shareCodeHash: string;
  status?: 'ACTIVE' | 'DISABLED';
}

export interface InitialRefreshSessionData {
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface UserRepository {
  create(data: CreateUserData): Promise<User>;
  createWithRefreshSession(
    data: CreateUserData,
    session: InitialRefreshSessionData,
  ): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<User>;
  updateShareCodeHash(id: string, shareCodeHash: string): Promise<User>;
}

export function createUserRepository(db: PrismaClient): UserRepository {
  return {
    async create(data): Promise<User> {
      return db.user.create({ data }) as Promise<User>;
    },

    async createWithRefreshSession(data, session): Promise<User> {
      return db.$transaction(async (tx) => {
        const user = await tx.user.create({ data });
        await tx.refreshSession.create({
          data: { ...session, userId: user.id },
        });
        return user as User;
      });
    },

    async findById(id: string): Promise<User | null> {
      return db.user.findUnique({ where: { id } }) as Promise<User | null>;
    },

    async findByEmail(email: string): Promise<User | null> {
      return db.user.findUnique({
        where: { emailNormalized: email.trim().toLowerCase() },
      }) as Promise<User | null>;
    },

    async updatePasswordHash(id: string, passwordHash: string): Promise<User> {
      return db.user.update({ where: { id }, data: { passwordHash } }) as Promise<User>;
    },

    async updateShareCodeHash(id: string, shareCodeHash: string): Promise<User> {
      return db.user.update({ where: { id }, data: { shareCodeHash } }) as Promise<User>;
    },
  };
}

export const UserRepository = createUserRepository(prisma);

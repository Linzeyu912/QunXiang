import type { AssetObject, PrismaClient } from '@prisma/client';
import type { PutAssetObjectInput } from '@novel-agent/core';
import { prisma } from './prisma.js';

export interface AssetObjectRepository {
  putIfAbsent(input: PutAssetObjectInput): Promise<AssetObject>;
  findById(id: string): Promise<AssetObject | null>;
  findByObjectKey(objectKey: string): Promise<AssetObject | null>;
  countReferences(objectId: string): Promise<number>;
  deleteIfUnreferenced(objectId: string): Promise<boolean>;
}

export function createAssetObjectRepository(db: PrismaClient): AssetObjectRepository {
  return {
    async putIfAbsent(input) {
      return db.assetObject.upsert({
        where: { objectKey: input.objectKey },
        update: {},
        create: {
          sha256: input.sha256,
          bytes: input.bytes,
          mime: input.mime,
          objectKey: input.objectKey,
          etag: input.etag,
          versionId: input.versionId,
        },
      });
    },

    async findById(id) {
      return db.assetObject.findUnique({ where: { id } });
    },

    async findByObjectKey(objectKey) {
      return db.assetObject.findUnique({ where: { objectKey } });
    },

    async countReferences(objectId) {
      const [snapshots, manifest, archive, publicAssetImages] = await Promise.all([
        db.snapshotObject.count({ where: { objectId } }),
        db.assetSnapshot.count({ where: { manifestObjectId: objectId } }),
        db.assetSnapshot.count({ where: { archiveObjectId: objectId } }),
        db.publicAssetImage.count({ where: { assetObjectId: objectId } }),
      ]);
      return snapshots + manifest + archive + publicAssetImages;
    },

    async deleteIfUnreferenced(objectId) {
      return db.$transaction(async (tx) => {
        const snapshots = await tx.snapshotObject.count({ where: { objectId } });
        const manifest = await tx.assetSnapshot.count({ where: { manifestObjectId: objectId } });
        const archive = await tx.assetSnapshot.count({ where: { archiveObjectId: objectId } });
        const publicAssetImages = await tx.publicAssetImage.count({ where: { assetObjectId: objectId } });
        if (snapshots + manifest + archive + publicAssetImages > 0) return false;
        await tx.assetObject.deleteMany({ where: { id: objectId } });
        return true;
      });
    },
  };
}

export const AssetObjectRepository = createAssetObjectRepository(prisma);

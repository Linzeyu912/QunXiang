/** 资产快照与不可变对象的公共类型（阶段二）。新表统一用 ownerId 语义（ADR 0001）。 */

export type AssetSnapshotStatus = 'building' | 'ready' | 'failed';

export type SnapshotObjectState = 'present' | 'empty' | 'not-generated';

export type SnapshotObjectCategory =
  | 'source'
  | 'entity'
  | 'review'
  | 'chapter'
  | 'noise'
  | 'extraction'
  | 'story'
  | 'image'
  | 'manifest'
  | 'archive';

export interface PutAssetObjectInput {
  sha256: string;
  bytes: bigint;
  mime: string;
  objectKey: string;
  etag?: string;
  versionId?: string;
}

export interface CreateAssetSnapshotInput {
  bookId: string;
  ownerId: string;
  contentRevision: string;
  now?: Date;
}

export interface CreateSnapshotObjectItem {
  objectId: string;
  logicalPath: string;
  category: SnapshotObjectCategory;
  state: SnapshotObjectState;
  reason?: string;
}

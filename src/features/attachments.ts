import { downloadAttachmentChunk } from "../api";
import { cryptoClient } from "../crypto/client";
import {
  chunkKey,
  localDb,
  localKey,
  type AttachmentOutboxEntry,
  type LocalAttachmentChunk,
  type LocalEncryptedObject,
  type OutboxEntry
} from "../storage/database";
import type { EncryptedAttachmentChunk, OpenAttachment, VaultAttachment } from "../types";
import { detectImageMime } from "./attachmentFormat";
import { mapWithConcurrency } from "./concurrency";

export { attachmentIdsIn, attachmentMarkdown, extensionForMime } from "./attachmentFormat";

export const ATTACHMENT_CHUNK_SIZE = 1024 * 1024;
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
export const ATTACHMENT_TRANSFER_CONCURRENCY = 4;

type ContinueOperation = () => boolean;

function requireActiveOperation(continueOperation?: ContinueOperation): void {
  if (continueOperation && !continueOperation()) throw new DOMException("Operation cancelled", "AbortError");
}

export async function createLocalAttachment(
  userId: string,
  ownerNoteId: string,
  file: File,
  continueOperation?: ContinueOperation
): Promise<OpenAttachment> {
  requireActiveOperation(continueOperation);
  if (file.size <= 0) throw new Error("附件为空");
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error("单个附件不能超过 25 MiB");
  const attachmentId = crypto.randomUUID();
  const data = await file.arrayBuffer();
  const mime = detectImageMime(new Uint8Array(data).subarray(0, 32));
  if (!mime) throw new Error("仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片，且会校验真实文件格式");
  const result = await cryptoClient.createAttachment({
    userId,
    attachmentId,
    ownerNoteId,
    originalName: file.name || `image-${attachmentId}`,
    mime,
    data,
    chunkSize: ATTACHMENT_CHUNK_SIZE
  });
  requireActiveOperation(continueOperation);
  const encryptedManifest = await cryptoClient.encryptObject(
    userId,
    attachmentId,
    "attachment",
    1,
    result.metadata
  );
  requireActiveOperation(continueOperation);
  const now = new Date().toISOString();
  const objectKey = localKey(userId, attachmentId);
  const localObject: LocalEncryptedObject = {
    key: objectKey,
    userId,
    objectId: attachmentId,
    objectType: "attachment",
    ciphertext: encryptedManifest.ciphertext,
    nonce: encryptedManifest.nonce,
    encryptionVersion: encryptedManifest.encryptionVersion,
    revision: 1,
    deleted: false,
    updatedAt: result.metadata.updatedAt
  };
  const objectOutbox: OutboxEntry = {
    ...localObject,
    operation: "upsert",
    baseRevision: 0,
    idempotencyKey: crypto.randomUUID(),
    generation: Date.now() * 1000 + result.chunks.length
  };
  await localDb.transaction("rw", [
    localDb.objects,
    localDb.outbox,
    localDb.attachmentChunks,
    localDb.attachmentOutbox
  ], async () => {
    requireActiveOperation(continueOperation);
    for (const chunk of result.chunks) {
      const key = chunkKey(userId, attachmentId, chunk.chunkIndex);
      const local: LocalAttachmentChunk = {
        key,
        userId,
        attachmentId,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        ciphertext: chunk.ciphertext,
        nonce: chunk.nonce,
        encryptionVersion: chunk.encryptionVersion,
        updatedAt: now
      };
      const outbox: AttachmentOutboxEntry = {
        ...local,
        idempotencyKey: crypto.randomUUID(),
        generation: Date.now() * 1000 + chunk.chunkIndex
      };
      await localDb.attachmentChunks.put(local);
      await localDb.attachmentOutbox.put(outbox);
    }
    await localDb.objects.put(localObject);
    await localDb.outbox.put(objectOutbox);
  });
  return { ...result.metadata, objectId: attachmentId, serverRevision: 0, dirty: true };
}

export async function ensureAttachmentChunks(
  userId: string,
  attachment: OpenAttachment,
  continueOperation?: ContinueOperation,
  allowNetwork = navigator.onLine
): Promise<EncryptedAttachmentChunk[]> {
  requireActiveOperation(continueOperation);
  const stored = await localDb.attachmentChunks.where("[userId+attachmentId]").equals([userId, attachment.objectId]).toArray();
  const storedVersions = new Set(stored.map((chunk) => chunk.encryptionVersion));
  if (stored.some((chunk) => (
    !Number.isInteger(chunk.chunkIndex)
    || chunk.chunkIndex < 0
    || chunk.chunkIndex >= attachment.chunkCount
    || chunk.totalChunks !== attachment.chunkCount
    || chunk.attachmentId !== attachment.objectId
  )) || storedVersions.size > 1) {
    throw new Error(`附件“${attachment.originalName}”的分块元数据不一致`);
  }
  const byIndex = new Map(stored.map((chunk) => [chunk.chunkIndex, chunk]));
  const missingIndexes: number[] = [];
  for (let index = 0; index < attachment.chunkCount; index += 1) {
    if (!byIndex.has(index)) missingIndexes.push(index);
  }
  if (missingIndexes.length && (!navigator.onLine || !allowNetwork)) {
    throw new Error(`附件“${attachment.originalName}”尚未缓存，离线时无法读取`);
  }
  const downloadedChunks = await mapWithConcurrency(
    missingIndexes,
    ATTACHMENT_TRANSFER_CONCURRENCY,
    async (index): Promise<LocalAttachmentChunk> => {
      const downloaded = await downloadAttachmentChunk(`/api/attachments/${attachment.objectId}/chunks/${index}`);
      requireActiveOperation(continueOperation);
      if (
        downloaded.totalChunks !== attachment.chunkCount
        || !Number.isInteger(downloaded.encryptionVersion)
        || downloaded.encryptionVersion < 1
      ) {
        throw new Error(`附件“${attachment.originalName}”的远端分块元数据不一致`);
      }
      return {
        key: chunkKey(userId, attachment.objectId, index),
        userId,
        attachmentId: attachment.objectId,
        chunkIndex: index,
        totalChunks: downloaded.totalChunks,
        ciphertext: downloaded.ciphertext,
        nonce: downloaded.nonce,
        encryptionVersion: downloaded.encryptionVersion,
        updatedAt: new Date().toISOString()
      };
    }
  );
  for (const chunk of downloadedChunks) storedVersions.add(chunk.encryptionVersion);
  if (storedVersions.size > 1) throw new Error(`附件“${attachment.originalName}”的远端分块元数据不一致`);
  requireActiveOperation(continueOperation);
  if (downloadedChunks.length) {
    await localDb.attachmentChunks.bulkPut(downloadedChunks);
    for (const chunk of downloadedChunks) byIndex.set(chunk.chunkIndex, chunk);
  }
  if (byIndex.size !== attachment.chunkCount) throw new Error(`附件“${attachment.originalName}”不完整`);
  return [...byIndex.values()].sort((a, b) => a.chunkIndex - b.chunkIndex).map((chunk) => ({
    attachmentId: chunk.attachmentId,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    ciphertext: chunk.ciphertext,
    nonce: chunk.nonce,
    encryptionVersion: chunk.encryptionVersion
  }));
}

export async function decryptAttachmentBlob(
  userId: string,
  attachment: OpenAttachment,
  continueOperation?: ContinueOperation,
  allowNetwork = navigator.onLine
): Promise<Blob> {
  const chunks = await ensureAttachmentChunks(userId, attachment, continueOperation, allowNetwork);
  requireActiveOperation(continueOperation);
  const bytes = await cryptoClient.decryptAttachment(userId, attachment.objectId, attachment, chunks);
  requireActiveOperation(continueOperation);
  return new Blob([bytes], { type: attachment.mime });
}

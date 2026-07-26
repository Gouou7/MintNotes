export type ObjectType = "note" | "folder" | "attachment";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
}

export interface AuthEndpoint {
  id: string;
  remembered: boolean;
}

export interface TrustedEndpoint {
  id: string;
  deviceName: string;
  ipAddress: string;
  firstSeenAt: string;
  lastLoginAt: string;
  lastSeenAt: string;
  loginCount: number;
  remembered: boolean;
  revokedAt: string | null;
  current: boolean;
  active: boolean;
}

export interface TrustedEndpointsResponse {
  canRevokeOthers: boolean;
  revokeEligibleAt: string;
  endpoints: TrustedEndpoint[];
}

export interface KdfParams {
  algorithm: "argon2id";
  opsLimit: number;
  memLimit: number;
  version: number;
}

export interface VaultDocument {
  kind: "note" | "folder";
  title: string;
  markdown: string;
  parentId: string | null;
  tags: string[];
  favorite: boolean;
  locked: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  manualOrder: number;
  attachmentIds: string[];
  schemaVersion: 2;
}

export interface VaultAttachment {
  kind: "attachment";
  ownerNoteId: string;
  originalName: string;
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";
  size: number;
  sha256: string;
  chunkCount: number;
  chunkSize: number;
  attachmentKey: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 2;
}

export type VaultObject = VaultDocument | VaultAttachment;

export interface OpenDocument extends VaultDocument {
  objectId: string;
  serverRevision: number;
  dirty: boolean;
}

export interface OpenAttachment extends VaultAttachment {
  objectId: string;
  serverRevision: number;
  dirty: boolean;
}

export interface EncryptedObject {
  objectId: string;
  objectType: ObjectType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  revision: number;
  deleted: boolean;
  purged?: boolean;
}

export interface SyncChange extends EncryptedObject {
  sequence: number;
  serverUpdatedAt: string;
}

export interface EncryptedAttachmentChunk {
  attachmentId: string;
  chunkIndex: number;
  totalChunks: number;
  ciphertext: ArrayBuffer;
  nonce: string;
  encryptionVersion: number;
}

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  index: number;
}

export type HistoryCaptureKind = "baseline" | "interval" | "idle" | "manual" | "restore-safety";

export interface NoteHistoryPayload {
  schemaVersion: 1;
  capturedAt: string;
  title: string;
  markdown: string;
  tags: string[];
  attachmentIds: string[];
  sourceUpdatedAt: string;
}

export interface HistoryListItem {
  historyId: string;
  noteId: string;
  capturedAt: string;
  captureKind: HistoryCaptureKind;
  byteSize: number;
  pending: boolean;
  serverCreatedAt?: string;
}

export interface EncryptedHistorySnapshot extends HistoryListItem {
  ciphertext: string;
  nonce: string;
  encryptionVersion: 1;
}

export interface HistorySettings {
  enabled: boolean;
  intervalMinutes: 5 | 10 | 30 | 60;
  retentionDays: 7 | 30 | 90 | 180 | 365 | null;
  count: number;
  usedBytes: number;
  quotaBytes: number;
  clearedBefore: string | null;
}

export type SortMode = "alphabetical" | "created" | "updated" | "manual";
export type ThemePreference = "system" | "light" | "dark";
export type FontSizePreference = "small" | "standard" | "large";
export type LanguagePreference = "system" | "en" | "zh-CN" | "zh-TW";

export interface UiPreferences {
  theme: ThemePreference;
  fontSize: FontSizePreference;
  language: LanguagePreference;
  sortMode: SortMode;
  treeCollapsed: boolean;
  outlineCollapsed: boolean;
  treeWidth: number;
  outlineWidth: number;
  rightPanelTab: "outline" | "history";
}

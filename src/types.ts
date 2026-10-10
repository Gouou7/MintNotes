export type { ObjectType, VaultDocument, VaultAttachment, VaultObject, OpenDocument, OpenAttachment, EncryptedObject, SyncChange, EncryptedAttachmentChunk, HistoryCaptureKind, NoteHistoryPayload, NoteHistoryMetadataPayload, EncryptedHistoryMetadata, HistoryListItem, EncryptedHistorySnapshot, HistorySettings } from "@mint-notes/application-client";

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
  inactiveRetentionDays: number;
  endpoints: TrustedEndpoint[];
}

export interface KdfParams {
  algorithm: "argon2id";
  opsLimit: number;
  memLimit: number;
  version: number;
}

export interface VaultEnvelopeBinding {
  version: 1 | 2;
  context: string;
}

export interface AuthParameters {
  kdfSalt: string;
  kdfParams: KdfParams;
  recoveryWrappedVaultKey: string;
  recoveryWrappedVaultNonce: string;
  envelopeBinding: VaultEnvelopeBinding;
}

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  index: number;
  sourceOffset: number;
  sourceLine: number;
}

export type SortMode = "alphabetical" | "created" | "updated" | "manual";
export type ThemePreference = "system" | "light" | "dark";
export type LanguagePreference = "system" | "en" | "zh-CN" | "zh-TW";
export type WorkspaceEditorMode = "live" | "source" | "reading";

export interface UiPreferences {
  workspaceVersion: 1;
  activeNoteId: string | null;
  openNoteIds: string[];
  editorMode: WorkspaceEditorMode;
  editorReadOnly: boolean;
  theme: ThemePreference;
  fontSize: number;
  wrapCodeBlocks: boolean;
  language: LanguagePreference;
  sortMode: SortMode;
  treeCollapsed: boolean;
  outlineCollapsed: boolean;
  treeWidth: number;
  outlineWidth: number;
  rightPanelTab: "outline" | "history";
}

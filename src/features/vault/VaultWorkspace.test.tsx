import "fake-indexeddb/auto";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { localDb, localKey, preferencesKey } from "../../storage/database";
import type { OpenDocument } from "../../types";
import { DEFAULT_PREFERENCES } from "./useVaultPreferences";
import { VaultWorkspace } from "./VaultWorkspace";

const mocks = vi.hoisted(() => ({ api: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(),
  encryptHistory: vi.fn(), decryptHistory: vi.fn(), encryptMetadata: vi.fn(), decryptMetadata: vi.fn()
}));
vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), api: mocks.api }));
vi.mock("../../crypto/client", () => ({ cryptoClient: {
  encryptObject: mocks.encrypt, decryptObject: mocks.decrypt,
  encryptHistory: mocks.encryptHistory, decryptHistory: mocks.decryptHistory,
  encryptHistoryMetadata: mocks.encryptMetadata, decryptHistoryMetadata: mocks.decryptMetadata
} }));
vi.mock("../../editor/product/MarkdownEditor", () => ({
  MarkdownEditor: (props: {
    markdown: string; documentKey: string; readOnly: boolean;
    onChange: (markdown: string, documentKey: string) => void;
  }) => <textarea aria-label="test-editor" value={props.markdown} readOnly={props.readOnly}
    onInput={event => props.onChange(event.currentTarget.value, props.documentKey)} />
}));
vi.mock("../../editor/product/ReadingEditor", () => ({
  ReadingEditor: ({ markdown }: { markdown: string }) => <article aria-label="test-preview">{markdown}</article>
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const userId = "workspace-composition-test";
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
let root: Root;
let host: HTMLDivElement;

function note(objectId: string, title: string): OpenDocument {
  return { objectId, title, markdown: `${title} body`, kind: "note", parentId: null,
    tags: [], favorite: false, locked: false, deleted: false, attachmentIds: [], manualOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 2, serverRevision: 1, dirty: false };
}

async function seed(value: OpenDocument) {
  const { objectId, serverRevision, dirty: _dirty, ...payload } = value;
  await localDb.objects.put({ key: localKey(userId, objectId), userId, objectId, objectType: "note",
    ciphertext: JSON.stringify(payload), nonce: "synthetic-nonce", encryptionVersion: 1,
    revision: serverRevision, deleted: false, updatedAt: value.updatedAt });
}

async function mount() {
  await act(async () => root.render(<StrictMode><I18nProvider><VaultWorkspace
    user={{ id: userId, username: "reader", displayName: "Reader", role: "user" }}
    endpoint={{ id: "endpoint", remembered: true }} credential={null} serverSessionVerified={false}
    onCredentialChange={vi.fn()} onDisplayNameChange={vi.fn()} onUsernameChange={vi.fn()} onLocked={vi.fn()}
  /></I18nProvider></StrictMode>));
  await settle(() => host.querySelector<HTMLTextAreaElement>('[aria-label="test-editor"]')?.value === "First body");
}

async function settle(ready: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let complete = false;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      complete = await ready();
    });
    if (complete) return;
  }
  throw new Error("Workspace did not settle");
}

beforeEach(async () => {
  vi.clearAllMocks();
  await localDb.delete();
  await localDb.open();
  localStorage.clear();
  mocks.encrypt.mockImplementation(async (_user, _id, _kind, _revision, payload) => ({
    ciphertext: JSON.stringify(payload), nonce: "synthetic-nonce", encryptionVersion: 1
  }));
  mocks.decrypt.mockImplementation(async (_user, _id, _kind, _revision, ciphertext) => JSON.parse(ciphertext));
  mocks.encryptHistory.mockImplementation(async (_user, _note, _id, _at, _kind, payload) => ({
    ciphertext: JSON.stringify(payload), nonce: "synthetic-history-nonce", encryptionVersion: 1
  }));
  mocks.decryptHistory.mockImplementation(async (_user, _note, _id, _at, _kind, ciphertext) => JSON.parse(ciphertext));
  mocks.encryptMetadata.mockImplementation(async (_user, _note, _id, _at, payload) => ({
    ciphertext: JSON.stringify(payload), nonce: "synthetic-metadata-nonce", encryptionVersion: 1
  }));
  mocks.decryptMetadata.mockImplementation(async (_user, _note, _id, _at, ciphertext) => JSON.parse(ciphertext));
  await seed(note(firstId, "First"));
  await seed(note(secondId, "Second"));
  await localDb.meta.put({ key: preferencesKey(userId), value: JSON.stringify({ ...DEFAULT_PREFERENCES,
    language: "en", activeNoteId: firstId, openNoteIds: [firstId] }) });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  await localDb.delete();
  vi.restoreAllMocks();
});

describe("vault feature composition", () => {
  it("loads under StrictMode and durably saves the previous draft before navigating offline", async () => {
    await mount();
    const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="test-editor"]')!;
    await act(async () => {
      editor.value = "unsaved latest draft";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const second = [...host.querySelectorAll<HTMLButtonElement>(".tree-main")]
      .find(button => button.textContent === "Second")!;
    await act(async () => second.click());
    await settle(() => host.querySelector<HTMLTextAreaElement>('[aria-label="test-editor"]')?.value === "Second body");
    const saved = await localDb.objects.get(localKey(userId, firstId));
    expect(JSON.parse(saved!.ciphertext).markdown).toBe("unsaved latest draft");
    expect((await localDb.outbox.get(localKey(userId, firstId)))?.ciphertext).toBe(saved!.ciphertext);
    const history = await localDb.historySnapshots.where("[userId+noteId]").equals([userId, firstId]).toArray();
    expect(history.some(snapshot => JSON.parse(snapshot.ciphertext).markdown === "unsaved latest draft")).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("creates and selects a note through the extracted document and tree controllers", async () => {
    await mount();
    const create = host.querySelector<HTMLButtonElement>('button[aria-label="New note"]')!;
    expect(create).not.toBeNull();
    await act(async () => create.click());
    await settle(async () => await localDb.objects.where("userId").equals(userId).count() === 3
      && host.querySelector<HTMLTextAreaElement>('[aria-label="test-editor"]')?.value === "");
    expect(await localDb.outbox.where("userId").equals(userId).count()).toBe(1);
    expect(host.querySelector(".tree-row.active")?.textContent).toContain("Untitled");
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("creates a safety checkpoint before restoring a historical snapshot over a pending draft", async () => {
    await mount();
    const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="test-editor"]')!;
    await act(async () => {
      editor.value = "draft before restore";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(async () => await localDb.historySnapshots.where("[userId+noteId]")
      .equals([userId, firstId]).count() > 0);
    const baseline = (await localDb.historySnapshots.where("[userId+noteId]").equals([userId, firstId]).toArray())[0];
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".right-panel-tabs button")[1].click());
    await settle(() => Boolean(host.querySelector(`[data-history-id="${baseline.historyId}"] .history-select`)));
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-history-id="${baseline.historyId}"] .history-select`)!.click());
    await settle(() => host.querySelector('[aria-label="test-preview"]')?.textContent === "First body");
    await act(async () => host.querySelector<HTMLButtonElement>(".history-preview-banner .primary")!.click());
    await settle(() => host.querySelector<HTMLTextAreaElement>('[aria-label="test-editor"]')?.value === "First body");
    const snapshots = await localDb.historySnapshots.where("[userId+noteId]").equals([userId, firstId]).toArray();
    const safety = snapshots.find(snapshot => snapshot.captureKind === "restore-safety");
    expect(JSON.parse(safety!.ciphertext).markdown).toBe("draft before restore");
    expect(JSON.parse((await localDb.objects.get(localKey(userId, firstId)))!.ciphertext).markdown).toBe("First body");
    expect(mocks.api).not.toHaveBeenCalled();
  });
});

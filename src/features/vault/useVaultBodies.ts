import { useCallback, useEffect, useRef, useState } from "react";
import { catalogSourceDigest } from "@mint-notes/application-client/crypto";
import { ApiError } from "../../api";
import { localDb, localKey, type LocalCatalogNote } from "../../storage/database";
import { ensureBodyBlocks, persistBodyBlocks } from "../../storage/noteBodies";
import type { EncryptedObject, OpenDocument, UiPreferences } from "../../types";
import { useWorkspaceServices } from "../session/workspaceServices";
import { readSyncEpoch } from "./syncReconciliation";
import type { useVaultModel } from "./useVaultModel";

export const DEFAULT_RECENT_BODY_LIMIT = 20;
export const normalizeRecentBodyLimit = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 200 ? value : DEFAULT_RECENT_BODY_LIMIT;

export function backgroundBodyTargets(documents: OpenDocument[], preferences: UiPreferences) {
  const mode = preferences.noteDownloadMode ?? "all";
  if (mode === "on-demand") return [];
  const notes = documents.filter((note) => note.kind === "note" && (mode === "all" || !note.deleted));
  notes.sort((left, right) => Number(left.deleted) - Number(right.deleted)
    || right.updatedAt.localeCompare(left.updatedAt) || left.objectId.localeCompare(right.objectId));
  return (mode === "recent" ? notes.slice(0, normalizeRecentBodyLimit(preferences.recentNoteDownloadLimit)) : notes).filter((note) => note.bodyPending);
}

const aborted = () => new DOMException("Note download cancelled", "AbortError");
const sameCatalog = (a: LocalCatalogNote | undefined, b: LocalCatalogNote) =>
  a?.epoch === b.epoch && a.revision === b.revision && a.nonce === b.nonce && a.catalog?.nonce === b.catalog?.nonce;
type Job = { id: string; revision: number; controller: AbortController; promise: Promise<OpenDocument>; priority: number };

export function useVaultBodies(options: {
  userId: string;
  model: ReturnType<typeof useVaultModel>;
  enabled: boolean;
  active?: OpenDocument;
  online: boolean;
  isActive: () => boolean;
  preferences: UiPreferences;
}) {
  const services = useWorkspaceServices();
  const [connected, setConnected] = useState(() => navigator.onLine);
  const online = options.online && connected;
  const latest = useRef(options);
  latest.current = { ...options, online };
  const running = useRef<Job | null>(null);
  const maintenance = useRef<AbortController | null>(null);
  const syncBusy = useRef(false);
  const retries = useRef(new Map<string, number>());
  const indexed = useRef(new Set<string>());
  const [activeError, setActiveError] = useState("");
  const [offline, setOffline] = useState<OpenDocument>();
  const search = useRef<AbortController | null>(null);
  const [searching, setSearching] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const update = () => setConnected(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const load = useCallback(async (requested: OpenDocument, priority: number, signal?: AbortSignal): Promise<OpenDocument> => {
    const { userId, model } = latest.current;
    const current = model.documentIndexRef.current.get(requested.objectId);
    if (!current || current.serverRevision !== requested.serverRevision) throw aborted();
    if (!current.bodyPending) return current;
    signal?.throwIfAborted();
    if (!latest.current.isActive() || !latest.current.online || !navigator.onLine) throw aborted();
    const existing = running.current;
    if (existing) {
      if (!existing.controller.signal.aborted && existing.id === requested.objectId && existing.revision === requested.serverRevision) {
        existing.priority = Math.max(existing.priority, priority);
        return existing.promise;
      }
      if (existing.priority < priority) existing.controller.abort();
      await existing.promise.catch(() => undefined);
      return load(requested, priority, signal);
    }
    if (priority > 0) maintenance.current?.abort();
    const controller = new AbortController();
    const requestSignal = controller.signal;
    const cancel = () => { if (running.current?.controller === controller && running.current.priority <= priority) controller.abort(); };
    signal?.addEventListener("abort", cancel, { once: true });
    const active = () => latest.current.isActive() && latest.current.online && !requestSignal.aborted;
    const promise = (async () => {
      const key = localKey(userId, requested.objectId);
      const catalog = await localDb.noteCatalog.get(key);
      if (!catalog || catalog.revision !== requested.serverRevision || !active()) throw aborted();
      const query = `?epoch=${encodeURIComponent(catalog.epoch)}&revision=${catalog.revision}`;
      const cached = await localDb.objects.get(key);
      const matches = cached?.revision === catalog.revision && (catalog.catalog
        ? await catalogSourceDigest(cached) === catalog.catalog.sourceDigest
        : cached.ciphertext === catalog.ciphertext && cached.nonce === catalog.nonce);
      const envelope: EncryptedObject = matches ? cached : catalog.encryptionVersion === 2 ? catalog
        : await services.transport.api(`/api/objects/${catalog.objectId}${query}`, { signal: requestSignal });
      if (envelope.objectId !== catalog.objectId || envelope.objectType !== "note" || envelope.revision !== catalog.revision || envelope.deleted !== catalog.deleted
        || (catalog.catalog && await catalogSourceDigest(envelope) !== catalog.catalog.sourceDigest)) throw new Error("Invalid note body version");
      const bodyBlocks = await ensureBodyBlocks(userId, envelope, active, services.transport.api, { epoch: catalog.epoch, signal: requestSignal });
      const note = await services.cryptoClient.decryptObject(userId, envelope.objectId, "note", envelope.revision, envelope.ciphertext, envelope.nonce, { ...envelope, bodyBlocks });
      if (note.kind !== "note" || note.deleted !== catalog.deleted || !active()) throw aborted();
      let committed = false;
      await localDb.transaction("rw", localDb.noteCatalog, localDb.objects, localDb.bodyBlocks, localDb.outbox, async () => {
        if (!active() || !sameCatalog(await localDb.noteCatalog.get(key), catalog) || await localDb.outbox.get(key)) return;
        await persistBodyBlocks(userId, envelope.objectId, { ...envelope, bodyBlocks });
        for (const block of bodyBlocks) await localDb.bodyBlocks.update(localKey(userId, `${envelope.objectId}:${block.blockId}`), { uploaded: true });
        const { bodyBlocks: _blocks, ...stored } = envelope;
        await localDb.objects.put({ ...stored, key, userId, catalog: catalog.catalog, updatedAt: catalog.updatedAt, serverTrashedAt: catalog.serverTrashedAt });
        await localDb.noteCatalog.delete(key);
        committed = true;
      });
      const live = model.documentIndexRef.current.get(requested.objectId);
      if (!committed || !active() || !live?.bodyPending || live.dirty || live.serverRevision !== catalog.revision) throw aborted();
      const result = { ...note, objectId: envelope.objectId, serverRevision: envelope.revision, serverTrashedAt: catalog.serverTrashedAt, dirty: false };
      latest.current.model.upsertDocument(result);
      return result;
    })().finally(() => {
      signal?.removeEventListener("abort", cancel);
      if (running.current?.controller === controller) running.current = null;
    });
    running.current = { id: requested.objectId, revision: requested.serverRevision, controller, promise, priority };
    return promise;
  }, [services]);

  const ensureBody = useCallback((note: OpenDocument, signal?: AbortSignal) => load(note, 1, signal), [load]);
  const loadActive = useCallback(() => setRetry((value) => value + 1), []);
  const setSyncBusy = useCallback((busy: boolean) => {
    syncBusy.current = busy;
    if (busy) {
      if (running.current?.priority === 0) running.current.controller.abort();
      maintenance.current?.abort();
    }
  }, []);

  const activeId = options.active?.objectId;
  const activeRevision = options.active?.serverRevision;
  const activePending = options.active?.bodyPending;
  useEffect(() => {
    setActiveError("");
    setOffline(undefined);
    if (!activeId || !activePending) return;
    let cancelled = false;
    const note = latest.current.active;
    if (!online) {
      void (async () => {
        const { userId } = latest.current;
        const cached = await localDb.objects.get(localKey(userId, activeId));
        if (!cached || cancelled) return;
        const prior = await services.cryptoClient.decryptObject(userId, activeId, "note", cached.revision, cached.ciphertext, cached.nonce, cached);
        if (!cancelled && latest.current.isActive() && prior.kind === "note") setOffline({ ...prior, objectId: activeId, serverRevision: cached.revision, dirty: false });
      })().catch(() => undefined);
    } else if (note) void load(note, 2).catch(() => { if (!cancelled) setActiveError(activeId); });
    return () => {
      cancelled = true;
      if (running.current?.id === activeId && running.current.priority === 2) running.current.controller.abort();
    };
  }, [activeId, activeRevision, activePending, online, retry, load, services]);

  const mode = options.preferences.noteDownloadMode;
  const limit = options.preferences.recentNoteDownloadLimit;
  useEffect(() => {
    if (!options.enabled || !online) return;
    let stopped = false;
    let timer: number;
    const tick = async () => {
      const current = latest.current;
      try {
        if (document.visibilityState !== "visible" || !navigator.onLine || !current.isActive()
          || syncBusy.current || running.current) return;
        const documents = current.model.documentsRef.current;
        const note = backgroundBodyTargets(documents, current.preferences)
          .find((entry) => (retries.current.get(entry.objectId) ?? 0) <= Date.now());
        if (note) {
          try { await load(note, 0); }
          catch (error) {
            if (error instanceof ApiError && error.status === 409) retries.current.set(note.objectId, Date.now() + 5_000);
            else if (!(error instanceof DOMException && error.name === "AbortError")) retries.current.set(note.objectId, Date.now() + 30_000);
          }
          return;
        }
        if ((await localDb.meta.get(`note-catalog:${current.userId}`))?.value !== "true") return;
        const localNote = documents.find((entry) => entry.kind === "note" && !entry.dirty && !entry.bodyPending
          && !indexed.current.has(`${entry.objectId}:${entry.serverRevision}`));
        if (!localNote || stopped || syncBusy.current || running.current) return;
        const fingerprint = `${localNote.objectId}:${localNote.serverRevision}`;
        indexed.current.add(fingerprint);
        const controller = new AbortController();
        maintenance.current = controller;
        try {
          const object = await localDb.objects.get(localKey(current.userId, localNote.objectId));
          if (!object || object.revision !== localNote.serverRevision || object.encryptionVersion !== 1 || object.catalog) return;
          const epoch = await readSyncEpoch(current.userId);
          if (!epoch) return;
          const payload = await services.cryptoClient.decryptObject(current.userId, object.objectId, "note", object.revision, object.ciphertext, object.nonce, object);
          if (payload.kind !== "note" || controller.signal.aborted) return;
          const catalog = await services.cryptoClient.encodeNoteCatalog(current.userId, object, payload);
          if (catalog.ciphertext.length > 65_536 || !current.isActive() || controller.signal.aborted) return;
          await services.transport.api(`/api/objects/${object.objectId}/catalog`, {
            method: "PUT", headers: { "X-WebMD-Sync-Epoch": epoch }, signal: controller.signal,
            body: JSON.stringify({ revision: object.revision, catalog })
          });
        } catch {
          if (controller.signal.aborted) indexed.current.delete(fingerprint);
        } finally {
          if (maintenance.current === controller) maintenance.current = null;
        }
      } finally {
        if (!stopped) timer = window.setTimeout(() => void tick().catch(() => undefined), 300);
      }
    };
    const pause = () => {
      if (document.visibilityState === "visible" && navigator.onLine) return;
      if (running.current?.priority === 0) running.current.controller.abort();
      maintenance.current?.abort();
    };
    window.addEventListener("offline", pause);
    document.addEventListener("visibilitychange", pause);
    timer = window.setTimeout(() => void tick().catch(() => undefined), 300);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("offline", pause);
      document.removeEventListener("visibilitychange", pause);
      if (running.current?.priority === 0) running.current.controller.abort();
      maintenance.current?.abort();
    };
  }, [options.enabled, online, mode, limit, load, services]);

  const stop = useCallback(() => {
    running.current?.controller.abort();
    maintenance.current?.abort();
    search.current?.abort();
  }, []);
  const searchAll = useCallback(async () => {
    if (search.current) { search.current.abort(); return; }
    const controller = new AbortController();
    search.current = controller;
    setSearching(true);
    let failed = false;
    try {
      for (const note of latest.current.model.documentsRef.current) if (note.kind === "note" && !note.deleted && note.bodyPending) {
        if (controller.signal.aborted) return;
        try { await load(note, 1, controller.signal); }
        catch { if (!controller.signal.aborted) failed = true; }
      }
      if (failed && !controller.signal.aborted) throw new Error("Full-text search incomplete");
    } finally {
      search.current = null;
      if (latest.current.isActive()) setSearching(false);
    }
  }, [load]);
  useEffect(() => stop, [stop]);
  return { ensureBody, online, activeFailed: activeError === activeId, offlineBody: offline?.objectId === activeId ? offline : undefined,
    retryActive: loadActive, searching, searchAll, stop, setSyncBusy };
}

import { ApplicationError, assertApplicationActive, type ApplicationConnectionBootstrap } from "../protocol.js";
import { applicationAuthSecret, b64, fromB64, ownedBuffer, VaultCipher, encryptAttachmentBytes, decryptAttachmentBytes, historyAad, historyMetadataAad } from "../crypto.js";
import { assertWritableNote, attachmentReferences, noteAccess } from "../policy.js";
import { AttachmentCloneService } from "../attachmentClone.js";
import { detectImageMime } from "../attachmentFormat.js";
import { makeDocument } from "../documentFactory.js";
import { nameKey, uniqueSiblingTitle } from "../siblingNames.js";
import type { EncryptedAttachmentChunk, EncryptedObject, OpenAttachment, OpenDocument, SyncChange, VaultAttachment, VaultDocument } from "../types.js";
import { ApplicationStore, type ConflictDraft, type HistoryWrite, type MutationResult, type ObjectWrite, type Operation, type PendingWrite } from "./store.js";
import { ApplicationTransport, normalizeApplicationUrl } from "./transport.js";

export interface ApplicationClientOptions {
  baseUrl: string;
  applicationKey: string;
  stateDir: string;
  offlineReads?: boolean;
}
type Arguments = Record<string, unknown>;
type ReadState = { offline: boolean; lastSyncedAt: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argumentId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new ApplicationError("INVALID_ARGUMENT", "A valid UUID is required");
  return value.toLowerCase();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ApplicationError("INVALID_ARGUMENT", "expectedRevision is required");
  return Number(value);
}
function text(value: unknown, field: string, max = 1_000_000): string {
  if (typeof value !== "string" || value.length > max) throw new ApplicationError("INVALID_ARGUMENT", `Invalid ${field}`);
  return value;
}
function operationCode(error: unknown): string { return error instanceof ApplicationError ? error.code : "CLIENT_FAILED"; }

/** All plaintext and keys live in the caller's worker, never in SQLite. */
export class ApplicationClient {
  private store: ApplicationStore;
  private transport: ApplicationTransport;
  private cipher: VaultCipher | null = null;
  private bootstrap: ApplicationConnectionBootstrap | null = null;
  private lifetime = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private activeSignal: AbortSignal | undefined;
  private constructor(private options: ApplicationClientOptions, connectionId: string, authSecret: string) {
    this.store = new ApplicationStore(options.stateDir, options.baseUrl, connectionId);
    this.transport = new ApplicationTransport(options.baseUrl, `${connectionId}.${authSecret}`, this.lifetime.signal);
  }

  static async open(options: ApplicationClientOptions): Promise<ApplicationClient> {
    const baseUrl = normalizeApplicationUrl(options.baseUrl);
    const auth = await applicationAuthSecret(options.applicationKey);
    return new ApplicationClient({ ...options, baseUrl }, auth.connectionId, auth.authSecret);
  }

  execute(tool: string, args: Arguments = {}, signal?: AbortSignal): Promise<unknown> {
    const task = this.queue.then(async () => {
      if (this.closed || signal?.aborted) throw new ApplicationError("CANCELLED", "Client stopped or request cancelled");
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new ApplicationError("INVALID_ARGUMENT", "Arguments must be an object");
      this.activeSignal = signal;
      try { return await this.dispatch(tool, args); }
      finally { this.activeSignal = undefined; }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  private async applyBootstrap(value: ApplicationConnectionBootstrap): Promise<void> {
    const expected = await applicationAuthSecret(this.options.applicationKey);
    if (value?.protocolVersion !== 1 || value.objectSchemaVersion !== 2 || value.encryptionVersion !== 1
      || value.connection?.connectionId !== expected.connectionId || !["read", "read-write"].includes(value.connection.access)
      || typeof value.userId !== "string" || !Number.isFinite(Date.parse(value.serverTime))) {
      throw new ApplicationError("PROTOCOL_UNSUPPORTED", "Unsupported application protocol");
    }
    assertApplicationActive(value.connection, Date.parse(value.serverTime));
    const previous = this.store.bootstrap();
    if (previous && previous.userId !== value.userId) throw new ApplicationError("ACCOUNT_MISMATCH", "Cached account does not match this connection");
    let cipher: VaultCipher;
    try { cipher = await VaultCipher.unlock(this.options.applicationKey, value); }
    catch { throw new ApplicationError("VAULT_DECRYPT_FAILED", "Unable to unlock the application vault"); }
    this.cipher?.dispose();
    this.cipher = cipher;
    this.bootstrap = value;
    this.store.transaction(() => {
      this.store.set("bootstrap", value);
      this.store.set("serverTime", Math.max(this.store.get<number>("serverTime") ?? 0, Date.parse(value.serverTime)));
      this.store.set("rejected", null);
    });
  }

  private async refreshBootstrap(): Promise<void> {
    const value = await this.transport.json<ApplicationConnectionBootstrap>("/connection", {}, this.activeSignal);
    await this.applyBootstrap(value);
  }

  private async prepare(synchronize = true, allowOffline = true): Promise<ReadState> {
    const rejected = this.store.get<string>("rejected");
    if (rejected) throw new ApplicationError(rejected, "Application connection requires new credentials", 401);
    try {
      await this.refreshBootstrap();
      if (synchronize) {
        for (const operation of this.store.pending()) {
          if (this.bootstrap!.connection.access !== "read-write") break;
          await this.flush(operation);
        }
        await this.pull();
        await this.refreshBootstrap();
        this.store.set("lastSyncedAt", this.bootstrap!.serverTime);
      }
      return { offline: false, lastSyncedAt: this.store.get("lastSyncedAt") };
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 401) {
        this.store.set("rejected", error.code);
        this.cipher?.dispose(); this.cipher = null;
      }
      if (!(error instanceof ApplicationError) || error.code !== "NETWORK_UNAVAILABLE") throw error;
      if (!allowOffline || this.options.offlineReads === false) throw new ApplicationError("OFFLINE_WRITE_DISABLED", "An online connection is required");
      const cached = this.store.bootstrap();
      if (!cached || this.store.get("rejected")) throw new ApplicationError("OFFLINE_CACHE_MISSING", "No verified offline cache is available");
      assertApplicationActive(cached.connection, Math.max(Date.now(), this.store.get<number>("serverTime") ?? 0));
      if (!this.cipher) this.cipher = await VaultCipher.unlock(this.options.applicationKey, cached);
      this.bootstrap = cached;
      return { offline: true, lastSyncedAt: this.store.get("lastSyncedAt") };
    }
  }

  private async pull(): Promise<void> {
    let cursor = this.store.get<number>("cursor") ?? 0;
    for (;;) {
      const page = await this.transport.json<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean }>(`/sync?since=${cursor}&limit=200&compact=1`, {}, this.activeSignal);
      if (!page || !Array.isArray(page.changes) || !Number.isSafeInteger(page.cursor) || typeof page.hasMore !== "boolean") {
        throw new ApplicationError("INVALID_RESPONSE", "Invalid synchronization page");
      }
      if (page.reset === true) {
        if (page.cursor !== 0 || page.changes.length) throw new ApplicationError("INVALID_RESPONSE", "Invalid synchronization reset");
        this.store.applyPage([], 0, true); cursor = 0; continue;
      }
      let sequence = cursor;
      for (const change of page.changes) {
        argumentId(change.objectId);
        if (!Number.isSafeInteger(change.sequence) || change.sequence <= sequence || change.sequence > page.cursor) throw new ApplicationError("INVALID_RESPONSE", "Invalid synchronization sequence");
        sequence = change.sequence;
        if (!change.purged) await this.cipher!.decryptObject(change);
      }
      if (page.cursor < cursor || (page.hasMore && page.cursor <= cursor)) throw new ApplicationError("INVALID_RESPONSE", "Synchronization made no progress");
      this.store.applyPage(page.changes, page.cursor);
      cursor = page.cursor;
      if (!page.hasMore) return;
    }
  }

  private async *iterateDocuments(): AsyncGenerator<OpenDocument> {
    for (const object of this.store.visibleObjects()) {
      if (object.objectType === "attachment") continue;
      const document = await this.cipher!.decryptObject(object) as VaultDocument;
      const pending = this.store.pendingForObject(object.objectId);
      yield { ...document, objectId: object.objectId, serverRevision: pending ? (pending.body?.conflict ? 0 : pending.body!.note.baseRevision) : object.revision, dirty: Boolean(pending) };
    }
  }

  private async documents(): Promise<OpenDocument[]> {
    const result: OpenDocument[] = [];
    for await (const document of this.iterateDocuments()) result.push(document);
    return result;
  }

  private async note(id: string): Promise<OpenDocument> {
    const object = this.store.visibleObjects().find((entry) => entry.objectId === id);
    if (!object) throw new ApplicationError("NOTE_NOT_FOUND", "Note is not in the available cache", 404);
    const note = await this.cipher!.decryptObject(object);
    if (note.kind !== "note" || !noteAccess(note, this.bootstrap!.connection.access).canRead) throw new ApplicationError("NOTE_NOT_FOUND", "Note is not available", 404);
    const pending = this.store.pendingForObject(id);
    return { ...note, objectId: id, serverRevision: pending ? (pending.body?.conflict ? 0 : pending.body!.note.baseRevision) : object.revision, dirty: Boolean(pending) };
  }

  private view(note: OpenDocument, state: ReadState) {
    const { serverRevision, dirty, ...document } = note;
    return { ...document, revision: serverRevision, pending: dirty, ...noteAccess(note, this.bootstrap!.connection.access), ...state };
  }

  private async dispatch(tool: string, args: Arguments): Promise<unknown> {
    if (tool === "mint_notes_status") {
      const state = await this.prepare(false);
      return { ...state, connection: this.bootstrap!.connection, pendingOperations: this.store.pending().map((operation) => operation.result) };
    }
    if (["mint_notes_create", "mint_notes_update", "mint_notes_append", "mint_notes_trash"].includes(tool)) return this.mutate(tool, args);
    if (!["mint_notes_get", "mint_notes_read_attachment", "mint_notes_list", "mint_notes_search"].includes(tool)) throw new ApplicationError("UNKNOWN_TOOL", "Unknown notes tool");
    const state = await this.prepare();
    if (tool === "mint_notes_get") return this.view(await this.note(argumentId(args.noteId)), state);
    if (tool === "mint_notes_read_attachment") {
      const note = await this.note(argumentId(args.noteId));
      const id = argumentId(args.attachmentId);
      if (![...note.attachmentIds, ...attachmentReferences(note.markdown)].includes(id)) throw new ApplicationError("ATTACHMENT_NOT_FOUND", "Attachment does not belong to this note", 404);
      const object = this.store.object(id);
      if (!object) throw new ApplicationError("ATTACHMENT_NOT_CACHED", "Attachment metadata is not cached");
      const metadata = await this.cipher!.decryptObject(object);
      if (metadata.kind !== "attachment" || metadata.ownerNoteId !== note.objectId || metadata.deleted) throw new ApplicationError("ATTACHMENT_NOT_FOUND", "Invalid attachment owner", 404);
      const data = await this.attachmentBytes(id, metadata, state.offline);
      this.store.evictAttachments();
      return { attachmentId: id, noteId: note.objectId, name: metadata.originalName, mime: metadata.mime, data, ...state };
    }
    if (!["mint_notes_list", "mint_notes_search"].includes(tool)) throw new ApplicationError("UNKNOWN_TOOL", "Unknown notes tool");
    const query = tool === "mint_notes_search" ? text(args.query, "query", 1000).normalize("NFC").toLowerCase() : "";
    const limit = args.limit === undefined ? 50 : Number(args.limit);
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new ApplicationError("INVALID_ARGUMENT", "Invalid pagination");
    const parentId = args.parentId === undefined ? undefined : args.parentId === null ? null : argumentId(args.parentId);
    const entries: Array<{ objectId: string; title: string; [key: string]: unknown }> = [];
    for await (const document of this.iterateDocuments()) {
      if (!noteAccess(document, this.bootstrap!.connection.access).canRead
        || (parentId !== undefined && document.parentId !== parentId)
        || (args.tag !== undefined && !document.tags.includes(text(args.tag, "tag", 200)))
        || (args.favorite !== undefined && document.favorite !== args.favorite)
        || (query && (document.kind !== "note" || ![document.title, document.markdown, ...document.tags].some((value) => value.normalize("NFC").toLowerCase().includes(query))))) continue;
      const { markdown, ...view } = this.view(document, state);
      if (tool === "mint_notes_list") entries.push(view);
      else {
        const index = markdown.normalize("NFC").toLowerCase().indexOf(query);
        entries.push({ ...view, excerpt: markdown.slice(Math.max(0, index - 80), Math.max(0, index - 80) + 240) });
      }
    }
    entries.sort((a, b) => nameKey(a.title).localeCompare(nameKey(b.title)) || a.objectId.localeCompare(b.objectId));
    return { ...state, total: entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null, items: entries.slice(offset, offset + limit) };
  }

  private async mutate(tool: string, args: Arguments): Promise<MutationResult> {
    const allowed = tool === "mint_notes_create" ? ["operationId", "title", "markdown", "parentId", "tags", "favorite"]
      : tool === "mint_notes_update" ? ["operationId", "noteId", "expectedRevision", "title", "markdown", "parentId", "tags", "favorite"]
      : tool === "mint_notes_append" ? ["operationId", "noteId", "expectedRevision", "markdown"] : ["operationId", "noteId", "expectedRevision"];
    if (Object.keys(args).some((key) => !allowed.includes(key))) throw new ApplicationError("INVALID_ARGUMENT", "Unsupported note mutation field");
    await this.prepare(true, false);
    if (this.bootstrap!.connection.access !== "read-write") throw new ApplicationError("APPLICATION_READ_ONLY", "Application is read-only", 403);
    const operationId = args.operationId === undefined ? crypto.randomUUID() : argumentId(args.operationId);
    const { operationId: _ignored, ...authored } = args;
    const requestHash = await this.cipher!.fingerprint({ tool, args: authored });
    const prior = this.store.operation(operationId);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Operation ID was used with a different request", 409);
      return prior.body ? this.flush(prior) : prior.result;
    }
    const documents = await this.documents();
    let document: OpenDocument;
    let original: OpenDocument | null = null;
    if (tool === "mint_notes_create") {
      document = makeDocument(documents, "note", text(args.title, "title", 2048).trim(), args.parentId ? argumentId(args.parentId) : null,
        args.markdown === undefined ? "" : text(args.markdown, "markdown"));
    } else {
      original = await this.note(argumentId(args.noteId));
      assertWritableNote(original, this.bootstrap!.connection.access);
      if (this.store.pendingForObject(original.objectId)) throw new ApplicationError("NOTE_PENDING", "Resolve the existing pending write first", 409);
      if (original.serverRevision !== revision(args.expectedRevision)) throw new ApplicationError("REVISION_CONFLICT", "Read the current note before editing", 409);
      document = { ...original, tags: [...original.tags], attachmentIds: [...original.attachmentIds] };
      if (tool === "mint_notes_trash") document.deleted = true;
      if (tool === "mint_notes_append") document.markdown += text(args.markdown, "markdown");
      if (tool === "mint_notes_update") {
        if (args.markdown !== undefined) document.markdown = text(args.markdown, "markdown");
        if (args.title !== undefined) document.title = text(args.title, "title", 2048).trim();
        if (args.parentId !== undefined) document.parentId = args.parentId === null ? null : argumentId(args.parentId);
      }
    }
    if (!document.title) throw new ApplicationError("INVALID_ARGUMENT", "Note title is required");
    if (args.tags !== undefined) {
      if (!Array.isArray(args.tags) || args.tags.length > 100) throw new ApplicationError("INVALID_ARGUMENT", "Invalid tags");
      document.tags = [...new Set(args.tags.map((tag) => text(tag, "tag", 200)))];
    }
    if (args.favorite !== undefined) {
      if (typeof args.favorite !== "boolean") throw new ApplicationError("INVALID_ARGUMENT", "Invalid favorite flag");
      document.favorite = args.favorite;
    }
    if (document.parentId && !documents.some((entry) => entry.objectId === document.parentId && entry.kind === "folder" && !entry.deleted)) {
      throw new ApplicationError("FOLDER_NOT_FOUND", "Destination folder is unavailable", 404);
    }
    document.title = uniqueSiblingTitle(documents.filter((entry) => entry.objectId !== document.objectId), document.title, document.parentId);
    document.updatedAt = new Date().toISOString();
    const sourceIds = original ? [...new Set([...original.attachmentIds, ...attachmentReferences(original.markdown)])] : [];
    const newReferences = attachmentReferences(document.markdown);
    if (newReferences.some((id) => !sourceIds.includes(id)) || (original && attachmentReferences(original.markdown).some((id) => !newReferences.includes(id)))) {
      throw new ApplicationError("ATTACHMENT_REFERENCE_CHANGE", "Keep existing attachment references; attachments cannot be added or removed by this plugin");
    }
    const sourceAttachments: EncryptedObject[] = [];
    for (const id of sourceIds) {
      const object = this.store.object(id);
      if (!object) throw new ApplicationError("ATTACHMENT_NOT_CACHED", "An attachment is unavailable");
      const metadata = await this.cipher!.decryptObject(object);
      if (metadata.kind !== "attachment" || metadata.ownerNoteId !== document.objectId || metadata.deleted) throw new ApplicationError("ATTACHMENT_NOT_FOUND", "Invalid attachment owner");
      await this.attachmentBytes(id, metadata, false);
      sourceAttachments.push(object);
    }
    const baseRevision = original?.serverRevision ?? 0;
    const note = await this.objectWrite(document, baseRevision);
    const body: PendingWrite = { note, sourceAttachments };
    if (original && this.bootstrap!.historyEnabled) body.history = await this.historyWrite(original);
    if (this.activeSignal?.aborted) throw new ApplicationError("CANCELLED", "Request cancelled");
    const operation: Operation = { operationId, requestHash, body, result: { operationId, objectId: document.objectId, status: "pending" } };
    this.store.stage(operation);
    const result = await this.flush(operation);
    this.store.evictAttachments();
    return result;
  }

  private async objectWrite(document: OpenDocument | OpenAttachment, baseRevision: number): Promise<ObjectWrite> {
    const { objectId, serverRevision: _revision, dirty: _dirty, ...payload } = document;
    const sealed = await this.cipher!.encryptObject(objectId, document.kind, baseRevision + 1, payload);
    if (sealed.ciphertext.length > 2_000_000) throw new ApplicationError("NOTE_TOO_LARGE", "Encrypted note exceeds the API limit");
    return { objectId, objectType: document.kind, baseRevision, revision: baseRevision + 1, deleted: document.deleted,
      idempotencyKey: crypto.randomUUID(), ...sealed };
  }

  private async historyWrite(note: OpenDocument): Promise<HistoryWrite> {
    const historyId = crypto.randomUUID();
    const capturedAt = new Date().toISOString();
    const payload = { schemaVersion: 1, capturedAt, title: note.title, markdown: note.markdown, tags: note.tags,
      attachmentIds: note.attachmentIds, sourceUpdatedAt: note.updatedAt };
    const sealed = await this.cipher!.encryptJson(payload, historyAad(this.bootstrap!.userId, note.objectId, historyId, capturedAt, "manual"));
    const metadata = await this.cipher!.encryptJson({ schemaVersion: 1, name: "Before application edit", attachmentIds: note.attachmentIds },
      historyMetadataAad(this.bootstrap!.userId, note.objectId, historyId, capturedAt));
    return { historyId, capturedAt, captureKind: "manual", ...sealed, encryptionVersion: 1,
      metadataCiphertext: metadata.ciphertext, metadataNonce: metadata.nonce, metadataEncryptionVersion: 1,
      protected: false, attachmentIds: [], idempotencyKey: crypto.randomUUID() };
  }

  private async sendObject(object: ObjectWrite): Promise<number> {
    const { objectId, revision: _revision, purged: _purged, ...body } = object;
    const response = await this.transport.json<{ revision: number }>(`/objects/${objectId}`, { method: "PUT", body: JSON.stringify(body) }, this.activeSignal);
    if (response.revision !== object.revision) throw new ApplicationError("INVALID_RESPONSE", "Unexpected accepted revision");
    return response.revision;
  }

  private async flush(operation: Operation): Promise<MutationResult> {
    if (!operation.body) return operation.result;
    try {
      const body = operation.body;
      if (body.history && !body.conflict) {
        const { historyId, ...history } = body.history;
        try {
          await this.transport.json(`/notes/${body.note.objectId}/history/${historyId}`, { method: "POST", body: JSON.stringify(history) }, this.activeSignal);
        } catch (error) {
          // Respect history clear barriers. If the original was purged, its
          // object revision check will preserve the proposal as a new copy.
          if (!(error instanceof ApplicationError) || !(error.status === 404 || error.code === "HISTORY_CLEARED")) throw error;
          delete body.history;
          this.store.saveOperation(operation);
        }
      }
      if (!body.conflict) {
        try {
          const revision = await this.sendObject(body.note);
          const result: MutationResult = { operationId: operation.operationId, objectId: body.note.objectId, revision, status: "committed" };
          this.store.complete(operation, result, [body.note]);
          return result;
        } catch (error) {
          if (!(error instanceof ApplicationError) || error.status !== 409) throw error;
          body.conflict = await this.conflictDraft(body);
          operation.result.conflictNoteId = body.conflict.note.objectId;
          this.store.saveOperation(operation);
        }
      }
      for (const chunk of body.conflict.chunks) {
        await this.transport.request(`/attachments/${chunk.attachmentId}/chunks/${chunk.chunkIndex}`, { method: "PUT",
          body: ownedBuffer(fromB64(chunk.ciphertext)), headers: { "Content-Type": "application/octet-stream", "X-WebMD-Nonce": chunk.nonce,
            "X-WebMD-Total-Chunks": String(chunk.totalChunks), "X-WebMD-Encryption-Version": "1", "X-WebMD-Idempotency-Key": chunk.idempotencyKey } }, this.activeSignal);
      }
      for (const attachment of body.conflict.attachments) await this.sendObject(attachment);
      const revision = await this.sendObject(body.conflict.note);
      const result: MutationResult = { operationId: operation.operationId, objectId: body.note.objectId, status: "conflict",
        conflictNoteId: body.conflict.note.objectId, revision };
      // Read the current original before completing the local operation. A network
      // failure keeps the same persisted conflict graph and idempotency keys.
      let original: EncryptedObject | null;
      try { original = await this.transport.json<EncryptedObject>(`/objects/${body.note.objectId}`, {}, this.activeSignal); }
      catch (error) { if (!(error instanceof ApplicationError) || error.status !== 404) throw error; original = null; }
      if (original) await this.cipher!.decryptObject(original);
      this.store.complete(operation, result, [body.conflict.note, ...body.conflict.attachments, ...(original ? [original] : [])], original ? undefined : body.note.objectId);
      return result;
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 401) {
        this.store.set("rejected", error.code); this.cipher?.dispose(); this.cipher = null; throw error;
      }
      operation.result = { ...operation.result, status: "pending", errorCode: operationCode(error) };
      this.store.saveOperation(operation);
      return operation.result;
    }
  }

  private async conflictDraft(body: PendingWrite): Promise<ConflictDraft> {
    const proposed = await this.cipher!.decryptObject(body.note) as VaultDocument;
    const documents = await this.documents();
    const parentId = documents.some((entry) => entry.objectId === proposed.parentId && entry.kind === "folder" && !entry.deleted) ? proposed.parentId : null;
    const document = makeDocument(documents, "note", uniqueSiblingTitle(documents, `${proposed.title} (conflict)`, parentId), parentId, proposed.markdown);
    Object.assign(document, { tags: proposed.tags, favorite: proposed.favorite, locked: proposed.locked, deleted: false });
    const sourceMap = new Map<string, OpenAttachment>();
    for (const object of body.sourceAttachments) {
      const source = await this.cipher!.decryptObject(object);
      if (source.kind !== "attachment") throw new ApplicationError("INVALID_OBJECT", "Invalid conflict attachment");
      sourceMap.set(object.objectId, { ...source, objectId: object.objectId, serverRevision: object.revision, dirty: false });
    }
    const attachments: ObjectWrite[] = [];
    const chunks: ConflictDraft["chunks"] = [];
    const cloner = new AttachmentCloneService({
      resolveAttachment: (id) => sourceMap.get(id),
      readAttachment: async (source) => new Blob([await this.attachmentBytes(source.objectId, source, true)], { type: source.mime }),
      createAttachment: async (ownerNoteId, source, plaintext) => {
        const objectId = crypto.randomUUID();
        const encrypted = await encryptAttachmentBytes({ userId: this.bootstrap!.userId, attachmentId: objectId, ownerNoteId,
          originalName: source.originalName, mime: source.mime, data: await plaintext.arrayBuffer(), chunkSize: 1024 * 1024 });
        chunks.push(...encrypted.chunks.map((chunk) => ({ ...chunk, ciphertext: b64(new Uint8Array(chunk.ciphertext)), idempotencyKey: crypto.randomUUID() })));
        return { ...encrypted.metadata, objectId, serverRevision: 0, dirty: true };
      },
      persistAttachment: async (attachment) => { attachments.push(await this.objectWrite(attachment, 0)); return attachment; },
      removeAttachment: async () => {}
    });
    const graph = await cloner.clone({ sourceMarkdown: proposed.markdown, sourceAttachmentIds: proposed.attachmentIds, targetNoteId: document.objectId });
    document.markdown = graph.markdown;
    document.attachmentIds = graph.attachmentIds;
    return { note: await this.objectWrite(document, 0), attachments, chunks };
  }

  private async attachmentBytes(id: string, metadata: VaultAttachment, offline: boolean, retried = false): Promise<ArrayBuffer> {
    const chunks: EncryptedAttachmentChunk[] = [];
    for (let index = 0; index < metadata.chunkCount; index++) {
      let chunk = this.store.chunk(id, index);
      if (!chunk) {
        if (offline) throw new ApplicationError("ATTACHMENT_NOT_CACHED", "Attachment is not available offline");
        const response = await this.transport.request(`/attachments/${id}/chunks/${index}`, {}, this.activeSignal);
        chunk = { attachmentId: id, chunkIndex: index, ciphertext: await response.arrayBuffer(), nonce: response.headers.get("X-WebMD-Nonce") ?? "",
          totalChunks: Number(response.headers.get("X-WebMD-Total-Chunks")), encryptionVersion: Number(response.headers.get("X-WebMD-Encryption-Version")) };
        if (chunk.ciphertext.byteLength > 1024 * 1024 + 16 || chunk.totalChunks !== metadata.chunkCount || chunk.encryptionVersion !== 1) throw new ApplicationError("INVALID_ATTACHMENT", "Invalid encrypted attachment chunk");
        this.store.putChunk(chunk);
      }
      chunks.push(chunk);
    }
    let bytes: ArrayBuffer;
    try { bytes = await decryptAttachmentBytes({ userId: this.bootstrap!.userId, attachmentId: id, metadata, chunks }); }
    catch {
      if (!offline && !retried) { this.store.removeChunks(id); return this.attachmentBytes(id, metadata, false, true); }
      throw new ApplicationError("INVALID_ATTACHMENT", "Attachment authentication failed");
    }
    if (detectImageMime(new Uint8Array(bytes)) !== metadata.mime) throw new ApplicationError("INVALID_ATTACHMENT", "Attachment image signature mismatch");
    return bytes;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    await this.queue;
    this.cipher?.dispose(); this.cipher = null;
    this.transport.dispose();
    this.options.applicationKey = "";
    this.store.close();
  }
}

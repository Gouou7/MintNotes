import { detectImageMime } from "./attachmentFormat";
import { MAX_ATTACHMENT_SIZE } from "./attachments";
import { markdownImages, type MarkdownImage } from "./markdownImages";
import { nameKey } from "./siblingNames";

export type ImportIssueCode = "unsafePath" | "archiveInvalid" | "fileLimit" | "manifestInvalid" | "missingImage" | "ambiguousImage" | "invalidImage" | "largeImage" | "invalidUrl" | "unmappedImage" | "writeFailed" | "cancelled";
export interface ImportIssue { source: string; code: ImportIssueCode; reference?: string }
export class ImportFailure extends Error {
  constructor(public readonly issue: ImportIssue) { super(issue.code); }
}
export interface ImportImage { key: string; file: File }
export interface ImportNote {
  source: string; title: string; parentKey: string | null; markdown: string;
  images: Map<MarkdownImage, ImportImage>;
}
export interface ImportFolder { key: string; source: string; title: string; parentKey: string | null }
export interface ImportPlan { folders: ImportFolder[]; notes: ImportNote[]; warnings: ImportIssue[] }
export interface ImportedItem { objectId: string; title: string }
export interface ImportHandlers {
  createFolder: (title: string, parentId: string | null) => Promise<ImportedItem>;
  createNote: (note: ImportNote, parentId: string | null) => Promise<ImportedItem>;
  isActive?: () => boolean;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}
export interface ImportCompletion extends ImportedItem { source: string; originalTitle: string; kind: "note" | "folder" }
export interface ImportResult {
  completed: ImportCompletion[]; warnings: ImportIssue[]; failure?: ImportIssue; pending: string[];
}
interface Entry { path: string; source: string; directory: boolean; size: number; read: () => Promise<Uint8Array> }

function requireActive(isActive: () => boolean) {
  if (!isActive()) throw new ImportFailure({ source: "", code: "cancelled" });
}
export function normalizeImportPath(raw: string): string {
  const path = raw.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\0") || path.split("/").includes("..")) {
    throw new ImportFailure({ source: raw, code: "unsafePath" });
  }
  return path.split("/").filter((part) => part && part !== ".").join("/");
}
function relativePath(notePath: string, url: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//") || url.startsWith("#")) return null;
  const decoded = decodeURIComponent(url.split(/[?#]/)[0]).replace(/\\/g, "/");
  if (decoded.startsWith("/") || /^[a-z]:/i.test(decoded) || decoded.includes("\0")) throw new Error("invalidUrl");
  const parts = notePath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") { if (!parts.length) throw new Error("invalidUrl"); parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export async function prepareImport(files: File[], isActive: () => boolean = () => true, signal?: AbortSignal): Promise<ImportPlan> {
  const plan: ImportPlan = { folders: [], notes: [], warnings: [] };
  const sources: Entry[][] = [];
  const closers: Array<() => Promise<void>> = [];
  let count = 0;
  try {
    // Enumerate every input before decrypting/creating any workspace object.
    for (const file of files) {
      requireActive(isActive);
      const entries: Entry[] = [];
      sources.push(entries);
      if (/\.zip$/i.test(file.name)) {
        try {
          // Native codecs are bundled locally; no Worker, WASM or runtime network source.
          const { ZipReader, BlobReader, Uint8ArrayWriter } = await import("@zip.js/zip.js/lib/zip-core-native.js");
          const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false, checkCrc32: true, strictness: "balanced", filenameValidation: "balanced", signal });
          closers.push(() => reader.close());
          for (const entry of await reader.getEntries()) {
            const path = normalizeImportPath(entry.filename);
            if (!entry.directory && ++count > 4000) throw new ImportFailure({ source: file.name, code: "fileLimit" });
            if (!path) continue;
            if (entry.encrypted || (!entry.directory && entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) throw new ImportFailure({ source: `${file.name}/${path}`, code: "archiveInvalid" });
            entries.push({ path, source: `${file.name}/${entry.filename}`, directory: entry.directory, size: entry.uncompressedSize,
              read: async () => {
                requireActive(isActive);
                if (entry.directory) return new Uint8Array();
                try { return await entry.getData(new Uint8ArrayWriter(), { checkCrc32: true, checkLocalDirectory: true, checkLocalFilename: true, useWebWorkers: false, signal }); }
                catch { throw new ImportFailure({ source: `${file.name}/${path}`, code: "archiveInvalid" }); }
              }
            });
          }
        } catch (error) {
          if (error instanceof ImportFailure) throw error;
          const unsafe = error instanceof Error && "filename" in error;
          throw new ImportFailure({ source: file.name, code: unsafe ? "unsafePath" : "archiveInvalid" });
        }
      } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
        if (++count > 4000) throw new ImportFailure({ source: file.name, code: "fileLimit" });
        entries.push({ path: file.name, source: file.name, directory: false, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) });
      }
    }
    for (const [sourceIndex, entries] of sources.entries()) {
      const byPath = new Map<string, Entry[]>();
      for (const entry of entries) if (!entry.directory) {
        const key = nameKey(entry.path);
        byPath.set(key, [...(byPath.get(key) ?? []), entry]);
      }
      const originalNames = new Map<string, string>();
      const manifests = byPath.get(nameKey("_export.json")) ?? [];
      if (manifests.length > 1) throw new ImportFailure({ source: manifests[0].source, code: "manifestInvalid" });
      if (manifests.length) {
        const entry = manifests[0];
        const bytes = await entry.read();
        try {
          const manifest = JSON.parse(new TextDecoder().decode(bytes));
          if (!manifest || typeof manifest !== "object" || manifest.format !== "webmd-markdown-export" || ![undefined, 1, 2].includes(manifest.version) || (manifest.attachments !== undefined && (!manifest.attachments || typeof manifest.attachments !== "object" || Array.isArray(manifest.attachments)))) throw new Error();
          for (const item of Object.values(manifest.attachments ?? {}) as Array<{ path: string; originalName: string }>) {
            if (!item || typeof item.path !== "string" || typeof item.originalName !== "string") throw new Error();
            originalNames.set(normalizeImportPath(item.path), item.originalName);
          }
        } catch { throw new ImportFailure({ source: entry.source, code: "manifestInvalid" }); }
      }
      const folders = new Map<string, string>();
      const ensureFolder = (path: string): string | null => {
        let parentKey: string | null = null;
        let accumulated = "";
        for (const title of path.split("/").filter(Boolean)) {
          accumulated = accumulated ? `${accumulated}/${title}` : title;
          // Exact paths describe directory identity; equivalent distinct paths receive distinct names later.
          let key = folders.get(accumulated);
          if (!key) {
            key = `${sourceIndex}:${accumulated}`;
            folders.set(accumulated, key);
            plan.folders.push({ key, title, parentKey, source: `${files[sourceIndex].name}/${accumulated}` });
          }
          parentKey = key;
        }
        return parentKey;
      };
      const resourceDirectories = new Set<string>();
      for (const path of originalNames.keys()) {
        const parts = path.split("/");
        parts.pop();
        while (parts.length) { resourceDirectories.add(parts.join("/")); parts.pop(); }
      }
      const isResourceDirectory = (path: string) => resourceDirectories.has(path)
        && !entries.some((entry) => !entry.directory && entry.path.startsWith(`${path}/`) && !originalNames.has(entry.path));
      for (const entry of entries) if (entry.directory && !isResourceDirectory(entry.path)) ensureFolder(entry.path);
      const imageCache = new Map<Entry, ImportImage | ImportIssueCode>();
      for (const entry of entries) {
        requireActive(isActive);
        if (entry.directory || !/\.(md|markdown|txt)$/i.test(entry.path)) continue;
        const parts = entry.path.split("/");
        const title = parts.pop()!.replace(/\.(md|markdown|txt)$/i, "");
        const note: ImportNote = { source: entry.source, title, parentKey: ensureFolder(parts.join("/")), markdown: new TextDecoder().decode(await entry.read()), images: new Map() };
        for (const reference of markdownImages(note.markdown)) {
          const warn = (code: ImportIssueCode) => plan.warnings.push({ source: entry.source, reference: reference.url, code });
          if (!reference.destination && !reference.definition) { warn("unmappedImage"); continue; }
          let path: string | null;
          try { path = relativePath(entry.path, reference.url); } catch { warn("invalidUrl"); continue; }
          if (path === null) continue;
          const candidates = byPath.get(nameKey(path)) ?? [];
          if (candidates.length !== 1) { warn(candidates.length ? "ambiguousImage" : "missingImage"); continue; }
          const image = candidates[0];
          let prepared = imageCache.get(image);
          if (!prepared) {
            if (image.size > MAX_ATTACHMENT_SIZE) prepared = "largeImage";
            else {
              const bytes = await image.read();
              if (bytes.byteLength > MAX_ATTACHMENT_SIZE) prepared = "largeImage";
              else if (!detectImageMime(bytes.subarray(0, 32))) prepared = "invalidImage";
              else prepared = { key: image.source + ":" + entries.indexOf(image), file: new File([Uint8Array.from(bytes)], originalNames.get(image.path) ?? image.path.split("/").pop()!, { type: "application/octet-stream" }) };
            }
            imageCache.set(image, prepared);
          }
          if (typeof prepared === "string") warn(prepared);
          else note.images.set(reference, prepared);
        }
        plan.notes.push(note);
      }
    }
    requireActive(isActive);
    return plan;
  } finally { await Promise.allSettled(closers.map((close) => close())); }
}

export async function commitImport(plan: ImportPlan, handlers: ImportHandlers): Promise<ImportResult> {
  const result: ImportResult = { completed: [], warnings: plan.warnings, pending: [] };
  const folders = new Map<string, string>();
  const jobs = [...plan.folders.map((folder) => ({ kind: "folder" as const, item: folder })), ...plan.notes.map((note) => ({ kind: "note" as const, item: note }))];
  for (const [index, job] of jobs.entries()) {
    try {
      requireActive(handlers.isActive ?? (() => true));
      const parentId = job.item.parentKey ? folders.get(job.item.parentKey)! : null;
      const created = job.kind === "folder" ? await handlers.createFolder(job.item.title, parentId) : await handlers.createNote(job.item, parentId);
      if (job.kind === "folder") folders.set(job.item.key, created.objectId);
      result.completed.push({ ...created, kind: job.kind, source: job.item.source, originalTitle: job.item.title });
      requireActive(handlers.isActive ?? (() => true));
      handlers.onProgress?.(index + 1, jobs.length);
    } catch (error) {
      result.failure = { source: job.item.source, code: error instanceof ImportFailure ? error.issue.code : error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "writeFailed" };
      result.pending = jobs.slice(index + (result.completed.length > index ? 1 : 0)).map((remaining) => remaining.item.source);
      break;
    }
  }
  return result;
}

export async function importFiles(files: File[], handlers: ImportHandlers): Promise<ImportResult> {
  return commitImport(await prepareImport(files, handlers.isActive, handlers.signal), handlers);
}

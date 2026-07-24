import type { OpenAttachment, OpenDocument } from "../types";
import { attachmentIdsIn, extensionForMime, MAX_ATTACHMENT_SIZE } from "./attachments";

export interface ImportHandlers {
  createFolder: (title: string, parentId: string | null) => Promise<string>;
  createNote: (title: string, markdown: string, parentId: string | null) => Promise<string>;
  attachImage: (noteId: string, file: File) => Promise<string>;
  updateNote: (noteId: string, markdown: string, attachmentIds: string[]) => Promise<void>;
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120) || "Untitled";
}

function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown|txt)$/i, "");
}

function normalizeZipPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function resolveRelative(baseFile: string, relative: string): string | null {
  if (/^[a-z]+:/i.test(relative) || relative.startsWith("//") || relative.startsWith("#")) return null;
  const base = baseFile.split("/").slice(0, -1).join("/");
  return normalizeZipPath(`${base}/${decodeURIComponent(relative.split(/[?#]/)[0])}`);
}

async function importEntries(
  entries: Map<string, Uint8Array>,
  directories: string[],
  handlers: ImportHandlers,
  originalNames: Map<string, string>
) {
  const folders = new Map<string, string>();
  const ensureFolder = async (path: string) => {
    let parentId: string | null = null;
    let accumulated = "";
    for (const part of path.split("/").filter(Boolean)) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      let folderId = folders.get(accumulated);
      if (!folderId) {
        folderId = await handlers.createFolder(part, parentId);
        folders.set(accumulated, folderId);
      }
      parentId = folderId;
    }
    return parentId;
  };

  for (const directory of directories.sort((a, b) => a.split("/").length - b.split("/").length)) await ensureFolder(directory);
  let noteCount = 0;
  for (const [path, bytes] of entries) {
    if (!/\.(md|markdown|txt)$/i.test(path)) continue;
    const parts = path.split("/");
    const fileName = parts.pop()!;
    const parentId = await ensureFolder(parts.join("/"));
    let markdown = new TextDecoder().decode(bytes);
    const noteId = await handlers.createNote(stripExtension(fileName), markdown, parentId);
    const attachmentIds: string[] = [];
    const replacements: Array<{ source: string; target: string }> = [];
    for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      const resolved = resolveRelative(path, match[2]);
      const image = resolved ? entries.get(resolved) : undefined;
      if (!resolved || !image || image.byteLength > MAX_ATTACHMENT_SIZE) continue;
      const file = new File([Uint8Array.from(image)], originalNames.get(resolved) ?? resolved.split("/").pop() ?? "image", { type: "application/octet-stream" });
      const attachmentId = await handlers.attachImage(noteId, file);
      attachmentIds.push(attachmentId);
      replacements.push({ source: match[2], target: `webmd-attachment:${attachmentId}` });
    }
    for (const replacement of replacements) markdown = markdown.split(replacement.source).join(replacement.target);
    if (replacements.length) await handlers.updateNote(noteId, markdown, attachmentIds);
    noteCount += 1;
  }
  return noteCount;
}

export async function importFiles(files: File[], handlers: ImportHandlers) {
  const entries = new Map<string, Uint8Array>();
  const caseFoldedPaths = new Set<string>();
  const directories: string[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(file);
      for (const [rawPath, entry] of Object.entries(zip.files)) {
        const path = normalizeZipPath(rawPath);
        if (!path || path.startsWith(".")) continue;
        if (entry.dir) {
          directories.push(path);
          continue;
        }
        if (entries.size >= 4000) throw new Error("An import can contain at most 4,000 files");
        const bytes = await entry.async("uint8array");
        if (caseFoldedPaths.has(path.toLowerCase())) throw new Error(`Duplicate ZIP path: ${path}`);
        caseFoldedPaths.add(path.toLowerCase());
        entries.set(path, bytes);
      }
    } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
      entries.set(file.name, new Uint8Array(await file.arrayBuffer()));
    }
  }
  const originalNames = new Map<string, string>();
  const manifestBytes = entries.get("_export.json");
  if (manifestBytes) {
    try {
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { format?: string; attachments?: Record<string, { path?: string; originalName?: string }> };
      if (manifest.format === "webmd-markdown-export") {
        for (const entry of Object.values(manifest.attachments ?? {})) if (entry.path && entry.originalName) originalNames.set(entry.path, entry.originalName);
      }
    } catch {
      throw new Error("_export.json is not valid JSON");
    }
  }
  return importEntries(entries, directories, handlers, originalNames);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function relativeAttachmentPath(notePath: string, attachmentPath: string): string {
  const depth = notePath.split("/").length - 1;
  return `${depth ? "../".repeat(depth) : "./"}${attachmentPath}`;
}

export function exportSingleMarkdown(document: OpenDocument) {
  download(new Blob([document.markdown], { type: "text/markdown;charset=utf-8" }), `${safeName(document.title)}.md`);
}

export async function exportMarkdownZip(
  documents: OpenDocument[],
  attachments: OpenAttachment[],
  getAttachment: (attachment: OpenAttachment) => Promise<Blob>,
  rootId: string | string[] | null = null
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const rootIds = Array.isArray(rootId) ? rootId : rootId ? [rootId] : [];
  const exportingTrash = rootIds.length > 0 && rootIds.every((id) => documents.find((item) => item.objectId === id)?.deleted);
  const active = documents.filter((item) => item.deleted === exportingTrash);
  const byId = new Map(active.map((item) => [item.objectId, item]));
  const includedIds = new Set<string>();
  if (rootIds.length) {
    for (const id of rootIds) includedIds.add(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of active) if (item.parentId && includedIds.has(item.parentId) && !includedIds.has(item.objectId)) { includedIds.add(item.objectId); changed = true; }
    }
  } else {
    for (const item of active) includedIds.add(item.objectId);
  }
  const root = rootIds.length === 1 ? byId.get(rootIds[0]) : undefined;
  const pathCache = new Map<string, string>();
  const segmentCache = new Map<string, string>();
  const segmentFor = (document: OpenDocument): string => {
    const cached = segmentCache.get(document.objectId);
    if (cached) return cached;
    const base = safeName(document.title);
    const collisions = active
      .filter((entry) => entry.parentId === document.parentId && safeName(entry.title).toLowerCase() === base.toLowerCase())
      .sort((a, b) => a.objectId.localeCompare(b.objectId));
    const index = collisions.findIndex((entry) => entry.objectId === document.objectId);
    const segment = index > 0 ? `${base} (${index + 1})` : base;
    segmentCache.set(document.objectId, segment);
    return segment;
  };
  const pathFor = (document: OpenDocument): string => {
    const cached = pathCache.get(document.objectId);
    if (cached) return cached;
    const segments = [segmentFor(document)];
    let parentId = document.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (root && parent.objectId === root.parentId) break;
      segments.unshift(segmentFor(parent));
      parentId = parent.parentId;
    }
    const path = segments.join("/");
    pathCache.set(document.objectId, path);
    return path;
  };
  for (const folder of active.filter((item) => item.kind === "folder" && includedIds.has(item.objectId))) zip.folder(pathFor(folder));
  const attachmentById = new Map(attachments.filter((item) => item.deleted === exportingTrash).map((item) => [item.objectId, item]));
  const exportedAttachments = new Map<string, { path: string; originalName: string; ownerNoteId: string }>();
  const usedPaths = new Set<string>();
  for (const document of active.filter((item) => item.kind === "note" && includedIds.has(item.objectId))) {
    let markdown = document.markdown;
    const notePath = `${pathFor(document)}.md`;
    for (const attachmentId of attachmentIdsIn(markdown)) {
      const attachment = attachmentById.get(attachmentId);
      if (!attachment) throw new Error(`笔记“${document.title}”缺少附件 ${attachmentId}`);
      let exported = exportedAttachments.get(attachmentId);
      if (!exported) {
        const path = `_attachments/${attachmentId}.${extensionForMime(attachment.mime)}`;
        zip.file(path, await getAttachment(attachment));
        exported = { path, originalName: attachment.originalName, ownerNoteId: attachment.ownerNoteId };
        exportedAttachments.set(attachmentId, exported);
      }
      markdown = markdown.split(`webmd-attachment:${attachmentId}`).join(relativeAttachmentPath(notePath, exported.path));
    }
    let uniquePath = notePath;
    let suffix = 2;
    while (usedPaths.has(uniquePath.toLowerCase())) uniquePath = notePath.replace(/\.md$/i, ` (${suffix++}).md`);
    usedPaths.add(uniquePath.toLowerCase());
    zip.file(uniquePath, markdown);
  }
  zip.file("_export.json", JSON.stringify({
    format: "webmd-markdown-export",
    version: 2,
    createdAt: new Date().toISOString(),
    noteCount: usedPaths.size,
    attachments: Object.fromEntries(exportedAttachments)
  }, null, 2));
  const label = root ? safeName(root.title) : `${rootIds.length ? "mint-notes-selection" : "mint-notes"}-${new Date().toISOString().slice(0, 10)}`;
  download(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `${label}.zip`);
}

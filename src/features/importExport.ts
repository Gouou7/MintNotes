import type { OpenAttachment, OpenDocument } from "../types";
import { extensionForMime } from "./attachmentFormat";
import { imageAttachmentId, markdownImages, rewriteMarkdownImages } from "./markdownImages";
import { nameKey } from "./siblingNames";
export { importFiles } from "./importPlan";
export type { ImportHandlers, ImportResult } from "./importPlan";

function safeName(value: string): string {
  const name = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120).replace(/[. ]+$/g, "") || "Untitled";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
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
  rootId: string | string[] | null = null,
  isActive: () => boolean = () => true
) {
  const checkActive = () => { if (!isActive()) throw new DOMException("Export cancelled", "AbortError"); };
  checkActive();
  const { default: JSZip } = await import("jszip");
  checkActive();
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
  const needed = new Map(active.filter((item) => includedIds.has(item.objectId)).map((item) => [item.objectId, item]));
  for (const item of [...needed.values()]) {
    let parentId = item.parentId;
    const seen = new Set<string>();
    while (parentId && parentId !== root?.parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      needed.set(parentId, parent);
      parentId = parent.parentId;
    }
  }
  const paths = new Map<string, string>();
  const children = new Map<string | null, OpenDocument[]>();
  for (const item of needed.values()) {
    const parent = item.parentId && needed.has(item.parentId) && item.objectId !== root?.objectId ? item.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const assign = (parentId: string | null, prefix: string) => {
    const siblings = (children.get(parentId) ?? []).sort((a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0);
    const baseFor = (item: OpenDocument) => safeName(item.title) + (item.kind === "note" ? ".md" : "");
    const reserved = new Set(prefix ? [] : [nameKey("_attachments"), nameKey("_export.json")]);
    const occupied = new Set([...reserved, ...siblings.map((item) => nameKey(baseFor(item)))]);
    const assigned = new Set(reserved);
    for (const item of siblings) {
      const base = safeName(item.title);
      const extension = item.kind === "note" ? ".md" : "";
      let segment = base + extension;
      if (assigned.has(nameKey(segment))) {
        let suffix = 2;
        do { segment = `${base} (${suffix++})${extension}`; } while (occupied.has(nameKey(segment)));
      }
      occupied.add(nameKey(segment));
      assigned.add(nameKey(segment));
      paths.set(item.objectId, prefix + segment);
    }
    for (const item of siblings) if (item.kind === "folder") assign(item.objectId, `${paths.get(item.objectId)}/`);
  };
  assign(null, "");
  const pathFor = (item: OpenDocument) => {
    const path = paths.get(item.objectId);
    if (!path) throw new Error("Invalid export directory graph");
    return path;
  };
  for (const folder of active.filter((item) => item.kind === "folder" && includedIds.has(item.objectId))) zip.folder(pathFor(folder));
  const attachmentById = new Map(attachments.filter((item) => item.deleted === exportingTrash).map((item) => [item.objectId, item]));
  const exportedAttachments = new Map<string, { path: string; originalName: string; ownerNoteId: string }>();
  const usedPaths = new Set<string>();
  for (const document of active.filter((item) => item.kind === "note" && includedIds.has(item.objectId))) {
    let markdown = document.markdown;
    const notePath = pathFor(document);
    const replacements = new Map<ReturnType<typeof markdownImages>[number], string>();
    for (const image of markdownImages(markdown)) {
      const attachmentId = imageAttachmentId(image.url);
      if (!attachmentId) continue;
      if (!image.destination && !image.definition) throw new Error("Unmapped attachment reference");
      const attachment = attachmentById.get(attachmentId);
      if (!attachment) throw new Error(`笔记“${document.title}”缺少附件 ${attachmentId}`);
      let exported = exportedAttachments.get(attachmentId);
      if (!exported) {
        const path = `_attachments/${attachmentId}.${extensionForMime(attachment.mime)}`;
        const bytes = await getAttachment(attachment);
        checkActive();
        zip.file(path, bytes);
        exported = { path, originalName: attachment.originalName, ownerNoteId: attachment.ownerNoteId };
        exportedAttachments.set(attachmentId, exported);
      }
      replacements.set(image, relativeAttachmentPath(notePath, exported.path));
    }
    markdown = rewriteMarkdownImages(markdown, replacements);
    usedPaths.add(notePath);
    zip.file(notePath, markdown);
  }
  zip.file("_export.json", JSON.stringify({
    format: "webmd-markdown-export",
    version: 2,
    createdAt: new Date().toISOString(),
    noteCount: usedPaths.size,
    attachments: Object.fromEntries(exportedAttachments)
  }, null, 2));
  const label = root ? safeName(root.title) : `${rootIds.length ? "mint-notes-selection" : "mint-notes"}-${new Date().toISOString().slice(0, 10)}`;
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  checkActive();
  download(blob, `${label}.zip`);
}

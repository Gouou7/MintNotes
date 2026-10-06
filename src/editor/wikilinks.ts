import type { OpenDocument } from "../types";

export interface WikiLinkTarget {
  note: string;
  heading: string;
}

export function parseWikiLinkTarget(target: string): WikiLinkTarget {
  const hash = target.indexOf("#");
  const rawNote = (hash >= 0 ? target.slice(0, hash) : target).trim();
  return {
    note: rawNote.replace(/\.md$/i, "").replace(/^\.?\//, ""),
    heading: hash >= 0 ? target.slice(hash + 1).trim() : ""
  };
}

export function resolveWikiLink(
  documents: OpenDocument[],
  target: string,
  currentDocument?: OpenDocument | null
): OpenDocument | null {
  const { note } = parseWikiLinkTarget(target);
  if (!note) return currentDocument?.kind === "note" && !currentDocument.deleted ? currentDocument : null;
  const segments = note.split(/[\\/]/).map((segment) => segment.trim()).filter(Boolean);
  const liveDocuments = documents.filter((document) => !document.deleted);
  const sameName = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

  if (segments.length > 1) {
    let parentId: string | null = null;
    for (let index = 0; index < segments.length; index += 1) {
      const kind = index === segments.length - 1 ? "note" : "folder";
      const match = liveDocuments.find((document) => (
        document.kind === kind
        && document.parentId === parentId
        && sameName(document.title, segments[index])
      ));
      if (!match) return null;
      parentId = match.objectId;
      if (kind === "note") return match;
    }
  }

  const candidates = liveDocuments.filter((document) => document.kind === "note" && sameName(document.title, note));
  return candidates.find((document) => document.parentId === currentDocument?.parentId)
    ?? candidates[0]
    ?? null;
}

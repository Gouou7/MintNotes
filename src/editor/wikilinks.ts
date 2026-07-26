import type { OpenDocument } from "../types";

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
}

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

function wikiLinkNodes(value: string): MdNode[] | null {
  const pattern = /(!?)\[\[([^\]\n]+)\]\]/g;
  const output: MdNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match[1]) continue;
    if (match.index > cursor) output.push({ type: "text", value: value.slice(cursor, match.index) });
    const parts = match[2].split("|");
    const target = (parts.shift() ?? "").trim();
    const label = parts.join("|").trim() || target;
    if (!target) continue;
    output.push({
      type: "link",
      url: `mint-wikilink:${encodeURIComponent(target)}`,
      children: [{ type: "text", value: label }],
      data: {
        hProperties: {
          className: "wiki-link",
          "data-wikilink-target": target
        }
      }
    });
    cursor = match.index + match[0].length;
  }

  if (!output.length) return null;
  if (cursor < value.length) output.push({ type: "text", value: value.slice(cursor) });
  return output;
}

function transformWikiLinks(node: MdNode) {
  if (!node.children || node.type === "link" || node.type === "code" || node.type === "inlineCode") return;
  const children: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      children.push(...(wikiLinkNodes(child.value) ?? [child]));
    } else {
      transformWikiLinks(child);
      children.push(child);
    }
  }
  node.children = children;
}

export function remarkWikiLinks() {
  return (tree: MdNode) => transformWikiLinks(tree);
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

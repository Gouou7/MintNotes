import type { Node as PMNode } from "prosemirror-model";

import {
  SOURCE_FINGERPRINT_ATTR,
  SOURCE_FROM_ATTR,
  SOURCE_TEXT_ATTR,
  SOURCE_TO_ATTR,
} from "./source";

const PRESENTATION_ATTRS = new Set([
  SOURCE_FROM_ATTR,
  SOURCE_TO_ATTR,
  SOURCE_TEXT_ATTR,
  SOURCE_FINGERPRINT_ATTR,
  "sourceEditing",
]);

function sourceShape(node: PMNode): unknown {
  if (node.isText) return { type: "text", text: node.text ?? "" };
  const attrs = Object.fromEntries(
    Object.entries(node.attrs)
      .filter(([name]) => !PRESENTATION_ATTRS.has(name))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const content: unknown[] = [];
  node.forEach((child) => content.push(sourceShape(child)));
  return {
    type: node.type.name,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(content.length > 0 ? { content } : {}),
  };
}

/** Stable semantic snapshot used only to decide whether authored source can be emitted verbatim. */
export function sourceFingerprint(node: PMNode): string {
  return JSON.stringify(sourceShape(node));
}

export function unchangedAuthoredSource(node: PMNode): string | null {
  const source = node.attrs[SOURCE_TEXT_ATTR];
  const fingerprint = node.attrs[SOURCE_FINGERPRINT_ATTR];
  if (typeof source !== "string" || typeof fingerprint !== "string") return null;
  return sourceFingerprint(node) === fingerprint ? source : null;
}

/** Exact source projection used only for safe history recovery. */
export function authoredDocumentSource(doc: PMNode): string | null {
  let source = "";
  let complete = true;
  doc.forEach((node) => {
    const authored = unchangedAuthoredSource(node);
    if (authored === null) complete = false;
    else source += authored;
  });
  return complete ? source : null;
}

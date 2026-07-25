import type { OpenDocument } from "../types";

export function documentPatchChanges(document: OpenDocument, patch: Partial<OpenDocument>): boolean {
  return (Object.keys(patch) as (keyof OpenDocument)[]).some((key) => {
    const current = document[key];
    const next = patch[key];
    if (Array.isArray(current) && Array.isArray(next)) {
      return current.length !== next.length || current.some((value, index) => value !== next[index]);
    }
    return current !== next;
  });
}

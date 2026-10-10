import type { OpenDocument } from "./types.js";

export function nameKey(title: string): string {
  return title.trim().normalize("NFC").toLowerCase().normalize("NFC");
}

export function allocateName(title: string, occupied: Set<string>): string {
  const base = title.trim() || "Untitled";
  let candidate = base;
  for (let suffix = 2; occupied.has(nameKey(candidate)); suffix += 1) candidate = `${base} ${suffix}`;
  occupied.add(nameKey(candidate));
  return candidate;
}

export function siblingTitleExists(documents: readonly OpenDocument[], title: string, parentId: string | null, exceptObjectId?: string): boolean {
  const key = nameKey(title);
  return documents.some((entry) => !entry.deleted && entry.parentId === parentId && entry.objectId !== exceptObjectId && nameKey(entry.title) === key);
}

export function uniqueSiblingTitle(documents: readonly OpenDocument[], title: string, parentId: string | null): string {
  return allocateName(title, new Set(documents.filter((entry) => !entry.deleted && entry.parentId === parentId).map((entry) => nameKey(entry.title))));
}

export interface NameRepair { objectId: string; previousTitle: string; title: string }

/** Reserve all authored names before assigning suffixes; never use device time. */
export function siblingNameRepairs(documents: readonly OpenDocument[]): NameRepair[] {
  const parents = new Map<string | null, OpenDocument[]>();
  for (const document of documents) {
    if (document.deleted) continue;
    const siblings = parents.get(document.parentId) ?? [];
    siblings.push(document);
    parents.set(document.parentId, siblings);
  }
  const repairs: NameRepair[] = [];
  for (const siblings of parents.values()) {
    const occupied = new Set(siblings.map((entry) => nameKey(entry.title)));
    const seen = new Set<string>();
    for (const entry of siblings.sort((a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0)) {
      const key = nameKey(entry.title);
      if (seen.has(key)) repairs.push({ objectId: entry.objectId, previousTitle: entry.title, title: allocateName(entry.title, occupied) });
      seen.add(key);
    }
  }
  return repairs;
}

/** Includes objects prepared asynchronously but not published in the workspace yet. */
export class NameReservations {
  private readonly pending = new Map<string, OpenDocument>();
  reserve(documents: readonly OpenDocument[], document: OpenDocument): OpenDocument {
    const others = [...documents, ...this.pending.values()].filter((entry) => entry.objectId !== document.objectId);
    const reserved = { ...document, title: uniqueSiblingTitle(others, document.title, document.parentId) };
    this.pending.set(document.objectId, reserved);
    return reserved;
  }
  claim(documents: readonly OpenDocument[], proposed: readonly OpenDocument[]): OpenDocument | undefined {
    const conflict = batchNameConflict([...documents, ...this.pending.values()], proposed);
    if (!conflict) for (const document of proposed) this.pending.set(document.objectId, document);
    return conflict;
  }
  release(objectId: string): void { this.pending.delete(objectId); }
  documents(): OpenDocument[] { return [...this.pending.values()]; }
}

/** Checks a proposed batch against both the existing namespace and its own siblings. */
export function batchNameConflict(documents: readonly OpenDocument[], proposed: readonly OpenDocument[]): OpenDocument | undefined {
  const ids = new Set(proposed.map((entry) => entry.objectId));
  const occupied = documents.filter((entry) => !ids.has(entry.objectId));
  for (const entry of proposed) {
    if (entry.deleted) continue;
    if (siblingTitleExists(occupied, entry.title, entry.parentId)) return entry;
    occupied.push(entry);
  }
  return undefined;
}

export function nextManualOrder(documents: OpenDocument[], parentId: string | null): number {
  const orders = documents.filter((entry) => entry.parentId === parentId && !entry.deleted).map((entry) => entry.manualOrder);
  return (orders.length ? Math.max(...orders) : 0) + 1024;
}

import type { Node as PMNode } from "prosemirror-model";

import { SOURCE_FROM_ATTR, SOURCE_TO_ATTR, type SourceOffset } from "./source";

export type PositionAffinity = "left" | "right";

function numericAttr(node: PMNode, name: string): number | null {
  const value = node.attrs[name];
  return Number.isInteger(value) && value >= 0 ? value as number : null;
}

function choose(candidates: readonly number[], affinity: PositionAffinity): number {
  return affinity === "left" ? Math.min(...candidates) : Math.max(...candidates);
}

/** Explicit canonical-source-boundary ↔ ProseMirror-position map. */
export class SourcePositionMap {
  private readonly sourceBoundaries: Array<number[]>;
  private readonly documentPositions: Array<number[]>;

  private constructor(
    readonly sourceLength: number,
    readonly documentSize: number,
  ) {
    this.sourceBoundaries = Array.from({ length: sourceLength + 1 }, () => []);
    this.documentPositions = Array.from({ length: documentSize + 1 }, () => []);
  }

  static fromDocument(doc: PMNode, source: string): SourcePositionMap {
    const map = new SourcePositionMap(source.length, doc.content.size);
    doc.descendants((node, position) => {
      const from = numericAttr(node, SOURCE_FROM_ATTR);
      const to = numericAttr(node, SOURCE_TO_ATTR);
      if (from === null || to === null) return true;
      const start = position + 1;
      if (node.type.name === "source_gap") {
        let offset = from;
        node.forEach((child, relative) => {
          const text = child.isText ? child.text ?? "" : String(child.attrs.character ?? "");
          for (let i = 0; i <= text.length; i++) map.add(offset + i, start + relative + i);
          offset += text.length;
        });
        return false;
      }
      if (node.isTextblock) {
        // Text projections carry their own source range. Never locate repeated
        // rendered text by searching the Markdown or infer missing delimiters.
        const text = node.textContent;
        if (node.content.size === text.length && source.slice(from, from + text.length) === text) {
          for (let i = 0; i <= text.length; i++) map.add(from + i, start + i);
        }
        return false;
      }
      return true;
    });
    if (!source && doc.firstChild?.isTextblock) map.add(0, 1);
    return map;
  }

  hasExactDocumentBoundary(position: number): boolean {
    return (this.documentPositions[position]?.length ?? 0) > 0;
  }

  /** Whether this authored boundary owns a concrete Live document position. */
  hasExactSourceBoundary(sourceOffset: SourceOffset): boolean {
    const offset = Math.max(0, Math.min(sourceOffset, this.sourceLength));
    return this.sourceBoundaries[offset]!.length > 0;
  }

  private add(sourceOffset: number, documentPosition: number): void {
    if (
      sourceOffset < 0
      || sourceOffset > this.sourceLength
      || documentPosition < 0
      || documentPosition > this.documentSize
    ) return;
    const sourceCandidates = this.sourceBoundaries[sourceOffset]!;
    if (!sourceCandidates.includes(documentPosition)) sourceCandidates.push(documentPosition);
    const documentCandidates = this.documentPositions[documentPosition]!;
    if (!documentCandidates.includes(sourceOffset)) documentCandidates.push(sourceOffset);
  }

  sourceToDocument(
    sourceOffset: SourceOffset,
    affinity: PositionAffinity = "left",
  ): number {
    const offset = Math.max(0, Math.min(sourceOffset, this.sourceLength));
    const exact = this.sourceBoundaries[offset]!;
    if (exact.length > 0) return choose(exact, affinity);
    if (affinity === "left") {
      for (let index = offset - 1; index >= 0; index -= 1) {
        const candidates = this.sourceBoundaries[index]!;
        if (candidates.length > 0) return Math.max(...candidates);
      }
      for (let index = offset + 1; index <= this.sourceLength; index += 1) {
        const candidates = this.sourceBoundaries[index]!;
        if (candidates.length > 0) return Math.min(...candidates);
      }
    } else {
      for (let index = offset + 1; index <= this.sourceLength; index += 1) {
        const candidates = this.sourceBoundaries[index]!;
        if (candidates.length > 0) return Math.min(...candidates);
      }
      for (let index = offset - 1; index >= 0; index -= 1) {
        const candidates = this.sourceBoundaries[index]!;
        if (candidates.length > 0) return Math.max(...candidates);
      }
    }
    return 0;
  }

  documentToSource(
    documentPosition: number,
    affinity: PositionAffinity = "left",
  ): SourceOffset {
    const position = Math.max(0, Math.min(documentPosition, this.documentSize));
    const exact = this.documentPositions[position]!;
    if (exact.length > 0) return choose(exact, affinity);
    if (affinity === "left") {
      for (let index = position - 1; index >= 0; index -= 1) {
        const candidates = this.documentPositions[index]!;
        if (candidates.length > 0) return Math.max(...candidates);
      }
      for (let index = position + 1; index <= this.documentSize; index += 1) {
        const candidates = this.documentPositions[index]!;
        if (candidates.length > 0) return Math.min(...candidates);
      }
    } else {
      for (let index = position + 1; index <= this.documentSize; index += 1) {
        const candidates = this.documentPositions[index]!;
        if (candidates.length > 0) return Math.min(...candidates);
      }
      for (let index = position - 1; index >= 0; index -= 1) {
        const candidates = this.documentPositions[index]!;
        if (candidates.length > 0) return Math.max(...candidates);
      }
    }
    return 0;
  }
}

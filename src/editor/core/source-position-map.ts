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
    let topLevelPosition = 0;
    doc.forEach((node) => {
      const from = numericAttr(node, SOURCE_FROM_ATTR);
      let to = numericAttr(node, SOURCE_TO_ATTR);
      if (
        from !== null
        && ["paragraph", "source_gap", "source_block", "blockquote", "code_block"].includes(node.type.name)
        && source.slice(from, from + node.textContent.length) === node.textContent
      ) {
        to = from + node.textContent.length;
      }
      if (from !== null && to !== null && from <= to && to <= source.length) {
        const contentFrom = topLevelPosition + 1;
        const contentTo = contentFrom + node.content.size;
        map.add(from, contentFrom);
        map.add(to, contentTo);

        const ownedSource = source.slice(from, to);
        let searchOffset = 0;
        node.descendants((child, relativePosition) => {
          if (!child.isText) return;
          const text = child.text ?? "";
          const found = ownedSource.indexOf(text, searchOffset);
          if (found < 0) return;
          const sourceStart = from + found;
          const documentStart = contentFrom + relativePosition;
          for (let index = 0; index <= text.length; index += 1) {
            map.add(sourceStart + index, documentStart + index);
          }
          searchOffset = found + text.length;
        });
      }
      topLevelPosition += node.nodeSize;
    });
    map.add(0, Math.min(1, doc.content.size));
    map.add(source.length, Math.max(0, doc.content.size - 1));
    return map;
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

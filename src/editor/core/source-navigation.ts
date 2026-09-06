import type { Node as PMNode } from "prosemirror-model";
import { Plugin, Selection, TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";

import { SOURCE_BLOCK_PRESENTATION_META } from "./extension";
import { SOURCE_FROM_ATTR, SOURCE_TEXT_ATTR, SOURCE_TO_ATTR } from "./source";

export const LIVE_NAVIGATION_META = "live-source-navigation";
export const LIVE_POINTER_SELECTION_META = "live-pointer-selection";
export const LIVE_PRESENTATION_SYNC_META = "live-presentation-sync";

export interface LiveNavigationIntent {
  readonly anchor?: number;
  readonly head?: number;
  readonly direction?: -1 | 1;
  readonly scroll?: boolean;
}

export function markLiveNavigation<T extends Transaction>(
  transaction: T,
  intent: LiveNavigationIntent = {},
): T {
  transaction.setMeta(LIVE_NAVIGATION_META, intent);
  return transaction;
}

export function selectionOutsideBlock(
  state: EditorState,
  blockPos: number,
  block: PMNode,
  direction: -1 | 1,
): Selection | null {
  const boundary = direction < 0 ? blockPos : blockPos + block.nodeSize;
  const $boundary = state.doc.resolve(boundary);
  const adjacent = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
  const outsideStart = adjacent?.type.name === "source_gap"
    ? adjacent.attrs.structuralOnly
      ? boundary + direction * (adjacent.nodeSize + 1)
      : boundary + direction * Math.min(2, adjacent.nodeSize - 1)
    : boundary + direction;
  if (outsideStart < 0 || outsideStart > state.doc.content.size) return null;
  return Selection.findFrom(state.doc.resolve(outsideStart), direction, true);
}

function sourceLines(source: string): Array<{ from: number; to: number }> {
  const lines: Array<{ from: number; to: number }> = [];
  let from = 0;
  for (const ending of source.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ from, to: ending.index });
    from = ending.index + ending[0].length;
  }
  lines.push({ from, to: source.length });
  return lines;
}

export function verticalSourceOffset(
  source: string,
  offset: number,
  direction: -1 | 1,
): number | null {
  const lines = sourceLines(source);
  let lineIndex = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.from > offset) break;
    lineIndex = index;
  }
  const target = lines[lineIndex + direction];
  if (!target) return null;
  const line = lines[lineIndex]!;
  const column = Math.max(0, Math.min(offset - line.from, line.to - line.from));
  return target.from + Math.min(column, target.to - target.from);
}

function adjacentSourceGap(
  state: EditorState,
  direction: -1 | 1,
): { gap: PMNode; gapPos: number; offset: number } | null {
  const { selection } = state;
  if (!selection.empty || selection.$from.depth !== 1) return null;
  const block = selection.$from.parent;
  const atBoundary = direction < 0
    ? selection.$from.parentOffset === 0
    : selection.$from.parentOffset === block.content.size;
  if (!atBoundary) return null;
  const blockPos = selection.$from.before();
  if (direction > 0) {
    const gapPos = blockPos + block.nodeSize;
    const gap = state.doc.nodeAt(gapPos);
    return gap?.type.name === "source_gap"
      ? { gap, gapPos, offset: 0 }
      : null;
  }
  const gap = state.doc.resolve(blockPos).nodeBefore;
  return gap?.type.name === "source_gap"
    ? { gap, gapPos: blockPos - gap.nodeSize, offset: gap.content.size }
    : null;
}

export function sourceGapNavigationPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        const { state } = view;
        const { selection } = state;
        const direction = event.key === "ArrowUp" ? -1 : 1;
        if (!selection.empty) return false;
        const currentGap = selection.$from.parent.type.name === "source_gap"
          ? {
              gap: selection.$from.parent,
              gapPos: selection.$from.before(),
              offset: selection.$from.parentOffset,
            }
          : adjacentSourceGap(state, direction);
        if (!currentGap) return false;
        const { gap, gapPos, offset } = currentGap;
        const source = String(gap.attrs[SOURCE_TEXT_ATTR] ?? "");
        const targetOffset = verticalSourceOffset(source, offset, direction);

        if (
          !gap.attrs.structuralOnly
          && targetOffset !== null
        ) {
          const sourceFrom = Number(gap.attrs[SOURCE_FROM_ATTR]);
          const targetSource = Number.isInteger(sourceFrom) ? sourceFrom + targetOffset : undefined;
          view.dispatch(
            markLiveNavigation(state.tr
              .setSelection(TextSelection.create(state.doc, gapPos + 1 + targetOffset))
              .setMeta(SOURCE_BLOCK_PRESENTATION_META, true), {
              ...(targetSource !== undefined ? { anchor: targetSource, head: targetSource } : {}),
              direction,
              scroll: true,
            }),
          );
          return true;
        }

        const outside = selectionOutsideBlock(state, gapPos, gap, direction);
        if (!outside) return false;
        const sourceBoundary = Number(gap.attrs[
          direction < 0 ? SOURCE_FROM_ATTR : SOURCE_TO_ATTR
        ]);
        view.dispatch(
          markLiveNavigation(state.tr
            .setSelection(outside)
            .setMeta(SOURCE_BLOCK_PRESENTATION_META, true), {
            ...(Number.isInteger(sourceBoundary)
              ? { anchor: sourceBoundary, head: sourceBoundary }
              : {}),
            direction,
            scroll: true,
          }),
        );
        return true;
      },
    },
  });
}

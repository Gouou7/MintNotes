import type { Node as PMNode } from "prosemirror-model";
import { Plugin, Selection, TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";

import { SOURCE_BLOCK_PRESENTATION_META } from "./extension";
import { SOURCE_TEXT_ATTR } from "./source";

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

export function sourceGapNavigationPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        const { state } = view;
        const { selection } = state;
        const gap = selection.$from.parent;
        if (!selection.empty || gap.type.name !== "source_gap") return false;

        const direction = event.key === "ArrowUp" ? -1 : 1;
        const source = String(gap.attrs[SOURCE_TEXT_ATTR] ?? "");
        const lines = sourceLines(source);
        const offset = selection.$from.parentOffset;
        let lineIndex = 0;
        for (let index = 1; index < lines.length; index += 1) {
          if (lines[index]!.from > offset) break;
          lineIndex = index;
        }
        const targetIndex = lineIndex + direction;
        const gapPos = selection.$from.before();

        if (
          !gap.attrs.structuralOnly
          && lines.length >= 3
          && targetIndex > 0
          && targetIndex < lines.length - 1
        ) {
          const line = lines[lineIndex]!;
          const target = lines[targetIndex]!;
          const column = Math.max(0, Math.min(offset - line.from, line.to - line.from));
          const targetOffset = target.from + Math.min(column, target.to - target.from);
          view.dispatch(
            state.tr
              .setSelection(TextSelection.create(state.doc, gapPos + 1 + targetOffset))
              .setMeta(SOURCE_BLOCK_PRESENTATION_META, true)
              .scrollIntoView(),
          );
          return true;
        }

        const outside = selectionOutsideBlock(state, gapPos, gap, direction);
        if (!outside) return false;
        view.dispatch(
          state.tr
            .setSelection(outside)
            .setMeta(SOURCE_BLOCK_PRESENTATION_META, true)
            .scrollIntoView(),
        );
        return true;
      },
    },
  });
}

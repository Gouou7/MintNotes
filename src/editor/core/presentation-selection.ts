import { Plugin, PluginKey, type EditorState } from "prosemirror-state";

import { LIVE_POINTER_SELECTION_META } from "./source-navigation";

export interface PresentationSelection {
  readonly anchor: number;
  readonly head: number;
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
}

const presentationSelectionKey = new PluginKey<PresentationSelection>(
  "livePresentationSelection",
);

function snapshot(anchor: number, head: number): PresentationSelection {
  return {
    anchor,
    head,
    from: Math.min(anchor, head),
    to: Math.max(anchor, head),
    empty: anchor === head,
  };
}

function fromState(state: EditorState): PresentationSelection {
  return snapshot(state.selection.anchor, state.selection.head);
}

/**
 * Keeps transient pointer-drag selections out of the rendered presentation.
 * The real ProseMirror selection remains current for native selection and copy;
 * renderers consume this committed snapshot and update together on mouse release.
 */
export function livePresentationSelectionPlugin(): Plugin<PresentationSelection> {
  return new Plugin<PresentationSelection>({
    key: presentationSelectionKey,
    state: {
      init: (_, state) => fromState(state),
      apply(transaction, previous, _oldState, newState) {
        if (!transaction.getMeta(LIVE_POINTER_SELECTION_META)) return fromState(newState);
        if (!transaction.docChanged) return previous;
        return snapshot(
          transaction.mapping.map(previous.anchor, previous.anchor <= previous.head ? -1 : 1),
          transaction.mapping.map(previous.head, previous.anchor <= previous.head ? 1 : -1),
        );
      },
    },
  });
}

export function presentationSelection(state: EditorState): PresentationSelection {
  return presentationSelectionKey.getState(state) ?? fromState(state);
}

export function presentationSelectionTouches(
  selection: PresentationSelection,
  from: number,
  to: number,
): boolean {
  return selection.empty
    ? selection.from >= from && selection.from <= to
    : (selection.anchor >= from && selection.anchor <= to) || (selection.head >= from && selection.head <= to);
}

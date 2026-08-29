import type { Node as PMNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type {
  BlockPresentationMatch,
  BlockSourcePresentation,
  ExtensionPresentations,
  InlineSourcePresentation,
  PresentationCleanup,
} from "./extension";
import {
  presentationSelection,
  presentationSelectionTouches,
  type PresentationSelection,
} from "./presentation-selection";

export type ResolvedBlockPresentation = {
  presentation: BlockSourcePresentation;
  match: BlockPresentationMatch;
};

function preventDefault(event: Event): void {
  event.preventDefault();
}

function mountSafely(
  container: HTMLElement,
  authoredSource: string,
  render: () => PresentationCleanup,
): PresentationCleanup {
  try {
    return render();
  } catch {
    container.classList.add("live-presentation-fallback");
    container.textContent = authoredSource;
  }
}

function presentationWidget(
  position: number,
  className: string,
  authoredSource: string,
  render: (container: HTMLElement) => PresentationCleanup,
  key: string,
  block: boolean,
): Decoration {
  let cleanup: PresentationCleanup;
  let reveal: ((event: Event) => void) | null = null;
  return Decoration.widget(position, (view, getPosition) => {
    const container = document.createElement(block ? "div" : "span");
    container.className = className;
    container.contentEditable = "false";
    cleanup = mountSafely(container, authoredSource, () => render(container));
    if (block) {
      reveal = (event) => {
        const target = getPosition();
        if (typeof target !== "number") return;
        const head = target + 1;
        const anchor = (event as MouseEvent).shiftKey ? view.state.selection.anchor : head;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
        view.focus();
      };
      container.addEventListener("mousedown", preventDefault);
      container.addEventListener("click", reveal);
    }
    return container;
  }, {
    key,
    side: -1,
    destroy(container) {
      if (reveal) container.removeEventListener("click", reveal);
      if (block) container.removeEventListener("mousedown", preventDefault);
      if (typeof cleanup === "function") cleanup();
    },
  });
}

function comparePriority(
  left: { priority?: number },
  right: { priority?: number },
): number {
  return (right.priority ?? 0) - (left.priority ?? 0);
}

function selectBlockCandidate<Candidate extends { presentation: BlockSourcePresentation }>(
  candidates: readonly Candidate[],
  node: PMNode,
): Candidate | null {
  if (candidates.length === 0) return null;
  const ordered = [...candidates].sort((left, right) => (
    comparePriority(left.presentation, right.presentation)
  ));
  const first = ordered[0]!;
  const second = ordered[1];
  if (
    second
    && (first.presentation.priority ?? 0) === (second.presentation.priority ?? 0)
  ) {
    throw new Error(
      `Conflicting primary presentations for ${node.type.name}: `
      + `${first.presentation.id}, ${second.presentation.id}`,
    );
  }
  return first;
}

/** Resolve the one declaration that owns a derived block, independent of DOM. */
export function resolveBlockPresentation(
  node: PMNode,
  presentations: readonly BlockSourcePresentation[],
): ResolvedBlockPresentation | null {
  const candidates: ResolvedBlockPresentation[] = [];
  for (const presentation of presentations) {
    if (!presentation.nodeTypes.includes(node.type.name)) continue;
    const match = presentation.match(node.textContent, {
      nodeType: node.type.name,
      attributes: node.attrs as Readonly<Record<string, unknown>>,
    });
    if (!match) continue;
    if (match.source !== node.textContent) {
      throw new Error(`Invalid block source from presentation ${presentation.id}`);
    }
    candidates.push({ presentation, match });
  }
  return selectBlockCandidate(candidates, node);
}

/** Resolve a complete or in-progress block that requires exact source editing. */
export function resolveSourceBlockEditingPresentation(
  node: PMNode,
  presentations: readonly BlockSourcePresentation[],
): BlockSourcePresentation | null {
  const candidates = presentations
    .filter((presentation) => presentation.nodeTypes.includes(node.type.name))
    .filter((presentation) => (
      presentation.sourceBlockEditing?.matches(node.textContent) === true
    ))
    .map((presentation) => ({ presentation }));
  return selectBlockCandidate(candidates, node)?.presentation ?? null;
}

function collectInlineDecorations(
  node: PMNode,
  position: number,
  parent: PMNode | null,
  selection: PresentationSelection,
  presentations: readonly InlineSourcePresentation[],
  decorations: Decoration[],
): void {
  if (!node.isText || parent?.type.name === "code_block") return;
  const source = node.text ?? "";
  for (const presentation of presentations) {
    const matches = presentation.find(source, {
      parentNodeType: parent?.type.name ?? null,
    });
    for (const match of matches) {
      if (
        match.from < 0
        || match.to <= match.from
        || match.to > source.length
        || source.slice(match.from, match.to) !== match.source
      ) {
        throw new Error(`Invalid inline source range from presentation ${presentation.id}`);
      }
      const from = position + match.from;
      const to = position + match.to;
      if (presentationSelectionTouches(selection, from, to)) {
        if (presentation.editingClassName) {
          decorations.push(Decoration.inline(from, to, {
            class: presentation.editingClassName,
          }));
        }
        continue;
      }
      decorations.push(Decoration.inline(from, to, {
        class: presentation.sourceClassName,
      }));
      decorations.push(presentationWidget(
        to,
        presentation.widgetClassName,
        match.source,
        (container) => presentation.render(container, match),
        `${presentation.id}:${from}:${match.key}`,
        false,
      ));
    }
  }
}

/** Hosts declaration-only extension renderers without exposing EditorView. */
export function extensionPresentationPlugin(
  registry: ExtensionPresentations,
): Plugin {
  const inline = [...(registry.inline ?? [])].sort(comparePriority);
  const block = [...(registry.block ?? [])].sort(comparePriority);
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        const selection = presentationSelection(state);
        state.doc.descendants((node, position, parent) => {
          collectInlineDecorations(
            node,
            position,
            parent,
            selection,
            inline,
            decorations,
          );

          if (!block.some((presentation) => presentation.nodeTypes.includes(node.type.name))) {
            return;
          }
          const candidate = resolveBlockPresentation(node, block);
          if (!candidate) return;
          const from = position + 1;
          const to = position + node.nodeSize - 1;
          const editing = presentationSelectionTouches(selection, from, to);
          decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: `${candidate.presentation.sourceClassName} ${editing
              ? "is-live-syntax-editing"
              : "is-live-syntax-rendering"}`,
          }));
          if (!editing) decorations.push(presentationWidget(
            position,
            candidate.presentation.widgetClassName,
            candidate.match.source,
            (container) => candidate.presentation.render(container, candidate.match),
            `${candidate.presentation.id}:${position}:${candidate.match.key}`,
            true,
          ));
          return false;
        });
        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : DecorationSet.empty;
      },
    },
  });
}

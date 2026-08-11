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

type BlockCandidate = {
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
  let reveal: (() => void) | null = null;
  return Decoration.widget(position, (view, getPosition) => {
    const container = document.createElement(block ? "div" : "span");
    container.className = className;
    container.contentEditable = "false";
    cleanup = mountSafely(container, authoredSource, () => render(container));
    if (block) {
      reveal = () => {
        const target = getPosition();
        if (typeof target !== "number") return;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target + 1)));
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

function selectionIsInside(
  selection: { from: number; to: number },
  from: number,
  to: number,
): boolean {
  return selection.from >= from && selection.from <= to
    && selection.to >= from && selection.to <= to;
}

function comparePriority(
  left: { priority?: number },
  right: { priority?: number },
): number {
  return (right.priority ?? 0) - (left.priority ?? 0);
}

function selectBlockCandidate(
  candidates: readonly BlockCandidate[],
  node: PMNode,
): BlockCandidate | null {
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

function collectInlineDecorations(
  node: PMNode,
  position: number,
  parent: PMNode | null,
  selection: { from: number; to: number },
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
      if (selectionIsInside(selection, from, to)) continue;
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
        state.doc.descendants((node, position, parent) => {
          collectInlineDecorations(
            node,
            position,
            parent,
            state.selection,
            inline,
            decorations,
          );

          if (!block.some((presentation) => presentation.nodeTypes.includes(node.type.name))) {
            return;
          }
          const candidates: BlockCandidate[] = [];
          for (const presentation of block) {
            if (!presentation.nodeTypes.includes(node.type.name)) continue;
            const match = presentation.match(node.textContent, {
              nodeType: node.type.name,
              attributes: node.attrs as Readonly<Record<string, unknown>>,
            });
            if (match) {
              if (match.source !== node.textContent) {
                throw new Error(`Invalid block source from presentation ${presentation.id}`);
              }
              candidates.push({ presentation, match });
            }
          }
          const candidate = selectBlockCandidate(candidates, node);
          if (!candidate) return;
          const from = position + 1;
          const to = position + node.nodeSize - 1;
          const editing = selectionIsInside(state.selection, from, to);
          decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: `${candidate.presentation.sourceClassName} ${editing
              ? "is-live-syntax-editing"
              : "is-live-syntax-rendered"}`,
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

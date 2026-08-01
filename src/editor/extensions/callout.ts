import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type { Editor, EditorExtension } from "../core/lib";

const focusMarkerCommand = "mint.callout.focus-marker";

interface FocusMarkerInput {
  calloutIndex: number;
  markerOffset?: number;
}

export function createCalloutExtension(): EditorExtension {
  return {
    id: "mint-callout",
    createPlugins: ({ schema }) => [calloutDecorationPlugin(schema)],
    commands: {
      [focusMarkerCommand]: (view, input) => {
        if (!isFocusMarkerInput(input)) return false;
        const marker = findCalloutMarker(view.state, input.calloutIndex);
        if (!marker) return false;
        const offset = Math.max(0, Math.min(input.markerOffset ?? marker.size, marker.size));
        try {
          view.dispatch(view.state.tr
            .setSelection(TextSelection.create(view.state.doc, marker.from + offset))
            .scrollIntoView());
          view.focus();
          return true;
        } catch {
          return false;
        }
      },
    },
  };
}

export function focusCalloutMarker(
  editor: Editor,
  calloutIndex: number,
  markerOffset?: number,
): boolean {
  return editor.runExtensionCommand<boolean>(focusMarkerCommand, {
    calloutIndex,
    markerOffset,
  } satisfies FocusMarkerInput) ?? false;
}

function isFocusMarkerInput(input: unknown): input is FocusMarkerInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<FocusMarkerInput>;
  return Number.isInteger(value.calloutIndex) &&
    (value.markerOffset === undefined || typeof value.markerOffset === "number");
}

function calloutDecorationPlugin(schema: Schema): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        const { selection } = state;
        state.doc.descendants((node, position) => {
          if (node.type !== schema.nodes.blockquote) return;
          const markerParagraph = node.firstChild;
          if (!markerParagraph || markerParagraph.type !== schema.nodes.paragraph) return;
          const marker = /^\[!([a-z0-9_-]+)\][+-]?(?:[ \t]+[^\n]*)?/i.exec(
            markerParagraph.textContent,
          );
          if (!marker) return;

          const paragraphPosition = position + 1;
          const markerFrom = paragraphPosition + 1;
          const markerTo = markerFrom + marker[0].length;
          const editing = selection.$from.parent === markerParagraph &&
            selection.$to.parent === markerParagraph;
          let quoteDepth = 1;
          if (editing) {
            const resolved = selection.$from.doc.resolve(position);
            for (let depth = 0; depth <= resolved.depth; depth++) {
              if (resolved.node(depth).type === schema.nodes.blockquote) quoteDepth++;
            }
          }

          decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: "live-callout",
            "data-callout-type": marker[1]!.toLowerCase(),
          }));
          decorations.push(Decoration.node(
            paragraphPosition,
            paragraphPosition + markerParagraph.nodeSize,
            {
              class: `live-callout-marker${editing ? " is-live-callout-marker-editing" : ""}`,
              ...(editing ? { "data-callout-prefix": "> ".repeat(quoteDepth) } : {}),
            },
          ));
          if (!editing) {
            decorations.push(Decoration.inline(markerFrom, markerTo, {
              class: "live-callout-marker-hidden",
            }));
          }
        });
        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : DecorationSet.empty;
      },
    },
  });
}

function findCalloutMarker(
  state: EditorState,
  calloutIndex: number,
): { from: number; size: number } | null {
  if (!Number.isInteger(calloutIndex) || calloutIndex < 0) return null;
  let currentIndex = 0;
  let result: { from: number; size: number } | null = null;
  const schema = state.schema;
  state.doc.descendants((node: PMNode, position: number) => {
    if (result || node.type !== schema.nodes.blockquote) return;
    const marker = node.firstChild;
    if (
      !marker ||
      marker.type !== schema.nodes.paragraph ||
      !/^\[![a-z0-9_-]+\][+-]?(?:[ \t]+[^\n]*)?/i.test(marker.textContent)
    ) return;
    if (currentIndex++ !== calloutIndex) return;
    result = { from: position + 2, size: marker.content.size };
    return false;
  });
  return result;
}

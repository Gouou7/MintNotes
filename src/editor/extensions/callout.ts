import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type {
  Editor,
  EditorExtension,
  SourceBlockPresentation,
} from "../core/lib";
import { LIVE_SYNTAX_EDITING, SOURCE_BLOCK_PRESENTATION_META } from "../core/lib";
import { markLiveNavigation } from "../core/source-navigation";
import { parseCalloutMarker, type CalloutMarker } from "../callouts";

const focusMarkerCommand = "mint.callout.focus-marker";
const QUOTE_LINE = /^((?:[\t ]*>[\t ]?)+)(.*)$/;
const FENCE = /^(`{3,}|~{3,})/;

interface FocusMarkerInput {
  calloutIndex: number;
  markerOffset?: number;
}

interface CalloutSourceMarker {
  from: number;
  size: number;
  lineFrom: number;
  parsed: CalloutMarker;
}

export interface CalloutExtensionOptions {
  renderBlockquotePreview?: (
    container: HTMLElement,
    source: string,
  ) => void | (() => void);
}

function sourceCallouts(source: string): CalloutSourceMarker[] {
  const output: CalloutSourceMarker[] = [];
  const lines = source.split("\n");
  let offset = 0;
  let fenceMarker: string | null = null;
  for (const line of lines) {
    const quote = QUOTE_LINE.exec(line);
    if (!quote) {
      offset += line.length + 1;
      continue;
    }
    const content = quote[2]!;
    const fence = FENCE.exec(content.trimStart());
    if (fence) {
      const marker = fence[1]![0]!;
      fenceMarker = fenceMarker === marker ? null : fenceMarker ?? marker;
      offset += line.length + 1;
      continue;
    }
    if (!fenceMarker) {
      const leading = content.length - content.trimStart().length;
      const candidate = content.trim();
      const parsed = parseCalloutMarker(candidate);
      if (parsed) {
        output.push({
          from: offset + quote[1]!.length + leading,
          size: candidate.length,
          lineFrom: offset,
          parsed,
        });
      }
    }
    offset += line.length + 1;
  }
  return output;
}

function defaultCalloutPreview(container: HTMLElement, source: string): void {
  const marker = sourceCallouts(source).find((candidate) => candidate.lineFrom === 0);
  if (!marker) return;
  const callout = document.createElement("div");
  callout.className = `markdown-callout callout-${marker.parsed.kind}`;
  const header = document.createElement("div");
  header.className = "callout-header";
  const title = document.createElement("strong");
  title.textContent = marker.parsed.title;
  header.append(title);
  const body = document.createElement("div");
  body.className = "callout-content";
  body.textContent = source.split("\n").slice(1).map((line) => (
    QUOTE_LINE.exec(line)?.[2] ?? line
  )).join("\n");
  callout.append(header, body);
  container.append(callout);
}

export function createCalloutExtension(
  options: CalloutExtensionOptions = {},
): EditorExtension {
  const presentation: SourceBlockPresentation = {
    nodeType: "blockquote",
    matches: options.renderBlockquotePreview
      ? () => true
      : (source) => sourceCallouts(source).some((marker) => marker.lineFrom === 0),
    render: options.renderBlockquotePreview ?? defaultCalloutPreview,
  };

  return {
    id: "mint-callout",
    createPlugins: ({ schema }) => [calloutDecorationPlugin(schema)],
    sourceBlockPresentations: [presentation],
    commands: {
      [focusMarkerCommand]: (view, input) => {
        if (!isFocusMarkerInput(input)) return false;
        const marker = findCalloutMarker(view.state, input.calloutIndex);
        if (!marker) return false;
        const offset = Math.max(0, Math.min(input.markerOffset ?? marker.size, marker.size));
        try {
          const node = view.state.doc.nodeAt(marker.nodePos);
          if (!node) return false;
          const tr = view.state.tr.setNodeMarkup(marker.nodePos, undefined, {
            ...node.attrs,
            liveSyntaxState: LIVE_SYNTAX_EDITING,
          });
          tr.setSelection(TextSelection.create(tr.doc, marker.from + offset));
          tr.setMeta("addToHistory", false);
          tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
          const sourceFrom = Number(node.attrs.sourceFrom);
          const sourceOffset = Number.isInteger(sourceFrom)
            ? sourceFrom + marker.from - marker.nodePos - 1 + offset
            : undefined;
          view.dispatch(markLiveNavigation(tr.scrollIntoView(), {
            ...(sourceOffset !== undefined ? { anchor: sourceOffset, head: sourceOffset } : {}),
            scroll: true,
          }));
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
  return Number.isInteger(value.calloutIndex)
    && (value.markerOffset === undefined || typeof value.markerOffset === "number");
}

function calloutDecorationPlugin(schema: Schema): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, position) => {
          if (node.type !== schema.nodes.blockquote) return;
          const marker = sourceCallouts(node.textContent).find((candidate) => candidate.lineFrom === 0);
          if (!marker) return;
          decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: `live-callout callout-${marker.parsed.kind}${marker.parsed.color ? ` callout-color-${marker.parsed.color}` : ""}`,
            "data-callout-type": marker.parsed.rawType,
            "data-callout-title": marker.parsed.title,
          }));
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
): { nodePos: number; from: number; size: number } | null {
  if (!Number.isInteger(calloutIndex) || calloutIndex < 0) return null;
  let currentIndex = 0;
  let result: { nodePos: number; from: number; size: number } | null = null;
  state.doc.descendants((node: PMNode, position: number) => {
    if (result || node.type.name !== "blockquote") return;
    for (const marker of sourceCallouts(node.textContent)) {
      if (currentIndex++ !== calloutIndex) continue;
      result = {
        nodePos: position,
        from: position + 1 + marker.from,
        size: marker.size,
      };
      return false;
    }
  });
  return result;
}

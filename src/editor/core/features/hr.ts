import type { Node as PMNode, Schema } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { leaveLineDraft } from "../block-draft";
import type { FeatureSpec } from "./_types";

// horizontal_rule (HR).
//
// Commit timing = leave-line. While the cursor is still on the line
// containing exactly `---` (or `***` / `___`), the line stays a regular
// paragraph but the three delim chars render gray (`<g>---</g>`) as a
// draft hint. Only when the selection leaves that line (Enter, Arrow
// up/down, click elsewhere) does the paragraph get replaced with an
// `horizontal_rule` node.
//
// Adding a 4th char (or anything that breaks the `^[-*_]{3}$` match)
// should drop the draft immediately — it's back to plain text.
//
// See `cases` below for the exact contract.

type HRVariant = "-" | "*" | "_";

const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const hrRevealKey = new PluginKey<number | null>("horizontalRuleReveal");

function createHrNode(schema: Schema, markup: string): PMNode {
  return schema.nodes.horizontal_rule!.create({ markup });
}

function makeHrPlugin(schema: Schema) {
  return leaveLineDraft<{ variant: HRVariant }>({
    match: (text) => {
      const m = HR_RE.exec(text);
      if (!m) return null;
      return {
        data: { variant: m[1]![0] as HRVariant },
        // All leading chars (= the whole matched run) render gray.
        prefixLen: m[1]!.length,
      };
    },
    draftClass: () => "hr-draft",
    commit: (tr, pos, paragraph, data) => {
      const hrNode = createHrNode(
        schema,
        data.variant.repeat(paragraph.textContent.length),
      );
      // If the HR would end up as the doc's last node, PM needs a
      // trailing textblock for the caret to live in. Enter typically
      // provides that via the baseKeymap splitBlock (which runs before
      // our appendTransaction), but arrow-leave / click-leave / tests
      // that don't go through Enter may leave the HR as the last node.
      const parent = tr.doc.resolve(pos).parent;
      const idxOfPara = tr.doc.resolve(pos).index();
      const isLast = idxOfPara === parent.childCount - 1;
      if (isLast) {
        const empty = schema.nodes.paragraph!.create();
        tr.replaceWith(pos, pos + paragraph.nodeSize, [hrNode, empty]);
      } else {
        tr.replaceWith(pos, pos + paragraph.nodeSize, hrNode);
      }
    },
  });
}

function makeHrNodeView(schema: Schema) {
  return (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) => {
    const dom = document.createElement("div");
    dom.className = "hr-node-view";
    dom.setAttribute("contenteditable", "false");
    const rule = document.createElement("hr");
    dom.appendChild(rule);

    const keepNodeStable = (event: MouseEvent): void => {
      // Prevent ProseMirror from selecting the atom before the click handler
      // replaces it. The wrapper owns the full visual row, including the
      // whitespace above and below the painted rule.
      event.preventDefault();
      event.stopPropagation();
    };

    const revealSource = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type !== schema.nodes.horizontal_rule) return;

      const markup = (current.attrs.markup as string) || "---";
      const paragraph = schema.nodes.paragraph!.create(null, schema.text(markup));
      const tr = view.state.tr.replaceWith(pos, pos + current.nodeSize, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1 + markup.length));
      tr.setMeta(hrRevealKey, pos);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    };

    dom.addEventListener("mousedown", keepNodeStable);
    dom.addEventListener("click", revealSource);
    return {
      dom,
      update(updated: typeof node): boolean {
        return updated.type === node.type;
      },
      destroy(): void {
        dom.removeEventListener("mousedown", keepNodeStable);
        dom.removeEventListener("click", revealSource);
      },
    };
  };
}

function makeHrInteractionPlugin(schema: Schema): Plugin {
  return new Plugin<number | null>({
    key: hrRevealKey,
    state: {
      init: () => null,
      apply(tr, activePos) {
        const revealedPos = tr.getMeta(hrRevealKey) as number | undefined;
        const mappedPos = revealedPos ?? (
          activePos == null ? null : tr.mapping.map(activePos, -1)
        );
        if (mappedPos == null) return null;
        const current = tr.doc.nodeAt(mappedPos);
        return current?.type.name === "paragraph" && HR_RE.test(current.textContent)
          ? mappedPos
          : null;
      },
    },
    appendTransaction(transactions, oldState, newState) {
      // Only react to navigation. Loading/replacing Markdown may naturally
      // leave an atom selected while the document itself is changing; that
      // should still open with the rule rendered.
      if (transactions.some((transaction) => transaction.docChanged)) return null;
      const selection = newState.selection;
      if (!(selection instanceof NodeSelection)) return null;
      if (
        oldState.selection instanceof NodeSelection
        && oldState.selection.from === selection.from
      ) return null;
      const current = selection.node;
      if (current.type !== schema.nodes.horizontal_rule) return null;

      const pos = selection.from;
      const markup = (current.attrs.markup as string) || "---";
      const paragraph = schema.nodes.paragraph!.create(null, schema.text(markup));
      const tr = newState.tr.replaceWith(pos, pos + current.nodeSize, paragraph);
      const enteredFromBefore = oldState.selection.from <= pos;
      const offset = enteredFromBefore ? 0 : markup.length;
      tr.setSelection(TextSelection.create(tr.doc, pos + 1 + offset));
      tr.setMeta(hrRevealKey, pos);
      return tr.scrollIntoView();
    },
    props: {
      nodeViews: {
        horizontal_rule: makeHrNodeView(schema),
      },
    },
  });
}

export const hr: FeatureSpec = {
  name: "horizontal_rule",

  plugins: (schema) => [makeHrPlugin(schema).plugin, makeHrInteractionPlugin(schema)],
  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const pos = hrRevealKey.getState(state);
      if (pos == null || !state.selection.empty) return false;
      const paragraph = state.doc.nodeAt(pos);
      const match = paragraph?.type.name === "paragraph"
        ? HR_RE.exec(paragraph.textContent)
        : null;
      if (!paragraph || !match || state.selection.$from.before() !== pos) return false;

      // Only Enter after the complete delimiter commits the revealed source
      // back to an HR and opens a paragraph below it. At the start or in the
      // middle, Enter must retain normal text editing semantics so the source
      // moves down or splits exactly at the caret.
      if (state.selection.$from.parentOffset !== paragraph.content.size) return false;

      if (dispatch) {
        const markup = match[1]!;
        const rule = createHrNode(schema, markup);
        const empty = schema.nodes.paragraph!.create();
        const tr = state.tr.replaceWith(pos, pos + paragraph.nodeSize, [rule, empty]);
        tr.setSelection(TextSelection.create(tr.doc, pos + rule.nodeSize + 1));
        dispatch(tr.scrollIntoView());
      }
      return true;
    },
  }),

};

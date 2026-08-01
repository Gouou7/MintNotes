import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { schema } from "./schema";

// A line-leading greater-than sign remains ordinary text until Enter confirms
// the paragraph. This keeps partially typed Markdown visible and canonical.
export function blockquoteInputPlugin(): Plugin {
  let pendingParagraphPosition: number | null = null;

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) return false;

        const { selection } = view.state;
        const { $from } = selection;
        if (
          !selection.empty ||
          $from.depth !== 1 ||
          $from.parent.type !== view.state.schema.nodes.paragraph ||
          !/^>[ \t]?/.test($from.parent.textContent)
        ) return false;

        pendingParagraphPosition = $from.before();
        return false;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (
        pendingParagraphPosition === null ||
        !transactions.some((transaction) => transaction.docChanged)
      ) return null;

      const paragraphPosition = pendingParagraphPosition;
      pendingParagraphPosition = null;
      const paragraph = newState.doc.nodeAt(paragraphPosition);
      const prefix = /^>[ \t]?/.exec(paragraph?.textContent ?? "");
      if (!paragraph || paragraph.type !== newState.schema.nodes.paragraph || !prefix) return null;

      const transaction = newState.tr.delete(
        paragraphPosition + 1,
        paragraphPosition + 1 + prefix[0].length,
      );
      const updatedParagraph = transaction.doc.nodeAt(paragraphPosition);
      if (!updatedParagraph) return null;

      const followingPosition = paragraphPosition + updatedParagraph.nodeSize;
      const followingNode = transaction.doc.nodeAt(followingPosition);
      const rangeEnd = followingNode?.type === newState.schema.nodes.paragraph
        ? followingPosition + followingNode.nodeSize - 1
        : paragraphPosition + updatedParagraph.nodeSize - 1;
      const range = transaction.doc
        .resolve(paragraphPosition + 1)
        .blockRange(transaction.doc.resolve(rangeEnd));
      if (range) transaction.wrap(range, [{ type: newState.schema.nodes.blockquote }]);
      return transaction.docChanged ? transaction : null;
    },
  });
}

// Authored backslashes stay in the document model and are hidden only while
// rendered. The serializer never creates these escapes on the user's behalf.
export function manualEscapeDecorationPlugin(): Plugin {
  const escapable = "\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-";
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, position, parent) => {
          if (
            !node.isText ||
            node.marks.some((mark) => mark.type === schema.marks.code) ||
            parent?.type === schema.nodes.code_block
          ) return;

          const text = node.text ?? "";
          for (let index = 0; index < text.length - 1; index++) {
            if (text[index] !== "\\" || !escapable.includes(text[index + 1]!)) continue;
            decorations.push(Decoration.inline(position + index, position + index + 1, {
              class: "live-markdown-escape-hidden",
              "aria-hidden": "true",
            }));
            index++;
          }
        });
        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : DecorationSet.empty;
      },
    },
  });
}

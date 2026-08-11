import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { schema } from "./schema";

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
            parent?.type === schema.nodes.code_block ||
            parent?.type === schema.nodes.blockquote
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

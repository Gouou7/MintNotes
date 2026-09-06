import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { presentationSelection, presentationSelectionTouches } from "./presentation-selection";
import { SOURCE_TRANSACTION_META } from "./source-transaction";
import type { EditorExtension } from "./extension";

/** Block markers share the same authored text surface as the styled body. */
export function sourceLinePresentationPlugin(units: NonNullable<EditorExtension["sourceLineUnits"]> = []): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const output: Decoration[] = [];
        const selection = presentationSelection(state);
        state.doc.descendants((node, pos) => {
          if (!node.attrs.sourceLiteral && !(node.type.name === "source_gap" && String(node.attrs.sourceText ?? "").includes(">"))) return;
          const ancestors = state.doc.resolve(pos + 1);
          let blockEditing = false;
          for (let depth = 1; depth < ancestors.depth; depth++) {
            const ancestor = ancestors.node(depth);
            if (units.some((unit) => unit.nodeType === ancestor.type.name && unit.matches(String(ancestor.attrs.sourceText ?? "")))) {
              blockEditing ||= presentationSelectionTouches(selection, ancestors.before(depth), ancestors.after(depth));
            }
          }
          const text = node.type.name === "source_gap" ? String(node.attrs.sourceText) : node.textContent;
          for (const line of text.matchAll(/[^\r\n]+/g)) {
            const start = pos + 1 + line.index;
            const end = start + line[0].length;
            const editing = blockEditing || presentationSelectionTouches(selection, start, end);
            if (editing && ancestors.parent.type.name === "paragraph" && ancestors.depth > 1 && ancestors.node(ancestors.depth - 1).type.name === "list_item") {
              const item = ancestors.node(ancestors.depth - 1);
              const itemPos = ancestors.before(ancestors.depth - 1);
              output.push(Decoration.node(itemPos, itemPos + item.nodeSize, { class: "source-list-editing" }));
            }
            const prefix = /^(?:[\t ]*>[\t ]?)*(?:[\t ]*(?:#{1,6}[\t ]+|(?:[-+*]|\d+[.)])[\t ]+))?/.exec(line[0])![0];
            if (prefix) output.push(Decoration.inline(start, start + prefix.length, {
              class: editing ? "syntax-hint" : "syntax-hidden",
            }));
            if (node.type.name === "heading") {
              const suffix = /(?:[\t ]+#+[\t ]*|[\t ]*[=-]+[\t ]*)$/.exec(line[0]);
              if (suffix) output.push(Decoration.inline(start + suffix.index, end, {
                class: editing ? "syntax-hint" : "syntax-hidden",
              }));
            }
            const task = /^\[([ xX])\][\t ]+/.exec(line[0].slice(prefix.length));
            if (task) {
              const at = start + prefix.length;
              if (!editing) {
                output.push(Decoration.inline(at, at + task[0].length, { class: "syntax-hidden" }));
                output.push(Decoration.widget(at, (view) => {
                  const box = document.createElement("span");
                  box.className = "checkbox";
                  box.setAttribute("role", "checkbox");
                  box.setAttribute("aria-checked", String(task[1] !== " "));
                  box.dataset.checked = task[1] === " " ? "0" : "1";
                  box.dataset.sourceTask = String(Number(node.attrs.sourceFrom) + line.index + prefix.length + 1);
                  box.contentEditable = "false";
                  box.addEventListener("mousedown", (event) => event.preventDefault());
                  box.addEventListener("click", (event) => {
                    event.preventDefault();
                    const from = Number(box.dataset.sourceTask);
                    view.dispatch(view.state.tr.setMeta(SOURCE_TRANSACTION_META, {
                      edits: [{ from, to: from + 1, insert: box.dataset.checked === "1" ? " " : "x" }],
                      selection: { anchor: from, head: from }, origin: "command", reparseDerivedDocument: true,
                    }));
                  });
                  return box;
                }, { key: `source-task-${at}-${task[1]}` }));
              } else output.push(Decoration.inline(at, at + task[0].length, { class: "syntax-hint" }));
            }
          }
        });
        return DecorationSet.create(state.doc, output);
      },

    },
  });
}

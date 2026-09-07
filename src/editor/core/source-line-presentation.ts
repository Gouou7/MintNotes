import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { presentationSelection, presentationSelectionTouches } from "./presentation-selection";
import { SOURCE_TRANSACTION_META } from "./source-transaction";
import type { EditorExtension } from "./extension";
import { sourceLinePrefix } from "./source-line-prefix";
import { isLiveSyntaxEditing } from "./live-syntax-state";

/** Block markers share the same authored text surface as the styled body. */
export function sourceLinePresentationPlugin(units: NonNullable<EditorExtension["sourceLineUnits"]> = []): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const output: Decoration[] = [];
        const selection = presentationSelection(state);
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "quote_container") return;
          let editing = presentationSelectionTouches(selection, pos, pos + node.nodeSize);
          const ancestors = state.doc.resolve(pos);
          for (let depth = 1; depth <= ancestors.depth && !editing; depth++) {
            if (ancestors.node(depth).type.name === "quote_container") {
              editing = presentationSelectionTouches(selection, ancestors.before(depth), ancestors.after(depth));
            }
          }
          if (editing) {
            output.push(Decoration.node(pos, pos + node.nodeSize, { class: "source-quote-editing" }));
          }
        });
        state.doc.descendants((node, pos) => {
          const literal = node.attrs.sourceLiteral
            || (node.type.name === "source_gap" && String(node.attrs.sourceText ?? "").includes(">"));
          const sourceBlock = node.type.name === "source_block"
            || (["code_block", "blockquote"].includes(node.type.name) && isLiveSyntaxEditing(node.attrs.liveSyntaxState));
          if (!literal && !sourceBlock) return;
          const ancestors = state.doc.resolve(pos + 1);
          let blockEditing = false;
          let inContainer = false;
          let listDepth = 0;
          for (let depth = 1; depth < ancestors.depth; depth++) {
            const ancestor = ancestors.node(depth);
            if (ancestor.type.name === "bullet_list" || ancestor.type.name === "ordered_list") listDepth++;
            inContainer ||= ancestor.type.name === "list_item" || ancestor.type.name === "quote_container";
            const wholeContainerUnit = ancestor.type.name === "quote_container"
              || units.some((unit) => unit.nodeType === ancestor.type.name && unit.matches(String(ancestor.attrs.sourceText ?? "")));
            if (wholeContainerUnit) {
              blockEditing ||= presentationSelectionTouches(selection, ancestors.before(depth), ancestors.after(depth));
            }
          }
          const alignSource = () => output.push(Decoration.node(pos, pos + node.nodeSize, {
            class: "source-text-editing",
            style: `--source-list-depth: ${listDepth}`,
          }));
          if (!literal) {
            alignSource();
            return;
          }
          const text = node.type.name === "source_gap" ? String(node.attrs.sourceText) : node.textContent;
          const setextHeading = node.type.name === "heading" && node.attrs.style === "setext";
          const setextHeadingEditing = setextHeading
            && presentationSelectionTouches(selection, pos + 1, pos + 1 + text.length);
          if (setextHeading) {
            output.push(Decoration.node(pos, pos + node.nodeSize, { class: "setext-heading" }));
          }
          const lines = [...text.matchAll(/[^\r\n]+/g)];
          const isEditing = (line: RegExpMatchArray) => blockEditing || setextHeadingEditing
            || presentationSelectionTouches(selection, pos + 1 + line.index!, pos + 1 + line.index! + line[0].length);
          const textEditing = lines.some(isEditing);
          if (textEditing) alignSource();
          for (const line of lines) {
            const start = pos + 1 + line.index;
            const end = start + line[0].length;
            const editing = isEditing(line);
            const prefix = sourceLinePrefix(line[0], inContainer);
            const task = /^\[([ xX])\][\t ]+/.exec(line[0].slice(prefix.length));
            if (editing) {
              for (let depth = 1; depth < ancestors.depth; depth++) {
                const item = ancestors.node(depth);
                if (item.type.name !== "list_item" || item.attrs.sourceFrom !== Number(node.attrs.sourceFrom) + line.index) continue;
                const itemPos = ancestors.before(depth);
                output.push(Decoration.node(itemPos, itemPos + item.nodeSize, { class: "source-list-editing" }));
              }
            }
            if (editing && prefix) {
              const marker = prefix + (task?.[0] ?? "");
              output.push(Decoration.inline(start, start + marker.length, {
                class: "syntax-hint source-line-prefix",
              }));
            } else if (prefix) output.push(Decoration.inline(start, start + prefix.length, {
              class: `syntax-hidden source-line-prefix-hidden${textEditing && listDepth ? " source-rendered-indent" : ""}`,
            }));
            // One textblock can contain an active source line and an inactive
            // lazy continuation with no authored prefix. Only the rendered
            // line needs its container indentation after the block is aligned.
            if (!editing && !prefix && textEditing && listDepth) {
              output.push(Decoration.widget(start, () => {
                const spacer = document.createElement("span");
                spacer.className = "source-rendered-indent";
                spacer.setAttribute("aria-hidden", "true");
                return spacer;
              }, { side: -1, key: `rendered-indent-${start}` }));
            }
            if (node.type.name === "heading") {
              const suffix = setextHeading
                ? line.index + line[0].length === text.length
                  ? /^[\t ]*[=-]+[\t ]*$/.exec(line[0])
                  : null
                : /[\t ]+#+[\t ]*$/.exec(line[0]);
              if (suffix) {
                const precedingEnding = setextHeading
                  ? /(?:\r\n|\r|\n)$/.exec(text.slice(0, line.index))?.[0].length ?? 0
                  : 0;
                output.push(Decoration.inline(
                  start + suffix.index - precedingEnding,
                  end,
                  {
                    class: [
                      ...(setextHeading ? ["setext-heading-marker"] : []),
                      editing ? "syntax-hint" : "syntax-hidden",
                    ].join(" "),
                  },
                ));
              }
            }
            if (task) {
              const at = start + prefix.length;
              if (!editing) {
                output.push(Decoration.inline(at, at + task[0].length, { class: "syntax-hidden" }));
                output.push(Decoration.widget(at, (view) => {
                  const box = document.createElement("span");
                  box.className = "checkbox source-task-checkbox";
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
              } else if (!prefix) output.push(Decoration.inline(at, at + task[0].length, { class: "syntax-hint" }));
            }
          }
        });
        return DecorationSet.create(state.doc, output);
      },

    },
  });
}

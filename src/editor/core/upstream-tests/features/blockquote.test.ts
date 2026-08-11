import { TextSelection } from "prosemirror-state";
import { feedKey } from "../../specs/events";
import { fakeView } from "../../specs/sim";
import { serialize } from "../../serializer";
import { expect, test } from "vitest";
import { runFeatureCases, setup } from "../utils";
import { blockquoteSpecs } from "../../specs/features/blockquote.specs";
import { createEditor } from "../../editor-api";

runFeatureCases(blockquoteSpecs);

test("Backspace before the first quote delimiter moves to the previous source line", () => {
  const view = fakeView(setup("before\n\n> quoted"));
  let quotePos = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "blockquote") quotePos = pos;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, quotePos + 1)));

  feedKey(view, "<Backspace>");

  expect(serialize(view.state.doc)).toBe("before\n\n> quoted");
  expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
  expect(view.state.selection.$from.parent.textContent).toBe("before");
  expect(view.state.selection.$from.parentOffset).toBe("before".length);
});

test("Backspace before a quote delimiter at document start is a no-op", () => {
  const view = fakeView(setup("> quoted"));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));

  feedKey(view, "<Backspace>");

  expect(serialize(view.state.doc)).toBe("> quoted");
  expect(view.state.selection.from).toBe(1);
});

test("Delete traverses the authored quote prefix instead of deleting a visual block", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor(host, { initialContent: "> quoted" });
  editor.setSelectionOffset(0);
  host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Delete",
    code: "Delete",
    bubbles: true,
    cancelable: true,
  }));

  expect(editor.getMarkdown()).toBe(" quoted");
  expect(host.querySelector(".ProseMirror > p")?.textContent).toBe(" quoted");
  editor.destroy();
  host.remove();
});

import { TextSelection } from "prosemirror-state";
import { feedKey } from "../../specs/events";
import { fakeView } from "../../specs/sim";
import { serialize } from "../../serializer";
import { expect, test } from "vitest";
import { runFeatureCases, setup } from "../utils";
import { blockquoteSpecs } from "../../specs/features/blockquote.specs";
import { createEditor } from "../../editor-api";

runFeatureCases(blockquoteSpecs);

function pressArrow(host: HTMLElement, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  });
  host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(event);
  return event.defaultPrevented;
}

function pressEnter(host: HTMLElement): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
  });
  host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(event);
  return event.defaultPrevented;
}

test.each([">", "> ", ">    ", ">\t \t"])(
  "Enter exits the empty quote source %j onto the line after a blank row",
  (markdown) => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: markdown });
    editor.setSelectionOffset(markdown.length);

    expect(pressEnter(host)).toBe(true);
    expect(editor.getMarkdown()).toBe("\n");
    expect(editor.getSelectionOffset()).toBe(1);
    expect(host.querySelector(".source-blockquote-node")).toBeNull();

    editor.destroy();
    host.remove();
  },
);

test("Enter preserves a blank source line between the quotes around it", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const markdown = "> first\n>   \n>second";
  const emptyQuoteEnd = markdown.indexOf("\n>") + 5;
  const editor = createEditor(host, { initialContent: markdown });
  editor.setSelectionOffset(emptyQuoteEnd);

  expect(pressEnter(host)).toBe(true);
  expect(editor.getMarkdown()).toBe("> first\n\n\n>second");
  expect(editor.getSelectionOffset()).toBe("> first\n\n".length);

  editor.destroy();
  host.remove();
});

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

test("ArrowUp and ArrowDown move by authored quote lines and leave at the edges", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const markdown = "before\n\n> one\n> longer\n\nafter";
  const quoteFrom = markdown.indexOf("> one");
  const editor = createEditor(host, { initialContent: markdown });

  editor.setSelectionOffset(quoteFrom + 2);
  expect(pressArrow(host, "ArrowDown")).toBe(true);
  expect(editor.getSelectionOffset()).toBe(quoteFrom + "> one\n".length + 2);

  expect(pressArrow(host, "ArrowDown")).toBe(true);
  expect(editor.getSelectionOffset()).toBeGreaterThan(
    quoteFrom + "> one\n> longer".length,
  );
  expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();

  editor.setSelectionOffset(quoteFrom + "> one\n> longer".length);
  expect(pressArrow(host, "ArrowUp")).toBe(true);
  expect(editor.getSelectionOffset()).toBe(quoteFrom + "> one".length);

  expect(pressArrow(host, "ArrowUp")).toBe(true);
  expect(editor.getSelectionOffset()).toBeLessThan(quoteFrom);
  expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();

  expect(editor.getMarkdown()).toBe(markdown);
  editor.destroy();
  host.remove();
});

test("ArrowLeft and ArrowRight leave an active quote at its authored edges", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const markdown = "before\n\n> quote\n\nafter";
  const quoteFrom = markdown.indexOf("> quote");
  const quoteTo = quoteFrom + "> quote".length;
  const editor = createEditor(host, { initialContent: markdown });

  editor.setSelectionOffset(quoteFrom);
  expect(pressArrow(host, "ArrowLeft")).toBe(true);
  expect(editor.getSelectionOffset()).toBeLessThan(quoteFrom);
  expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();

  editor.setSelectionOffset(quoteTo);
  expect(pressArrow(host, "ArrowRight")).toBe(true);
  expect(editor.getSelectionOffset()).toBeGreaterThan(quoteTo);
  expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();

  expect(editor.getMarkdown()).toBe(markdown);
  editor.destroy();
  host.remove();
});

import { expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { feedKey, feedText } from "../../specs/events";
import { fencedCodeSpecs } from "../../specs/features/fenced-code.specs";
import { fakeView } from "../../specs/sim";
import { serialize } from "../../serializer";
import { pretty, runFeatureCases, setup } from "../utils";
import { createEditor } from "../../editor-api";

runFeatureCases(fencedCodeSpecs);

test("typing a closing fence line immediately exits the code block", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const source = "```ts\nbefore\n";
  const editor = createEditor(host, { initialContent: source });
  editor.insertMarkdown("```", source.length);

  expect(editor.getMarkdown()).toBe("```ts\nbefore\n```");
  expect(host.querySelector(".ProseMirror > pre > code")?.textContent).toBe("```ts\nbefore\n```");
  editor.destroy();
  host.remove();
});

test("typing a closing fence in the middle reparses the entire remaining document", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const source = "```ts\nbefore\n\n# after\n```\n\noutside";
  const offset = "```ts\nbefore\n".length;
  const editor = createEditor(host, { initialContent: source });
  editor.insertMarkdown("```", offset);

  expect(editor.getMarkdown()).toBe(
    "```ts\nbefore\n```\n# after\n```\n\noutside",
  );
  expect(host.querySelector(".ProseMirror > h1")?.textContent).toBe("after");
  expect(host.querySelectorAll(".ProseMirror > pre:not([data-source-gap])")).toHaveLength(2);
  editor.destroy();
  host.remove();
});

test("three backticks inside a nonempty code line remain literal", () => {
  const view = fakeView(setup());
  feedText(view, "```");
  feedKey(view, "<Enter>");
  feedText(view, "value ```");

  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  expect(view.state.doc.child(0).textContent).toBe("```\nvalue ```\n```");
});

test("an unclosed fence owns the rest of the document and closes while typing", () => {
  const view = fakeView(setup("```ts\nbefore\n# still code\n- still code"));

  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.child(0).type.name).toBe("code_block");
  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  expect(view.state.doc.child(0).textContent).toBe(
    "```ts\nbefore\n# still code\n- still code",
  );

  feedKey(view, "<Enter>");
  feedText(view, "```");

  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  expect(view.state.doc.child(0).textContent).toBe(
    "```ts\nbefore\n# still code\n- still code\n```",
  );
  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(0));
  expect(serialize(view.state.doc)).toBe(
    "```ts\nbefore\n# still code\n- still code\n```",
  );
});

test("ArrowDown from the preceding block reveals the opening fence", () => {
  let state = setup("before\n\n```ts\nfoo\n```");
  const beforeEnd = state.doc.child(0).nodeSize - 1;
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, beforeEnd)),
  );
  const view = fakeView(state);

  feedKey(view, "<ArrowDown>");

  expect(pretty(view.state)).toBe("before\n|```ts\nfoo\n```");
  feedKey(view, "<ArrowDown>");
  expect(pretty(view.state)).toBe("before\n```ts\n|foo\n```");
});

test("horizontal arrows enter rendered code through the nearest fence", () => {
  const markdown = "before\n\n```ts\nfoo\n```\n\nafter";

  let fromAbove = setup(markdown);
  fromAbove = fromAbove.apply(
    fromAbove.tr.setSelection(
      TextSelection.create(fromAbove.doc, fromAbove.doc.child(0).nodeSize - 1),
    ),
  );
  const rightView = fakeView(fromAbove);
  feedKey(rightView, "<ArrowRight>");
  expect(pretty(rightView.state)).toBe("before\n|```ts\nfoo\n```\nafter");

  let fromBelow = setup(markdown);
  const afterStart = fromBelow.doc.child(0).nodeSize
    + fromBelow.doc.child(1).nodeSize
    + 1;
  fromBelow = fromBelow.apply(
    fromBelow.tr.setSelection(TextSelection.create(fromBelow.doc, afterStart)),
  );
  const leftView = fakeView(fromBelow);
  feedKey(leftView, "<ArrowLeft>");
  expect(pretty(leftView.state)).toBe("before\n```ts\nfoo\n```|\nafter");
});

test("mousedown enters editing state once and preserves the clicked body offset", () => {
  const mount = document.createElement("div");
  document.body.append(mount);
  let dispatchCount = 0;
  let view: EditorView;
  view = new EditorView(mount, {
    state: setup("```ts\nfirst line\nsecond line\n```\n\nafter"),
    dispatchTransaction(transaction) {
      dispatchCount += 1;
      view.updateState(view.state.apply(transaction));
    },
  });

  const bodyOffset = "first line\nsecond".length;
  Object.defineProperty(view, "posAtCoords", {
    value: () => ({ pos: 1 + "```ts\n".length + bodyOffset, inside: 0 }),
  });
  const pre = mount.querySelector("pre")!;
  Object.defineProperty(pre, "getBoundingClientRect", {
    value: () => ({ top: 0, right: 400, bottom: 120, left: 0, width: 400, height: 120 }),
  });
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 140,
    clientY: 60,
  });
  pre.querySelector("code")!.dispatchEvent(event);

  const active = view.state.doc.child(0);
  expect(event.defaultPrevented).toBe(true);
  expect(dispatchCount).toBe(1);
  expect(active.attrs.liveSyntaxState).toBe("editing");
  expect(view.state.selection.$from.parentOffset).toBe(3 + "ts".length + 1 + bodyOffset);
  view.destroy();
  mount.remove();
});

test("mousedown to the right of the closing fence keeps a stable source caret", () => {
  let state = setup("```ts\nfirst line\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const mount = document.createElement("div");
  document.body.append(mount);
  let dispatchCount = 0;
  let view: EditorView;
  view = new EditorView(mount, {
    state,
    dispatchTransaction(transaction) {
      dispatchCount += 1;
      view.updateState(view.state.apply(transaction));
    },
  });
  Object.defineProperty(view, "coordsAtPos", {
    value: () => ({ left: 120, right: 120, top: 80, bottom: 100 }),
  });

  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 320,
    clientY: 90,
  });
  mount.querySelector("pre")!.dispatchEvent(event);

  const active = view.state.doc.child(0);
  expect(event.defaultPrevented).toBe(true);
  expect(dispatchCount).toBe(1);
  expect(active.attrs.liveSyntaxState).toBe("editing");
  expect(view.state.selection.empty).toBe(true);
  expect(view.state.selection.$from.parentOffset).toBe(active.content.size);
  view.destroy();
  mount.remove();
});

test("a native selection move into rendered code reveals the nearest fence", () => {
  const markdown = "before\n\n```ts\none\ntwo\n```\n\nafter";

  let fromBelow = setup(markdown);
  const codePos = fromBelow.doc.child(0).nodeSize;
  const code = fromBelow.doc.child(1);
  const belowView = fakeView(fromBelow);
  belowView.dispatch(
    belowView.state.tr.setSelection(
      TextSelection.create(belowView.state.doc, codePos + 1 + code.content.size),
    ),
  );
  const activeFromBelow = belowView.state.doc.child(1);
  expect(activeFromBelow.attrs.liveSyntaxState).toBe("editing");
  expect(belowView.state.selection.$from.parentOffset).toBe(activeFromBelow.content.size);
  expect(pretty(belowView.state)).toBe("before\n```ts\none\ntwo\n```|\nafter");

  let fromAbove = setup(markdown);
  fromAbove = fromAbove.apply(
    fromAbove.tr.setSelection(
      TextSelection.create(fromAbove.doc, fromAbove.doc.child(0).nodeSize - 1),
    ),
  );
  const aboveView = fakeView(fromAbove);
  aboveView.dispatch(
    aboveView.state.tr.setSelection(TextSelection.create(aboveView.state.doc, codePos + 1)),
  );
  expect(aboveView.state.doc.child(1).attrs.liveSyntaxState).toBe("editing");
  expect(aboveView.state.selection.$from.parentOffset).toBe(0);
  expect(pretty(aboveView.state)).toBe("before\n|```ts\none\ntwo\n```\nafter");
});

test("ArrowUp walks closing fence, body lines, opening fence, then outside", () => {
  const state = setup("before\n\n```ts\none\ntwo\n```\n\nafter");
  const codePos = state.doc.child(0).nodeSize;
  const code = state.doc.child(1);
  const view = fakeView(state);
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, codePos + 1 + code.content.size),
    ),
  );

  expect(pretty(view.state)).toBe("before\n```ts\none\ntwo\n```|\nafter");
  feedKey(view, "<ArrowUp>");
  expect(pretty(view.state)).toBe("before\n```ts\none\ntwo|\n```\nafter");
  feedKey(view, "<ArrowUp>");
  expect(pretty(view.state)).toBe("before\n```ts\none|\ntwo\n```\nafter");
  feedKey(view, "<ArrowUp>");
  expect(pretty(view.state)).toBe("before\n```|ts\none\ntwo\n```\nafter");
  feedKey(view, "<ArrowUp>");
  expect(view.state.doc.child(1).attrs.liveSyntaxState).toBe("rendering");
  expect(view.state.selection.$from.parent.textContent).toBe("before");
});

test("ArrowDown walks opening fence, body lines, closing fence, then outside", () => {
  let state = setup("before\n\n```ts\none\ntwo\n```\n\nafter");
  state = state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, state.doc.child(0).nodeSize - 1),
    ),
  );
  const view = fakeView(state);

  feedKey(view, "<ArrowDown>");
  expect(pretty(view.state)).toBe("before\n|```ts\none\ntwo\n```\nafter");
  feedKey(view, "<ArrowDown>");
  expect(pretty(view.state)).toBe("before\n```ts\n|one\ntwo\n```\nafter");
  feedKey(view, "<ArrowDown>");
  expect(pretty(view.state)).toBe("before\n```ts\none\n|two\n```\nafter");
  feedKey(view, "<ArrowDown>");
  expect(pretty(view.state)).toBe("before\n```ts\none\ntwo\n```|\nafter");
  feedKey(view, "<ArrowDown>");
  expect(view.state.doc.child(1).attrs.liveSyntaxState).toBe("rendering");
  expect(view.state.selection.$from.parent.textContent).toBe("after");
});

test("active fenced source is real editable text and collapses after the caret leaves", () => {
  let state = setup("```bash\necho hi\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);

  const active = view.state.doc.child(0);
  expect(active.attrs.liveSyntaxState).toBe("editing");
  expect(active.textContent).toBe("```bash\necho hi\n```");

  const languageEnd = 1 + 3 + "bash".length;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, languageEnd))
      .insertText("-session"),
  );
  expect(serialize(view.state.doc)).toBe("```bash-session\necho hi\n```\n\nafter");

  const activeSize = view.state.doc.child(0).nodeSize;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, activeSize + 1)),
  );
  const rendered = view.state.doc.child(0);
  expect(rendered.attrs.liveSyntaxState).toBe("rendering");
  expect(rendered.attrs.lang).toBe("bash-session");
  expect(rendered.textContent).toBe("```bash-session\necho hi\n```");
  expect(serialize(view.state.doc)).toBe("```bash-session\necho hi\n```\n\nafter");
});

test("a range selection inside fenced source does not collapse the code block", () => {
  let state = setup("```ts\none\ntwo\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);
  const sourceSize = view.state.doc.child(0).content.size;

  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + sourceSize)),
  );

  expect(view.state.selection.empty).toBe(false);
  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  expect(view.state.doc.child(0).textContent).toBe("```ts\none\ntwo\n```");
  expect(serialize(view.state.doc)).toBe("```ts\none\ntwo\n```\n\nafter");
});

test("deleting part of a closing fence immediately reparses following Markdown", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const source = "```ts\nvalue\n```\n\nafter";
  const closingEnd = source.indexOf("```", 3) + 3;
  const editor = createEditor(host, { initialContent: source });
  editor.setSelectionOffset(closingEnd - 1);
  host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Delete",
    code: "Delete",
    bubbles: true,
    cancelable: true,
  }));

  expect(editor.getMarkdown()).toBe("```ts\nvalue\n``\n\nafter");
  expect(host.querySelectorAll(".ProseMirror > pre")).toHaveLength(1);
  editor.destroy();
  host.remove();
});

test("Backspace from below traverses the authored closing fence before code body", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const source = "```ts\nvalue\n```\n\nafter";
  const closingStart = source.indexOf("```", 3);
  const editor = createEditor(host, { initialContent: source });
  for (let offset = closingStart; offset <= closingStart + 3; offset += 1) {
    editor.setSelectionOffset(offset);
    expect(editor.getSelectionOffset()).toBe(offset);
    expect(editor.getMarkdown()).toBe(source);
  }
  editor.destroy();
  host.remove();
});

test("Delete from above traverses the authored opening fence", () => {
  let state = setup("before\n\n```ts\nvalue\n```");
  state = state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, state.doc.child(0).nodeSize - 1),
    ),
  );
  const view = fakeView(state);

  feedKey(view, "<Delete>");

  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(1));
  expect(view.state.selection.$from.parentOffset).toBe(0);
  expect(view.state.doc.child(1).attrs.liveSyntaxState).toBe("editing");
  expect(serialize(view.state.doc)).toBe("before\n\n```ts\nvalue\n```");
});

test("ArrowDown leaves the closing source fence and restores rendered code", () => {
  let state = setup("```ts\nvalue\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);

  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  feedKey(view, "<ArrowDown>");

  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("rendering");
  expect(view.state.selection.$from.parent.textContent).toBe("after");
  expect(serialize(view.state.doc)).toBe("```ts\nvalue\n```\n\nafter");
});

test("Enter after the closing fence exits into a new paragraph", () => {
  let state = setup("```ts\nvalue\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);

  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  feedKey(view, "<Enter>");
  feedText(view, "next");

  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("rendering");
  expect(view.state.doc.child(1).type.name).toBe("paragraph");
  expect(view.state.doc.child(1).textContent).toBe("next");
  expect(view.state.doc.child(2).textContent).toBe("after");
  expect(serialize(view.state.doc)).toBe("```ts\nvalue\n```\n\nnext\n\nafter");
});

test("Enter before the opening fence inserts a paragraph above the code block", () => {
  let state = setup("```ts\nvalue\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
  );

  expect(view.state.doc.child(0).attrs.liveSyntaxState).toBe("editing");
  feedKey(view, "<Enter>");

  expect(view.state.doc.child(0).type.name).toBe("paragraph");
  expect(view.state.doc.child(0).textContent).toBe("");
  expect(view.state.doc.child(1).type.name).toBe("code_block");
  expect(view.state.doc.child(1).attrs.liveSyntaxState).toBe("rendering");
  expect(view.state.doc.child(1).textContent).toBe("```ts\nvalue\n```");
  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(0));
  expect(serialize(view.state.doc)).toBe("\n```ts\nvalue\n```\n\nafter");
});

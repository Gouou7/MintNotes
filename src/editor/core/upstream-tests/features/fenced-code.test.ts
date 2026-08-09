import { expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { feedKey, feedText } from "../../specs/events";
import { fencedCodeSpecs } from "../../specs/features/fenced-code.specs";
import { fakeView } from "../../specs/sim";
import { serialize } from "../../serializer";
import { pretty, runFeatureCases, setup } from "../utils";

runFeatureCases(fencedCodeSpecs);

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
  expect(activeFromBelow.attrs.sourceEditing).toBe(true);
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
  expect(aboveView.state.doc.child(1).attrs.sourceEditing).toBe(true);
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
  expect(view.state.doc.child(1).attrs.sourceEditing).toBe(false);
  expect(view.state.selection.$from.parent.textContent).toBe("before");
});

test("active fenced source is real editable text and collapses after the caret leaves", () => {
  let state = setup("```bash\necho hi\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);

  const active = view.state.doc.child(0);
  expect(active.attrs.sourceEditing).toBe(true);
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
  expect(rendered.attrs.sourceEditing).toBe(false);
  expect(rendered.attrs.lang).toBe("bash-session");
  expect(rendered.textContent).toBe("echo hi");
  expect(serialize(view.state.doc)).toBe("```bash-session\necho hi\n```\n\nafter");
});

test("an incomplete edited fence stays visible and serializes verbatim", () => {
  let state = setup("```ts\nvalue\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);

  const closingTick = view.state.doc.child(0).nodeSize - 2;
  view.dispatch(view.state.tr.delete(closingTick, closingTick + 1));
  const activeSize = view.state.doc.child(0).nodeSize;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, activeSize + 1)),
  );

  expect(view.state.doc.child(0).attrs.sourceEditing).toBe(true);
  expect(serialize(view.state.doc)).toBe("```ts\nvalue\n``\n\nafter");
});

test("ArrowDown leaves the closing source fence and restores rendered code", () => {
  let state = setup("```ts\nvalue\n```\n\nafter");
  const code = state.doc.child(0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, code.nodeSize - 1)),
  );
  const view = fakeView(state);

  expect(view.state.doc.child(0).attrs.sourceEditing).toBe(true);
  feedKey(view, "<ArrowDown>");

  expect(view.state.doc.child(0).attrs.sourceEditing).toBe(false);
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

  expect(view.state.doc.child(0).attrs.sourceEditing).toBe(true);
  feedKey(view, "<Enter>");
  feedText(view, "next");

  expect(view.state.doc.child(0).attrs.sourceEditing).toBe(false);
  expect(view.state.doc.child(1).type.name).toBe("paragraph");
  expect(view.state.doc.child(1).textContent).toBe("next");
  expect(view.state.doc.child(2).textContent).toBe("after");
  expect(serialize(view.state.doc)).toBe("```ts\nvalue\n```\n\nnext\n\nafter");
});

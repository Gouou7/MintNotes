import { expect, test } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";

import { runFeatureCases, setup } from "../utils";
import { hrSpecs } from "../../specs/features/hr.specs";
import { feedKey } from "../../specs/events";
import { fakeView } from "../../specs/sim";

runFeatureCases(hrSpecs);

test("keyboard selection reveals a horizontal rule from either direction", () => {
  const markdown = "before\n\n***\n\nafter";

  let fromAfter = setup(markdown);
  const rulePos = fromAfter.doc.child(0).nodeSize;
  fromAfter = fromAfter.apply(
    fromAfter.tr.setSelection(NodeSelection.create(fromAfter.doc, rulePos)),
  );
  expect(fromAfter.doc.child(1).type.name).toBe("paragraph");
  expect(fromAfter.doc.child(1).textContent).toBe("***");
  expect(fromAfter.selection.from).toBe(rulePos + 1 + "***".length);

  let fromBefore = setup(markdown);
  const beforeRule = rulePos - 1;
  fromBefore = fromBefore.apply(
    fromBefore.tr.setSelection(TextSelection.create(fromBefore.doc, beforeRule)),
  );
  fromBefore = fromBefore.apply(
    fromBefore.tr.setSelection(NodeSelection.create(fromBefore.doc, rulePos)),
  );
  expect(fromBefore.doc.child(1).type.name).toBe("paragraph");
  expect(fromBefore.doc.child(1).textContent).toBe("***");
  expect(fromBefore.selection.from).toBe(rulePos + 1);
});

function revealRuleSource() {
  const state = setup("before\n\n---\n\nafter");
  const rulePos = state.doc.child(0).nodeSize;
  return {
    rulePos,
    state: state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, rulePos)),
    ),
  };
}

test("Enter at the start of revealed horizontal-rule source moves it down", () => {
  const { state, rulePos } = revealRuleSource();
  const atStart = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, rulePos + 1)),
  );
  const view = fakeView(atStart);

  feedKey(view, "<Enter>");

  expect(view.state.doc.childCount).toBe(4);
  expect(view.state.doc.child(1).type.name).toBe("paragraph");
  expect(view.state.doc.child(1).textContent).toBe("");
  expect(view.state.doc.child(2).type.name).toBe("paragraph");
  expect(view.state.doc.child(2).textContent).toBe("---");
  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(2));
  expect(view.state.selection.$from.parentOffset).toBe(0);
});

test("Enter in the middle of revealed horizontal-rule source splits it at the caret", () => {
  const { state, rulePos } = revealRuleSource();
  const inMiddle = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, rulePos + 2)),
  );
  const view = fakeView(inMiddle);

  feedKey(view, "<Enter>");

  expect(view.state.doc.childCount).toBe(4);
  expect(view.state.doc.child(1).type.name).toBe("paragraph");
  expect(view.state.doc.child(1).textContent).toBe("-");
  expect(view.state.doc.child(2).type.name).toBe("paragraph");
  expect(view.state.doc.child(2).textContent).toBe("--");
  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(2));
  expect(view.state.selection.$from.parentOffset).toBe(0);
});

test("Enter at the end of revealed horizontal-rule source commits it", () => {
  const { state, rulePos } = revealRuleSource();
  const view = fakeView(state);

  feedKey(view, "<Enter>");

  expect(view.state.doc.childCount).toBe(4);
  expect(view.state.doc.child(1).type.name).toBe("horizontal_rule");
  expect(view.state.doc.child(1).attrs.markup).toBe("---");
  expect(view.state.doc.child(2).type.name).toBe("paragraph");
  expect(view.state.doc.child(2).textContent).toBe("");
  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(2));
  expect(view.state.selection.$from.parentOffset).toBe(0);
});

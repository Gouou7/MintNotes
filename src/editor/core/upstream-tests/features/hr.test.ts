import { expect, test } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";

import { runFeatureCases, setup } from "../utils";
import { hrSpecs } from "../../specs/features/hr.specs";

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

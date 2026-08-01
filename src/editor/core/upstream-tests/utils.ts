import { describe, expect, test } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";

import { createState } from "../editor";
import { type Event, feedEvent } from "../specs/events";
import { fakeView } from "../specs/sim";
import type { FeatureSpecs } from "../specs/_types";
import { parse } from "../parser";
import { schema } from "../schema";
import { pretty } from "../specs/pretty";

export { pretty };
export type { Event } from "../specs/events";

export function setup(md = ""): EditorState {
  const doc = md ? parse(md) : schema.nodes.doc.createAndFill()!;
  const base = createState(doc);
  return base.apply(base.tr.setSelection(TextSelection.atEnd(doc)));
}

export function apply(state: EditorState, events: Event[]): EditorState {
  const view = fakeView(state);
  for (const e of events) feedEvent(view, e);
  return view.state;
}

// Run every checkpoint across every case of a feature as an independent test.
// Each feature.test.ts becomes a one-liner; the expansion shape (describe
// feature → describe case.label → test "at N") stays uniform so failures
// read consistently in the runner output.
export function runFeatureCases(specs: FeatureSpecs): void {
  describe(specs.name, () => {
    for (const c of specs.cases ?? []) {
      describe(c.label, () => {
        for (const cp of c.checkpoints) {
          test(`at ${cp.at}`, () => {
            expect(pretty(apply(setup(c.seed), c.events.slice(0, cp.at)))).toBe(cp.expect);
          });
        }
      });
    }
  });
}

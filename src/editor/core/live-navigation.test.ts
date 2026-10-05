import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parse } from "./parser";
import { LiveNavigation } from "./live-navigation";
import { SourcePositionMap } from "./source-position-map";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); document.body.replaceChildren(); });

describe("unmapped navigation fallback", () => {
  it.each([
    ["ArrowRight", { anchor: 4, head: 4 }, { anchor: 5, head: 5 }],
    ["ArrowDown", { anchor: 4, head: 4 }, { anchor: 6, head: 6 }],
  ] as const)("requests the exact source surface for %s when the projection has no provenance", (key, selection, target) => {
    const source = "first\n\nsecond";
    const host = document.createElement("div"); document.body.append(host);
    const doc = parse(source, { sourceGaps: false });
    const view = new EditorView(host, { state: EditorState.create({ doc }) }); views.push(view);
    const navigation = new LiveNavigation();
    expect(navigation.resolve(view, source, selection, new KeyboardEvent("keydown", { key }), SourcePositionMap.fromDocument(doc, source)))
      .toEqual({ kind: "source-selection", selection: target });
    expect(view.state.doc).toBe(doc);
  });
});

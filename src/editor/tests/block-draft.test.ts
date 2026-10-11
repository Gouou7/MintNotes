import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo } from "prosemirror-history";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { leaveLineDraft } from "../../../.generated/typora-web/src/block-draft";
import { schema } from "../../../.generated/typora-web/src/schema";
import { serialize } from "../../../.generated/typora-web/src/serializer";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(paragraphs: string[], draftIndex = 0) {
  const doc = schema.nodes.doc.create(null, paragraphs.map(text => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)));
  let pos = 0; for (let i = 0; i < draftIndex; i++) pos += doc.child(i).nodeSize;
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ schema, doc, plugins: defaultPlugins({ cursorWidget: false }), selection: TextSelection.create(doc, pos + doc.child(draftIndex).nodeSize - 1) }) });
  views.push(view); return view;
}
function select(view: EditorView, from: number, to = from) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))); }
function composition(view: EditorView, type: "compositionstart" | "compositionend") { view.dom.dispatchEvent(new CompositionEvent(type, { bubbles: true })); }
async function settle() { await new Promise(resolve => setTimeout(resolve, 40)); }

describe("block drafts and IME selections", () => {
  for (const [source, type] of [["## ce", "heading"], ["***", "horizontal_rule"], ["```ts", "code_block"]]) {
    it(`keeps a selection inside ${type} draft editable and commits only on leaving`, () => {
      const view = setup([source, "After"]), before = view.state.doc;
      select(view, source.length + 1, 1);
      expect(view.state.doc.eq(before)).toBe(true);
      expect(view.dom.querySelector(".syntax-hint")?.textContent).not.toBeUndefined();
      select(view, view.state.doc.firstChild!.nodeSize + 1);
      expect(view.state.doc.firstChild?.type.name).toBe(type);
      expect(view.state.doc.lastChild?.textContent).toBe("After");
    });
  }
  for (const level of [1, 2, 3, 4, 5, 6]) it(`keeps H${level} pinyin and its committed Chinese in the same paragraph`, async () => {
    const prefix = "#".repeat(level) + " ", view = setup([prefix, ""]);
    composition(view, "compositionstart");
    view.dispatch(view.state.tr.insertText("c"));
    const update = view.state.tr.insertText("ce", prefix.length + 1, prefix.length + 2);
    view.dispatch(update.setSelection(TextSelection.create(update.doc, prefix.length + 1, prefix.length + 3)));
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(view.state.selection.$from.parent).toBe(view.state.doc.firstChild);
    view.dispatch(view.state.tr.insertText("ce shi", prefix.length + 1, prefix.length + 3));
    view.dispatch(view.state.tr.insertText("测试", prefix.length + 1, prefix.length + 7));
    composition(view, "compositionend"); await settle();
    expect(view.state.doc.firstChild?.textContent).toBe(prefix + "测试");
    expect(view.state.doc.lastChild?.textContent).toBe("");
    select(view, view.state.doc.firstChild!.nodeSize + 1);
    expect(serialize(view.state.doc)).toBe(prefix + "测试");
    expect(view.state.doc.firstChild?.attrs.level).toBe(level);
  });
  it("defers leaving a composing draft, maps its position, and commits after composition", async () => {
    const view = setup(["Before", "## ce", "After"], 1);
    composition(view, "compositionstart");
    select(view, view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + 1);
    expect(view.state.doc.child(1).type.name).toBe("paragraph");
    view.dispatch(view.state.tr.insertText("prefix ", 1, 1));
    composition(view, "compositionend"); await settle();
    expect(view.state.doc.child(1).type.name).toBe("heading");
    expect(serialize(view.state.doc)).toBe("prefix Before\n\n## ce\n\nAfter");
  });
  it("drops a deferred conversion if its paragraph is deleted", async () => {
    const view = setup(["## ce", "After"]);
    composition(view, "compositionstart"); select(view, view.state.doc.firstChild!.nodeSize + 1);
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    view.dispatch(view.state.tr.delete(0, view.state.doc.firstChild!.nodeSize));
    composition(view, "compositionend"); await settle();
    expect(serialize(view.state.doc)).toBe("After"); expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
  });
  it("cancels a deferred conversion when the selection returns to its paragraph", async () => {
    const view = setup(["## ce", "After"]);
    composition(view, "compositionstart"); select(view, view.state.doc.firstChild!.nodeSize + 1); select(view, 6);
    composition(view, "compositionend"); await settle();
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    select(view, view.state.doc.firstChild!.nodeSize + 1); expect(view.state.doc.firstChild?.type.name).toBe("heading");
  });
  it("keeps composition-tagged selection transactions from converting drafts", () => {
    const view = setup(["## ce", "After"]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize + 1)).setMeta("composition", 1));
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    view.dispatch(view.state.tr); expect(view.state.doc.firstChild?.type.name).toBe("heading");
  });
  for (const source of ["***", "```ts"]) it(`cancels a deferred draft when composition changes its syntax: ${source}`, async () => {
    const view = setup([source, "After"]);
    composition(view, "compositionstart"); select(view, view.state.doc.firstChild!.nodeSize + 1);
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    view.dispatch(view.state.tr.insertText("中文", source.length + 1, source.length + 1));
    composition(view, "compositionend"); await settle();
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(view.state.doc.firstChild?.textContent).toBe(source + "中文");
  });
  it("does not add display-only selections to undo history", () => {
    const view = setup(["## ce", "After"]);
    select(view, 4, 6); select(view, 6);
    expect(undo(view.state, view.dispatch)).toBe(false);
  });
  for (const options of [{ isComposing: true }, { keyCode: 229 }]) it(`leaves heading candidate-list arrows to the IME: ${JSON.stringify(options)}`, () => {
    const view = setup(["## ce"]), before = view.state.doc;
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", ...options });
    expect(view.someProp("handleKeyDown", handler => handler(view, event))).toBeFalsy();
    expect(view.state.doc.eq(before)).toBe(true);
  });
  it("rejects imperative conversion during composition and cancels deferred work on destruction", async () => {
    const handle = leaveLineDraft({ match: text => text.startsWith("## ") ? { data: {}, prefixLen: 3 } : null, draftClass: () => "draft", commit: (tr, pos, paragraph) => { tr.setBlockType(pos, pos + paragraph.nodeSize, schema.nodes.heading, { level: 2 }); } });
    const view = setup(["## ce", "After"]);
    composition(view, "compositionstart"); expect(handle.commit(view)).toBe(false);
    select(view, view.state.doc.firstChild!.nodeSize + 1); composition(view, "compositionend");
    const dispatch = vi.spyOn(view, "dispatch"); view.destroy(); await settle();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

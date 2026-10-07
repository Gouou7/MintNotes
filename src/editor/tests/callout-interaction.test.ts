import { afterEach, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo } from "prosemirror-history";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { parse } from "../../../.generated/typora-web/src/parser";
import { schema } from "../../../.generated/typora-web/src/schema";
import { callout } from "../../../.generated/typora-web/src/mint/callout";
import { parseCalloutMarker } from "../product/calloutMarker";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });
function setup(source: string) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ schema, doc: parse(source), plugins: defaultPlugins({ cursorWidget: false, parseCallout: parseCalloutMarker }) }) });
  views.push(view); return view;
}
function select(view: EditorView, text: string, offset = 0) {
  let position = -1;
  view.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) position = pos + 1 + offset; });
  expect(position).toBeGreaterThanOrEqual(0); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
}
function key(view: EditorView, value: string) {
  return view.someProp("handleKeyDown", handler => handler(view, new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
}
describe("Callout editing", () => {
  for (const source of ["> [!tip] Title\n>\n> Body", "> [!tip] Title\n> Body"]) {
    it(`retains the rendered header while editing the body (${source.includes("\n>\n") ? "separate" : "shared"} paragraph)`, () => {
      const view = setup(source), text = source.includes("\n>\n") ? "Body" : "[!tip] Title\nBody";
      select(view, text, text.length);
      expect(view.dom.querySelector(".markdown-callout")?.classList.contains("mint-callout-rendered")).toBe(true);
      expect(view.dom.querySelector(".callout-header strong")?.textContent).toBe("Title");
      select(view, source.includes("\n>\n") ? "[!tip] Title" : text, 2);
      expect(view.dom.querySelector(".markdown-callout")?.classList.contains("mint-callout-editing")).toBe(true);
    });
  }
  it("exposes only the nested marker while keeping the outer header rendered", () => {
    const view = setup("> [!note] Outer\n>\n> > [!tip] Inner\n> > Body");
    select(view, "[!tip] Inner\nBody", 2);
    const quotes = view.dom.querySelectorAll(".markdown-callout");
    expect(quotes[0].classList.contains("mint-callout-rendered")).toBe(true);
    expect(quotes[1].classList.contains("mint-callout-editing")).toBe(true);
  });
  it("returns from a newly created empty body to the marker and can undo the deletion", () => {
    const view = setup("> [!note] Title"); select(view, "[!note] Title", "[!note] Title".length);
    key(view, "Enter");
    expect(view.state.selection.$from.parent.textContent).toBe("");
    expect(view.dom.querySelector(".mint-callout-rendered")).not.toBeNull();
    const before = view.state.doc;
    expect(key(view, "Backspace")).toBe(true);
    expect(view.state.doc.firstChild?.childCount).toBe(1);
    expect(view.state.selection.$from.parentOffset).toBe("[!note] Title".length);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
  });
  it("leaves nonempty and nested bodies to normal keyboard handling", () => {
    const plugin = callout.plugins!(schema, { parseCallout: parseCalloutMarker })[0], handler = plugin.props.handleKeyDown!;
    for (const source of ["> [!note]\n>\n> Body", "> [!note]\n>\n> > nested"]) {
      const view = setup(source); select(view, source.endsWith("Body") ? "Body" : "nested");
      const before = view.state.doc;
      expect(handler.call(plugin, view, new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(false);
      expect(view.state.doc.eq(before)).toBe(true);
    }
  });
  it("does not intercept composing or readonly Backspace", () => {
    const view = setup("> [!note]"); select(view, "[!note]", 7); key(view, "Enter"); const before = view.state.doc;
    for (const readOnly of [true, false]) {
      const plugin = callout.plugins!(schema, { readOnly, parseCallout: parseCalloutMarker })[0], handler = plugin.props.handleKeyDown!;
      expect(handler.call(plugin, view, new KeyboardEvent("keydown", { key: "Backspace", isComposing: !readOnly }))).toBe(false);
      expect(view.state.doc.eq(before)).toBe(true);
    }
  });
});

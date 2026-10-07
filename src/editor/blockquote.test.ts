import { afterEach, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undoInputRule } from "prosemirror-inputrules";
import { defaultPlugins } from "../../.generated/typora-web/src/editor";
import { parse } from "../../.generated/typora-web/src/parser";
import { schema } from "../../.generated/typora-web/src/schema";
import { serialize } from "../../.generated/typora-web/src/serializer";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });
function setup(source = "") {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ schema, doc: parse(source), plugins: defaultPlugins({ cursorWidget: false }) }) });
  views.push(view); view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc))); return view;
}
function input(view: EditorView, text: string) {
  const { from, to } = view.state.selection;
  const handled = view.someProp("handleTextInput", handler => handler(view, from, to, text, () => view.state.tr.insertText(text, from, to)));
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to));
}

describe("quote escaping", () => {
  it("does not escape pending quote input or inline greater-than characters", () => {
    for (const text of [">", "> pending", "a > b", "> > nested"]) {
      const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
      expect(serialize(doc)).toBe(text);
    }
  });
  for (const source of [
    String.raw`\> literal`, String.raw`before \> literal`, String.raw`\\> literal`, String.raw`\\\> literal`,
    '> quoted\n>\n> > nested', String.raw`> \> literal inside quote`,
    String.raw`[label](https://example.com/a\>b)`, String.raw`[label \> literal](https://example.com/path)`,
    String.raw`\> [!note] literal marker`, '`> literal \\>`', '```md\n> literal \\>\n```',
    '---\nquote: >\n  literal\n---\n\nbody',
  ]) it(`preserves quote structure and authored escapes: ${source.slice(0, 40)}`, () => {
    const first = parse(source), output = serialize(first);
    expect(parse(output).toJSON()).toEqual(first.toJSON());
    if (first.textContent.includes('\\>')) expect(output).toContain('\\>');
  });
  it("keeps explicitly escaped quote starts as paragraphs", () => {
    const first = parse(String.raw`\> literal`);
    expect(first.firstChild?.type.name).toBe("paragraph");
    expect(serialize(first)).toBe('\\> literal');
    expect(parse(serialize(first)).firstChild?.type.name).toBe("paragraph");
  });
  it("wraps both separate and batched native input without dropping following text", () => {
    for (const events of [[">", " ", "quoted"], [">", " quoted"], ["> quoted"]]) {
      const view = setup(); events.forEach(text => input(view, text));
      expect(view.state.doc.firstChild?.type.name).toBe("blockquote");
      expect(view.state.doc.textContent).toBe("quoted"); expect(serialize(view.state.doc)).toBe("> quoted");
    }
  });
  it("can undo a batched input rule back to the literal paragraph", () => {
    const view = setup(); input(view, "> quoted"); expect(undoInputRule(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph"); expect(view.state.doc.textContent).toBe("> quoted");
  });
  it("leaves authored escapes and fenced code input literal", () => {
    const escaped = setup(); input(escaped, '\\> literal'); expect(escaped.state.doc.firstChild?.type.name).toBe("paragraph");
    const code = setup('```md\ncode\n```'); input(code, '\n> literal');
    expect(code.state.doc.firstChild?.type.name).toBe("code_block"); expect(code.state.doc.textContent).toBe("code\n> literal");
  });
  it("keeps link destinations containing a quote escape after live normalization", () => {
    const source = String.raw`[label](https://example.com/a\>b)`;
    const targets = (doc: ReturnType<typeof parse>) => {
      const hrefs: string[] = []; doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === "link") hrefs.push(mark.attrs.href); }); return hrefs;
    };
    const expected = targets(parse(source)); expect(expected.length).toBeGreaterThan(0);
    const view = setup(); input(view, source); expect(targets(view.state.doc).length).toBeGreaterThan(0);
    input(view, "!");
    expect(targets(parse(serialize(view.state.doc)))).toEqual(expected);
  });
});

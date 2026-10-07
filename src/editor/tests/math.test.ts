import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo } from "prosemirror-history";
import { Slice } from "prosemirror-model";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { parse } from "../../../.generated/typora-web/src/parser";
import { serialize } from "../../../.generated/typora-web/src/serializer";
import { schema } from "../../../.generated/typora-web/src/schema";
import { literals } from "../../../.generated/typora-web/src/mint/syntax";
import { mathAt, mathBlockSource, mathBodySelection } from "../../../.generated/typora-web/src/mint/math-syntax";
import { createMintEditor } from "../engine";
import { renderMathInto } from "../product/richRenderers";
import type { MintContext } from "../../../.generated/typora-web/src/mint/context";
import { mathBehaviorKey } from "../../../.generated/typora-web/src/mint/math-behavior";

vi.hoisted(() => {
  document.insertBefore(document.implementation.createDocumentType("html", "", ""), document.documentElement);
  Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });
});

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup(source: string, context: MintContext = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { editable: () => !context.readOnly,
    state: EditorState.create({ schema, doc: parse(source), plugins: defaultPlugins(context) }),
  });
  vi.spyOn(view, "endOfTextblock").mockReturnValue(false);
  views.push(view); return view;
}
function select(view: EditorView, from: number, to = from) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))); }
function key(view: EditorView, key: string, options: KeyboardEventInit = {}) {
  const plugin = mathBehaviorKey.get(view.state);
  return !!plugin?.props.handleKeyDown?.call(plugin, view, new KeyboardEvent("keydown", { key, ...options }));
}

describe("formula syntax and Markdown preservation", () => {
  for (const source of ['$$\nA_B\n$$', '$$A_B$$', '$$ A_B $$', '$$A_B\nC_D\n$$', '$$\nA_B\nC_D$$', '$$\n\n$$', '$$\n\\begin{aligned}\nA_B &= C_D \\\\\nE_F &= G_H\n\\end{aligned}\n$$']) {
    it(`loads and serializes a single complete block ${JSON.stringify(source)}`, () => {
      const doc = parse(source);
      expect(doc.childCount).toBe(1); expect(doc.firstChild?.type.name).toBe("mint_math_block");
      expect(doc.firstChild?.textContent).toBe(source); expect(serialize(doc)).toBe(source);
      expect(parse(serialize(doc)).eq(doc)).toBe(true);
      expect(mathBlockSource(source)?.complete).toBe(true);
    });
  }
  for (const source of ['Text $A_B$ end', 'Text $$ A_B $$ end', '| A | B |\n| --- | --- |\n| $A_B$ | $$ C_D $$ |', '> $$\n> A_B\n> $$', '- $$\n  A_B\n  $$', '$$\nA_B\n$$\n\n$$\nC_D\n$$']) {
    it(`retains math inside its container ${source.slice(0, 35)}`, () => {
      const doc = parse(source), output = serialize(doc);
      expect(output).toContain("A_B"); expect(output).not.toContain("A\\_B");
      expect(parse(output).toJSON()).toEqual(doc.toJSON());
    });
  }
  it("keeps placement separate from display style and requires exact closing delimiters", () => {
    expect(parse('Before $$A_B$$ after').firstChild?.type.name).toBe('paragraph');
    expect(literals('Before $$ A_B $$ after')[0]).toMatchObject({ kind: 'display-math', body: ' A_B ' });
    expect(mathAt('$A_B$$', 0)).toBeNull(); expect(mathAt('$$A_B$', 0)).toBeNull();
    expect(mathAt('$$$A_B$$$', 0)).toBeNull(); expect(mathAt('$A\nB$', 0)).toBeNull();
    expect(mathAt('$A\\$B$', 0)?.body).toBe('A\\$B');
    expect(mathBlockSource('$$A_B$$ after')).toBeNull();
    expect(mathBodySelection('$$\nA_B\n$$')).toEqual({ start: 3, end: 6 });
  });
  it("leaves incomplete formulas editable without consuming the following Markdown blocks", () => {
    const source = '$$\nA_B\n\n# Following heading';
    const doc = parse(source);
    expect(doc.firstChild?.type.name).toBe('paragraph'); expect(doc.lastChild?.type.name).toBe('heading');
    expect(serialize(doc)).toBe(source);
    expect(serialize(parse('Text $A_B'))).toBe('Text $A_B');
    const withCode = parse(source + '\n\n```tex\n$$\nC_D\n$$\n```');
    expect(withCode.child(1).type.name).toBe('heading'); expect(withCode.lastChild?.type.name).toBe('code_block');
    expect(withCode.lastChild?.textContent).toBe('$$\nC_D\n$$');
  });
  it("does not render escaped delimiters or literal syntax in code", () => {
    const view = setup('\\$A_B$\n\n`$A_B$`\n\n```tex\n$$\nA_B\n$$\n```', { renderMath: renderMathInto });
    expect(view.dom.querySelector('.katex')).toBeNull();
    expect(serialize(view.state.doc)).toContain('\\$');
    expect(view.state.doc.lastChild?.textContent).toBe('$$\nA_B\n$$');
  });
  it("does not interpret Markdown code, emphasis or wiki syntax inside TeX", () => {
    const body = '\\text{`literal` **text** [[Note]]}', source = `Before $${body}$ after`;
    const render = vi.fn((element: HTMLElement, tex: string) => { element.textContent = tex; });
    const view = setup(source, { renderMath: render });
    expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), body, false);
    expect(view.dom.querySelector('.wiki-link')).toBeNull();
    expect(serialize(view.state.doc)).toBe(source);
    view.state.doc.descendants(node => { if (node.isText) expect(node.marks).toEqual([]); });
  });
});

describe("formula editing", () => {
  it("creates a multiline formula on Enter, edits within the block and exits with Mod-Enter", () => {
    const view = setup('$$'), before = view.state.doc;
    select(view, 3); expect(key(view, 'Enter')).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('mint_math_block');
    expect(view.state.selection.from).toBe(4); expect(serialize(view.state.doc)).toBe('$$\n\n$$');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true);
    view.dispatch(view.state.tr.insertText('A_B'));
    expect(key(view, 'Enter')).toBe(true); view.dispatch(view.state.tr.insertText('C_D'));
    expect(serialize(view.state.doc)).toBe('$$\nA_B\nC_D\n$$');
    expect(key(view, 'Enter', { metaKey: true })).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(view.state.doc.firstChild?.textContent).toBe('$$\nA_B\nC_D\n$$');
  });
  it("promotes completed standalone input with its source and undo intact", () => {
    const view = setup(''), before = view.state.doc;
    view.dispatch(view.state.tr.insertText('$$A_B$$'));
    expect(view.state.doc.firstChild?.type.name).toBe('mint_math_block');
    expect(serialize(view.state.doc)).toBe('$$A_B$$');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true); expect(serialize(view.state.doc)).toBe('$$A_B$$');
  });
  it("creates inside a list with a valid leading paragraph and keeps formulas inline in table cells", () => {
    const list = setup('- $$');
    select(list, 5); expect(key(list, 'Enter')).toBe(true);
    expect(list.state.selection.$from.parent.type.name).toBe('mint_math_block');
    list.dispatch(list.state.tr.insertText('A_B'));
    list.state.doc.check(); expect(parse(serialize(list.state.doc)).eq(list.state.doc)).toBe(true);
    const table = setup('| A |\n| --- |\n| $$ |');
    let position = 0;
    table.state.doc.descendants((node, pos) => { if (node.type.name === 'table_cell') { position = pos + 1; return false; } return true; });
    select(table, position + 2); expect(key(table, 'Enter')).toBe(false);
    table.dispatch(table.state.tr.insertText('A_B$$'));
    table.state.doc.check(); expect(table.state.doc.firstChild?.type.name).toBe('table');
    expect(table.state.selection.$from.parent.type.name).toBe('table_cell');
    expect(serialize(table.state.doc)).toContain('$$A_B$$');
    expect(parse(serialize(table.state.doc)).eq(table.state.doc)).toBe(true);
  });
  it("pastes a complete multiline formula as one block without losing surrounding text", () => {
    const view = setup('Before after'), before = view.state.doc;
    select(view, 8);
    const event = { clipboardData: { getData: (type: string) => type === 'text/plain' ? '$$\r\nA_B\r\n$$' : '' } } as ClipboardEvent;
    expect(view.someProp('handlePaste', handler => handler(view, event, Slice.empty))).toBe(true);
    expect(serialize(view.state.doc)).toContain('$$\nA_B\n$$');
    expect(serialize(view.state.doc)).toContain('Before'); expect(serialize(view.state.doc)).toContain('after');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it("shows inline source on click or range selection without changing the document", () => {
    const view = setup('Before $A_B$ after', { renderMath: renderMathInto }), before = view.state.doc;
    select(view, view.state.doc.content.size - 1);
    const widget = view.dom.querySelector<HTMLElement>('.mint-math')!;
    expect(widget.querySelector('.katex')).not.toBeNull(); widget.click();
    expect(view.state.selection.from).toBe(9); expect(view.dom.querySelector('.mint-math')).toBeNull();
    select(view, 5, 15);
    expect(view.dom.querySelector('.mint-math')).toBeNull(); expect(view.dom.querySelector('.syntax-hidden')).toBeNull();
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  it("enters a block preview at the body, navigates its boundaries and leaves internal movement native", () => {
    const view = setup('Above\n\n$$\nA_B\n$$\n\nBelow', { renderMath: renderMathInto }), before = view.state.doc;
    const pos = before.firstChild!.nodeSize;
    select(view, 2); view.dom.querySelector<HTMLElement>('.mint-math-preview')!.click();
    expect(view.state.selection.from).toBe(pos + 4);
    expect(key(view, 'ArrowUp')).toBe(true); expect(view.state.selection.$from.parent.textContent).toBe('Above');
    expect(key(view, 'ArrowDown')).toBe(true); expect(view.state.selection.from).toBe(pos + 4);
    select(view, pos + 5); expect(key(view, 'ArrowUp')).toBe(false); expect(key(view, 'ArrowDown')).toBe(false);
    select(view, pos + 7); expect(key(view, 'ArrowDown')).toBe(true); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    expect(key(view, 'ArrowUp')).toBe(true); expect(view.state.selection.from).toBe(pos + 7);
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) it(`preserves modified or composing arrows ${JSON.stringify(options)}`, () => {
    const view = setup('Above\n\n$$\nA_B\n$$'); select(view, view.state.doc.firstChild!.nodeSize - 1);
    const before = view.state;
    expect(key(view, 'ArrowDown', options)).toBe(false); expect(view.state).toBe(before);
  });
  it("waits for IME completion before changing the input surface and cancels deferred work on destroy", async () => {
    vi.useFakeTimers();
    const scheduled = vi.spyOn(globalThis, 'setTimeout'), cleared = vi.spyOn(globalThis, 'clearTimeout');
    const view = setup('');
    view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    view.dispatch(view.state.tr.insertText('$$A_B$$'));
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph'); expect(key(view, 'Enter', { isComposing: true })).toBe(false);
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(25);
    expect(view.state.doc.firstChild?.type.name).toBe('mint_math_block'); expect(serialize(view.state.doc)).toBe('$$A_B$$');
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    const timerIndex = scheduled.mock.calls.findLastIndex(call => call[1] === 25);
    const mathTimer = scheduled.mock.results[timerIndex].value;
    view.destroy(); views.splice(views.indexOf(view), 1);
    expect(cleared).toHaveBeenCalledWith(mathTimer);
  });
});

describe("formula rendering and lifecycle", () => {
  it("renders the multiline subscript with KaTeX, keeps invalid TeX readable and prohibits trusted commands", () => {
    const host = document.createElement('div');
    const cleanup = renderMathInto(host, '\nA_B\n', true);
    expect(host.querySelector('.katex-display .katex')).not.toBeNull(); expect(host.querySelector('math msub')).not.toBeNull();
    cleanup(); expect(host.childNodes.length).toBe(0);
    renderMathInto(host, '\\notACommand{', false); expect(host.textContent).toContain('\\notACommand');
    renderMathInto(host, '\\href{https://example.com}{x}', false); expect(host.querySelector('a')).toBeNull();
  });
  it("preserves loaded source through previews, selections, reading/source modes and refreshes without saving", () => {
    const host = document.createElement('div'), changed = vi.fn(), disposals: ReturnType<typeof vi.fn>[] = [];
    document.body.append(host);
    const source = 'Before $A_B$ after\n\n$$\nA_B\n$$';
    const render = vi.fn((element: HTMLElement, text: string, display: boolean) => {
      element.textContent = text; element.dataset.display = String(display);
      const dispose = vi.fn(() => element.replaceChildren()); disposals.push(dispose); return dispose;
    });
    const editor = createMintEditor(host, { initialContent: source, onChange: changed, renderMath: render });
    try {
      host.querySelector<HTMLElement>('.mint-math-preview')!.click();
      expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), '\nA_B\n', true);
      editor.setMode('reading'); editor.refreshPresentation(); editor.setMode('source'); editor.setMode('live');
      expect(editor.getMarkdown()).toBe(source); expect(changed).not.toHaveBeenCalled();
      editor.loadDocument('other', 'Other note'); expect(editor.getMarkdown()).toBe('Other note');
    } finally { editor.destroy(); }
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("rejects formula interactions in reading mode and falls back when the renderer fails", () => {
    const view = setup('Before $A_B$ after\n\n$$\nA_B\n$$', { readOnly: true, renderMath: () => { throw new Error('Unavailable'); } }), before = view.state;
    expect(view.dom.textContent).toContain('A_B');
    view.dom.querySelector<HTMLElement>('.mint-math')!.click(); view.dom.querySelector<HTMLElement>('.mint-math-preview')!.click();
    expect(key(view, 'Enter')).toBe(false); expect(view.state).toBe(before);
  });
});

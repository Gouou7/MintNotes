import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo } from "prosemirror-history";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { parse } from "../../../.generated/typora-web/src/parser";
import { serialize } from "../../../.generated/typora-web/src/serializer";
import { schema } from "../../../.generated/typora-web/src/schema";
import { getLangFocus } from "../../../.generated/typora-web/src/features/fenced-code";
import { calloutBody, calloutKey } from "../../../.generated/typora-web/src/mint/callout-behavior";
import { createMintEditor } from "../engine";
import { CALLOUT_TYPES, editCalloutMarker, parseCalloutMarker } from "../product/calloutMarker";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });
function setup(source: string, readOnly = false) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { editable: () => !readOnly, state: EditorState.create({ schema, doc: parse(source), plugins: defaultPlugins({
    cursorWidget: false, readOnly, parseCallout: parseCalloutMarker, editCalloutMarker, calloutTypes: CALLOUT_TYPES,
    icon: name => { const element = document.createElement("span"); element.dataset.icon = name; return { element, destroy: vi.fn() }; },
  }) }) });
  vi.spyOn(view, 'endOfTextblock').mockReturnValue(false);
  views.push(view); return view;
}
function draft(input: HTMLInputElement, value: string) { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }
function enter(input: HTMLInputElement, isComposing = false) { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing, bubbles: true, cancelable: true })); }
function select(view: EditorView, pos: number) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))); }
function arrow(view: EditorView, key: 'ArrowUp' | 'ArrowDown', options: KeyboardEventInit = {}) {
  return !!view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key, ...options })));
}
function inputArrow(input: HTMLInputElement, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  input.dispatchEvent(event); return event.defaultPrevented;
}
function choose(view: EditorView, value: string, index = 0) {
  const select = view.dom.querySelectorAll<HTMLSelectElement>(".callout-type-select")[index]; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("code language header editing", () => {
  for (const finish of ["enter", "blur"] as const) it(`commits the entire info string on ${finish} as one undoable edit`, () => {
    const view = setup('```js\nconst literal = "[[Note]] $x$";\n```'), before = view.state.doc;
    const button = view.dom.querySelector<HTMLButtonElement>(".mint-code-language-label")!; button.click();
    const input = view.dom.querySelector<HTMLInputElement>(".cb-lang-input")!;
    expect(input.hidden).toBe(false); expect(input.value).toBe("js");
    draft(input, "ts metadata"); expect(view.state.doc.eq(before)).toBe(true);
    if (finish === "enter") enter(input); else input.blur();
    expect(view.state.doc.firstChild?.attrs.lang).toBe("ts metadata"); expect(view.state.doc.firstChild?.textContent).toBe(before.firstChild?.textContent);
    expect(input.hidden).toBe(true); expect(view.dom.querySelector(".mint-code-language-label")?.textContent).toBe("ts metadata");
    if (finish === 'enter') expect(view.state.selection.$from.parentOffset).toBe(0);
    expect(serialize(view.state.doc)).toContain('```ts metadata');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.firstChild?.attrs.lang).toBe("ts metadata");
  });
  it("keeps blank language blank, cancels Escape and rejects an invalid fence header", () => {
    const view = setup('```\nplain body\n```'), before = view.state.doc;
    const button = view.dom.querySelector<HTMLButtonElement>(".mint-code-language-label")!, input = view.dom.querySelector<HTMLInputElement>(".cb-lang-input")!;
    button.click(); enter(input); expect(view.state.doc.eq(before)).toBe(true);
    button.click(); draft(input, 'python'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.hidden).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    button.click(); draft(input, 'js```'); enter(input); expect(view.state.doc.eq(before)).toBe(true); expect(input.hidden).toBe(false);
    inputArrow(input, 'ArrowDown'); expect(view.state.doc.eq(before)).toBe(true); expect(input.hidden).toBe(false);
  });
  it("waits for IME completion and commits a blurred composition once", () => {
    const view = setup('```js\nbody\n```'), before = view.state.doc;
    view.dom.querySelector<HTMLButtonElement>('.mint-code-language-label')!.click(); const input = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); draft(input, 'python'); enter(input, true); inputArrow(input, 'ArrowDown');
    expect(input.hidden).toBe(false); input.blur();
    expect(view.state.doc.eq(before)).toBe(true);
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); expect(view.state.doc.firstChild?.attrs.lang).toBe('python');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
});

describe('code block arrow navigation', () => {
  it('visits above → language → body → below and reverses that order, committing drafts before leaving', () => {
    const view = setup('Above\n\n```js\nfirst\nlast\n```\n\nBelow'), before = view.state.doc;
    const codePos = before.firstChild!.nodeSize, codeEnd = codePos + before.child(1).nodeSize - 1, below = codeEnd + 2;
    const input = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    select(view, codePos - 1); expect(arrow(view, 'ArrowDown')).toBe(true);
    expect(input.hidden).toBe(false); expect(document.activeElement).toBe(input); expect(getLangFocus(view.state)?.pos).toBe(codePos);
    expect(view.state.doc.eq(before)).toBe(true);
    draft(input, 'python metadata'); inputArrow(input, 'ArrowDown');
    expect(input.hidden).toBe(true); expect(view.state.selection.from).toBe(codePos + 1);
    expect(view.state.doc.child(1).attrs.lang).toBe('python metadata');
    select(view, codeEnd); expect(arrow(view, 'ArrowDown')).toBe(true); expect(view.state.selection.from).toBe(below); expect(getLangFocus(view.state)).toBeNull();
    expect(arrow(view, 'ArrowUp')).toBe(true); expect(view.state.selection.from).toBe(codeEnd); expect(input.hidden).toBe(true);
    select(view, codePos + 1); expect(arrow(view, 'ArrowUp')).toBe(true); expect(input.hidden).toBe(false);
    draft(input, 'ts'); inputArrow(input, 'ArrowUp');
    expect(view.state.selection.from).toBe(codePos - 1); expect(input.hidden).toBe(true); expect(getLangFocus(view.state)).toBeNull();
    expect(view.state.doc.child(1).attrs.lang).toBe('ts'); expect(view.state.doc.child(1).textContent).toBe('first\nlast');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.child(1).attrs.lang).toBe('python metadata');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('keeps an empty code body as a separate navigation stop', () => {
    const view = setup('Above\n\n```\n```\n\nBelow'), before = view.state.doc, pos = before.firstChild!.nodeSize;
    const input = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    select(view, pos - 1); arrow(view, 'ArrowDown'); expect(input.hidden).toBe(false);
    inputArrow(input, 'ArrowDown'); expect(view.state.selection.from).toBe(pos + 1); expect(input.hidden).toBe(true);
    arrow(view, 'ArrowDown'); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    arrow(view, 'ArrowUp'); expect(view.state.selection.$from.parent.type.name).toBe('code_block'); expect(input.hidden).toBe(true);
    arrow(view, 'ArrowUp'); expect(input.hidden).toBe(false); inputArrow(input, 'ArrowUp');
    expect(view.state.selection.from).toBe(pos - 1); expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  it('opens the next header between adjacent code blocks and returns to the preceding body', () => {
    const view = setup('```js\none\n```\n\n```ts\ntwo\n```'), before = view.state.doc, second = before.firstChild!.nodeSize;
    const inputs = view.dom.querySelectorAll<HTMLInputElement>('.cb-lang-input');
    select(view, second - 1); arrow(view, 'ArrowDown'); expect(inputs[0].hidden).toBe(true); expect(inputs[1].hidden).toBe(false);
    inputArrow(inputs[1], 'ArrowDown'); expect(view.state.selection.from).toBe(second + 1);
    arrow(view, 'ArrowUp'); expect(inputs[1].hidden).toBe(false);
    inputArrow(inputs[1], 'ArrowUp'); expect(view.state.selection.from).toBe(second - 1); expect(view.state.doc.eq(before)).toBe(true);
  });
  for (const nested of [false, true]) it(`provides paragraphs at ${nested ? 'quote' : 'document'} edges without losing code`, () => {
    const view = setup(nested ? '> ```js\n> body\n> ```' : '```js\nbody\n```');
    const initialPos = nested ? 1 : 0;
    select(view, initialPos + 1); arrow(view, 'ArrowUp');
    const input = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!; inputArrow(input, 'ArrowUp');
    const container = nested ? view.state.doc.firstChild! : view.state.doc;
    expect(container.firstChild?.type.name).toBe('paragraph'); expect(container.child(1).textContent).toBe('body');
    const pos = initialPos + container.firstChild!.nodeSize;
    select(view, pos + container.child(1).nodeSize - 1); arrow(view, 'ArrowDown');
    const updated = nested ? view.state.doc.firstChild! : view.state.doc;
    expect(updated.childCount).toBe(3); expect(updated.lastChild?.type.name).toBe('paragraph');
    expect(updated.child(1).attrs.lang).toBe('js'); expect(updated.child(1).textContent).toBe('body'); expect(getLangFocus(view.state)).toBeNull();
  });
  it('uses visual line edges and leaves internal code movement to the browser', () => {
    const view = setup('Above\n\n```js\nfirst\nlast\n```\n\nBelow'), pos = view.state.doc.firstChild!.nodeSize;
    const input = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    select(view, pos + 3); expect(arrow(view, 'ArrowUp')).toBe(false); expect(arrow(view, 'ArrowDown')).toBe(false); expect(input.hidden).toBe(true);
    vi.mocked(view.endOfTextblock).mockReturnValue(true);
    arrow(view, 'ArrowUp'); expect(input.hidden).toBe(false); inputArrow(input, 'ArrowUp');
    select(view, 3); arrow(view, 'ArrowDown'); expect(input.hidden).toBe(false); inputArrow(input, 'ArrowDown');
    select(view, pos + 9); arrow(view, 'ArrowDown'); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    select(view, view.state.selection.from + 2); arrow(view, 'ArrowUp'); expect(view.state.selection.$from.parent.textContent).toBe('first\nlast'); expect(input.hidden).toBe(true);
  });
  for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) it(`preserves native modified/composing arrows ${JSON.stringify(options)}`, () => {
    const view = setup('Above\n\n```js\nbody\n```'), before = view.state.doc;
    select(view, before.firstChild!.nodeSize - 1);
    expect(arrow(view, 'ArrowDown', options)).toBe(false); expect(getLangFocus(view.state)).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('does not enter a disabled language editor in reading mode', () => {
    const view = setup('Above\n\n```js\nbody\n```', true), before = view.state.doc;
    select(view, before.firstChild!.nodeSize - 1);
    expect(arrow(view, 'ArrowDown')).toBe(false); expect(getLangFocus(view.state)).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
  });
  for (const finish of ['blur', 'escape'] as const) it(`clears unchanged virtual language focus on ${finish}`, () => {
    const view = setup('Above\n\n```js\nbody\n```'), before = view.state.doc;
    select(view, before.firstChild!.nodeSize - 1); arrow(view, 'ArrowDown');
    const input = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    if (finish === 'blur') input.blur(); else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.hidden).toBe(true); expect(getLangFocus(view.state)).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
  });
});

describe("Callout header editing", () => {
  it("offers every supported type and alias and updates a default title", () => {
    const view = setup('> [!note]-\n> body'), before = view.state.doc;
    expect([...view.dom.querySelectorAll<HTMLOptionElement>('.callout-type-select option')].map(option => option.value)).toEqual(CALLOUT_TYPES.map(type => type.value));
    choose(view, 'warning');
    expect(view.dom.querySelector('.callout-header strong')?.textContent).toBe('Warning');
    expect(view.dom.querySelector('[data-icon="callout-warning"]')).not.toBeNull();
    expect(view.dom.querySelector('.callout-warning')).not.toBeNull(); expect(view.state.doc.firstChild?.firstChild?.textContent).toBe('[!warning]-\nbody');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it("keeps custom titles, fold markers, literal body and nested Callouts", () => {
    const view = setup('> [!note]+ **Custom title** {color=red icon=bug}\n> body [[Note]]\n>\n> > [!tip] Nested\n> > inner'), before = view.state.doc;
    choose(view, 'success');
    expect(view.dom.querySelector('.callout-header strong')?.textContent).toBe('**Custom title**');
    expect(view.dom.querySelector('[data-icon="callout-success"]')).not.toBeNull();
    expect(serialize(view.state.doc)).toContain('[!success]+ **Custom title**');
    expect(serialize(view.state.doc)).not.toContain('color=red');
    expect(view.state.doc.firstChild?.lastChild?.eq(before.firstChild!.lastChild!)).toBe(true);
    choose(view, 'danger', 1); expect(serialize(view.state.doc)).toContain('[!danger] Nested'); expect(serialize(view.state.doc)).toContain('body [[Note]]');
  });
  for (const finish of ['enter', 'blur'] as const) it(`commits titles on ${finish} without replacing the type control`, () => {
    const view = setup('> [!note]+ Old {icon=bug color=red}\n> Body'), before = view.state.doc;
    const typeControl = view.dom.querySelector('.callout-type-select');
    view.dom.querySelector<HTMLButtonElement>('.callout-title-editor button')!.click(); const input = view.dom.querySelector<HTMLInputElement>('.callout-title-editor input')!;
    draft(input, 'New 标题'); expect(view.state.doc.eq(before)).toBe(true);
    if (finish === 'enter') enter(input); else input.blur();
    expect(input.hidden).toBe(true); expect(serialize(view.state.doc)).toContain('[!note]+ New 标题 {icon=bug color=red}');
    expect(view.dom.querySelector('.callout-type-select')).toBe(typeControl);
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it("clears an explicit title back to its default and keeps folding display-only", () => {
    const view = setup('> [!note]- Custom\n> Body');
    view.dom.querySelector<HTMLButtonElement>('.callout-title-editor button')!.click(); const input = view.dom.querySelector<HTMLInputElement>('.callout-title-editor input')!;
    draft(input, ''); input.blur(); expect(serialize(view.state.doc)).toContain('[!note]-\n');
    expect(view.dom.querySelector('.callout-header strong')?.textContent).toBe('Note'); const before = view.state.doc;
    view.dom.querySelector<HTMLButtonElement>('.callout-toggle')!.click(); expect(view.state.doc.eq(before)).toBe(true);
    expect(view.dom.querySelector('.callout-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('header input horizontal exits', () => {
  for (const kind of ['callout', 'code'] as const) it(`clears virtual ${kind} header focus when exiting unchanged text to a separator`, () => {
    const view = setup(kind === 'callout' ? '---\n\n> [!note] Title\n> Body' : '---\n\n```js\nbody\n```'), before = view.state.doc;
    const pos = before.firstChild!.nodeSize;
    if (kind === 'callout') select(view, calloutBody(before, pos)!.start); else select(view, pos + 1);
    arrow(view, 'ArrowUp'); const field = view.dom.querySelector<HTMLInputElement>(kind === 'callout' ? '.callout-title-editor input' : '.cb-lang-input')!;
    expect(field.hidden).toBe(false); field.setSelectionRange(0, 0); inputArrow(field, 'ArrowLeft');
    expect(field.hidden).toBe(true); expect(document.activeElement).toBe(view.dom); expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(0); expect(getLangFocus(view.state)).toBeNull(); expect(calloutKey.getState(view.state)?.titleFocus).toBeNull();
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  for (const kind of ['callout', 'code'] as const) for (const above of [true, false]) it(`exits a nested ${kind} header on the left ${above ? 'to preceding text' : 'at the document start'}`, () => {
    const nested = kind === 'callout' ? '> > [!tip] Inner\n> > Body' : '> ```js\n> body\n> ```';
    const view = setup((above ? 'Above\n\n' : '') + '> [!note] Outer\n>\n' + nested), before = view.state.doc;
    const button = kind === 'callout' ? view.dom.querySelectorAll<HTMLButtonElement>('.callout-title-editor button')[1] : view.dom.querySelector<HTMLButtonElement>('.mint-code-language-label')!;
    button.click(); const field = kind === 'callout' ? view.dom.querySelectorAll<HTMLInputElement>('.callout-title-editor input')[1] : view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    field.setSelectionRange(0, 0); inputArrow(field, 'ArrowLeft');
    expect([...view.dom.querySelectorAll<HTMLInputElement>('.callout-title-editor input, .cb-lang-input')].every(input => input.hidden)).toBe(true);
    expect(document.activeElement).toBe(view.dom);
    expect(view.state.selection.$from.parent.textContent).toBe(above ? 'Above' : kind === 'callout' ? '[!tip] Inner\nBody' : 'body');
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  for (const firstBody of ['callout', 'code', 'separator'] as const) it(`enters the first ${firstBody} body from the outer title without another header stop`, () => {
    const body = firstBody === 'callout' ? '> > [!tip] Inner\n> > Body' : firstBody === 'code' ? '> ```js\n> body\n> ```' : '> ---\n>\n> Body';
    const view = setup('> [!note] Outer\n>\n' + body), before = view.state.doc;
    view.dom.querySelector<HTMLButtonElement>('.callout-title-editor button')!.click(); const field = view.dom.querySelector<HTMLInputElement>('.callout-title-editor input')!;
    field.setSelectionRange(field.value.length, field.value.length); inputArrow(field, 'ArrowRight');
    expect([...view.dom.querySelectorAll<HTMLInputElement>('.callout-title-editor input, .cb-lang-input')].every(input => input.hidden)).toBe(true);
    expect(document.activeElement).toBe(view.dom);
    if (firstBody === 'separator') expect(view.state.selection).toBeInstanceOf(NodeSelection);
    else expect(view.state.selection.$from.parent.textContent).toBe(firstBody === 'callout' ? '[!tip] Inner\nBody' : 'body');
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  for (const kind of ['callout', 'code'] as const) for (const direction of ['ArrowLeft', 'ArrowRight'] as const) it(`exits the ${kind} input on ${direction} at its boundary and commits its draft`, () => {
    const view = setup(kind === 'callout' ? 'Above\n\n> [!note] Title\n> Body\n\nBelow' : 'Above\n\n```js\nbody\n```\n\nBelow'), before = view.state.doc;
    view.dom.querySelector<HTMLButtonElement>(kind === 'callout' ? '.callout-title-editor button' : '.mint-code-language-label')!.click();
    const field = view.dom.querySelector<HTMLInputElement>(kind === 'callout' ? '.callout-title-editor input' : '.cb-lang-input')!;
    draft(field, kind === 'callout' ? 'Changed title' : 'python metadata');
    const boundary = direction === 'ArrowLeft' ? 0 : field.value.length; field.setSelectionRange(boundary, boundary);
    expect(inputArrow(field, direction)).toBe(true); expect(field.hidden).toBe(true); expect(document.activeElement).toBe(view.dom);
    expect(view.state.selection.$from.parent.textContent).toBe(direction === 'ArrowLeft' ? 'Above' : kind === 'callout' ? '[!note] Changed title\nBody' : 'body');
    if (direction === 'ArrowLeft') expect(view.state.selection.$from.parentOffset).toBe('Above'.length);
    else if (kind === 'code') expect(view.state.selection.$from.parentOffset).toBe(0);
    else expect(view.state.selection.from).toBe(calloutBody(view.state.doc, before.firstChild!.nodeSize)!.start);
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  for (const kind of ['callout', 'code'] as const) it(`keeps native movement and selection in the ${kind} input`, () => {
    const view = setup(kind === 'callout' ? 'Above\n\n> [!note] Title\n> Body' : 'Above\n\n```javascript\nbody\n```'), before = view.state.doc;
    view.dom.querySelector<HTMLButtonElement>(kind === 'callout' ? '.callout-title-editor button' : '.mint-code-language-label')!.click();
    const field = view.dom.querySelector<HTMLInputElement>(kind === 'callout' ? '.callout-title-editor input' : '.cb-lang-input')!;
    field.setSelectionRange(2, 2); expect(inputArrow(field, 'ArrowLeft')).toBe(false); expect(inputArrow(field, 'ArrowRight')).toBe(false);
    field.setSelectionRange(0, field.value.length); expect(inputArrow(field, 'ArrowLeft')).toBe(false); expect(inputArrow(field, 'ArrowRight')).toBe(false);
    field.setSelectionRange(0, 0);
    for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) expect(inputArrow(field, 'ArrowLeft', options)).toBe(false);
    expect(field.hidden).toBe(false); expect(document.activeElement).toBe(field); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('keeps an invalid code language in its input when attempting to exit', () => {
    const view = setup('Above\n\n```js\nbody\n```'), before = view.state.doc;
    view.dom.querySelector<HTMLButtonElement>('.mint-code-language-label')!.click(); const field = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    draft(field, 'js```'); field.setSelectionRange(field.value.length, field.value.length);
    expect(inputArrow(field, 'ArrowRight')).toBe(true); expect(field.hidden).toBe(false); expect(document.activeElement).toBe(field); expect(view.state.doc.eq(before)).toBe(true);
  });
});

describe("header control lifecycle", () => {
  it("disables edits in reading mode and discards old drafts on note replacement", () => {
    const host = document.createElement('div'), changed = vi.fn(); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: '> [!note] Title\n> Body\n\n```js\ncode\n```', parseCallout: parseCalloutMarker, editCalloutMarker, calloutTypes: CALLOUT_TYPES, onChange: changed });
    try {
      editor.setMode('reading');
      expect(host.querySelector<HTMLSelectElement>('.callout-type-select')?.disabled).toBe(true);
      expect(host.querySelector<HTMLButtonElement>('.callout-title-editor button')?.disabled).toBe(true);
      expect(host.querySelector<HTMLButtonElement>('.mint-code-language-label')?.disabled).toBe(true);
      editor.setMode('live'); host.querySelector<HTMLButtonElement>('.callout-title-editor button')!.click();
      const stale = host.querySelector<HTMLInputElement>('.callout-title-editor input')!; draft(stale, 'WRONG');
      editor.loadDocument('other', 'Other note'); stale.dispatchEvent(new Event('blur')); enter(stale);
      expect(editor.getMarkdown()).toBe('Other note'); expect(changed).not.toHaveBeenCalled();
    } finally { editor.destroy(); host.remove(); }
  });
});

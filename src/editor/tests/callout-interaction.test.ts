import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo } from "prosemirror-history";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { parse } from "../../../.generated/typora-web/src/parser";
import { serialize } from "../../../.generated/typora-web/src/serializer";
import { schema } from "../../../.generated/typora-web/src/schema";
import { calloutBody, calloutKey } from "../../../.generated/typora-web/src/mint/callout-behavior";
import { CALLOUT_TYPES, editCalloutMarker, parseCalloutMarker } from "../product/calloutMarker";
import { createMintEditor } from "../engine";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });
function setup(source = "", readOnly = false) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { editable: () => !readOnly, state: EditorState.create({ schema, doc: parse(source), plugins: defaultPlugins({ cursorWidget: false, readOnly, parseCallout: parseCalloutMarker, editCalloutMarker, calloutTypes: CALLOUT_TYPES }) }) });
  vi.spyOn(view, 'endOfTextblock').mockReturnValue(false); views.push(view); return view;
}
function select(view: EditorView, pos: number) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))); }
function key(view: EditorView, key: string, options: KeyboardEventInit = {}) {
  return !!view.someProp("handleKeyDown", handler => handler(view, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })));
}
function input(view: EditorView, text: string) {
  const { from, to } = view.state.selection;
  if (!view.someProp('handleTextInput', handler => handler(view, from, to, text, () => view.state.tr.insertText(text, from, to)))) view.dispatch(view.state.tr.insertText(text, from, to));
}
function titleInput(view: EditorView, index = 0) { return view.dom.querySelectorAll<HTMLInputElement>('.callout-title-editor input')[index]; }
function titleKey(view: EditorView, key: string, index = 0) { titleInput(view, index).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }
function setTitle(view: EditorView, text: string) { const field = titleInput(view); field.value = text; field.dispatchEvent(new Event('input', { bubbles: true })); }

describe('Callout creation and body editing', () => {
  for (const header of ['> [!note]', '> [!tip] Custom 名称', '> [!custom-type]- Folded']) {
    for (const batched of [false, true]) it(`creates ${header} on Enter from ${batched ? 'batched' : 'typed'} input and keeps blank Enter inside`, () => {
      const view = setup();
      if (batched) input(view, header); else [...header].forEach(char => input(view, char));
      expect(view.dom.querySelector('.markdown-callout')).toBeNull(); expect(view.dom.textContent).toContain(header.slice(2));
      expect(key(view, 'Enter')).toBe(true);
      const quote = view.state.doc.firstChild!;
      expect(quote.type.name).toBe('blockquote'); expect(quote.childCount).toBe(2);
      expect(view.state.selection.$from.parent.textContent).toBe(''); expect(view.state.selection.$from.node(-1)).toBe(quote);
      expect(view.dom.querySelector('.callout-header strong')?.textContent).toBe(parseCalloutMarker(header.slice(2))?.title);
      expect(view.dom.querySelector('.mint-callout-folded')).toBeNull();
      key(view, 'Enter'); key(view, 'Enter');
      expect(view.state.doc.childCount).toBe(1); expect(view.state.doc.firstChild?.childCount).toBe(4);
      expect(view.state.selection.$from.node(-1).type.name).toBe('blockquote'); expect(view.dom.querySelector('.mint-callout-editing')).toBeNull();
      expect(serialize(view.state.doc)).toContain(header.slice(2));
    });
  }
  it('creates from a literal quote-prefixed paragraph without changing its custom title', () => {
    const view = setup(), header = '> [!warning]+ My title';
    view.dispatch(view.state.tr.insertText(header)); key(view, 'Enter');
    expect(view.state.doc.firstChild?.firstChild?.textContent).toBe('[!warning]+ My title');
    expect(view.state.selection.$from.parent.textContent).toBe('');
  });
  it('keeps a loaded empty Callout rendered and creates a body only when clicked', () => {
    const host = document.createElement('div'), changed = vi.fn(); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: '> [!note] Title', parseCallout: parseCalloutMarker, editCalloutMarker, onChange: changed });
    try {
      expect(host.querySelector('.callout-header strong')?.textContent).toBe('Title'); expect(host.querySelector<HTMLInputElement>('.callout-title-editor input')?.hidden).toBe(true);
      expect(changed).not.toHaveBeenCalled();
      host.querySelector('.callout-content')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(host.querySelectorAll('.callout-content > p')).toHaveLength(2); expect(host.querySelector('.mint-callout-editing')).toBeNull();
      expect(changed).not.toHaveBeenCalled();
    } finally { editor.destroy(); }
  });
  it('keeps the first empty body on Backspace and opens the title instead of the marker', () => {
    const view = setup('> [!note] Title'); titleInput(view).previousElementSibling?.dispatchEvent(new MouseEvent('click'));
    titleKey(view, 'Enter'); const before = view.state.doc;
    expect(key(view, 'Backspace')).toBe(true); expect(titleInput(view).hidden).toBe(false); expect(view.state.doc.eq(before)).toBe(true);
    expect(view.dom.querySelector('.mint-callout-editing')).toBeNull(); titleKey(view, 'ArrowDown');
    input(view, 'Body'); expect(view.state.doc.firstChild?.firstChild?.textContent).toBe('[!note] Title'); expect(serialize(view.state.doc)).toContain('Body');
  });
  it('does not turn ordinary quotes or code literals into Callouts', () => {
    const quote = setup('> ordinary'); select(quote, 2 + 'ordinary'.length); key(quote, 'Enter'); key(quote, 'Enter');
    expect(quote.state.doc.lastChild?.type.name).toBe('paragraph'); expect(quote.dom.querySelector('.markdown-callout')).toBeNull();
    const code = setup('```md\n> [!note] literal\n```'); select(code, code.state.doc.firstChild!.nodeSize - 1); key(code, 'Enter');
    expect(code.state.doc.firstChild?.type.name).toBe('code_block'); expect(code.dom.querySelector('.markdown-callout')).toBeNull();
  });
});

describe('Callout header navigation', () => {
  for (const source of ['> [!tip] Title\n> Body', '> [!tip] Title\n>\n> Body']) it(`navigates both ways with a ${source.includes('\n>\n') ? 'separate' : 'shared'} marker paragraph`, () => {
    const view = setup('Above\n\n' + source + '\n\nBelow'), before = view.state.doc, pos = before.firstChild!.nodeSize;
    const body = calloutBody(before, pos)!;
    select(view, pos - 1); expect(key(view, 'ArrowDown')).toBe(true); expect(titleInput(view).hidden).toBe(false); expect(document.activeElement).toBe(titleInput(view));
    setTitle(view, 'New title'); titleKey(view, 'ArrowDown');
    const updatedBody = calloutBody(view.state.doc, pos)!;
    expect(titleInput(view).hidden).toBe(true); expect(view.state.selection.from).toBe(updatedBody.start);
    select(view, updatedBody.end); expect(key(view, 'ArrowDown')).toBe(true); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    expect(key(view, 'ArrowUp')).toBe(true); expect(view.state.selection.from).toBe(updatedBody.end); expect(titleInput(view).hidden).toBe(true);
    select(view, updatedBody.start); expect(key(view, 'ArrowUp')).toBe(true); expect(titleInput(view).hidden).toBe(false);
    titleKey(view, 'ArrowUp'); expect(view.state.selection.from).toBe(pos - 1); expect(view.dom.querySelector('.mint-callout-editing')).toBeNull();
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true); expect(body.start).toBeLessThan(body.end);
  });
  it('routes selections of a hidden marker to the native title field, including nested Callouts', () => {
    const view = setup('> [!note] Outer\n>\n> > [!tip] Inner\n> > Body'), before = view.state.doc;
    const innerPos = before.firstChild!.firstChild!.nodeSize + 1;
    select(view, innerPos + 3);
    expect(titleInput(view, 1).hidden).toBe(false); expect(titleInput(view, 0).hidden).toBe(true);
    expect(view.dom.querySelectorAll('.mint-callout-editing')).toHaveLength(0); expect(view.dom.querySelectorAll('.callout-header')).toHaveLength(2);
    expect(view.state.doc.eq(before)).toBe(true); titleKey(view, 'Enter', 1); expect(view.state.selection.$from.parent.textContent).toContain('Body');
  });
  it('retains native focus when the first body block is a nested Callout and unfolds the outer body', () => {
    const view = setup('Above\n\n> [!note]- Outer\n>\n> > [!tip] Inner\n> > Body'), before = view.state.doc, pos = before.firstChild!.nodeSize;
    select(view, pos - 1); key(view, 'ArrowDown'); titleKey(view, 'Enter');
    expect(titleInput(view, 1).hidden).toBe(false); expect(document.activeElement).toBe(titleInput(view, 1));
    expect(view.dom.querySelector('.mint-callout-folded')).toBeNull();
    titleKey(view, 'ArrowUp', 1); expect(titleInput(view).hidden).toBe(false); expect(document.activeElement).toBe(titleInput(view));
    expect(view.state.doc.eq(before)).toBe(true);
  });
  it('visits the body of an empty Callout instead of skipping it', () => {
    const view = setup('Above\n\n> [!note]\n\nBelow'), pos = view.state.doc.firstChild!.nodeSize;
    select(view, pos - 1); key(view, 'ArrowDown'); titleKey(view, 'Enter');
    expect(view.state.selection.$from.parent.textContent).toBe(''); expect(titleInput(view).hidden).toBe(true);
    key(view, 'ArrowDown'); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    key(view, 'ArrowUp'); expect(view.state.selection.$from.parent.textContent).toBe(''); expect(titleInput(view).hidden).toBe(true);
    key(view, 'ArrowUp'); expect(titleInput(view).hidden).toBe(false);
  });
  it('unfolds the body when entering from the title or from below, without editing Markdown', () => {
    const view = setup('Above\n\n> [!note]- Title\n> Body\n\nBelow'), before = view.state.doc, pos = before.firstChild!.nodeSize;
    select(view, pos - 1); key(view, 'ArrowDown'); expect(view.dom.querySelector('.mint-callout-folded')).not.toBeNull();
    titleKey(view, 'Enter'); expect(view.dom.querySelector('.mint-callout-folded')).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
    view.dom.querySelector<HTMLButtonElement>('.callout-toggle')!.click(); select(view, before.content.size - 'Below'.length - 1); key(view, 'ArrowUp');
    expect(view.dom.querySelector('.mint-callout-folded')).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('navigates adjacent Callouts and code headers in document order', () => {
    const view = setup('> [!note] First\n> Body\n\n> [!tip] Second\n> Next\n\n```js\ncode\n```');
    const firstSize = view.state.doc.firstChild!.nodeSize;
    select(view, calloutBody(view.state.doc, 0)!.end); key(view, 'ArrowDown'); expect(titleInput(view, 1).hidden).toBe(false);
    titleKey(view, 'ArrowUp', 1); expect(view.state.selection.from).toBe(calloutBody(view.state.doc, 0)!.end);
    select(view, calloutBody(view.state.doc, firstSize)!.end); key(view, 'ArrowDown');
    expect(view.dom.querySelector<HTMLInputElement>('.cb-lang-input')?.hidden).toBe(false);
  });
  it('keeps code language navigation before the outer title when code is the first body block', () => {
    const view = setup('> [!note] Title\n>\n> ```js\n> code\n> ```'), before = view.state.doc;
    const codePos = before.firstChild!.firstChild!.nodeSize + 1;
    select(view, codePos + 1); key(view, 'ArrowUp');
    const language = view.dom.querySelector<HTMLInputElement>('.cb-lang-input')!;
    expect(language.hidden).toBe(false); expect(titleInput(view).hidden).toBe(true);
    language.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(titleInput(view).hidden).toBe(false); expect(document.activeElement).toBe(titleInput(view)); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('moves from a preceding code body into the Callout title without stealing native focus', () => {
    const view = setup('```js\ncode\n```\n\n> [!note] Title\n> Body'), before = view.state.doc;
    select(view, before.firstChild!.nodeSize - 1); key(view, 'ArrowDown');
    expect(titleInput(view).hidden).toBe(false); expect(document.activeElement).toBe(titleInput(view));
    titleKey(view, 'ArrowUp'); expect(view.state.selection.$from.parent.type.name).toBe('code_block');
    expect(view.dom.querySelector<HTMLInputElement>('.cb-lang-input')?.hidden).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('routes initial editor focus away from a hidden marker to the title control', () => {
    const view = setup('> [!note] Title\n> Body'), before = view.state.doc;
    view.focus(); expect(document.activeElement).toBe(titleInput(view)); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('provides editable paragraphs above and below a Callout at document edges', () => {
    const view = setup('> [!note] Title\n> Body');
    select(view, calloutBody(view.state.doc, 0)!.start); key(view, 'ArrowUp'); titleKey(view, 'ArrowUp');
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph'); expect(view.state.selection.$from.parent.textContent).toBe('');
    const pos = view.state.doc.firstChild!.nodeSize;
    select(view, calloutBody(view.state.doc, pos)!.end); key(view, 'ArrowDown');
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph'); expect(view.state.selection.$from.parent.textContent).toBe('');
    expect(view.state.doc.child(1).firstChild?.textContent).toBe('[!note] Title\nBody');
  });
  it('preserves internal visual-line movement and intercepts only the body edge', () => {
    const view = setup('Above\n\n> [!note]\n> First\n> Last\n\nBelow'), pos = view.state.doc.firstChild!.nodeSize, body = calloutBody(view.state.doc, pos)!;
    select(view, body.start + 2); expect(key(view, 'ArrowDown')).toBe(false); expect(key(view, 'ArrowUp')).toBe(false);
    vi.mocked(view.endOfTextblock).mockReturnValue(true); key(view, 'ArrowUp'); expect(titleInput(view).hidden).toBe(false);
  });
  for (const options of [{ shiftKey: true }, { ctrlKey: true }, { isComposing: true }]) it(`leaves modified/composing navigation alone ${JSON.stringify(options)}`, () => {
    const view = setup('Above\n\n> [!note]\n> Body'), before = view.state.doc;
    select(view, before.firstChild!.nodeSize - 1); expect(key(view, 'ArrowDown', options)).toBe(false);
    expect(calloutKey.getState(view.state)?.titleFocus).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('rejects readonly navigation and does not focus a disabled title', () => {
    const view = setup('Above\n\n> [!note]\n> Body', true), before = view.state.doc;
    select(view, before.firstChild!.nodeSize - 1); expect(key(view, 'ArrowDown')).toBe(false); expect(titleInput(view).hidden).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
});

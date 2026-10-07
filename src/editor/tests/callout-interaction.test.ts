import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo } from "prosemirror-history";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { parse } from "../../../.generated/typora-web/src/parser";
import { serialize } from "../../../.generated/typora-web/src/serializer";
import { schema } from "../../../.generated/typora-web/src/schema";
import { calloutBody, calloutKey, enterCalloutBody } from "../../../.generated/typora-web/src/mint/callout-behavior";
import { getLangFocus } from "../../../.generated/typora-web/src/features/fenced-code";
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
  it('deletes the whole Callout when Backspace is pressed in its empty body', () => {
    const view = setup('> [!note] Title'); titleInput(view).previousElementSibling?.dispatchEvent(new MouseEvent('click'));
    titleKey(view, 'Enter'); const before = view.state.doc;
    expect(key(view, 'Backspace')).toBe(true); expect(view.dom.querySelector('.markdown-callout')).toBeNull();
    expect(view.state.doc.childCount).toBe(1); expect(view.state.doc.firstChild?.type.name).toBe('paragraph'); expect(view.state.selection.$from.parent.textContent).toBe('');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('does not turn ordinary quotes or code literals into Callouts', () => {
    const quote = setup('> ordinary'); select(quote, 2 + 'ordinary'.length); key(quote, 'Enter'); key(quote, 'Enter');
    expect(quote.state.doc.lastChild?.type.name).toBe('paragraph'); expect(quote.dom.querySelector('.markdown-callout')).toBeNull();
    const code = setup('```md\n> [!note] literal\n```'); select(code, code.state.doc.firstChild!.nodeSize - 1); key(code, 'Enter');
    expect(code.state.doc.firstChild?.type.name).toBe('code_block'); expect(code.dom.querySelector('.markdown-callout')).toBeNull();
  });
});

describe('Callout Backspace behavior', () => {
  for (const body of ['', 'Body', 'First\n> Last']) it(`matches code blocks when deleting from the empty next line: ${JSON.stringify(body)}`, () => {
    const view = setup('Above\n\n> [!note] Custom title' + (body ? '\n> ' + body : ''));
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, schema.nodes.paragraph.create()));
    const before = view.state.doc, pos = before.firstChild!.nodeSize;
    select(view, before.content.size - 1); expect(key(view, 'Backspace')).toBe(true);
    if (body) {
      expect(view.state.doc.childCount).toBe(2); expect(view.state.selection.from).toBe(calloutBody(view.state.doc, pos)!.end);
      expect(view.state.doc.lastChild?.eq(before.child(1))).toBe(true); expect(titleInput(view).hidden).toBe(true);
    } else {
      expect(view.state.doc.childCount).toBe(2); expect(view.state.doc.lastChild?.type.name).toBe('paragraph'); expect(view.dom.querySelector('.markdown-callout')).toBeNull();
    }
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    const code = setup('Above\n\n```js\n' + body.replaceAll('\n> ', '\n') + '\n```');
    code.dispatch(code.state.tr.insert(code.state.doc.content.size, schema.nodes.paragraph.create()));
    select(code, code.state.doc.content.size - 1); vi.mocked(code.endOfTextblock).mockReturnValue(true);
    expect(key(code, 'Backspace')).toBe(true); expect(code.state.doc.childCount).toBe(2);
    expect(code.state.selection.$from.parent.type.name).toBe(body ? 'code_block' : 'paragraph');
    if (body) expect(code.state.selection.$from.parentOffset).toBe(code.state.selection.$from.parent.content.size);
  });
  it('preserves text on the next line while moving into a nonempty folded Callout', () => {
    const view = setup('> [!note]- Title\n> First\n> Last\n\nBelow'), before = view.state.doc;
    select(view, before.content.size - 'Below'.length - 1); expect(key(view, 'Backspace')).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true); expect(view.state.selection.from).toBe(calloutBody(before, 0)!.end);
    expect(view.dom.querySelector('.mint-callout-folded')).toBeNull(); expect(titleInput(view).hidden).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  it('deletes a cleared body without counting its marker or title as content', () => {
    const view = setup('Above\n\n> [!tip] Title\n> Body\n\nBelow'), pos = view.state.doc.firstChild!.nodeSize;
    const body = calloutBody(view.state.doc, pos)!; view.dispatch(view.state.tr.delete(body.start, body.end));
    const before = view.state.doc; select(view, calloutBody(before, pos)!.start);
    expect(key(view, 'Backspace')).toBe(true); expect(view.dom.querySelector('.markdown-callout')).toBeNull();
    expect(view.state.doc.childCount).toBe(2); expect(view.state.doc.textContent).toBe('AboveBelow');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('removes empty body lines one at a time before deleting the block', () => {
    const view = setup('> [!note] Title'); enterCalloutBody(view, 0); key(view, 'Enter'); key(view, 'Enter');
    vi.mocked(view.endOfTextblock).mockReturnValue(true);
    for (let remaining = 3; remaining >= 2; remaining--) {
      expect(key(view, 'Backspace')).toBe(true); expect(view.state.doc.firstChild?.childCount).toBe(remaining);
      expect(titleInput(view).hidden).toBe(true);
    }
    expect(key(view, 'Backspace')).toBe(true); expect(view.dom.querySelector('.markdown-callout')).toBeNull();
  });
  for (const body of ['Body', ' ', '\n', '![](webmd-attachment:00000000-0000-4000-8000-000000000000)', '\n>\n> ---']) it(`keeps a nonempty body on boundary Backspace: ${JSON.stringify(body)}`, () => {
    const view = setup('> [!note] Title'); enterCalloutBody(view, 0); input(view, body);
    const before = view.state.doc; select(view, calloutBody(before, 0)!.start);
    expect(key(view, 'Backspace')).toBe(true); expect(view.state.doc.eq(before)).toBe(true); expect(titleInput(view).hidden).toBe(true);
  });
  it('keeps the outer Callout editable after deleting an empty nested Callout', () => {
    const view = setup('> [!note] Outer\n>\n> > [!tip] Inner'), inner = view.state.doc.firstChild!.firstChild!.nodeSize + 1;
    enterCalloutBody(view, inner); const before = view.state.doc;
    expect(key(view, 'Backspace')).toBe(true); expect(view.dom.querySelectorAll('.markdown-callout')).toHaveLength(1);
    expect(view.state.selection.from).toBe(calloutBody(view.state.doc, 0)!.start); expect(titleInput(view).hidden).toBe(true);
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('returns to the empty Callout body after deleting its final empty code block', () => {
    const view = setup('> [!note] Outer\n>\n> ```js\n> ```'), before = view.state.doc, code = before.firstChild!.firstChild!.nodeSize + 1;
    select(view, code + 1); expect(key(view, 'Backspace')).toBe(true);
    expect(titleInput(view).hidden).toBe(true); expect(view.state.selection.$from.parent.textContent).toBe('');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('keeps code block deletion ahead of the preceding Callout', () => {
    const view = setup('> [!note] Title\n\n```js\n```'), before = view.state.doc, code = before.firstChild!.nodeSize;
    select(view, code + 1); expect(key(view, 'Backspace')).toBe(true);
    expect(view.state.doc.firstChild?.firstChild?.eq(before.firstChild!.firstChild!)).toBe(true); expect(view.dom.querySelector('.cb-lang-input')).toBeNull();
    expect(titleInput(view).hidden).toBe(true); expect(view.state.selection.$from.parent.textContent).toBe('');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('retains native list Backspace at the first body item without touching the title', () => {
    const view = setup('> [!note] Title\n>\n> - Item'), before = view.state.doc;
    select(view, calloutBody(before, 0)!.start); vi.mocked(view.endOfTextblock).mockReturnValue(true);
    expect(key(view, 'Backspace')).toBe(true); expect(view.state.doc.firstChild?.child(1).type.name).toBe('paragraph');
    expect(view.state.doc.firstChild?.firstChild?.textContent).toBe('[!note] Title'); expect(view.state.doc.firstChild?.child(1).textContent).toBe('Item'); expect(titleInput(view).hidden).toBe(true);
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('leaves an uncommitted marker editable and rejects reading-mode deletion', () => {
    const draft = setup(); input(draft, '> [!note]'); const before = draft.state.doc;
    expect(key(draft, 'Backspace')).toBe(false); expect(draft.state.doc.eq(before)).toBe(true);
    const readonly = setup('> [!note] Title\n> Body\n\nBelow', true), readonlyDoc = readonly.state.doc;
    select(readonly, readonlyDoc.content.size - 'Below'.length - 1);
    expect(key(readonly, 'Backspace')).toBe(false); expect(readonly.state.doc.eq(readonlyDoc)).toBe(true);
  });
});

describe('Callout horizontal navigation', () => {
  it('crosses selected separators above and inside a Callout without opening its title', () => {
    const view = setup('Above\n\n---\n\n> [!note] Title\n>\n> ---\n>\n> Body\n\nBelow'), before = view.state.doc;
    const separator = before.firstChild!.nodeSize, pos = separator + before.child(1).nodeSize;
    const innerSeparator = pos + 1 + before.child(2).firstChild!.nodeSize;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(before, separator)));
    expect(key(view, 'ArrowRight')).toBe(true); expect(view.state.selection).toBeInstanceOf(NodeSelection); expect(view.state.selection.from).toBe(innerSeparator);
    expect(titleInput(view).hidden).toBe(true);
    expect(key(view, 'ArrowLeft')).toBe(true); expect(view.state.selection.from).toBe(separator); expect(view.state.selection).toBeInstanceOf(NodeSelection);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(before, innerSeparator)));
    expect(key(view, 'ArrowRight')).toBe(false); expect(titleInput(view).hidden).toBe(true);
    select(view, calloutBody(before, pos)!.start); vi.mocked(view.endOfTextblock).mockReturnValueOnce(true);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, bubbles: true, cancelable: true }));
    expect(view.state.selection).toBeInstanceOf(NodeSelection); expect(view.state.selection.from).toBe(innerSeparator);
    key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(separator);
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  for (const source of ['> [!tip] Title\n> Body', '> [!tip] Title\n>\n> Body']) it(`crosses the body without opening the title: ${source}`, () => {
    const view = setup('Above\n\n' + source + '\n\nBelow'), before = view.state.doc, pos = before.firstChild!.nodeSize;
    const body = calloutBody(before, pos)!;
    select(view, pos - 1); expect(key(view, 'ArrowRight')).toBe(true); expect(view.state.selection.from).toBe(body.start);
    expect(titleInput(view).hidden).toBe(true); expect(document.activeElement).toBe(view.dom);
    expect(key(view, 'ArrowLeft')).toBe(true); expect(view.state.selection.from).toBe(pos - 1);
    select(view, body.end); expect(key(view, 'ArrowRight')).toBe(true); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    expect(key(view, 'ArrowLeft')).toBe(true); expect(view.state.selection.from).toBe(body.end);
    expect(titleInput(view).hidden).toBe(true); expect(calloutKey.getState(view.state)?.titleFocus).toBeNull();
    expect(view.state.doc.eq(before)).toBe(true); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  it('visits a loaded empty body without changing Markdown or adding undo history', () => {
    const view = setup('Above\n\n> [!tip] Title\n\nBelow'), before = serialize(view.state.doc), pos = view.state.doc.firstChild!.nodeSize;
    select(view, pos - 1); key(view, 'ArrowRight');
    const body = calloutBody(view.state.doc, pos)!;
    expect(view.state.selection.from).toBe(body.start); expect(view.state.selection.$from.parent.textContent).toBe('');
    key(view, 'ArrowRight'); expect(view.state.selection.$from.parent.textContent).toBe('Below');
    key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(body.end);
    key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(pos - 1);
    expect(titleInput(view).hidden).toBe(true); expect(serialize(view.state.doc)).toBe(before); expect(undo(view.state, view.dispatch)).toBe(false);
  });
  it('does not save or normalize original Markdown when entering a loaded empty Callout', () => {
    const host = document.createElement('div'), changed = vi.fn(), source = 'Above\n\n\n> [!tip] Title\n\nBelow'; document.body.append(host);
    const editor = createMintEditor(host, { initialContent: source, parseCallout: parseCalloutMarker, editCalloutMarker, onChange: changed });
    try {
      editor.setSelectionOffset('Above'.length);
      host.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      expect(host.querySelectorAll('.callout-content > p')).toHaveLength(2);
      expect(host.querySelector<HTMLInputElement>('.callout-title-editor input')?.hidden).toBe(true);
      expect(changed).not.toHaveBeenCalled(); expect(editor.getMarkdown()).toBe(source);
      expect(editor.createInsertionBookmark().insert('Actual body')).toBe(true);
      expect(changed).toHaveBeenCalledTimes(1); expect(editor.getMarkdown()).toContain('> Actual body');
    } finally { editor.destroy(); }
  });
  it('skips headers between adjacent Callouts and code bodies in both directions', () => {
    const view = setup('```js\ncode\n```\n\n> [!note] First\n> Body\n\n> [!tip] Second\n> Next\n\n```ts\nlast\n```'), before = view.state.doc;
    const first = before.firstChild!.nodeSize, second = first + before.child(1).nodeSize, code = second + before.child(2).nodeSize;
    select(view, first - 1); expect(key(view, 'ArrowRight')).toBe(true); expect(view.state.selection.from).toBe(calloutBody(before, first)!.start);
    expect(key(view, 'ArrowLeft')).toBe(true); expect(view.state.selection.from).toBe(first - 1);
    select(view, calloutBody(before, first)!.end); key(view, 'ArrowRight'); expect(view.state.selection.from).toBe(calloutBody(before, second)!.start);
    key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(calloutBody(before, first)!.end);
    select(view, calloutBody(before, second)!.end); key(view, 'ArrowRight'); expect(view.state.selection.from).toBe(code + 1);
    key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(calloutBody(before, second)!.end);
    expect([...view.dom.querySelectorAll<HTMLInputElement>('.callout-title-editor input, .cb-lang-input')].every(field => field.hidden)).toBe(true);
    expect(getLangFocus(view.state)).toBeNull(); expect(view.state.doc.eq(before)).toBe(true);
  });
  it('skips nested markers and reveals folded bodies without changing Markdown', () => {
    const view = setup('Above\n\n> [!note]- Outer\n>\n> > [!tip]- Inner\n> > Body\n\nBelow'), before = view.state.doc;
    const outer = before.firstChild!.nodeSize, inner = outer + 1 + before.child(1).firstChild!.nodeSize;
    select(view, outer - 1); key(view, 'ArrowRight'); expect(view.state.selection.from).toBe(calloutBody(before, inner)!.start);
    expect(view.dom.querySelector('.mint-callout-folded')).toBeNull();
    key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(outer - 1);
    select(view, before.content.size - 'Below'.length - 1); key(view, 'ArrowLeft'); expect(view.state.selection.from).toBe(calloutBody(before, inner)!.end);
    expect([...view.dom.querySelectorAll<HTMLInputElement>('.callout-title-editor input')].every(field => field.hidden)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
  });
  it('keeps native movement within body text and does not insert paragraphs at document edges', () => {
    const view = setup('> [!note] Title\n> Body'), before = view.state.doc, body = calloutBody(before, 0)!;
    select(view, body.start + 1); expect(key(view, 'ArrowLeft')).toBe(false); expect(key(view, 'ArrowRight')).toBe(false);
    select(view, body.start); expect(key(view, 'ArrowLeft')).toBe(true); expect(view.state.selection.from).toBe(body.start);
    select(view, body.end); key(view, 'ArrowRight'); expect(view.state.selection.from).toBe(body.end);
    expect(view.state.doc.eq(before)).toBe(true); expect(titleInput(view).hidden).toBe(true);
  });
  for (const arrow of ['ArrowLeft', 'ArrowRight']) for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) it(`preserves native ${arrow} ${JSON.stringify(options)}`, () => {
    const view = setup('Above\n\n> [!note] Title\n> Body'), before = view.state.doc, pos = before.firstChild!.nodeSize;
    select(view, arrow === 'ArrowLeft' ? calloutBody(before, pos)!.start : pos - 1);
    expect(key(view, arrow, options)).toBe(false); expect(titleInput(view).hidden).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
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

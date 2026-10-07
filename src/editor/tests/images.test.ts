import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo } from "prosemirror-history";
import { defaultPlugins } from "../../../.generated/typora-web/src/editor";
import { getWidgets } from "../../../.generated/typora-web/src/normalize";
import { parse } from "../../../.generated/typora-web/src/parser";
import { serialize } from "../../../.generated/typora-web/src/serializer";
import { schema } from "../../../.generated/typora-web/src/schema";
import type { MintContext } from "../../../.generated/typora-web/src/mint/context";
import { createMintEditor, type Editor } from "../engine";

const views: EditorView[] = [], editors: Editor[] = [];
afterEach(() => {
  views.splice(0).forEach(view => view.destroy());
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren(); vi.restoreAllMocks();
});
function setup(source: string, context: MintContext = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView(host, { editable: () => !context.readOnly,
    state: EditorState.create({ schema, doc: parse(source), plugins: defaultPlugins(context) }),
  });
  views.push(view); return view;
}
function select(view: EditorView, from: number, to = from) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))); }
function image(view: EditorView, index = 0) { return view.dom.querySelectorAll<HTMLImageElement>("img.image-render")[index]; }
function click(element: HTMLElement, options: MouseEventInit = {}) { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...options })); }

describe("image preview source editing", () => {
  for (const source of [
    '![preview](https://example.com/a.png "Caption")',
    '> ![preview](https://example.com/a.png)',
    '- ![preview](https://example.com/a.png)',
    '| Image |\n| --- |\n| ![preview](https://example.com/a.png) |',
    '![preview](webmd-attachment:12345678-1234-1234-1234-123456789abc)',
  ]) it(`clicks into the source end and keeps the image below the native caret: ${source.slice(0, 40)}`, () => {
    const view = setup(`Above\n\n${source}\n\nBelow`, { resolveImageSource: () => "blob:resolved" });
    const before = view.state.doc, preview = image(view), widget = getWidgets(view.state).find(widget => widget.kind === "image-render")!;
    expect(preview.classList.contains("mint-image-selected")).toBe(false);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true }); preview.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    preview.dispatchEvent(new Event("error")); click(preview);
    expect(view.state.selection.from).toBe(widget.spanTo); expect(view.state.selection.empty).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true); expect(view.hasFocus()).toBe(true);
    expect(image(view)).toBe(preview); expect(preview.dataset.imageFailed).toBe("true");
    expect(preview.classList.contains("mint-image-selected")).toBe(true);
    expect(preview.parentElement?.querySelector(".syntax-hidden")).toBeNull();
    if (!source.startsWith("|")) expect(preview.closest("p")?.classList.contains("mint-image-source-visible")).toBe(true);
    const caret = document.getSelection()!;
    expect(caret.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(caret.anchorNode?.textContent?.endsWith(")")).toBe(true);
    expect(caret.anchorOffset).toBe(caret.anchorNode?.textContent?.length);
    expect(preview.referrerPolicy).toBe("no-referrer");
    if (source.includes("Caption")) expect(preview.title).toBe("Caption");
    select(view, 1);
    expect(image(view).classList.contains("mint-image-selected")).toBe(false);
    expect(image(view).parentElement?.querySelector(".syntax-hidden")).not.toBeNull();
    if (!source.startsWith("|")) {
      expect(image(view).closest("p")?.classList.contains("mint-image-paragraph")).toBe(true);
      expect(image(view).closest("p")?.classList.contains("mint-image-source-visible")).toBe(false);
    }
    expect(undo(view.state, view.dispatch)).toBe(false);
  });

  it("hides the source icon even when the upstream image styles are present", () => {
    const widgetStyles = readFileSync(".generated/typora-web/src/styles/widgets.css", "utf8");
    const mintStyles = readFileSync("src/editor/product/typora-overrides.css", "utf8");
    const style = document.createElement("style"); style.textContent = widgetStyles + mintStyles; document.body.append(style);
    const view = setup('Above\n\n![preview](https://example.com/a.png)\n\nBelow');
    view.dom.parentElement!.classList.add("markdown-editor-host"); click(image(view));
    const icon = view.dom.querySelector<HTMLElement>(".mint-image-icon")!;
    expect(icon).not.toBeNull(); expect(getComputedStyle(icon).display).toBe("none");
    expect(serialize(view.state.doc)).not.toContain("🖼");
  });

  it("selects only the clicked occurrence even when two previews use the same URL", () => {
    const view = setup('Above\n\n![one](https://example.com/a.png) ![two](https://example.com/a.png)\n\nBelow');
    click(image(view)); expect(image(view).classList.contains("mint-image-selected")).toBe(true); expect(image(view, 1).classList.contains("mint-image-selected")).toBe(false);
    click(image(view, 1)); expect(image(view).classList.contains("mint-image-selected")).toBe(false); expect(image(view, 1).classList.contains("mint-image-selected")).toBe(true);
    expect(view.state.selection.from).toBe(getWidgets(view.state).filter(widget => widget.kind === "image-render")[1].spanTo);
    select(view, 1, view.state.doc.content.size - 1);
    expect(view.dom.querySelectorAll(".mint-image-selected")).toHaveLength(2);
    expect(image(view).parentElement?.querySelector(".syntax-hidden")).toBeNull();
    expect(view.dom.querySelectorAll("img.image-render")).toHaveLength(2);
  });

  it("keeps the entire source visible during forward and backward selections of alt, URL and title", () => {
    const source = '![preview](https://example.com/a.png "Caption")', view = setup(`Above\n\n${source}\n\nBelow`), before = view.state.doc;
    click(image(view));
    const widget = getWidgets(view.state).find(widget => widget.kind === "image-render")!;
    for (const selected of ["preview", "https://example.com/a.png", "Caption", source]) {
      const start = widget.spanFrom + source.indexOf(selected), end = start + selected.length;
      for (const backwards of [false, true]) {
        select(view, backwards ? end : start, backwards ? start : end);
        expect(view.state.selection.anchor).toBe(backwards ? end : start);
        expect(image(view).classList.contains("mint-image-selected")).toBe(true);
        expect(image(view).closest("p")?.classList.contains("mint-image-source-visible")).toBe(true);
        expect(image(view).parentElement?.querySelector(".syntax-hidden")).toBeNull();
        expect(document.getSelection()?.toString()).toBe(selected);
        expect(view.state.doc.eq(before)).toBe(true);
      }
    }
    select(view, 1, 4);
    expect(image(view).parentElement?.querySelector(".syntax-hidden")).not.toBeNull();
    expect(image(view).classList.contains("mint-image-selected")).toBe(false);
    expect(undo(view.state, view.dispatch)).toBe(false);
  });

  it("replaces selected image source text as one undoable edit while preserving the destination", () => {
    const view = setup('Above\n\n![preview](https://example.com/a.png "Caption")\n\nBelow'), before = view.state.doc;
    click(image(view));
    const widget = getWidgets(view.state).find(widget => widget.kind === "image-render")!;
    select(view, widget.spanFrom + 2, widget.spanFrom + 9);
    view.dispatch(view.state.tr.insertText("updated"));
    expect(serialize(view.state.doc)).toContain('![updated](https://example.com/a.png "Caption")');
    expect(image(view).alt).toBe("updated");
    expect(image(view).parentElement?.querySelector(".syntax-hidden")).toBeNull();
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    expect(undo(view.state, view.dispatch)).toBe(false);
  });

  it("applies compact paragraph layout only when the paragraph contains an image by itself", () => {
    const view = setup('Above\n\n![single](https://example.com/a.png)\n\nText ![inline](https://example.com/b.png) text\n\nBelow');
    expect(image(view).closest("p")?.classList.contains("mint-image-paragraph")).toBe(true);
    expect(image(view, 1).closest("p")?.classList.contains("mint-image-paragraph")).toBe(false);
    const readonly = setup('![preview](https://example.com/a.png)', { readOnly: true });
    select(readonly, 1, readonly.state.doc.firstChild!.nodeSize - 1);
    expect(image(readonly).closest("p")?.classList.contains("mint-image-paragraph")).toBe(true);
    expect(image(readonly).closest("p")?.classList.contains("mint-image-source-visible")).toBe(false);
    expect(image(readonly).parentElement?.querySelector(".syntax-hidden")).not.toBeNull();
  });

  it("uses the updated source position after edits and leaves real edits undoable", () => {
    const view = setup('Above\n\n![preview](https://example.com/a.png)\n\nBelow'), before = view.state.doc;
    view.dispatch(view.state.tr.insertText("prefix ", before.firstChild!.nodeSize + 1));
    const preview = image(view), widget = getWidgets(view.state).find(widget => widget.kind === "image-render")!;
    click(preview); expect(view.state.selection.from).toBe(widget.spanTo);
    view.dispatch(view.state.tr.insertText("!")); expect(serialize(view.state.doc)).toContain('![preview](https://example.com/a.png)!');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(serialize(view.state.doc)).not.toContain('a.png)!');
    expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true); expect(serialize(view.state.doc)).toContain("prefix ");
  });

  it("does not submit Markdown when selecting, leaving, refreshing or switching modes", () => {
    const source = 'Above\n\n![preview](https://example.com/a.png)\n\nBelow', changed = vi.fn();
    const host = document.createElement("div"); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: source, onChange: changed }); editors.push(editor);
    click(host.querySelector<HTMLImageElement>("img.image-render")!);
    editor.setSelectionOffset(0); editor.refreshPresentation(); editor.setMode("reading"); editor.setMode("live"); editor.flush();
    expect(editor.getMarkdown()).toBe(source); expect(changed).not.toHaveBeenCalled();
  });

  it("leaves reading mode and modified clicks outside source editing", () => {
    const source = 'Above\n\n![preview](https://example.com/a.png)\n\nBelow';
    const readonly = setup(source, { readOnly: true }), selection = readonly.state.selection;
    click(image(readonly)); expect(readonly.state.selection.eq(selection)).toBe(true);
    expect(readonly.dom.querySelector(".mint-image-selected")).toBeNull();
    expect(image(readonly).parentElement?.querySelector(".syntax-hidden")).not.toBeNull();
    const live = setup(source);
    for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { button: 2 }]) {
      const selection = live.state.selection; click(image(live), options);
      expect(live.state.selection.eq(selection)).toBe(true); expect(live.dom.querySelector(".mint-image-selected")).toBeNull();
    }
  });
});

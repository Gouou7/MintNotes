import { afterEach, describe, expect, it, vi } from "vitest";
import { createMintEditor, type Editor } from "../engine";
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
function setup(markdown: string, readOnly = false) {
  const host = document.createElement("div"), changed = vi.fn(); document.body.append(host);
  const editor = createMintEditor(host, { initialContent: markdown, documentKey: "a", onChange: changed, readOnly }); editors.push(editor);
  return { host, editor, changed };
}
describe("Mint upstream controller", () => {
  it("keeps loaded source without saving during selection, mode or display changes", () => {
    const text = "__bold__\n\n[unused]: https://example.com/unused\n\n- item\n";
    const { editor, changed } = setup(text);
    editor.setSelectionOffset(2); editor.setMode("source"); editor.setMode("reading"); editor.refreshPresentation(); editor.setMode("live");
    expect(editor.getMarkdown()).toBe(text); expect(changed).not.toHaveBeenCalled();
    editor.loadDocument("b", "new"); expect(changed).not.toHaveBeenCalled();
  });
  it("retains referenced and unused destinations after real edits", () => {
    const { editor } = setup('[label][ref]\n\n[ref]: https://example.com/path "title"\n[unused]: https://example.com/unused\n[ref]: https://example.com/duplicate');
    editor.createInsertionBookmark(0).insert("edited ");
    expect(editor.getMarkdown()).toContain("https://example.com/path"); expect(editor.getMarkdown()).toContain("https://example.com/unused"); expect(editor.getMarkdown()).toContain("title"); expect(editor.getMarkdown()).toContain("https://example.com/duplicate");
  });
  it("maps bookmarks through edits and cancels on document or mode changes", () => {
    const { editor } = setup("abc");
    editor.setMode("source"); editor.setSelectionOffset(2); const bookmark = editor.createInsertionBookmark();
    const start = editor.createInsertionBookmark(0); expect(start.insert("X")).toBe(true); expect(bookmark.insert("Y")).toBe(true); expect(editor.getMarkdown()).toBe("XabYc");
    const stale = editor.createInsertionBookmark(); editor.loadDocument("b", "other"); expect(stale.insert("WRONG")).toBe(false);
    const mode = editor.createInsertionBookmark(); editor.setMode("live"); expect(mode.insert("WRONG")).toBe(false);
  });
  it("rejects edits and bookmarks in reading and destroys resources", () => {
    const { editor, host, changed } = setup("secret", true);
    editor.replaceMarkdown("other"); expect(editor.createInsertionBookmark().insert("other")).toBe(false);
    expect(host.querySelector('[contenteditable="false"]')).not.toBeNull(); expect(changed).not.toHaveBeenCalled();
    editor.destroy(); expect(host.textContent).toBe(""); expect(editor.getMarkdown()).toBe("");
  });
  it("keeps protected source selectable and rejects all source mutations without saving", () => {
    const { editor, host, changed } = setup("__secret__", true);
    editor.setMode("source"); const source = host.querySelector("textarea")!;
    expect(source.readOnly).toBe(true); expect(source.hidden).toBe(false);
    source.setSelectionRange(0, source.value.length); expect(source.selectionEnd).toBe(10);
    source.value = "wrong"; source.dispatchEvent(new Event("input", { bubbles: true }));
    editor.replaceMarkdown("wrong"); expect(editor.createInsertionBookmark().insert("wrong")).toBe(false);
    expect(source.value).toBe("__secret__");
    editor.setMode("reading"); editor.setMode("source"); editor.loadDocument("b", "other");
    expect(source.readOnly).toBe(true); expect(editor.getMarkdown()).toBe("other"); expect(changed).not.toHaveBeenCalled();
  });
  it("changes source permissions without saving and invalidates pending insertion permanently", () => {
    const { editor, host, changed } = setup("abc"); editor.setMode("source");
    const bookmark = editor.createInsertionBookmark(); const source = host.querySelector("textarea")!;
    editor.setReadOnly(true); expect(source.readOnly).toBe(true);
    editor.setReadOnly(false); expect(source.readOnly).toBe(false); expect(bookmark.insert("wrong")).toBe(false);
    expect(editor.getMarkdown()).toBe("abc"); expect(changed).not.toHaveBeenCalled();
    source.value = "abcd"; source.dispatchEvent(new Event("input", { bubbles: true }));
    expect(changed).toHaveBeenCalledOnce(); expect(editor.getMarkdown()).toBe("abcd");
  });
  it("finishes composition before making source read-only", () => {
    const { editor, host, changed } = setup("a"); editor.setMode("source"); const source = host.querySelector("textarea")!;
    source.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); source.value = "a中文";
    source.dispatchEvent(new Event("input", { bubbles: true })); editor.setReadOnly(true);
    expect(changed).not.toHaveBeenCalled(); source.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); editor.flush();
    expect(editor.getMarkdown()).toBe("a中文"); expect(changed).toHaveBeenCalledOnce(); expect(source.readOnly).toBe(true);
  });
  it("cancels a deferred surface switch when the user returns to source during composition", () => {
    const { editor, host, changed } = setup("a"); editor.setMode("source"); const source = host.querySelector("textarea")!;
    source.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); source.value = "a中文";
    source.dispatchEvent(new Event("input", { bubbles: true })); editor.setMode("live"); editor.setMode("source");
    source.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); editor.flush();
    expect(source.hidden).toBe(false); expect(source.value).toBe("a中文"); expect(changed).toHaveBeenCalledOnce();
  });
  it("creates only mounted previews and disposes them on refresh and destruction", () => {
    const host = document.createElement("div"), cleanup = vi.fn(), render = vi.fn(() => cleanup); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "Before $x$ after", renderMath: render }); editors.push(editor);
    expect(render).toHaveBeenCalledTimes(1);
    editor.setSelectionOffset(16); editor.setSelectionOffset(15); editor.setSelectionOffset(14);
    expect(render).toHaveBeenCalledTimes(1); expect(cleanup).not.toHaveBeenCalled();
    editor.refreshPresentation(); expect(render).toHaveBeenCalledTimes(2); expect(cleanup).toHaveBeenCalledTimes(1);
    editor.destroy(); expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it("emits source composition once and defers mode changes", async () => {
    const { editor, host, changed } = setup("a"); editor.setMode("source"); const source = host.querySelector("textarea")!;
    source.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    source.value = "a中文"; source.dispatchEvent(new Event("input", { bubbles: true })); editor.setMode("live"); expect(changed).not.toHaveBeenCalled();
    source.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); editor.flush();
    expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith("a中文", "a"); expect(editor.getMarkdown()).toBe("a中文");
  });
  it("maps source bookmarks once per composition update", () => {
    const { editor, host } = setup("abcd"); editor.setMode("source"); editor.setSelectionOffset(2); const bookmark = editor.createInsertionBookmark(); const source = host.querySelector("textarea")!;
    source.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const text of ["Xabcd", "XYabcd"]) { source.value = text; source.dispatchEvent(new Event("input", { bubbles: true })); }
    source.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); editor.flush(); expect(bookmark.insert("!")).toBe(true); expect(editor.getMarkdown()).toBe("XYab!cd");
  });
  it("allows HTTPS and resolved attachment images, blocks authored blob/data/http", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const host = document.createElement("div"); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: `![https](https://example.com/a.png) ![unsafe](http://example.com/a.png) ![blob](blob:authored) ![attachment](webmd-attachment:${id})`, readOnly: true, resolveImageSource: source => source.endsWith(id) ? "blob:resolved" : undefined }); editors.push(editor);
    const sources = [...host.querySelectorAll("img")].map(image => image.getAttribute("src"));
    expect(sources).toContain("https://example.com/a.png"); expect(sources).toContain("blob:resolved"); expect(sources).not.toContain("http://example.com/a.png"); expect(sources).not.toContain("blob:authored");
    expect([...host.querySelectorAll("img")].every(image => image.referrerPolicy === "no-referrer")).toBe(true);
  });
});

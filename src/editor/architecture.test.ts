import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor, type EditorOptions } from "./core/lib";
import { createCalloutExtension } from "./extensions/callout";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); });

function setup(source: string, options: EditorOptions = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = vi.fn();
  const editor = createEditor(host, { initialContent: source, onChange, ...options });
  editors.push(editor);
  editor.focus();
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!;
  const surface = () => editor.isSourceMode() ? textarea : live;
  const key = (key: string, extra: KeyboardEventInit = {}) => surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  const input = (text: string) => surface().dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
  const clipboard = (kind: "copy" | "cut" | "paste", text = "") => {
    const data = new Map([["text/plain", text]]);
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data.get(type), setData: (type: string, value: string) => data.set(type, value), files: [], items: [] } });
    surface().dispatchEvent(event);
    return data.get("text/plain");
  };
  const undo = () => key("z", { ctrlKey: true, metaKey: true });
  return { editor, host, live, textarea, onChange, key, input, clipboard, undo };
}

describe("editor architecture acceptance", () => {
  it.each(["😀", "👨‍👩‍👧‍👦", "e\u0301", "🇨🇳", "👍🏽"])("moves and deletes %s as one character with one undo", (character) => {
    const { editor, key, undo } = setup(`a${character}b`);
    editor.setSelectionOffset(1);
    key("ArrowRight");
    expect(editor.getSelectionOffset()).toBe(1 + character.length);
    key("Backspace");
    expect(editor.getMarkdown()).toBe("ab");
    undo();
    expect(editor.getMarkdown()).toBe(`a${character}b`);
    expect(editor.getSelectionOffset()).toBe(1 + character.length);
  });

  it("keeps both selection endpoints and undo across live/source/live", () => {
    const { editor, input, undo } = setup("# title\n\nbody");
    editor.setSelectionOffset(4);
    input("X");
    editor.setSelection({ anchor: 7, head: 2 });
    editor.setSourceMode(true);
    expect(editor.getSelection()).toEqual({ anchor: 7, head: 2 });
    editor.setSourceMode(false);
    expect(editor.getSelection()).toEqual({ anchor: 7, head: 2 });
    undo();
    expect(editor.getMarkdown()).toBe("# title\n\nbody");
  });

  it("records source textarea input in the same source history", () => {
    const { editor, textarea, undo } = setup("a");
    editor.setSourceMode(true);
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "b" }));
    textarea.value = "ab";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "b" }));
    editor.setSourceMode(false);
    undo();
    expect(editor.getMarkdown()).toBe("a");
  });

  it("preserves original CRLF outside a native source textarea edit", () => {
    const source = "# a\r\n\r\nbody\r\ntail";
    const { editor, textarea, onChange, undo } = setup(source);
    editor.setSelectionOffset(source.indexOf("body") + 2);
    editor.setSourceMode(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getMarkdownOffsetAtPoint(0, 0)).toBe(source.indexOf("body") + 2);
    expect(textarea.value).toBe(source.replaceAll("\r\n", "\n"));
    const from = textarea.selectionStart;
    textarea.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "X" }));
    textarea.value = textarea.value.slice(0, from) + "X" + textarea.value.slice(from);
    textarea.setSelectionRange(from + 1, from + 1);
    textarea.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "X" }));
    expect(editor.getMarkdown()).toBe(source.replace("body", "boXdy"));
    undo(); expect(editor.getMarkdown()).toBe(source);
  });

  it("copies and cuts exactly the selected heading body and restores both endpoints", () => {
    const { editor, clipboard, undo } = setup("# title\n\nbody");
    editor.setSelection({ anchor: 2, head: 7 });
    expect(clipboard("copy")).toBe("title");
    expect(clipboard("cut")).toBe("title");
    expect(editor.getMarkdown()).toBe("# \n\nbody");
    undo();
    expect(editor.getMarkdown()).toBe("# title\n\nbody");
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 7 });
  });

  it("keeps heading typography and only activates the selected list source line", () => {
    const { editor, host } = setup("# title\n\n- first\n- second");
    editor.setSelectionOffset(3);
    expect(host.querySelector("h1 .syntax-hint")?.textContent).toBe("# ");
    editor.setSelectionOffset(12);
    expect([...host.querySelectorAll("li .syntax-hint")].map((node) => node.textContent)).toEqual(["- "]);
    expect(host.querySelector("pre[data-source-kind=bullet_list]")).toBeNull();
  });

  it.each([
    ["# **bold**", "h1 strong", "bold"],
    ["- *italic*", "li em", "italic"],
    ["  - ~~deleted~~", "li s", "deleted"],
    ["> ==highlighted==", "blockquote mark", "highlighted"],
    ["- [x] **task**", "li strong", "task"],
  ])("reveals %j on the existing styled text surface", (line, selector, body) => {
    const source = `${line}\n\nafter`;
    const { editor, host, onChange, input, undo, clipboard } = setup(source);
    editor.setSelectionOffset(source.length);
    const styledBody = host.querySelector(selector)!;
    expect(styledBody.textContent).toBe(body);

    editor.setSelection({ anchor: 0, head: line.length });
    expect(host.querySelector(selector)).toBe(styledBody);
    expect(host.querySelector("pre[data-source-block]")).toBeNull();
    const prefix = host.querySelector<HTMLElement>(".source-line-prefix")!;
    expect(prefix.hasAttribute("style")).toBe(false);
    expect(host.querySelector(".source-task-checkbox")).toBeNull();
    expect(clipboard("copy")).toBe(line);
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();

    input("替换");
    expect(editor.getMarkdown()).toBe("替换\n\nafter");
    undo();
    expect(editor.getMarkdown()).toBe(source);
    expect(editor.getSelection()).toEqual({ anchor: 0, head: line.length });
  });

  it.each(["- ", "+ ", "* ", "1. ", "1) ", "> "])(
    "keeps newly recognized %j source on the document text surface",
    (marker) => {
      const { editor, host, input, undo } = setup("");
      for (const character of marker) input(character);
      expect(editor.getMarkdown()).toBe(marker);
      expect(editor.getSelectionOffset()).toBe(marker.length);
      expect(host.querySelector(".source-text-editing")?.textContent).toBe(marker);
      expect(host.querySelector(".source-line-prefix")?.textContent).toBe(marker);
      input("正文");
      expect(editor.getMarkdown()).toBe(`${marker}正文`);
      undo();
      expect(editor.getMarkdown()).toBe(marker);
    },
  );

  it.each([
    ["- first\n  continuation\n  - nested", "continuation", 1],
    ["- first\n  continuation\n  - nested", "nested", 2],
    ["> - first\n>   - nested", "nested", 2],
    ["- first\n\n  > nested", "nested", 1],
    ["> > nested", "nested", 0],
  ] as const)("aligns the active line in %j without changing authored indentation", (block, word, listDepth) => {
    const source = `${block}\n\nafter`;
    const { editor, host, onChange, clipboard } = setup(source);
    editor.setSelectionOffset(source.indexOf(word) + 2);
    const line = [...host.querySelectorAll<HTMLElement>(".source-text-editing")]
      .find((node) => node.textContent?.includes(word))!;
    expect(line.style.getPropertyValue("--source-list-depth")).toBe(String(listDepth));
    expect(line.querySelector(".source-line-prefix")?.hasAttribute("style")).toBe(false);
    editor.setSelection({ anchor: 0, head: block.length });
    expect(clipboard("copy")).toBe(block);
    editor.setSelectionOffset(source.length);
    expect(host.querySelector("li .source-text-editing, blockquote .source-text-editing")).toBeNull();
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the inactive list line's indentation when editing a lazy continuation", () => {
    const source = "- first\n  continuation\nlazy continuation\n\nafter";
    const { editor, host } = setup(source);
    editor.setSelectionOffset(source.indexOf("continuation") + 2);
    expect(host.querySelector("li.source-list-editing")).toBeNull();
    expect(host.querySelector(".source-line-prefix-hidden.source-rendered-indent")?.textContent).toBe("- ");
    expect(host.querySelector(".source-rendered-indent[aria-hidden]")).not.toBeNull();
    expect(host.querySelector(".source-line-prefix")?.textContent).toBe("  ");
    editor.setSelectionOffset(source.length);
    expect(host.querySelector(".source-rendered-indent")).toBeNull();
    expect(editor.getMarkdown()).toBe(source);
  });

  it.each([">", "> ", ">\n>", "> \r\n>\r\n>  ", "> >"])("toggles empty quote markers without adding a paragraph for %j", (quote) => {
    const source = `before\n\n${quote}\n\nafter`;
    const from = source.indexOf(">");
    const to = from + quote.length;
    const { editor, host, onChange, input, undo, clipboard } = setup(source);
    const quotes = () => host.querySelectorAll("blockquote[data-source-container]");
    const markerCount = quote.split(/\r\n|\r|\n/).length;
    expect(quotes().length).toBeGreaterThan(0);
    expect(host.querySelector("blockquote.source-quote-editing")).toBeNull();
    expect(host.querySelector("blockquote p")).toBeNull();
    expect(host.querySelectorAll("blockquote .source-line-prefix-hidden")).toHaveLength(markerCount);

    editor.setSelection({ anchor: from, head: to });
    expect(host.querySelector("blockquote.source-quote-editing")).not.toBeNull();
    expect(host.querySelectorAll("blockquote .source-line-prefix")).toHaveLength(markerCount);
    expect(clipboard("copy")).toBe(quote);
    expect(editor.getSelection()).toEqual({ anchor: from, head: to });
    editor.setSelectionOffset(source.length);
    expect(quotes().length).toBeGreaterThan(0);
    expect(host.querySelector("blockquote.source-quote-editing")).toBeNull();
    expect(host.querySelectorAll("blockquote .source-line-prefix-hidden")).toHaveLength(markerCount);
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();

    editor.setSelectionOffset(to);
    input("文字");
    expect(editor.getMarkdown()).toBe(`${source.slice(0, to)}文字${source.slice(to)}`);
    undo();
    expect(editor.getMarkdown()).toBe(source);
    expect(editor.getSelectionOffset()).toBe(to);
    expect(host.querySelector("blockquote p")).toBeNull();
  });

  it("uses each quote block separated by an ordinary blank line as one editing unit", () => {
    const first = "> first\n>\n> third";
    const second = "> fourth\n> fifth";
    const source = `${first}\n\n${second}`;
    const { editor, host, onChange } = setup(source);
    const visibleMarkers = () => [...host.querySelectorAll<HTMLElement>("blockquote .source-line-prefix")]
      .map((marker) => marker.textContent);
    const hiddenMarkers = () => host.querySelectorAll("blockquote .source-line-prefix-hidden");

    editor.setSelectionOffset(source.indexOf("third") + 2);
    expect(visibleMarkers()).toEqual(["> ", ">", "> "]);
    expect(hiddenMarkers()).toHaveLength(2);
    expect([...host.querySelectorAll("blockquote")].map((quote) => quote.classList.contains("source-quote-editing")))
      .toEqual([true, false]);

    editor.setSelectionOffset(source.indexOf("fifth") + 2);
    expect(visibleMarkers()).toEqual(["> ", "> "]);
    expect(hiddenMarkers()).toHaveLength(3);
    expect([...host.querySelectorAll("blockquote")].map((quote) => quote.classList.contains("source-quote-editing")))
      .toEqual([false, true]);

    editor.setSelectionOffset(first.length + 1);
    expect(visibleMarkers()).toEqual([]);
    expect(hiddenMarkers()).toHaveLength(5);
    expect(host.querySelector("blockquote.source-quote-editing")).toBeNull();
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reveals continuation indentation without removing the first line's rendered bullet", () => {
    const source = "- first\n  continuation\n  - nested\n\t\tcontinued\n\nend";
    const { editor, host, clipboard, onChange } = setup(source);
    editor.setSelectionOffset(source.indexOf("continuation") + 2);
    expect(host.querySelector("li")?.classList.contains("source-list-editing")).toBe(false);
    expect(host.querySelector(".source-line-prefix")?.textContent).toBe("  ");
    editor.setSelectionOffset(source.indexOf("nested") + 2);
    expect(host.querySelector("li li.source-list-editing")).not.toBeNull();
    expect(host.querySelector(".source-line-prefix")?.textContent).toBe("  - ");
    editor.setSelection({ anchor: 0, head: source.length });
    expect(clipboard("copy")).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["=", "h1"],
    ["-", "h2"],
  ] as const)("keeps a Setext %s heading as one two-line display unit", (marker, tag) => {
    const source = `before\n\nTitle ---\n${marker.repeat(5)}\n\nafter`;
    const titleFrom = source.indexOf("Title ---");
    const markerFrom = source.indexOf(marker.repeat(5));
    const { editor, host, onChange, input, undo } = setup(source);
    const heading = host.querySelector<HTMLElement>(tag);
    const setextMarker = () => heading?.querySelector<HTMLElement>(".setext-heading-marker");

    expect(heading?.textContent).toBe(`Title ---\n${marker.repeat(5)}`);
    expect(heading?.querySelectorAll(".setext-heading-marker")).toHaveLength(1);
    expect(heading?.querySelector(".syntax-hidden")?.textContent).toBe(`\n${marker.repeat(5)}`);
    expect(setextMarker()?.classList.contains("syntax-hidden")).toBe(true);

    editor.setSelectionOffset(titleFrom + 2);
    expect(setextMarker()?.classList.contains("syntax-hint")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(titleFrom + 2);
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();

    editor.setSelectionOffset(markerFrom + 2);
    expect(setextMarker()?.classList.contains("syntax-hint")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(markerFrom + 2);
    input(marker);
    expect(editor.getMarkdown()).toBe(`${source.slice(0, markerFrom + 2)}${marker}${source.slice(markerFrom + 2)}`);
    undo();
    expect(editor.getMarkdown()).toBe(source);

    editor.setSelectionOffset(source.length);
    expect(setextMarker()?.classList.contains("syntax-hidden")).toBe(true);
  });

  it.each([
    ["H1 with LF", "\n", "===", "h1"],
    ["H1 with CRLF", "\r\n", "===", "h1"],
    ["H2 with LF", "\n", "---", "h2"],
    ["H2 with CRLF", "\r\n", "---", "h2"],
  ] as const)("keeps horizontal movement on every visual Setext line for %s", (
    _name,
    ending,
    underline,
    tag,
  ) => {
    const prefix = `before${ending}${ending}`;
    const source = `${prefix}Title${ending}${underline}${ending}${ending}after`;
    const titleFrom = prefix.length;
    const markerFrom = source.indexOf(underline, titleFrom);
    const { editor, host, key } = setup(source);

    editor.setSelectionOffset(titleFrom + 1);
    expect(key("ArrowLeft")).toBe(false);

    const heading = host.querySelector<HTMLElement>(tag);
    expect(editor.getSelectionOffset()).toBe(titleFrom);
    expect(document.getSelection()?.anchorNode).toBe(heading?.firstChild);
    expect(document.getSelection()?.anchorOffset).toBe(0);

    editor.setSelectionOffset(markerFrom + 1);
    expect(key("ArrowLeft")).toBe(false);

    const marker = host.querySelector<HTMLElement>(".setext-heading-marker");
    expect(editor.getSelectionOffset()).toBe(markerFrom);
    expect(document.getSelection()?.anchorNode).toBe(marker?.firstChild);
    expect(document.getSelection()?.anchorOffset).toBe(ending.length);

    editor.setSelectionOffset(markerFrom - ending.length);
    expect(key("ArrowRight")).toBe(false);
    expect(editor.getSelectionOffset()).toBe(markerFrom);
    expect(document.getSelection()?.anchorNode).toBe(marker?.firstChild);
    expect(document.getSelection()?.anchorOffset).toBe(ending.length);

    editor.setSelectionOffset(markerFrom);
    expect(key("ArrowLeft")).toBe(false);
    expect(editor.getSelectionOffset()).toBe(markerFrom - ending.length);
    expect(document.getSelection()?.anchorNode).toBe(heading?.firstChild);
    expect(document.getSelection()?.anchorOffset).toBe("Title".length);

    editor.setSelectionOffset(titleFrom + 1);
    expect(key("ArrowLeft", { shiftKey: true })).toBe(false);
    expect(editor.getSelection()).toEqual({ anchor: titleFrom + 1, head: titleFrom });
    expect(document.getSelection()?.isCollapsed).toBe(false);

    editor.setSelectionOffset(markerFrom + 1);
    expect(key("ArrowLeft", { shiftKey: true })).toBe(false);
    expect(editor.getSelection()).toEqual({ anchor: markerFrom + 1, head: markerFrom });
    expect(document.getSelection()?.isCollapsed).toBe(false);

    editor.setSelectionOffset(markerFrom - ending.length);
    expect(key("ArrowRight", { shiftKey: true })).toBe(false);
    expect(editor.getSelection()).toEqual({
      anchor: markerFrom - ending.length,
      head: markerFrom,
    });
    expect(document.getSelection()?.isCollapsed).toBe(false);

    editor.setSelectionOffset(titleFrom);
    expect(key("ArrowLeft")).toBe(false);
    expect(editor.getSelectionOffset()).toBe(titleFrom - ending.length);

    editor.setSelectionOffset(markerFrom + underline.length);
    expect(key("ArrowRight")).toBe(false);
    expect(editor.getSelectionOffset()).toBe(markerFrom + underline.length + ending.length);

    expect(editor.getMarkdown()).toBe(source);
  });

  it.each([false, true])("reveals all selected inline units, including endpoints (reverse: %s)", (reverse) => {
    const source = "a **one** b **two** c **three** z **outside**";
    const { editor, host, clipboard, undo, onChange } = setup(source);
    const selection = reverse ? { anchor: 24, head: 4 } : { anchor: 4, head: 24 };
    editor.setSelection(selection);
    expect([...host.querySelectorAll(".syntax-hint")].filter((node) => node.textContent === "**")).toHaveLength(6);
    expect([...host.querySelectorAll(".syntax-hidden")].filter((node) => node.textContent === "**")).toHaveLength(2);
    expect(editor.getSelection()).toEqual(selection);
    expect(onChange).not.toHaveBeenCalled();
    expect(clipboard("copy")).toBe(source.slice(4, 24));
    expect(clipboard("cut")).toBe(source.slice(4, 24));
    expect(editor.getMarkdown()).toBe(source.slice(0, 4) + source.slice(24));
    undo();
    expect(editor.getMarkdown()).toBe(source);
    expect(editor.getSelection()).toEqual(selection);
    editor.setSelectionOffset(source.length);
    expect([...host.querySelectorAll(".syntax-hint")].filter((node) => node.textContent === "**")).toHaveLength(2);
  });

  it.each([false, true])("reveals covered lines and whole blocks while retaining tables (reverse: %s)", (reverse) => {
    const source = "# before\n\n- first\n  - **nested**\n- last\n\n> quote\n> next\n\n```ts\ncode\n```\n\n> [!note]\n> body\n\n| a | b |\n| --- | --- |\n| c | **d** |\n\n## after\n\n# outside";
    const { editor, host, clipboard, onChange } = setup(source, { extensions: [createCalloutExtension()] });
    const from = source.indexOf("before") + 1;
    const to = source.indexOf("after") + 2;
    const selection = reverse ? { anchor: to, head: from } : { anchor: from, head: to };
    editor.setSelection(selection);
    expect(host.querySelectorAll("li.source-list-editing")).toHaveLength(3);
    expect(host.querySelectorAll("blockquote .source-line-prefix")).toHaveLength(2);
    expect(host.querySelector("pre[data-live-syntax-state='editing']")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector("td .syntax-hint")?.textContent).toBe("**");
    expect(host.querySelector("h1:last-of-type .syntax-hidden")?.textContent).toBe("# ");
    expect(editor.getSelection()).toEqual(selection);
    expect(clipboard("copy")).toBe(source.slice(from, to));
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    editor.setSelectionOffset(source.length);
    expect(host.querySelectorAll("li.source-list-editing")).toHaveLength(0);
    expect(host.querySelector("pre[data-live-syntax-state='editing']")).toBeNull();
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();
  });

  it("reveals boundary units even when only the boundaries are selected", () => {
    const source = "**first** middle *last*";
    const { editor, host, onChange } = setup(source);
    editor.setSelection({ anchor: "**first**".length, head: source.indexOf("*last*") });
    expect([...host.querySelectorAll(".syntax-hint")].map((node) => node.textContent)).toEqual(["**", "**", "*", "*"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    "> ```ts\n> code\n> ```",
    "- item\n\n  ```ts\n  code\n  ```",
  ])("activates covered fenced blocks inside containers: %s", (block) => {
    const source = `before\n\n${block}\n\nafter`;
    const { editor, host, onChange } = setup(source);
    editor.setSelection({ anchor: 1, head: source.length - 1 });
    expect(host.querySelector("pre[data-live-syntax-state='editing']")).not.toBeNull();
    editor.setSelectionOffset(source.length);
    expect(host.querySelector("pre[data-live-syntax-state='editing']")).toBeNull();
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["# title", "- item", "> quote", "**bold**"])("pastes raw Markdown into %s without repair", (source) => {
    const { editor, clipboard, undo } = setup(source);
    editor.setSelectionOffset(source.length);
    clipboard("paste", "\r\n\t[broken](\n| a | b");
    expect(editor.getMarkdown()).toBe(source + "\r\n\t[broken](\n| a | b");
    undo();
    expect(editor.getMarkdown()).toBe(source);
  });

  it("edits a repeated table value in place without touching spacing or dividers", () => {
    const source = "| same | same  |\r\n|:-----|-----:|\r\n| same | **same** |";
    const { editor, host, input, undo, key } = setup(source);
    const at = source.lastIndexOf("same") + 2;
    editor.setSelectionOffset(at);
    input("X");
    expect(editor.getMarkdown()).toBe(source.slice(0, at) + "X" + source.slice(at));
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector("pre[data-source-kind=table]")).toBeNull();
    key("Tab");
    undo();
    expect(editor.getMarkdown()).toBe(source);
  });

  it("keeps a table editable inside a Callout", () => {
    const source = "> [!note]\n>\n> | a | b |\n> | --- | --- |\n> | c | d |";
    const { editor, host, input, undo } = setup(source, { extensions: [createCalloutExtension()] });
    const at = source.lastIndexOf("d");
    editor.setSelectionOffset(at);
    input("X");
    expect(editor.getMarkdown()).toBe(source.slice(0, at) + "X" + source.slice(at));
    expect(host.querySelector("table")).not.toBeNull();
    undo();
    expect(editor.getMarkdown()).toBe(source);
  });

  it("uses cell boundaries for navigation and deletion", () => {
    const source = "| a | b |\n| --- | --- |\n| c | d |\n\nafter";
    const { editor, key } = setup(source);
    editor.setSelectionOffset(source.indexOf("a") + 1);
    key("ArrowRight");
    expect(editor.getSelectionOffset()).toBe(source.indexOf("b"));
    key("Backspace");
    expect(editor.getMarkdown()).toBe(source);
    key("Enter");
    expect(editor.getSelectionOffset()).toBe(source.indexOf("d"));
  });

  it("does not move into unmapped table structure at the document edge", () => {
    const source = "| a | b |\n| --- | --- |\n| c | d |";
    const { editor, key } = setup(source);
    const at = source.indexOf("d") + 1;
    editor.setSelectionOffset(at);
    key("Tab"); expect(editor.getSelectionOffset()).toBe(at);
    expect(editor.isSourceMode()).toBe(false);
    expect(editor.getMarkdown()).toBe(source);
  });

  it("adds and deletes table rows through complete source undo operations", () => {
    const source = "> [!note]\r\n>\r\n> | a | b |\r\n> | :--- | ---: |\r\n> | c | d |";
    const { editor, key, host, undo } = setup(source);
    editor.setSelectionOffset(source.indexOf("d"));
    key("Enter", { ctrlKey: true, metaKey: true });
    expect(editor.getMarkdown()).toBe(source + "\r\n> | | |");
    expect(host.querySelectorAll("table tr")).toHaveLength(3);
    undo(); expect(editor.getMarkdown()).toBe(source);
    editor.setSelectionOffset(source.indexOf("d"));
    key("Backspace", { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(editor.getMarkdown()).toBe(source.slice(0, source.lastIndexOf("\r\n")));
    undo(); expect(editor.getMarkdown()).toBe(source);
  });

  it("preserves the image while revealing source at either boundary and on click", () => {
    const source = "before\n\n![alt](image.png)\n\nafter";
    const { editor, host } = setup(source);
    editor.setSelectionOffset(source.length);
    host.querySelector("img")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getSelectionOffset()).toBe(source.indexOf("!["));
    expect(host.querySelector("img")).not.toBeNull();
    for (const offset of [source.indexOf("!["), source.indexOf(")") + 1]) {
      editor.setSelectionOffset(offset);
      expect(host.querySelector(".syntax-hidden")?.textContent).not.toBe("![alt](image.png)");
    }
  });

  it("defers source mode until source composition finishes and commits once", async () => {
    const { editor, textarea, onChange, undo } = setup("a");
    editor.setSourceMode(true);
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.value = "a中";
    textarea.dispatchEvent(new InputEvent("input", { isComposing: true }));
    editor.setSourceMode(false);
    expect(editor.isSourceMode()).toBe(true);
    textarea.value = "a中文";
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(editor.isSourceMode()).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("a中文");
    undo();
    expect(editor.getMarkdown()).toBe("a");
  });
});

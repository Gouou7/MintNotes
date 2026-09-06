import { afterEach, describe, expect, it } from "vitest";
import { Plugin } from "prosemirror-state";
import { createEditor, type EditorExtension, type EditorOptions } from "./core/lib";
import { createCalloutExtension, focusCalloutMarker } from "./extensions/callout";
import { createCommentExtension } from "./extensions/comment";
import { createMathExtension } from "./extensions/math";
import { createMermaidExtension } from "./extensions/mermaid";
import { createWikiLinkExtension } from "./extensions/wikilink";
import {
  INVALID_SOURCE_FIDELITY_STRINGS,
  SOURCE_FIDELITY_LINE_ENDING_STRINGS,
} from "./core/source-fidelity-fixtures";

interface MintPresentationOptions {
  renderMath?: (container: HTMLElement, source: string) => void | (() => void);
  renderMathBlock?: (container: HTMLElement, source: string) => void | (() => void);
  renderMermaid?: (container: HTMLElement, source: string) => void | (() => void);
  onWikiLink?: (target: string) => void;
}

function activeLiveTextSurface(editable: HTMLElement): HTMLElement | null {
  const anchor = document.getSelection()?.anchorNode;
  const parent = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
  const selected = parent?.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6, td, th, code");
  if (selected && editable.contains(selected)) return selected;
  const structured = editable.querySelector<HTMLElement>("pre[data-source-block] > code")
    ?? editable.querySelector<HTMLElement>(
      ".source-blockquote-node.is-source-editing .source-blockquote-source-code",
    )
    ?? editable.querySelector<HTMLElement>("pre.cb-source-editing > code")
    ?? editable.querySelector<HTMLElement>(
      "pre[data-source-gap]:not([data-source-gap-structural]) > code",
    );
  if (structured) return structured;
  const lastBlock = editable.lastElementChild;
  if (lastBlock instanceof HTMLElement && /^(P|H[1-6])$/.test(lastBlock.tagName)) return lastBlock;
  return lastBlock?.querySelector<HTMLElement>("li:last-child p, td:last-child, th:last-child") ?? null;
}

function createMintEditor(
  host: HTMLElement,
  options: EditorOptions & { presentations?: MintPresentationOptions } = {},
) {
  const { presentations, ...editorOptions } = options;
  return createEditor(host, {
    ...editorOptions,
    extensions: [
      createCommentExtension(),
      createCalloutExtension(),
      createMathExtension({
        renderInline: presentations?.renderMath,
        renderBlock: presentations?.renderMathBlock,
      }),
      createMermaidExtension({ render: presentations?.renderMermaid }),
      createWikiLinkExtension({ onNavigate: presentations?.onWikiLink }),
    ],
  });
}

async function typeNativeText(host: HTMLElement, text: string): Promise<void> {
  for (const character of text) {
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const surface = editable ? activeLiveTextSurface(editable) : null;
    if (!editable || !surface) throw new Error("Missing active Live text surface");
    surface.textContent = `${surface.textContent ?? ""}${character}`;
    const range = document.createRange();
    range.selectNodeContents(surface);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: character,
      bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function typeNativeTextAtSelection(host: HTMLElement, text: string): Promise<void> {
  for (const character of text) {
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const selection = document.getSelection();
    if (!editable || !selection || selection.rangeCount === 0) {
      throw new Error("Missing active Live selection");
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const inserted = document.createTextNode(character);
    range.insertNode(inserted);
    range.setStartAfter(inserted);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: character,
      bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function typeBrowserTextAtSelection(host: HTMLElement, text: string): Promise<void> {
  for (const character of text) {
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    if (!editable) throw new Error("Missing Live editor");
    const beforeInput = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: character,
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function typeKeyboardTextAtSelection(host: HTMLElement, text: string): Promise<void> {
  for (const character of text) {
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    if (!editable) throw new Error("Missing Live editor");
    const keyDown = new KeyboardEvent("keydown", {
      key: character,
      code: character === "`" ? "Backquote" : "",
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(keyDown);
    const beforeInput = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: character,
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(true);
    editable.dispatchEvent(new KeyboardEvent("keyup", {
      key: character,
      code: character === "`" ? "Backquote" : "",
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function composeNativeText(host: HTMLElement, candidates: readonly string[]): Promise<void> {
  const editable = host.querySelector<HTMLElement>(".ProseMirror");
  const surface = editable ? activeLiveTextSurface(editable) : null;
  if (!editable || !surface) throw new Error("Missing active Live text surface");
  const prefix = surface.textContent ?? "";
  editable.dispatchEvent(new CompositionEvent("compositionstart", {
    bubbles: true,
    data: "",
  }));
  for (const candidate of candidates) {
    surface.textContent = prefix + candidate;
    const range = document.createRange();
    range.selectNodeContents(surface);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new CompositionEvent("compositionupdate", {
      bubbles: true,
      data: candidate,
    }));
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertCompositionText",
      data: candidate,
      bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  editable.dispatchEvent(new CompositionEvent("compositionend", {
    bubbles: true,
    data: candidates.at(-1) ?? "",
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function deleteNativeLastCharacter(host: HTMLElement): Promise<void> {
  const editable = host.querySelector<HTMLElement>(".ProseMirror");
  const surface = editable ? activeLiveTextSurface(editable) : null;
  if (!editable || !surface) throw new Error("Missing active Live text surface");
  surface.textContent = (surface.textContent ?? "").slice(0, -1);
  const range = document.createRange();
  range.selectNodeContents(surface);
  range.collapse(false);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  editable.dispatchEvent(new InputEvent("input", {
    inputType: "deleteContentBackward",
    data: null,
    bubbles: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pressNavigationKey(
  host: HTMLElement,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  });
  host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(event);
  return event.defaultPrevented;
}

function scrollRequestCounter(): {
  extension: EditorExtension;
  requests: () => number;
} {
  let requests = 0;
  return {
    extension: {
      id: "test-scroll-request-counter",
      createPlugins: () => [new Plugin({
        props: {
          handleScrollToSelection: () => {
            requests += 1;
            return true;
          },
        },
      })],
    },
    requests: () => requests,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Mint editor core public controller", () => {
  it.each(SOURCE_FIDELITY_LINE_ENDING_STRINGS)(
    "keeps %j exact through no-edit controller lifecycle operations",
    (markdown) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });

      expect(editor.getMarkdown()).toBe(markdown);
      editor.focus();
      editor.refreshPresentation();
      editor.toggleSource();
      expect(editor.getMarkdown()).toBe(markdown);
      editor.setMarkdown(markdown);
      editor.toggleSource();
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  const structuredSourceFixtures = [
    ["heading", "### Heading ###"],
    ["bullet list", "* item\n  + nested"],
    ["ordered list", "07) item\n    9. nested"],
    ["task list", "- [X] item"],
    ["table", "| a  | b |\n| :--- | ---: |\n| x\\|y | z |"],
    ["reference definition", "[Ref]: <https://example.test> 'Title'"],
    ["TOC", "[TOC]"],
    ["horizontal rule", "* * *"],
  ] as const;

  it.each(structuredSourceFixtures)(
    "round-trips every authored offset in a structured %s block",
    (_name, markdown) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });
      for (let offset = 0; offset <= markdown.length; offset += 1) {
        editor.setSelectionOffset(offset);
        expect(editor.getSelectionOffset()).toBe(offset);
        expect(editor.getMarkdown()).toBe(markdown);
      }
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  it.each([
    ["heading", "### Heading ###", 1],
    ["bullet list", "* item\n  + nested", 1],
    ["ordered list", "07) item", 2],
    ["task list", "- [X] item", 4],
    ["table", "| a  | b |\n| :--- | ---: |", 1],
    ["reference definition", "[Ref]: <https://example.test> 'Title'", 6],
    ["TOC", "[TOC]", 1],
    ["horizontal rule", "* * *", 1],
  ] as const)(
    "deletes exactly one authored delimiter character in a %s block",
    (_name, syntax, caretInSyntax) => {
      const prefix = "before repeated repeated\n\n";
      const suffix = "\n\nafter repeated repeated\n \t";
      const markdown = `${prefix}${syntax}${suffix}`;
      const deleteAt = prefix.length + caretInSyntax - 1;
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });

      editor.setSelectionOffset(prefix.length + caretInSyntax);
      if (_name === "table") editor.setSourceMode(true);
      expect(host.querySelector("pre[data-source-block], pre[data-source-gap]")).not.toBeNull();
      host.querySelector<HTMLElement>(editor.isSourceMode() ? "textarea" : ".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        bubbles: true,
        cancelable: true,
      }));

      const expected = markdown.slice(0, deleteAt) + markdown.slice(deleteAt + 1);
      expect(editor.getMarkdown()).toBe(expected);
      const editable = host.querySelector<HTMLElement>(editor.isSourceMode() ? "textarea" : ".ProseMirror");
      editable?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
      expect(editor.getMarkdown()).toBe(markdown);
      editable?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
      expect(editor.getMarkdown()).toBe(expected);
      expect(changes).toEqual([expected, markdown, expected]);
      editor.destroy();
    },
  );

  it("toggles a task checkbox through one canonical source transaction", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, {
      initialContent: "- [ ] task\n\nafter",
      onChange: (markdown) => changes.push(markdown),
    });
    editor.setSelectionOffset(editor.getMarkdown().length);
    const checkbox = host.querySelector<HTMLElement>(".checkbox");
    expect(checkbox).not.toBeNull();
    checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(editor.getMarkdown()).toBe("- [x] task\n\nafter");
    expect(changes).toEqual(["- [x] task\n\nafter"]);

    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    editable?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.getMarkdown()).toBe("- [ ] task\n\nafter");
    editor.destroy();
  });

  it("keeps canonical command undo local to the current external document", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "a" });
    editor.insertMarkdown("b", 1);
    expect(editor.getMarkdown()).toBe("ab");
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    editable?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.getMarkdown()).toBe("a");

    editor.setMarkdown("external");
    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.getMarkdown()).toBe("external");
    editor.destroy();
  });

  it("renders a source-backed HTML break and reveals its exact source for editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "a<br>b" });
    expect(host.querySelector("br.html-break-render")).not.toBeNull();
    expect(host.querySelector(".syntax-hidden")?.textContent).toBe("<br>");
    expect(editor.getMarkdown()).toBe("a<br>b");

    editor.setSelectionOffset(3);
    expect(host.querySelector("br.html-break-render")).toBeNull();
    expect(host.querySelector(".syntax-hint")?.textContent).toBe("<br>");
    expect(editor.getMarkdown()).toBe("a<br>b");
    editor.destroy();
  });

  it("hides complete Obsidian comments until their authored range is selected", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "before %%secret%% after" });
    expect(host.querySelector(".live-comment-source")?.textContent).toBe("%%secret%%");
    expect(editor.getMarkdown()).toBe("before %%secret%% after");

    editor.setSelectionOffset(10);
    expect(host.querySelector(".live-comment-source")).toBeNull();
    expect(host.textContent).toContain("%%secret%%");
    expect(editor.getMarkdown()).toBe("before %%secret%% after");
    editor.destroy();
  });

  const sourceEditBoundaryFixtures = [
    ...structuredSourceFixtures,
    ["blockquote", "> quote\n>\n> tail"],
    ["Callout", "> [!NOTE]\n> body"],
    ["fenced code", "````ts\nconst value = `x`;\n````"],
  ] as const;

  it.each(sourceEditBoundaryFixtures)(
    "isolates beginning, middle, and end source edits in %s",
    (_name, syntax) => {
      const prefix = "lead repeated repeated\r\n\r\n";
      const suffix = "\r\n\r\ntail repeated repeated\r\n \t";
      const markdown = `${prefix}${syntax}${suffix}`;
      const positions = [
        prefix.length + 1,
        prefix.length + Math.max(1, Math.floor(syntax.length / 2)),
        prefix.length + Math.max(1, syntax.length - 1),
      ];

      const exercise = (
        key: "Backspace" | "Delete" | "Enter",
        position: number,
        expected: string,
      ) => {
        const host = document.createElement("div");
        document.body.append(host);
        const changes: string[] = [];
        const editor = createEditor(host, {
          initialContent: markdown,
          onChange: (next) => changes.push(next),
        });
        editor.setSelectionOffset(position);
        if (_name === "table") editor.setSourceMode(true);
        if (editor.isSourceMode() && key === "Enter") editor.insertMarkdown("\n");
        else host.querySelector<HTMLElement>(editor.isSourceMode() ? "textarea" : ".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
        }));
        expect(editor.getMarkdown()).toBe(expected);
        expect(changes).toEqual([expected]);
        editor.destroy();
        host.remove();
      };

      for (const position of positions) {
        exercise(
          "Backspace",
          position,
          markdown.slice(0, position - 1) + markdown.slice(position),
        );
        const deletePosition = Math.min(position, prefix.length + syntax.length - 1);
        exercise(
          "Delete",
          deletePosition,
          markdown.slice(0, deletePosition) + markdown.slice(deletePosition + 1),
        );
        const lineStart = markdown.lastIndexOf("\n", position - 1) + 1;
        const line = markdown.slice(lineStart, markdown.indexOf("\n", lineStart) < 0
          ? markdown.length
          : markdown.indexOf("\n", lineStart));
        const quotePrefix = /^(?: {0,3}>[\t ]?)+/.exec(line)?.[0] ?? "";
        const enterText = quotePrefix ? `\n${quotePrefix}` : "\n";
        exercise(
          "Enter",
          position,
          markdown.slice(0, position) + enterText + markdown.slice(position),
        );
      }
    },
  );

  it.each(INVALID_SOURCE_FIDELITY_STRINGS)(
    "keeps incomplete syntax %j exact through no-edit mode switches",
    (markdown) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });
      editor.toggleSource();
      editor.toggleSource();
      editor.refreshPresentation();
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  it.each(["*", "+", "-", "1.", "1)"])(
    "keeps incomplete list candidate %j literal while native typing continues",
    async (marker) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host);

      await typeNativeText(host, marker);
      expect(editor.getMarkdown()).toBe(marker);
      expect(host.querySelector(".ProseMirror > p")?.textContent).toBe(marker);
      expect(host.querySelector(".ProseMirror > ul, .ProseMirror > ol")).toBeNull();
      expect(host.querySelector("pre[data-source-block]")).toBeNull();

      await typeNativeText(host, "a");
      expect(editor.getMarkdown()).toBe(`${marker}a`);
      expect(host.querySelector(".ProseMirror > p")?.textContent).toBe(`${marker}a`);
      expect(host.querySelector(".ProseMirror > ul, .ProseMirror > ol")).toBeNull();
      editor.destroy();
    },
  );

  it("inserts each typed backtick exactly once without synthesizing a closing fence", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, { onChange: (next) => changes.push(next) });
    editor.focus();

    await typeKeyboardTextAtSelection(host, "`");
    expect(editor.getMarkdown()).toBe("`");
    await typeKeyboardTextAtSelection(host, "`");
    expect(editor.getMarkdown()).toBe("``");
    await typeKeyboardTextAtSelection(host, "`");

    expect(editor.getMarkdown()).toBe("```");
    expect(editor.getSelectionOffset()).toBe(3);
    const code = host.querySelector<HTMLElement>(".ProseMirror > pre > code");
    expect(code?.textContent).toBe("```");
    const domSelection = document.getSelection();
    if (!code || !domSelection?.anchorNode) throw new Error("Missing fenced-code DOM selection");
    const domOffset = document.createRange();
    domOffset.selectNodeContents(code);
    domOffset.setEnd(domSelection.anchorNode, domSelection.anchorOffset);
    expect(domOffset.toString().length).toBe(3);
    expect(changes).toEqual(["`", "``", "```"]);

    await typeKeyboardTextAtSelection(host, "ts");
    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.getMarkdown()).toBe("```ts\n");
    expect(editor.getSelectionOffset()).toBe(6);
    expect(host.querySelector(".ProseMirror > pre > code")?.textContent).toBe("```ts");
    expect(changes.at(-1)).toBe("```ts\n");
    editor.destroy();
  });

  it.each([
    ["an empty document", "", 0],
    ["a trailing blank line", "before\n\n", "before\n\n".length],
    ["a blank line between blocks", "before\n\n\nafter", "before\n\n".length],
  ] as const)(
    "inserts exactly one backtick per key press on %s",
    async (_name, markdown, offset) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host, { initialContent: markdown });
      editor.setSelectionOffset(offset);

      await typeKeyboardTextAtSelection(host, "`");
      expect(editor.getMarkdown()).toBe(
        `${markdown.slice(0, offset)}\`${markdown.slice(offset)}`,
      );
      await typeKeyboardTextAtSelection(host, "`");
      expect(editor.getMarkdown()).toBe(
        `${markdown.slice(0, offset)}\`\`${markdown.slice(offset)}`,
      );
      await typeKeyboardTextAtSelection(host, "`");

      expect(editor.getMarkdown()).toBe(
        `${markdown.slice(0, offset)}\`\`\`${markdown.slice(offset)}`,
      );
      expect(editor.getSelectionOffset()).toBe(offset + 3);
      expect(host.querySelector(
        ".ProseMirror > pre:not([data-source-gap]) > code",
      )?.textContent?.startsWith("```")).toBe(true);
      editor.destroy();
    },
  );

  it("commits ordinary beforeinput text at the current canonical caret", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "ac" });
    editor.setSelectionOffset(1);

    await typeBrowserTextAtSelection(host, "b");

    expect(editor.getMarkdown()).toBe("abc");
    expect(editor.getSelectionOffset()).toBe(2);
    expect(host.querySelector(".ProseMirror > p")?.textContent).toBe("abc");
    editor.destroy();
  });

  it("keeps the native Live text surface mounted while ordinary typing advances the caret", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "plain" });
    editor.setSelectionOffset("plain".length);
    const paragraph = host.querySelector(".ProseMirror > p");

    await typeNativeText(host, " text");

    expect(host.querySelector(".ProseMirror > p")).toBe(paragraph);
    expect(editor.getMarkdown()).toBe("plain text");
    expect(editor.getSelectionOffset()).toBe("plain text".length);
    editor.destroy();
  });

  it("keeps a heading marker visible and the DOM caret on its editing source line", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, { onChange: (next) => changes.push(next) });
    editor.focus();

    await typeNativeText(host, "#");

    const sourceBlock = host.querySelector<HTMLElement>("h1");
    expect(sourceBlock?.textContent).toBe("#");
    expect(sourceBlock?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
    expect(editor.getMarkdown()).toBe("#");
    expect(editor.getSelectionOffset()).toBe(1);

    await typeNativeText(host, " ");
    await composeNativeText(host, ["b", "biao", "标", "标题"]);

    expect(host.querySelector("h1")).toBe(sourceBlock);
    expect(sourceBlock?.textContent).toBe("# 标题");
    expect(sourceBlock?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
    expect(editor.getMarkdown()).toBe("# 标题");
    expect(editor.getSelectionOffset()).toBe("# 标题".length);
    expect(changes).toEqual(["#", "# ", "# 标题"]);
    editor.destroy();
  });

  it.each([
    ["heading", "#", "h1"],
    ["bullet list", "- ", "li p"],
    ["ordered list", "1. ", "li p"],
    ["task list", "- [ ] ", "li p"],
    ["blockquote", ">", "blockquote code"],
    ["horizontal rule", "---", "pre[data-source-block][data-source-kind='horizontal_rule'] > code"],
    ["TOC", "[TOC]", "pre[data-source-block][data-source-kind='toc'] > code"],
    ["reference definition", "[ref]: https://example.test", "pre[data-source-gap] > code"],
  ] as const)(
    "keeps a newly typed %s marker and its DOM caret on the same authored source line",
    async (_name, markdown, selector) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createEditor(host, { onChange: (next) => changes.push(next) });
      editor.focus();

      await typeNativeText(host, markdown);

      const source = host.querySelector<HTMLElement>(selector);
      expect(source?.textContent).toBe(markdown);
      expect(source?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
      expect(editor.getMarkdown()).toBe(markdown);
      expect(editor.getSelectionOffset()).toBe(markdown.length);
      expect(changes.at(-1)).toBe(markdown);
      editor.destroy();
    },
  );

  it.each([
    ["heading", "#", "标题"],
    ["horizontal rule", "---", "x"],
    ["TOC", "[TOC]", "x"],
  ] as const)(
    "keeps text and caret aligned when IME confirmation invalidates a %s candidate",
    async (_name, marker, confirmed) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host);
      editor.focus();

      await typeNativeText(host, marker);
      await composeNativeText(host, ["z", confirmed]);

      const expected = marker + confirmed;
      const paragraph = host.querySelector<HTMLElement>(".ProseMirror > p");
      expect(paragraph?.textContent).toBe(expected);
      expect(paragraph?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
      expect(editor.getMarkdown()).toBe(expected);
      expect(editor.getSelectionOffset()).toBe(expected.length);
      editor.destroy();
    },
  );

  it("keeps an IME-created structure marker and its DOM caret together after confirmation", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, { onChange: (next) => changes.push(next) });
    editor.focus();

    await composeNativeText(host, ["＃", "#"]);

    const source = host.querySelector<HTMLElement>(
      "h1",
    );
    expect(source?.textContent).toBe("#");
    expect(source?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
    expect(editor.getMarkdown()).toBe("#");
    expect(editor.getSelectionOffset()).toBe(1);
    expect(changes).toEqual(["#"]);
    editor.destroy();
  });

  it.each([
    ["heading", "#", ""],
    ["bullet list", "- ", "-"],
    ["ordered list", "1. ", "1."],
    ["blockquote", ">", ""],
    ["fenced code", "```", "``"],
    ["horizontal rule", "---", "--"],
    ["TOC", "[TOC]", "[TOC"],
  ] as const)(
    "keeps text and caret aligned when Backspace invalidates a %s candidate",
    async (_name, marker, expected) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host);
      editor.focus();
      await typeNativeText(host, marker);

      host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        bubbles: true,
        cancelable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const paragraph = host.querySelector<HTMLElement>(".ProseMirror > p");
      expect(paragraph?.textContent).toBe(expected);
      expect(paragraph?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
      expect(editor.getMarkdown()).toBe(expected);
      expect(editor.getSelectionOffset()).toBe(expected.length);
      editor.destroy();
    },
  );

  it.each([
    ["heading", "#x", "#", "h1"],
    ["horizontal rule", "---x", "---", "pre[data-source-block][data-source-kind='horizontal_rule'] > code"],
    ["TOC", "[TOC]x", "[TOC]", "pre[data-source-block][data-source-kind='toc'] > code"],
  ] as const)(
    "reparses a %s formed by a native mobile-style deletion without losing its caret",
    async (_name, initial, expected, selector) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host, { initialContent: initial });
      editor.setSelectionOffset(initial.length);
      editor.focus();

      await deleteNativeLastCharacter(host);

      const source = host.querySelector<HTMLElement>(selector);
      expect(source?.textContent).toBe(expected);
      expect(source?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
      expect(editor.getMarkdown()).toBe(expected);
      expect(editor.getSelectionOffset()).toBe(expected.length);
      editor.destroy();
    },
  );

  it.each([
    ["heading", "#", ""],
    ["bullet list", "- ", "-"],
    ["blockquote", ">", ""],
    ["fenced code", "```", "``"],
    ["horizontal rule", "---", "--"],
    ["TOC", "[TOC]", "[TOC"],
  ] as const)(
    "reparses a %s invalidated by a native mobile-style deletion without losing its caret",
    async (_name, initial, expected) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host, { initialContent: initial });
      editor.setSelectionOffset(initial.length);
      editor.focus();

      await deleteNativeLastCharacter(host);

      const paragraph = host.querySelector<HTMLElement>(".ProseMirror > p");
      expect(paragraph?.textContent).toBe(expected);
      expect(paragraph?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
      expect(editor.getMarkdown()).toBe(expected);
      expect(editor.getSelectionOffset()).toBe(expected.length);
      editor.destroy();
    },
  );

  it("keeps a pasted table rendered and composes in the selected cell", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "| A | B |\n| --- | --- |\n| 一 | 二 |";
    const editor = createEditor(host);
    editor.focus();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => markdown } });
    host.querySelector(".ProseMirror")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector("pre[data-source-kind=table]")).toBeNull();
    expect(editor.getMarkdown()).toBe(markdown);
    editor.setSelectionOffset(markdown.indexOf("二") + 1);
    const cell = host.querySelector("td:last-child");
    await composeNativeText(host, ["b", "biaoti", "标题"]);
    expect(host.querySelector("td:last-child")).toBe(cell);
    expect(editor.getMarkdown()).toBe(markdown.replace("二", "二标题"));
    expect(editor.getSelectionOffset()).toBe(markdown.indexOf("二") + 3);
    editor.destroy();
  });

  it("commits changing Chinese IME candidates once without replacing the Live text surface", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, {
      initialContent: "开始",
      onChange: (next) => changes.push(next),
    });
    editor.setSelectionOffset("开始".length);
    const paragraph = host.querySelector(".ProseMirror > p");

    await composeNativeText(host, ["n", "ni", "你", "你好"]);

    expect(host.querySelector(".ProseMirror > p")).toBe(paragraph);
    expect(editor.getMarkdown()).toBe("开始你好");
    expect(editor.getSelectionOffset()).toBe("开始你好".length);
    expect(changes).toEqual(["开始你好"]);

    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.getMarkdown()).toBe("开始");
    editor.destroy();
  });

  it.each([
    ["heading", "# 标题", "h1"],
    ["nested list", "- 一级\n    - 二级", "li li p"],
    ["task list", "- [ ] 任务", "li p"],
    ["quote", "> 引用", "blockquote p"],
  ])("keeps Chinese IME composition stable inside an editing %s", async (_name, initial, selector) => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, {
      initialContent: initial,
      onChange: (next) => changes.push(next),
    });
    editor.focus();
    editor.setSelectionOffset(initial.length);
    const sourceBlock = host.querySelector(selector);

    await composeNativeText(host, ["z", "zhong", "中", "中文"]);

    expect(host.querySelector(selector)).toBe(sourceBlock);
    expect(editor.getMarkdown()).toBe(`${initial}中文`);
    expect(editor.getSelectionOffset()).toBe(`${initial}中文`.length);
    expect(changes).toEqual([`${initial}中文`]);
    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true,
    }));
    expect(editor.getMarkdown()).toBe(initial);
    editor.destroy();
  });

  it("keeps an editing source-backed surface mounted until its structure changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "# Heading" });
    editor.setSelectionOffset("# Heading".length);
    const sourceBlock = host.querySelector("h1");

    await typeNativeText(host, " text");

    expect(host.querySelector("h1")).toBe(sourceBlock);
    expect(editor.getMarkdown()).toBe("# Heading text");
    expect(editor.getSelectionOffset()).toBe("# Heading text".length);
    editor.destroy();
  });

  it("advances canonical positions across repeated native input in a derived list", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const initial = "- first\n- second";
    const editor = createEditor(host, { initialContent: initial });
    editor.setSelectionOffset(initial.length);
    const list = host.querySelector(".ProseMirror > ul");

    await typeNativeText(host, " repeated");

    expect(host.querySelector(".ProseMirror > ul")).toBe(list);
    expect(editor.getMarkdown()).toBe(`${initial} repeated`);
    expect(editor.getSelectionOffset()).toBe(`${initial} repeated`.length);
    editor.destroy();
  });

  it.each(INVALID_SOURCE_FIDELITY_STRINGS)(
    "keeps valid neighbors rendered around the smallest literal fallback for %j",
    (invalid) => {
      const markdown = `# Valid before\n\n${invalid}\n\n**valid after**`;
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });

      expect(editor.getMarkdown()).toBe(markdown);
      expect(host.querySelector(".ProseMirror > h1")?.textContent).toBe("# Valid before");
      expect(host.querySelector("strong")?.textContent).toBe("valid after");
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  it("preserves source through renderer failure, close, and reopen without onChange", () => {
    const markdown = "> [!NOTE]\n> Body\r\n\r\n### Heading ###\r\n";
    const changes: string[] = [];
    const firstHost = document.createElement("div");
    document.body.append(firstHost);
    const first = createEditor(firstHost, {
      initialContent: markdown,
      extensions: [createCalloutExtension({
        renderBlockquotePreview: () => {
          throw new Error("renderer unavailable");
        },
      })],
      onChange: (next) => changes.push(next),
    });

    first.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    first.refreshPresentation();
    expect(firstHost.querySelector(".live-presentation-fallback")?.textContent)
      .toBe("> [!NOTE]\n> Body");
    first.toggleSource();
    first.toggleSource();
    const saved = first.getMarkdown();
    first.destroy();
    firstHost.remove();

    const secondHost = document.createElement("div");
    document.body.append(secondHost);
    const reopened = createEditor(secondHost, {
      initialContent: saved,
      onChange: (next) => changes.push(next),
    });
    expect(reopened.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    reopened.destroy();
  });

  it("keeps soft breaks inside one Live paragraph and extra blank lines as source gaps", () => {
    const softHost = document.createElement("div");
    document.body.append(softHost);
    const soft = createEditor(softHost, { initialContent: "a\nb" });
    expect(softHost.querySelectorAll(".ProseMirror > p")).toHaveLength(1);
    expect(softHost.querySelector(".ProseMirror > p")?.textContent).toBe("a\nb");
    soft.destroy();

    const standardGapHost = document.createElement("div");
    document.body.append(standardGapHost);
    const standardGap = createEditor(standardGapHost, { initialContent: "a\n\nb" });
    expect(standardGapHost.querySelectorAll("pre[data-source-gap] br[data-source-gap-eol]")).toHaveLength(1);
    expect(standardGapHost.querySelectorAll("pre[data-source-gap] [data-source-gap-hidden]")).toHaveLength(1);
    expect(standardGapHost.querySelector("pre[data-source-gap] br.ProseMirror-trailingBreak"))
      .not.toBeNull();
    expect(standardGap.getMarkdown()).toBe("a\n\nb");
    standardGap.destroy();

    const blankHost = document.createElement("div");
    document.body.append(blankHost);
    const blank = createEditor(blankHost, { initialContent: "a\n\n\nb" });
    expect(blankHost.querySelectorAll("pre[data-source-gap] br[data-source-gap-eol]")).toHaveLength(2);
    expect(blankHost.querySelectorAll("pre[data-source-gap] [data-source-gap-hidden]")).toHaveLength(1);
    expect(blankHost.querySelector("pre[data-source-gap] br.ProseMirror-trailingBreak"))
      .not.toBeNull();
    expect(blank.getMarkdown()).toBe("a\n\n\nb");
    blank.destroy();
  });

  it("does not present the structural line ending between adjacent headings as a blank row", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "# First\n# Second";
    const editor = createEditor(host, { initialContent: markdown });
    const gap = host.querySelector<HTMLElement>("pre[data-source-gap]");

    expect(gap?.dataset.sourceGapStructural).toBe("1");
    expect(gap?.querySelector("br.ProseMirror-trailingBreak")).not.toBeNull();
    expect(editor.getMarkdown()).toBe(markdown);
    editor.setSelectionOffset("# First\n".length);
    expect(editor.getSelectionOffset()).toBe("# First\n".length);
    expect(host.querySelector("h1:last-of-type .syntax-hint")?.textContent).toBe("# ");
    expect(host.querySelector("h1:last-of-type")?.textContent).toBe("# Second");
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("keeps authored blank rows as gaps between independent bullet-list blocks", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "- one\n\n\n- two\n\n- three";
    const editor = createEditor(host, { initialContent: markdown });
    const blocks = [...host.querySelectorAll<HTMLElement>(".ProseMirror > *")];
    const gaps = host.querySelectorAll<HTMLElement>(".ProseMirror > pre[data-source-gap]");

    expect(blocks.map((block) => block.tagName)).toEqual(["UL", "PRE", "UL", "PRE", "UL"]);
    expect(gaps[0]?.querySelectorAll("br[data-source-gap-eol]")).toHaveLength(2);
    expect(gaps[1]?.querySelectorAll("br[data-source-gap-eol]")).toHaveLength(1);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it.each([
    [
      "bullet",
      "- one\n    - nested\n- two\n\n- three",
      "- one\n    - nested\n- two",
      "- three",
    ],
    ["ordered", "1. one\n2. two\n\n3. three", "1. one\n2. two", "3. three"],
    ["task", "- [ ] one\n- [x] two\n\n- [ ] three", "- [ ] one\n- [x] two", "- [ ] three"],
  ] as const)("activates only the selected %s list line across an authored gap", (
    _kind,
    markdown,
    firstBlock,
    secondBlock,
  ) => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: markdown });

    editor.setSelectionOffset(markdown.indexOf("one") + 1);
    expect(host.querySelectorAll(".ProseMirror > pre[data-source-block]")).toHaveLength(0);
    expect(host.querySelector("li .syntax-hint")?.parentElement?.textContent).toBe(firstBlock.split("\n")[0]);

    editor.setSelectionOffset(markdown.indexOf("three") + 1);
    expect(host.querySelectorAll(".ProseMirror > pre[data-source-block]")).toHaveLength(0);
    expect(host.querySelector("li .syntax-hint")?.parentElement?.textContent).toBe(secondBlock);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  const blockGapFixtures = [
    ["heading", "# First"],
    ["bullet list", "- first"],
    ["task list", "- [ ] first"],
    ["fenced code", "```txt\nfirst\n```"],
    ["blockquote", "> first"],
    ["table", "| a |\n| --- |\n| b |"],
    ["horizontal rule", "---"],
  ] as const;

  it.each(blockGapFixtures)(
    "keeps source-authored rows as the only gap after a %s block",
    (_name, firstBlock) => {
      for (const [separator, expectedRows] of [
        ["\n", 0],
        ["\n\n", 1],
        ["\n\n\n", 2],
        ["\n \t\n", 1],
        ["\r\n\r\n", 1],
        ["\r\n\r\n\r\n", 2],
      ] as const) {
        const host = document.createElement("div");
        document.body.append(host);
        const markdown = `${firstBlock}${separator}# Second`;
        const editor = createMintEditor(host, { initialContent: markdown });
        const gap = host.querySelector<HTMLElement>(".ProseMirror > pre[data-source-gap]");
        const visibleRows = gap?.hasAttribute("data-source-gap-structural")
          ? 0
          : (gap?.querySelectorAll("br[data-source-gap-eol]").length ?? 0);

        expect(gap).not.toBeNull();
        expect(visibleRows).toBe(expectedRows);
        expect(editor.getMarkdown()).toBe(markdown);

        editor.setSelectionOffset(markdown.length);
        expect(host.querySelector("h1:last-of-type")?.textContent).toBe("# Second");
        expect(editor.getMarkdown()).toBe(markdown);
        editor.destroy();
        host.remove();
      }
    },
  );

  it.each([
    ["heading", "### Heading", ".ProseMirror > h3"],
    ["bullet list", "- item", ".ProseMirror > ul"],
    ["table", "| a |\n| --- |\n| b |", ".ProseMirror > table"],
    ["TOC", "[TOC]", ".ProseMirror > .toc"],
  ] as const)(
    "preserves the rendered %s surface or its measured height during editing",
    (_name, syntax, selector) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const prefix = "before\n\n";
      const markdown = `${prefix}${syntax}\n\nafter`;
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });
      const rendered = host.querySelector<HTMLElement>(selector);
      if (!rendered) throw new Error(`Missing rendered ${selector}`);
      Object.defineProperty(rendered, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ height: 73.256 }),
      });

      editor.setSelectionOffset(prefix.length + (_name === "table" ? syntax.indexOf("a") : 1));
      const source = host.querySelector<HTMLElement>("pre[data-source-block]");
      if (_name === "TOC") {
        expect(source?.dataset.sourceLayoutHeight).toBe("73.26");
        expect(source?.style.minHeight).toBe("73.26px");
      } else {
        expect(host.querySelector(selector)).toBe(rendered);
        expect(source).toBeNull();
      }
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);

      editor.setSelectionOffset(0);
      expect(host.querySelector("pre[data-source-block]")).toBeNull();
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  it.each([
    ["emphasis", "*em*", 2, "*"],
    ["strong emphasis", "**strong**", 3, "**"],
    ["highlight", "==mark==", 3, "=="],
    ["strikeout", "~~strike~~", 3, "~~"],
    ["inline code", "`code`", 2, "`"],
    ["Markdown link", "[link](https://example.test)", 2, "["],
  ] as const)(
    "reveals %s delimiters without changing canonical Markdown",
    (_name, syntax, caretInSyntax, openingDelimiter) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const prefix = "before ";
      const markdown = `${prefix}${syntax} after`;
      const editor = createMintEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });

      editor.setSelectionOffset(0);
      expect(Array.from(host.querySelectorAll(".syntax-hidden"))
        .some((element) => element.textContent === openingDelimiter)).toBe(true);

      editor.setSelectionOffset(prefix.length + caretInSyntax);
      expect(Array.from(host.querySelectorAll(".syntax-hint"))
        .some((element) => element.textContent === openingDelimiter)).toBe(true);
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);

      editor.setSelectionOffset(0);
      expect(Array.from(host.querySelectorAll(".syntax-hidden"))
        .some((element) => element.textContent === openingDelimiter)).toBe(true);
      editor.destroy();
    },
  );

  it("renders Chinese emphasis as an em mark in Live mode", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "中文 *斜体* and _italic_";
    const editor = createEditor(host, { initialContent: markdown });
    const emphasis = host.querySelectorAll<HTMLElement>(".ProseMirror em");

    expect(Array.from(emphasis, (node) => node.textContent)).toEqual(["斜体", "italic"]);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals a WikiLink in place without changing canonical Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = "before [[Guide|the guide]] after";
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });

    expect(host.querySelector(".live-wikilink-widget")).not.toBeNull();
    editor.setSelectionOffset(markdown.indexOf("Guide") + 1);
    expect(host.querySelector(".live-wikilink-widget")).toBeNull();
    expect(host.textContent).toContain("[[Guide|the guide]]");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it.each([1, 2, 3, 4, 5, 6] as const)(
    "labels an editing level-%s heading source with its original heading level",
    (level) => {
      const host = document.createElement("div");
      document.body.append(host);
      const markdown = `${"#".repeat(level)} Heading`;
      const editor = createEditor(host, { initialContent: markdown });

      editor.setSelectionOffset(markdown.length);

      expect(host.querySelector(`h${level} .syntax-hint`)?.textContent).toBe(`${"#".repeat(level)} `);
      expect(editor.getMarkdown()).toBe(markdown);
      editor.destroy();
    },
  );

  it("applies Enter as one canonical source transaction and reparses the Live view", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, {
      initialContent: "abc",
      onChange: (markdown) => changes.push(markdown),
    });
    editor.setSelectionOffset(1);

    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.getMarkdown()).toBe("a\nbc");
    expect(changes).toEqual(["a\nbc"]);
    expect(host.querySelectorAll(".ProseMirror > p")).toHaveLength(1);

    editor.destroy();
  });

  it("requests caret scrolling after keyboard, text, clipboard, and history edits", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const counter = scrollRequestCounter();
    const editor = createEditor(host, {
      initialContent: "abc",
      extensions: [counter.extension],
    });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    if (!editable) throw new Error("Missing Live editor");
    editor.setSelectionOffset(3);
    editor.focus();

    let previous = counter.requests();
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    expect(counter.requests()).toBeGreaterThan(previous);

    previous = counter.requests();
    await typeBrowserTextAtSelection(host, "d");
    expect(counter.requests()).toBeGreaterThan(previous);

    previous = counter.requests();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "ef" } });
    editable.dispatchEvent(paste);
    expect(counter.requests()).toBeGreaterThan(previous);

    previous = counter.requests();
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      bubbles: true,
      cancelable: true,
    }));
    expect(counter.requests()).toBeGreaterThan(previous);

    previous = counter.requests();
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(counter.requests()).toBeGreaterThan(previous);

    editor.destroy();
  });

  it("requests caret scrolling when table keyboard navigation changes cells", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const counter = scrollRequestCounter();
    const markdown = "| A | B |\n| --- | --- |\n| C | D |";
    const editor = createEditor(host, {
      initialContent: markdown,
      extensions: [counter.extension],
    });
    editor.setSelectionOffset(markdown.indexOf("A"));
    editor.focus();
    const previous = counter.requests();

    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.getSelectionOffset()).toBe(markdown.indexOf("C"));
    expect(counter.requests()).toBeGreaterThan(previous);
    editor.destroy();
  });

  it("keeps presentation refreshes and external replacements from moving the viewport", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const counter = scrollRequestCounter();
    const editor = createEditor(host, {
      initialContent: "abc",
      extensions: [counter.extension],
    });
    editor.setSelectionOffset(2);
    editor.focus();
    const previous = counter.requests();

    editor.refreshPresentation();
    editor.replaceMarkdown("abcd", 2);

    expect(editor.getSelectionOffset()).toBe(2);
    expect(counter.requests()).toBe(previous);
    editor.destroy();
  });

  it.each([
    ["bullet list", "- item", "- item\n- ", "- item\n\n"],
    ["ordered list", "3. item", "3. item\n4. ", "3. item\n\n"],
    ["task list", "- [x] item", "- [x] item\n- [ ] ", "- [x] item\n\n"],
    ["blockquote", ">quote", ">quote\n>", ">quote\n\n"],
  ] as const)(
    "moves below a preserved blank row after two Enter presses in a %s",
    (_name, initial, continued, exited) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host, { initialContent: initial });
      const editable = host.querySelector<HTMLElement>(".ProseMirror");
      const enter = () => editable?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }));
      editor.setSelectionOffset(initial.length);

      enter();
      expect(editor.getMarkdown()).toBe(continued);
      expect(editor.getSelectionOffset()).toBe(continued.length);

      enter();
      expect(editor.getMarkdown()).toBe(exited);
      expect(editor.getSelectionOffset()).toBe(exited.length);

      editor.destroy();
      host.remove();
    },
  );

  it.each(SOURCE_FIDELITY_LINE_ENDING_STRINGS)(
    "round-trips every available source offset for %j",
    (markdown) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host, { initialContent: markdown });
      for (let offset = 0; offset <= markdown.length; offset += 1) {
        editor.setSelectionOffset(offset);
        expect(editor.getSelectionOffset()).toBe(offset);
      }
      editor.destroy();
    },
  );

  it("refreshes a pending image source without changing Markdown or the caret", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const attachmentSource = "webmd-attachment:11111111-1111-4111-8111-111111111111";
    const markdown = `before ![image](${attachmentSource}) after`;
    const displaySource = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    let resolvedSource: string | null | undefined = null;
    const editor = createMintEditor(host, {
      initialContent: markdown,
      resolveImageSource: (source) => source === attachmentSource ? resolvedSource : undefined,
    });

    editor.setSelectionOffset(markdown.length);
    const initialOffset = editor.getSelectionOffset();
    expect(host.querySelector("img.image-render")?.hasAttribute("src")).toBe(false);

    resolvedSource = displaySource;
    editor.refreshPresentation();

    expect(host.querySelector("img.image-render")?.getAttribute("src")).toBe(displaySource);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe(initialOffset);
    editor.destroy();
  });

  it("refreshes a blockquote preview without changing source or selection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "> [!NOTE]\n> Body";
    let renderCount = 0;
    const editor = createEditor(host, {
      initialContent: markdown,
      extensions: [createCalloutExtension({
        renderBlockquotePreview: (container, source) => {
          renderCount += 1;
          container.textContent = source;
        },
      })],
    });

    expect(focusCalloutMarker(editor, 0, 3)).toBe(true);
    const offset = editor.getSelectionOffset();
    editor.refreshPresentation();

    expect(renderCount).toBe(2);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe(offset);
    editor.destroy();
  });

  it("reveals a horizontal rule source on click and preserves its delimiter", () => {
    for (const delimiter of ["---", "***"] as const) {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createMintEditor(host, { initialContent: delimiter });
      const ruleRow = host.querySelector<HTMLElement>(".hr-node-view");
      if (!ruleRow) throw new Error(`Missing rendered rule row for ${delimiter}`);

      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      ruleRow.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      ruleRow.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
      }));
      ruleRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      const source = host.querySelector<HTMLElement>(
        "pre[data-source-block][data-source-kind='horizontal_rule'] > code",
      );
      expect(source?.textContent).toBe(delimiter);
      expect(editor.getMarkdown()).toBe(delimiter);
      editor.destroy();
      host.remove();
    }
  });

  it("lets an editing horizontal rule be deleted or followed by a new line", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "---" });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const ruleRow = host.querySelector<HTMLElement>(".hr-node-view");
    if (!editable || !ruleRow) throw new Error("Missing live horizontal rule");

    ruleRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const source = host.querySelector<HTMLElement>(
      "pre[data-source-block][data-source-kind='horizontal_rule'] > code",
    );
    if (!source) throw new Error("Missing revealed horizontal rule source");
    source.textContent = "--";
    const range = document.createRange();
    range.selectNodeContents(source);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "deleteContentBackward",
      data: null,
      bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector("hr")).toBeNull();
    expect(editor.getMarkdown()).toBe("--");
    editor.destroy();
    host.remove();

    const lineHost = document.createElement("div");
    document.body.append(lineHost);
    const lineEditor = createMintEditor(lineHost, { initialContent: "---" });
    const lineEditable = lineHost.querySelector<HTMLElement>(".ProseMirror");
    const lineRuleRow = lineHost.querySelector<HTMLElement>(".hr-node-view");
    if (!lineEditable || !lineRuleRow) throw new Error("Missing second live horizontal rule");
    lineRuleRow.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const lineSource = lineHost.querySelector<HTMLElement>(
      "pre[data-source-block][data-source-kind='horizontal_rule'] > code",
    );
    if (!lineSource) throw new Error("Missing second revealed horizontal rule source");
    const lineRange = document.createRange();
    lineRange.selectNodeContents(lineSource);
    lineRange.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(lineRange);
    lineEditable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    expect(lineHost.querySelector(".hr-node-view")).not.toBeNull();
    expect(lineHost.querySelectorAll("pre[data-source-gap] br[data-source-gap-eol]")).toHaveLength(0);
    expect(lineHost.querySelectorAll("pre[data-source-gap] [data-source-gap-hidden]")).toHaveLength(1);
    expect(lineEditor.getMarkdown()).toBe("---\n");

    lineEditable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(lineEditor.getMarkdown()).toBe("---");

    lineEditable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(lineEditor.getMarkdown()).toBe("---\n");

    const restoredRuleRow = lineHost.querySelector<HTMLElement>(".hr-node-view");
    if (!restoredRuleRow) throw new Error("Missing restored horizontal rule row");
    restoredRuleRow.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }));
    const restoredSource = lineHost.querySelector(
      "pre[data-source-block][data-source-kind='horizontal_rule'] > code",
    ) ?? lineHost.querySelector("p.hr-draft");
    expect(restoredSource?.textContent).toBe("---");
    lineEditor.destroy();
  });

  it("reveals one editable fenced-code source without changing Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "```ts\nconst value = 1;\n```";
    const editor = createMintEditor(host, { initialContent: markdown });
    const label = host.querySelector<HTMLElement>(".cb-language-label");
    const code = host.querySelector<HTMLElement>("pre code");
    if (!label || !code) throw new Error("Missing fenced code block");
    expect(label.textContent).toBe("TypeScript");

    label.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
    }));

    expect(host.querySelector("pre")?.dataset.liveSyntaxState).toBe("editing");
    expect(code.textContent).toBe(markdown);
    expect(host.querySelector(".cb-language-label")?.hasAttribute("hidden")).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("loads Mint-specific presentation only through explicit extensions", () => {
    const bareHost = document.createElement("div");
    document.body.append(bareHost);
    const markdown = "> [!NOTE]\n>\n> Body";
    const bareEditor = createEditor(bareHost, { initialContent: markdown });

    expect(bareHost.querySelector("blockquote")).not.toBeNull();
    expect(bareHost.querySelector(".source-blockquote-node.live-callout")).toBeNull();
    bareEditor.destroy();

    const extendedHost = document.createElement("div");
    document.body.append(extendedHost);
    const extendedEditor = createMintEditor(extendedHost, { initialContent: markdown });

    expect(extendedHost.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    extendedEditor.destroy();
  });

  it("exits a bare greater-than candidate below a preserved blank row", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createMintEditor(host, { onChange: (markdown) => changes.push(markdown) });

    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editable?.querySelector("p");
    if (!editable || !paragraph) throw new Error("Missing live editor paragraph");
    paragraph.textContent = ">";
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: ">",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(editor.getMarkdown()).toBe(">");

    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }));
    expect(host.querySelector("blockquote")).toBeNull();
    expect(host.querySelector(".source-blockquote-node")).toBeNull();
    expect(editor.getMarkdown()).toBe("\n");
    expect(editor.getSelectionOffset()).toBe(1);
    expect(changes.at(-1)).toBe("\n");
    expect(editor.getMarkdown()).not.toContain("\\>");

    editor.replaceMarkdown("a > b", "a > b".length);
    expect(editor.getMarkdown()).toBe("a > b");
    editor.destroy();
  });

  it("never synthesizes backslash escapes for Markdown punctuation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host);

    editor.replaceMarkdown("plain # - + * _ [ ] < > \\ `");
    expect(editor.getMarkdown()).toBe("plain # - + * _ [ ] < > \\ `");
    expect(editor.getMarkdown()).not.toContain("\\#");
    expect(editor.getMarkdown()).not.toContain("\\-");
    expect(editor.getMarkdown()).not.toContain("\\+");
    expect(editor.getMarkdown()).not.toContain("\\*");
    expect(editor.getMarkdown()).not.toContain("\\_");
    expect(editor.getMarkdown()).not.toContain("\\[");
    expect(editor.getMarkdown()).not.toContain("\\]");
    expect(editor.getMarkdown()).not.toContain("\\<");

    editor.replaceMarkdown([
      "| Left | Right |",
      "| --- | --- |",
      "| a &#124; b | value |"
    ].join("\n"));
    expect(editor.getMarkdown()).toContain("a &#124; b");
    expect(editor.getMarkdown()).not.toContain("\\|");

    editor.replaceMarkdown('[link](https://example.com "a\\"b")');
    expect(editor.getMarkdown()).toContain('"a\\"b"');

    editor.replaceMarkdown('![image](https://example.com/image.png "a\\"b")');
    expect(editor.getMarkdown()).toContain('"a\\"b"');
    editor.destroy();
  });

  it("keeps unedited authored spellings through a real Live transaction", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = [
      "| Left | Right |",
      "| --- | --- |",
      "| a &#124; b | value |",
      "",
      "after"
    ].join("\n");
    const editor = createMintEditor(host, { initialContent: markdown });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editable?.lastElementChild as HTMLElement | null;
    if (!editable || !paragraph || paragraph.tagName !== "P") throw new Error("Missing paragraph after table");
    paragraph.textContent = "later";
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: "later",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getMarkdown()).toContain("a &#124; b");
    expect(editor.getMarkdown()).toContain("later");
    editor.destroy();
  });

  it("preserves user-authored escapes while rendering the escaped symbol as text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host);

    for (const symbol of "\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-") {
      const escaped = `\\${symbol}`;
      const markdown = `${escaped} x`;
      editor.replaceMarkdown(markdown, markdown.length);
      expect(editor.getMarkdown()).toBe(markdown);
      expect(host.querySelector(".live-markdown-escape-hidden")?.textContent).toBe("\\");
      editor.setSelectionOffset(1);
      expect(host.querySelector(".live-markdown-escape-hidden")).toBeNull();
    }

    editor.replaceMarkdown("\\>", "\\>".length);
    expect(host.querySelector("blockquote")).toBeNull();
    editor.destroy();
  });

  it("round-trips complete and partially edited callout markers without private syntax", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      initialContent: "> [!WARNING]\n>\n> Body"
    });

    expect(editor.getMarkdown()).toBe("> [!WARNING]\n>\n> Body");
    expect(host.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-preview")?.hasAttribute("hidden")).toBe(false);
    editor.replaceMarkdown("> [!WARNI\n>\n> Body");
    expect(editor.getMarkdown()).toBe("> [!WARNI\n>\n> Body");
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-node.live-callout")).toBeNull();
    expect(editor.getMarkdown()).not.toMatch(/==`|\\\[|\\\]/);
    editor.replaceMarkdown("> [!WARNING]\n>\n> Body");
    expect(host.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    editor.destroy();
  });

  it("keeps a rendering-state callout as presentation over unchanged authored source", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n> [!NOTE]\n>\n> Body";
    const editor = createMintEditor(host, { initialContent: markdown });

    expect(host.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-preview .markdown-callout")?.textContent).toContain("Note");
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!NOTE]\n>\n> Body");
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals a two-line Callout on mouse release without merging its authored lines", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = "> [!NOTE] \n> Note callout";
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });
    const preview = host.querySelector<HTMLElement>(".source-blockquote-preview");
    if (!preview) throw new Error("Missing Callout preview");

    preview.dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));

    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(true);

    preview.dispatchEvent(new MouseEvent("mouseup", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));

    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(markdown);
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(false);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("moves freely through quote and Callout boundaries in a mixed Live document", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = [
      "# Title(cursor)",
      "",
      "# Title",
      "",
      "dd ",
      "",
      "*Italic*==heghlight==~~d elete~~**Bold**`code`",
      "",
      "",
      "- 1",
      "- 3",
      "",
      "",
      "",
      "",
      "",
      "- [ ] 1 ",
      "",
      "",
      "",
      "",
      "",
      "",
      "```sh",
      "",
      "code block",
      "",
      "```",
      "",
      "",
      "> quote",
      "",
      "",
      "",
      "> [!note]",
      "> callout",
    ].join("\n");
    const quoteFrom = markdown.indexOf("> quote");
    const quoteTo = quoteFrom + "> quote".length;
    const calloutFrom = markdown.indexOf("> [!note]");
    const calloutFirstLineLength = "> [!note]".length;
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });

    editor.setSelectionOffset(quoteTo);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();
    expect(editor.getSelectionOffset()).toBe(quoteTo + 1);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(quoteTo + 2);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(quoteTo + 3);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(calloutFrom);
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();

    editor.setSelectionOffset(calloutFrom + 3);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(calloutFrom + calloutFirstLineLength + 1 + 3);

    editor.setSelectionOffset(calloutFrom);
    expect(pressNavigationKey(host, "ArrowLeft")).toBe(true);
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();
    expect(editor.getSelectionOffset()).toBe(calloutFrom - 1);

    expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(calloutFrom - 2);
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).toBeNull();

    expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(calloutFrom - 3);
    expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(quoteTo);
    expect(host.querySelector("blockquote p .syntax-hint")).not.toBeNull();

    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("traverses list source edges and vertical list/code boundaries", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = [
      "before",
      "",
      "- 1",
      "- 3",
      "",
      "",
      "```sh",
      "",
      "code block",
      "",
      "```",
      "",
      "after",
    ].join("\n");
    const listFrom = markdown.indexOf("- 1");
    const secondItemFrom = markdown.indexOf("- 3");
    const listTo = secondItemFrom + "- 3".length;
    const codeFrom = markdown.indexOf("```sh");
    const codeTo = markdown.indexOf("```", codeFrom + 3) + 3;
    const editor = createEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });

    editor.setSelectionOffset(listFrom + 2);
    expect(host.querySelector("li .syntax-hint")).not.toBeNull();
    expect(pressNavigationKey(host, "ArrowLeft")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(listFrom + 1);
    expect(pressNavigationKey(host, "ArrowLeft")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(listFrom);
    expect(pressNavigationKey(host, "ArrowLeft")).toBe(true);
    expect(editor.getSelectionOffset()).toBeLessThan(listFrom);
    expect(host.querySelector("pre[data-source-block]")).toBeNull();

    editor.setSelectionOffset(listFrom + 2);
    expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
    expect(editor.getSelectionOffset()).toBeLessThan(listFrom);
    expect(host.querySelector("pre[data-source-block]")).toBeNull();

    editor.setSelectionOffset(secondItemFrom + 2);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(listTo + 1);
    expect(host.querySelector("pre[data-source-block]")).toBeNull();
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(listTo + 2);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(host.querySelector("pre[data-source-block]")).toBeNull();

    editor.setSelectionOffset(codeFrom + 3);
    expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
    expect(editor.getSelectionOffset()).toBeLessThan(codeFrom);
    expect(host.querySelector("pre[data-live-syntax-state='editing']")).toBeNull();

    editor.setSelectionOffset(codeTo);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBeGreaterThan(codeTo);
    expect(host.querySelector("pre[data-live-syntax-state='editing']")).toBeNull();

    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it.each([
    ["structural separator", "\n", 1],
    ["one blank row", "\n\n", 2],
    ["two blank rows", "\n\n\n", 3],
  ] as const)(
    "puts the next heading into editing state on the first key that reaches it across a %s",
    (_name, separator, pressesToTarget) => {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const markdown = `# First${separator}# Second\nplain`;
      const secondFrom = markdown.indexOf("# Second");
      const editor = createEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
      });

      editor.setSelectionOffset("# First".length);
      const plainBefore = Array.from(host.querySelectorAll("p"))
        .find((node) => node.textContent === "plain");
      const secondHeading = Array.from(host.querySelectorAll<HTMLElement>("h1"))
        .find((node) => node.textContent === "# Second");
      let heightReads = 0;
      if (secondHeading) Object.defineProperty(secondHeading, "getBoundingClientRect", {
        configurable: true,
        value: () => {
          heightReads += 1;
          return { height: 41.25 };
        },
      });

      for (let index = 0; index < pressesToTarget; index += 1) {
        expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
      }

      const active = host.querySelector<HTMLElement>("h1:last-of-type");
      expect(active?.textContent).toBe("# Second");
      expect(active).toBe(secondHeading);
      expect(heightReads).toBeLessThanOrEqual(1);
      expect(host.querySelector("h1")?.textContent).toBe("# First");
      expect(Array.from(host.querySelectorAll("p"))
        .find((node) => node.textContent === "plain")).toBe(plainBefore);
      expect(editor.getSelectionOffset()).toBeGreaterThanOrEqual(secondFrom);
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);

      expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
      expect(editor.getSelectionOffset()).toBe(secondFrom - 1);
      expect(host.querySelector("pre[data-source-block]")?.textContent).not.toBe("# Second");
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  it("moves through each trailing authored blank line without jumping to the end", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "text\n\n\n";
    const editor = createEditor(host, { initialContent: markdown });
    editor.setSelectionOffset("text".length);

    for (const expected of ["text\n".length, "text\n\n".length, markdown.length]) {
      expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
      expect(editor.getSelectionOffset()).toBe(expected);
    }

    for (const expected of ["text\n\n".length, "text\n".length, "text".length]) {
      expect(pressNavigationKey(host, "ArrowUp")).toBe(true);
      expect(editor.getSelectionOffset()).toBe(expected);
    }

    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals inline delimiters when an arrow reaches the styled source span", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = "x *em* y";
    const editor = createEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });

    editor.setSelectionOffset(markdown.indexOf(" y"));
    expect(pressNavigationKey(host, "ArrowLeft")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(markdown.indexOf(" y") - 1);
    expect(Array.from(host.querySelectorAll(".syntax-hint"))
      .some((node) => node.textContent === "*")).toBe(true);

    editor.setSelectionOffset(0);
    expect(Array.from(host.querySelectorAll(".syntax-hidden"))
      .some((node) => node.textContent === "*")).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("defers a rendered click until mouse release and preserves its source gap", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "before\n\n### Title";
    const headingFrom = markdown.indexOf("### Title");
    const editor = createEditor(host, { initialContent: markdown });
    const heading = host.querySelector<HTMLElement>("h3");
    if (!heading) throw new Error("Missing rendered heading");

    heading.dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    editor.setSelectionOffset(headingFrom + "### ".length + 2);

    expect(host.querySelector("pre[data-source-block]")).toBeNull();

    heading.dispatchEvent(new MouseEvent("mouseup", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.querySelector("h3")?.textContent).toBe("### Title");
    expect(editor.getSelectionOffset()).toBe(headingFrom + "### ".length + 2);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("keeps inline presentation frozen while dragging, then reveals and copies its source", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "before *em* after";
    const source = "*em*";
    const sourceFrom = markdown.indexOf(source);
    const editor = createEditor(host, { initialContent: markdown });
    const liveRoot = host.querySelector<HTMLElement>(".ProseMirror");
    if (!liveRoot) throw new Error("Missing Live editor root");

    editor.setSelectionOffset(0);
    liveRoot.dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    editor.setSelectionOffset(sourceFrom + source.length);
    for (let index = 0; index < source.length; index += 1) {
      liveRoot.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
    }

    expect(Array.from(host.querySelectorAll(".syntax-hidden"))
      .filter((node) => node.textContent === "*")).toHaveLength(2);
    expect(host.querySelectorAll(".syntax-hint")).toHaveLength(0);

    liveRoot.dispatchEvent(new MouseEvent("mouseup", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Array.from(host.querySelectorAll(".syntax-hint"))
      .filter((node) => node.textContent === "*")).toHaveLength(2);

    let copied = "";
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", {
      value: {
        setData: (type: string, value: string) => {
          if (type === "text/plain") copied = value;
        },
      },
    });
    liveRoot.dispatchEvent(copy);

    expect(copy.defaultPrevented).toBe(true);
    expect(copied).toBe(source);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals every covered unit in a completed pointer range and copies canonical Markdown", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "# First\n\n### Middle\n\n- **item**\n\n## Second";
    const editor = createEditor(host, { initialContent: markdown });
    const firstHeading = host.querySelector<HTMLElement>("h1");
    const secondHeading = host.querySelector<HTMLElement>("h2");
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    if (!firstHeading || !secondHeading || !editable) {
      throw new Error("Missing rendered selection endpoints");
    }

    firstHeading.dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    editor.setSelectionOffset(markdown.length);
    for (let index = 0; index < markdown.length; index += 1) {
      editable.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
    }

    expect(host.querySelectorAll("pre[data-source-block]")).toHaveLength(0);
    expect(host.querySelector("h3 .syntax-hidden")?.textContent).toBe("### ");
    expect(host.querySelector("li.source-list-editing")).toBeNull();

    secondHeading.dispatchEvent(new MouseEvent("mouseup", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Array.from(host.querySelectorAll("h1 .syntax-hint, h2 .syntax-hint, h3 .syntax-hint"))
      .map((node) => node.textContent)).toEqual(["# ", "### ", "## "]);
    expect(host.querySelector("li.source-list-editing")).not.toBeNull();
    expect([...host.querySelectorAll("li .syntax-hint")].map((node) => node.textContent)).toEqual(["- ", "**", "**"]);

    let copied = "";
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", {
      value: {
        setData: (type: string, value: string) => {
          if (type === "text/plain") copied = value;
        },
      },
    });
    editable.dispatchEvent(copy);

    expect(copy.defaultPrevented).toBe(true);
    expect(copied).toBe(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it.each([
    ["heading", "### Title", 1],
    ["blockquote", "> Quote", 1],
    ["bullet list", "- Item", 1],
    ["ordered list", "1. Item", 1],
    ["task list", "- [ ] Item", 1],
    ["fenced code", "```\ncode\n```", 1],
  ] as const)(
    "moves ArrowLeft through the first authored character of a %s",
    (_name, markdown, caret) => {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createEditor(host, { initialContent: markdown });
      editor.setSelectionOffset(caret);

      expect(pressNavigationKey(host, "ArrowLeft")).toBe(true);
      expect(editor.getSelectionOffset()).toBe(caret - 1);
      expect(editor.getMarkdown()).toBe(markdown);
      editor.destroy();
    },
  );

  it("keeps ordinary arrow navigation inside a table on the rich cell path", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "| a | b |\n| --- | --- |\n| c | d |";
    const editor = createEditor(host, { initialContent: markdown });
    const firstCellText = host.querySelector("th")?.firstChild;
    if (!firstCellText) throw new Error("Missing table cell text");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(firstCellText, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new Event("selectionchange"));

    expect(pressNavigationKey(host, "ArrowRight")).toBe(true);
    expect(host.querySelector("pre[data-source-block]")).toBeNull();
    expect(host.querySelector("table")).not.toBeNull();
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals a source-backed quote when keyboard focus lands inside it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = "> Keyboard editable";
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });
    const surface = host.querySelector<HTMLElement>(".ProseMirror");

    editor.setSelectionOffset(3);
    surface?.dispatchEvent(new FocusEvent("focus"));
    expect(host.querySelector("blockquote .syntax-hint")?.textContent).toBe("> ");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("focuses top-level and nested callout markers without changing Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = [
      "> [!NOTE] Outer",
      ">",
      "> Body",
      "> > [!WARNING]- Nested",
      "> >",
      "> > Details"
    ].join("\n");
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next)
    });
    const serialized = editor.getMarkdown();

    expect(focusCalloutMarker(editor, 0, 8)).toBe(true);
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe("> ".length + 8);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(changes).toEqual([]);

    expect(focusCalloutMarker(editor, 1, 999)).toBe(true);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe(
      markdown.indexOf("[!WARNING]- Nested") + "[!WARNING]- Nested".length,
    );
    expect(editor.getMarkdown()).toBe(serialized);
    expect(changes).toEqual([]);

    expect(focusCalloutMarker(editor, -1)).toBe(false);
    expect(focusCalloutMarker(editor, 2)).toBe(false);
    editor.destroy();
  });

  it("keeps a canonical callout line free of generated escapes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      onChange: (markdown) => changes.push(markdown)
    });

    editor.replaceMarkdown("> [!NOTE]", "> [!NOTE]".length);

    expect(editor.getMarkdown()).toBe("> [!NOTE]");
    expect(changes.at(-1)).toBe("> [!NOTE]");
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!NOTE]");
    expect(editor.getMarkdown()).not.toMatch(/==`|\\>|\\\[|\\\]/);
    editor.destroy();
  });

  it("edits trailing spaces and titles in the real Callout source", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "> [!TIP]" });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    expect(focusCalloutMarker(editor, 0)).toBe(true);
    const markerSource = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    if (!editable || !markerSource) throw new Error("Missing callout source");

    markerSource.textContent = "> [!TIP] ";
    const range = document.createRange();
    range.selectNodeContents(markerSource);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: " ",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.getMarkdown()).toBe("> [!TIP] ");
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!TIP] ");

    const editedSource = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    if (!editedSource) throw new Error("Missing edited callout source");
    editedSource.textContent = "> [!TIP] Custom title";
    range.selectNodeContents(editedSource);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: "Custom title",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.getMarkdown()).toBe("> [!TIP] Custom title");
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!TIP] Custom title");
    editor.destroy();
  });

  it("rejects a native mutation whose source line boundaries cannot be mapped", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "> [!note]\n> body";
    const changes: string[] = [];
    const editor = createMintEditor(host, { initialContent: markdown, onChange: (source) => changes.push(source) });
    editor.setSelectionOffset(markdown.length);
    editor.focus();
    const literal = host.querySelector<HTMLElement>(".source-blockquote-source-code")!;
    literal.innerHTML = "<div>&gt; [!note]</div><div>&gt; changed</div>";
    host.querySelector(".ProseMirror")!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.isSourceMode()).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("inserts and deletes text on a middle quote line before native DOM mutation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const initial = "> [!note] \n> \n> callout ";
    const inserted = "> [!note] \n> test\n> callout ";
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      initialContent: initial,
      onChange: (next) => changes.push(next),
    });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    if (!editable) throw new Error("Missing Live editor root");
    expect(focusCalloutMarker(editor, 0)).toBe(true);

    let source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    let text = source?.firstChild;
    if (!source || !text) throw new Error("Missing editable quote source");
    const insertAt = initial.indexOf("\n> ") + 3;
    let range = document.createRange();
    range.setStart(text, insertAt);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const insert = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "test",
      bubbles: true,
      cancelable: true,
    });

    editable.dispatchEvent(insert);

    expect(insert.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(inserted);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(inserted);
    expect(editor.getSelectionOffset()).toBe(insertAt + "test".length);

    source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    text = source?.firstChild;
    if (!source || !text) throw new Error("Missing updated quote source");
    const deleteFrom = inserted.indexOf("test");
    range = document.createRange();
    range.setStart(text, deleteFrom + 4);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    for (let index = 0; index < 4; index += 1) {
      source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
      if (!source) throw new Error("Missing quote source while deleting");
      const remove = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        bubbles: true,
        cancelable: true,
      });
      editable.dispatchEvent(remove);
      expect(remove.defaultPrevented).toBe(true);
      expect(editor.getSelectionOffset()).toBe(deleteFrom + 3 - index);
    }

    expect(editor.getMarkdown()).toBe(initial);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(initial);
    expect(changes.at(0)).toBe(inserted);
    expect(changes.at(-1)).toBe(initial);
    editor.destroy();
  });

  it("keeps the canonical caret stable while a quote prefix becomes invalid", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "> quote" });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    editor.setSelectionOffset(1);
    const source = host.querySelector<HTMLElement>("blockquote p");
    const text = source?.querySelector(".syntax-hint")?.firstChild;
    if (!editable || !source || !text) throw new Error("Missing active quote source");
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    const remove = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(remove);

    expect(remove.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(" quote");
    expect(editor.getSelectionOffset()).toBe(0);
    expect(host.querySelector(".ProseMirror > p")?.textContent).toBe(" quote");
    editor.destroy();
  });

  it("keeps an empty Callout body editable without a private placeholder", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      initialContent: "> [!CAUTION]\n> "
    });

    expect(editor.getMarkdown()).toBe("> [!CAUTION]\n> ");
    expect(editor.getMarkdown()).not.toContain("\u2060");
    expect(focusCalloutMarker(editor, 0)).toBe(true);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!CAUTION]\n> ");
    editor.destroy();
  });

  it("renders math, Mermaid, and WikiLinks as reversible live decorations", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const wikiLinks: string[] = [];
    const markdown = [
      "Before $x_i$ and [[Guide|the guide]].",
      "",
      "$$E = mc^2$$",
      "",
      "$$",
      "A_B",
      "$$",
      "",
      "```mint-math",
      "not display math",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```"
    ].join("\n");
    const editor = createMintEditor(host, {
      initialContent: markdown,
      presentations: {
        renderMath: (container, source) => { container.textContent = `inline:${source}`; },
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
        renderMermaid: (container, source) => { container.textContent = `diagram:${source}`; },
        onWikiLink: (target) => wikiLinks.push(target)
      }
    });

    expect(host.querySelector(".live-inline-math-widget")?.textContent).toBe("inline:x_i");
    expect([...host.querySelectorAll(".live-math-block-widget")].map((node) => node.textContent)).toEqual([
      "block:E = mc^2",
      "block:A_B",
    ]);
    expect(host.querySelector("pre[data-lang='mint-math']")?.textContent).toContain("not display math");
    expect(host.querySelector(".live-mermaid-widget")?.textContent).toContain("diagram:graph TD");
    const wikiLink = host.querySelector<HTMLButtonElement>(".live-wikilink");
    expect(wikiLink?.textContent).toBe("the guide");
    wikiLink?.click();
    expect(wikiLinks).toEqual(["Guide"]);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals covered extension syntax while preserving image previews and exact source", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n$x$ [[Guide]] ![image](test.png)\n\n$$\ny\n$$\n\n```mermaid\ngraph TD; A-->B\n```\n\nAfter";
    const changes: string[] = [];
    const render = (container: HTMLElement, source: string) => { container.textContent = source; };
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
      presentations: { renderMath: render, renderMathBlock: render, renderMermaid: render },
    });
    const selection = { anchor: markdown.length - 1, head: 1 };
    editor.setSelection(selection);
    expect(host.querySelector(".live-inline-math-editing")?.textContent).toBe("$x$");
    expect(host.querySelector(".live-inline-math-widget, .live-math-block-widget, .live-mermaid-widget, .live-wikilink")).toBeNull();
    expect(host.querySelector("pre[data-source-kind='mint-math-block']")?.textContent).toBe("$$\ny\n$$");
    expect(host.querySelector("img.image-render")).not.toBeNull();
    expect(editor.getSelection()).toEqual(selection);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.setSelectionOffset(0);
    expect(host.querySelector(".live-inline-math-editing")).toBeNull();
    expect(host.querySelector(".live-math-block-widget")).not.toBeNull();
    expect(host.querySelector(".live-mermaid-widget")).not.toBeNull();
    editor.destroy();
  });

  it.each(["\n", "\r\n"])(
    "renders authored multiline math directly and preserves %j line endings",
    (eol) => {
      const host = document.createElement("div");
      document.body.append(host);
      const markdown = ["Before", "", "$$", "A_B", "$$", "", "After"].join(eol);
      const changes: string[] = [];
      const editor = createMintEditor(host, {
        initialContent: markdown,
        onChange: (next) => changes.push(next),
        presentations: {
          renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
        },
      });

      expect(host.querySelector(".live-math-block-widget")?.textContent).toBe("block:A_B");
      expect(editor.getMarkdown()).toBe(markdown);
      expect(changes).toEqual([]);
      editor.destroy();
    },
  );

  it("shows the complete inline-math source in its active editing range", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before $A_d$ after";
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
      presentations: {
        renderMath: (container, source) => { container.textContent = `inline:${source}`; },
      },
    });

    expect(host.querySelector(".live-inline-math-widget")?.textContent).toBe("inline:A_d");
    editor.setSelectionOffset(markdown.indexOf("A_d") + 1);
    expect(host.querySelector(".live-inline-math-editing")?.textContent).toBe("$A_d$");
    expect(host.querySelector(".live-inline-math-widget")).toBeNull();

    editor.setSelectionOffset(0);
    expect(host.querySelector(".live-inline-math-editing")).toBeNull();
    expect(host.querySelector(".live-inline-math-widget")?.textContent).toBe("inline:A_d");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it.each([
    ["single-line", "$$E = mc^2$$", "E = mc^2"],
    ["multiline", "$$\nA_B\n$$", "A_B"],
  ] as const)(
    "shows the complete %s display-math source only while its block is active",
    (_kind, authoredMath, renderedMath) => {
      const host = document.createElement("div");
      document.body.append(host);
      const markdown = `Before\n\n${authoredMath}\n\nAfter`;
      const editor = createMintEditor(host, {
        initialContent: markdown,
        presentations: {
          renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
        },
      });

      const widget = host.querySelector<HTMLElement>(".live-math-block-widget");
      expect(widget?.textContent).toBe(`block:${renderedMath}`);
      widget?.click();

      const source = host.querySelector<HTMLElement>(
        'pre[data-source-block][data-source-kind="mint-math-block"]',
      );
      expect(source?.textContent).toBe(authoredMath);
      expect(source?.querySelector("code")?.textContent).toBe(authoredMath);
      expect(host.querySelector(".live-math-block-widget")).toBeNull();

      editor.setSelectionOffset(markdown.length);
      expect(host.querySelector(".live-math-block-source.is-live-syntax-rendering")).not.toBeNull();
      expect(host.querySelector(".live-math-block-widget")?.textContent)
        .toBe(`block:${renderedMath}`);
      expect(editor.getMarkdown()).toBe(markdown);
      editor.destroy();
    },
  );

  it("reveals and edits exact multiline math source without a private code fence", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n$$\nA_B\n$$\n\nAfter";
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
      presentations: {
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
      },
    });

    const widget = host.querySelector<HTMLElement>(".live-math-block-widget");
    expect(widget?.textContent).toBe("block:A_B");
    widget?.click();
    expect(host.querySelector(".live-math-block-widget")).toBeNull();
    expect(host.querySelector(
      'pre[data-source-block][data-source-kind="mint-math-block"] > code',
    )?.textContent).toBe("$$\nA_B\n$$");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);

    const insertion = markdown.indexOf("A_B") + "A_B".length;
    editor.insertMarkdown("{}", insertion);
    const edited = markdown.slice(0, insertion) + "{}" + markdown.slice(insertion);
    expect(editor.getMarkdown()).toBe(edited);
    expect(changes).toEqual([edited]);
    editor.setSelectionOffset(edited.length);
    expect(host.querySelector(".live-math-block-widget")?.textContent).toBe("block:A_B{}");

    editor.toggleSource();
    expect(editor.getMarkdown()).toBe(edited);
    editor.toggleSource();
    expect(editor.getMarkdown()).toBe(edited);
    expect(changes).toEqual([edited]);
    editor.destroy();
  });

  it("deletes one authored character from the end of an active multiline math block", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n$$\nA\nB\n$$\n\nAfter";
    const editor = createMintEditor(host, {
      initialContent: markdown,
      presentations: {
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
      },
    });

    host.querySelector<HTMLElement>(".live-math-block-widget")?.click();
    const blockEnd = markdown.indexOf("\n\nAfter");
    editor.setSelectionOffset(blockEnd);
    const event = new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      bubbles: true,
      cancelable: true,
    });
    host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(
      markdown.slice(0, blockEnd - 1) + markdown.slice(blockEnd),
    );
    expect(editor.getMarkdown()).toContain("$$\nA\nB\n$");
    editor.destroy();
  });

  it("forms multiline math through Live input without collapsing authored lines", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      initialContent: "$$",
      onChange: (next) => changes.push(next),
      presentations: {
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
      },
    });
    const enter = () => host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));

    editor.setSelectionOffset(2);
    enter();
    editor.insertMarkdown("A_B");
    enter();
    editor.insertMarkdown("$$");
    expect(editor.getMarkdown()).toBe("$$\nA_B\n$$");
    expect(editor.getMarkdown()).not.toBe("$$ A_B $$");

    editor.insertMarkdown("\n\nAfter");
    expect(editor.getMarkdown()).toBe("$$\nA_B\n$$\n\nAfter");
    expect(host.querySelector(".live-math-block-widget")?.textContent).toBe("block:A_B");
    expect(changes.at(-1)).toBe("$$\nA_B\n$$\n\nAfter");
    editor.destroy();
  });

  it("keeps delimiter-only display-math lines while typing the complete block natively", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      initialContent: "",
      onChange: (next) => changes.push(next),
      presentations: {
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
      },
    });
    const enter = () => host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    await typeNativeText(host, "$$");
    expect(editor.getMarkdown()).toBe("$$");
    enter();
    expect(editor.getMarkdown()).toBe("$$\n");
    await typeNativeText(host, "A_B");
    expect(editor.getMarkdown()).toBe("$$\nA_B");
    enter();
    expect(editor.getMarkdown()).toBe("$$\nA_B\n");
    await typeNativeText(host, "$$");

    const authored = "$$\nA_B\n$$";
    expect(editor.getMarkdown()).toBe(authored);
    expect(editor.getMarkdown()).not.toBe("$$ A_B $$");
    expect(host.querySelector(
      'pre[data-source-block][data-source-kind="mint-math-block"] > code',
    )?.textContent).toBe(authored);
    expect(changes.at(-1)).toBe(authored);

    enter();
    expect(editor.getMarkdown()).toBe(`${authored}\n`);
    enter();
    expect(editor.getMarkdown()).toBe(`${authored}\n\n`);
    editor.insertMarkdown("After");
    expect(editor.getMarkdown()).toBe(`${authored}\n\nAfter`);
    expect(host.querySelector(".live-math-block-widget")?.textContent).toBe("block:A_B");
    editor.destroy();
  });

  it("keeps an empty display-math body on its own authored line", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      presentations: {
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
      },
    });
    const enter = () => host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    await typeNativeText(host, "$$");
    enter();
    enter();
    await typeNativeText(host, "$$");

    expect(editor.getMarkdown()).toBe("$$\n\n$$");
    expect(host.querySelector(
      'pre[data-source-block][data-source-kind="mint-math-block"] > code',
    )?.textContent).toBe("$$\n\n$$");
    editor.destroy();
  });

  it.each([
    "$$\nincomplete",
    "```mint-math\nA_B\n```",
  ])("does not render invalid or fenced display-math source for %j", (markdown) => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      initialContent: `Before\n\n${markdown}\n\nAfter`,
      presentations: {
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
      },
    });

    expect(host.querySelector(".live-math-block-widget")).toBeNull();
    expect(editor.getMarkdown()).toBe(`Before\n\n${markdown}\n\nAfter`);
    editor.destroy();
  });

  it("keeps new rich renderers on the declaration-only extension path", () => {
    const math = createMathExtension();
    const mermaid = createMermaidExtension();
    const wikiLink = createWikiLinkExtension();

    for (const extension of [math, mermaid, wikiLink]) {
      expect(extension.presentations).toBeDefined();
      expect(extension.createPlugins).toBeUndefined();
      expect(extension.commands).toBeUndefined();
    }
  });

  it("rejects ambiguous primary block presentations instead of using registration order", () => {
    const presentationExtension = (id: string): EditorExtension => ({
      id,
      presentations: {
        block: [{
          id: `${id}-paragraph`,
          nodeTypes: ["paragraph"],
          sourceClassName: `${id}-source`,
          widgetClassName: `${id}-widget`,
          match: (source) => ({ source, renderSource: source, key: source, data: null }),
          render: () => undefined,
        }],
      },
    });
    const host = document.createElement("div");
    document.body.append(host);

    expect(() => createEditor(host, {
      initialContent: "ambiguous",
      extensions: [presentationExtension("first"), presentationExtension("second")],
    })).toThrow(/Conflicting primary presentations/);
  });

  it("falls back to literal authored source when a presentation renderer fails", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before $x_i$ after";
    const changes: string[] = [];
    const editor = createEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
      extensions: [createMathExtension({
        renderInline: () => { throw new Error("renderer unavailable"); },
      })],
    });

    const fallback = host.querySelector<HTMLElement>(".live-presentation-fallback");
    expect(fallback?.textContent).toBe("$x_i$");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);

    editor.setSelectionOffset(markdown.indexOf("x_i"));
    expect(host.querySelector(".live-inline-math-widget")).toBeNull();
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });
});

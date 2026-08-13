import { afterEach, describe, expect, it } from "vitest";
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
    const surface = editable?.querySelector<HTMLElement>(
      "pre[data-source-block] > code, p:last-child",
    );
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
      expect(host.querySelector("pre[data-source-block], pre[data-source-gap]")).not.toBeNull();
      host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        bubbles: true,
        cancelable: true,
      }));

      const expected = markdown.slice(0, deleteAt) + markdown.slice(deleteAt + 1);
      expect(editor.getMarkdown()).toBe(expected);
      const editable = host.querySelector<HTMLElement>(".ProseMirror");
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
      initialContent: "- [ ] task",
      onChange: (markdown) => changes.push(markdown),
    });
    const checkbox = host.querySelector<HTMLElement>(".checkbox");
    expect(checkbox).not.toBeNull();
    checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(editor.getMarkdown()).toBe("- [x] task");
    expect(changes).toEqual(["- [x] task"]);

    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    editable?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(editor.getMarkdown()).toBe("- [ ] task");
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
        host.querySelector<HTMLElement>(".ProseMirror")?.dispatchEvent(new KeyboardEvent("keydown", {
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

  it("keeps an activated source-backed surface mounted until its structure changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "# Heading" });
    editor.setSelectionOffset("# Heading".length);
    const sourceBlock = host.querySelector("pre[data-source-block]");

    await typeNativeText(host, " text");

    expect(host.querySelector("pre[data-source-block]")).toBe(sourceBlock);
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
      expect(host.querySelector(".ProseMirror > h1")?.textContent).toBe("Valid before");
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
    expect(standardGapHost.querySelectorAll("pre[data-source-gap] br[data-source-gap-eol]")).toHaveLength(0);
    expect(standardGapHost.querySelectorAll("pre[data-source-gap] [data-source-gap-hidden]")).toHaveLength(2);
    expect(standardGapHost.querySelectorAll("pre[data-source-gap] br")).toHaveLength(1);
    expect(standardGap.getMarkdown()).toBe("a\n\nb");
    standardGap.destroy();

    const blankHost = document.createElement("div");
    document.body.append(blankHost);
    const blank = createEditor(blankHost, { initialContent: "a\n\n\nb" });
    expect(blankHost.querySelectorAll("pre[data-source-gap] br[data-source-gap-eol]")).toHaveLength(1);
    expect(blankHost.querySelectorAll("pre[data-source-gap] [data-source-gap-hidden]")).toHaveLength(2);
    expect(blankHost.querySelectorAll("pre[data-source-gap] br")).toHaveLength(2);
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
    expect(host.querySelector<HTMLElement>("pre[data-source-block]")?.dataset.sourceKind)
      .toBe("heading-1");
    expect(host.querySelector("pre[data-source-block]")?.textContent).toBe("# Second");
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("displays every authored blank row between bullet items", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "- one\n\n\n- two\n\n- three";
    const editor = createEditor(host, { initialContent: markdown });
    const items = host.querySelectorAll<HTMLElement>(".ProseMirror > ul > li");

    expect(items).toHaveLength(3);
    expect(items[0]?.hasAttribute("data-source-gap-before")).toBe(false);
    expect(items[1]?.dataset.sourceGapBefore).toBe("2");
    expect(items[1]?.style.getPropertyValue("--source-gap-before")).toBe("2");
    expect(items[2]?.dataset.sourceGapBefore).toBe("1");
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
          : (gap?.querySelectorAll("br[data-source-gap-eol]").length ?? 0) + 1;

        expect(gap).not.toBeNull();
        expect(visibleRows).toBe(expectedRows);
        expect(editor.getMarkdown()).toBe(markdown);

        editor.setSelectionOffset(markdown.length);
        expect(host.querySelector("pre[data-source-block]")?.textContent).toBe("# Second");
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
    "carries the rendered %s height into transient source editing",
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

      editor.setSelectionOffset(prefix.length + 1);
      const source = host.querySelector<HTMLElement>("pre[data-source-block]");
      expect(source?.dataset.sourceLayoutHeight).toBe("73.26");
      expect(source?.style.minHeight).toBe("73.26px");
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
    "labels an activated level-%s heading source with its original heading level",
    (level) => {
      const host = document.createElement("div");
      document.body.append(host);
      const markdown = `${"#".repeat(level)} Heading`;
      const editor = createEditor(host, { initialContent: markdown });

      editor.setSelectionOffset(markdown.length);

      expect(host.querySelector("pre[data-source-block]")?.getAttribute("data-source-kind"))
        .toBe(`heading-${level}`);
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

  it("lets an activated horizontal rule be deleted or followed by a new line", async () => {
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

    label.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    }));

    expect(host.querySelector("pre")?.dataset.sourceEditing).toBe("1");
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

  it("recognizes a line-leading greater-than candidate without changing its source", async () => {
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
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(">\n>");
    expect(editor.getMarkdown()).toBe(">\n>");
    expect(editor.getSelectionOffset()).toBe(">\n>".length);
    expect(changes.at(-1)).toBe(">\n>");
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
      editor.replaceMarkdown(escaped, escaped.length);
      expect(editor.getMarkdown()).toBe(escaped);
      expect(host.querySelector(".live-markdown-escape-hidden")?.textContent).toBe("\\");
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

  it("keeps an inactive callout as presentation over unchanged authored source", () => {
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

  it("reveals a two-line Callout without merging its authored lines", () => {
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
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();

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
    expect(host.querySelector("pre[data-source-block]")).not.toBeNull();
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
    expect(host.querySelector("pre[data-source-editing='1']")).toBeNull();

    editor.setSelectionOffset(codeTo);
    expect(pressNavigationKey(host, "ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBeGreaterThan(codeTo);
    expect(host.querySelector("pre[data-source-editing='1']")).toBeNull();

    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it.each([
    ["structural separator", "\n", 1],
    ["one blank row", "\n\n", 2],
    ["two blank rows", "\n\n\n", 3],
  ] as const)(
    "activates the next heading on the first key that reaches it across a %s",
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
        .find((node) => node.textContent === "Second");
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

      const active = host.querySelector<HTMLElement>("pre[data-source-block]");
      expect(active?.textContent).toBe("# Second");
      expect(active?.style.minHeight).toBe("41.25px");
      expect(heightReads).toBeLessThanOrEqual(1);
      expect(host.querySelector("h1")?.textContent).toBe("First");
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

    expect(pressNavigationKey(host, "ArrowRight")).toBe(false);
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

    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(true);
    surface?.dispatchEvent(new FocusEvent("focus"));

    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(false);
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

  it("preserves quote lines when native editing creates block DOM", async () => {
    for (const fixture of [
      {
        initial: "> [!note] \n> \n> callout ",
        dom: "&gt; [!note] <div>&gt; test</div><div>&gt; callout </div>",
        expected: "> [!note] \n> test\n> callout ",
      },
      {
        initial: "> quote\n> \n> tail",
        dom: "&gt; quote<div>&gt; test</div><div>&gt; tail</div>",
        expected: "> quote\n> test\n> tail",
      },
    ]) {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createMintEditor(host, {
        initialContent: fixture.initial,
        onChange: (next) => changes.push(next),
      });
      const source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
      if (!source) throw new Error("Missing source-backed quote content");

      source.innerHTML = fixture.dom;
      source.dispatchEvent(new InputEvent("input", {
        inputType: "insertText",
        data: "test",
        bubbles: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(editor.getMarkdown()).toBe(fixture.expected);
      expect(changes.at(-1)).toBe(fixture.expected);
      expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(fixture.expected);
      expect(host.querySelector(".source-blockquote-source-code")?.querySelector("div, br")).toBeNull();
      editor.destroy();
      host.remove();
    }
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
    const source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    const text = source?.firstChild;
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
    expect(host.querySelector(".live-math-block-widget")?.textContent).toBe("block:E = mc^2");
    expect(host.querySelector(".live-mermaid-widget")?.textContent).toContain("diagram:graph TD");
    const wikiLink = host.querySelector<HTMLButtonElement>(".live-wikilink");
    expect(wikiLink?.textContent).toBe("the guide");
    wikiLink?.click();
    expect(wikiLinks).toEqual(["Guide"]);
    expect(editor.getMarkdown()).toBe(markdown);
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

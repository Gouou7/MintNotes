import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ReadingEditor } from "./ReadingEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.clearAllMocks();
});

describe("ReadingEditor", () => {
  it("enables visual code wrapping by default without changing code text", () => {
    const source = "const_very_long_authored_line_without_breaks_1234567890";
    const markdown = `\`\`\`ts\n${source}\n\`\`\``;
    const wrapped = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={markdown} /></I18nProvider>
    );
    const unwrapped = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={markdown} wrapCodeBlocks={false} /></I18nProvider>
    );

    expect(wrapped).toContain('class="reading-editor wrap-code-blocks"');
    expect(unwrapped).toContain('class="reading-editor"');
    expect(unwrapped).not.toContain("wrap-code-blocks");
    expect(wrapped).toContain(source);
  });

  it("keeps Chinese emphasis as semantic italic text", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={"*斜体* and _italic_"} /></I18nProvider>
    );

    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders highlights with nested inline formatting", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={"这是 ==高亮中包含 **粗体** 的文本。=="} /></I18nProvider>
    );

    expect(html).toContain("这是 <mark>高亮中包含 <strong>粗体</strong> 的文本。</mark>");
    expect(html).not.toContain("==");
  });

  it("keeps highlight markers literal in inline code and when escaped", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={"`==code==` and \\==literal=="} /></I18nProvider>
    );

    expect(html).toContain("<code>==code==</code>");
    expect(html).toContain("==literal==");
    expect(html).not.toContain("<mark>");
  });

  it("keeps an authored soft line break in one paragraph", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <I18nProvider><ReadingEditor markdown={"a\nb"} /></I18nProvider>
    ));

    const paragraph = container.querySelector("p.markdown-softbreak-paragraph");
    expect(paragraph?.textContent).toBe("a\nb");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it.each([
    ["bullet", "- one\n- two\n\n- three"],
    ["ordered", "1. one\n2. two\n\n3. three"],
    ["task", "- [ ] one\n- [x] two\n\n- [ ] three"],
  ] as const)("renders adjacent %s items compactly and preserves authored gaps", async (
    _kind,
    markdown,
  ) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <I18nProvider><ReadingEditor markdown={markdown} /></I18nProvider>
    ));

    const items = container.querySelectorAll<HTMLElement>("li");
    expect(items).toHaveLength(3);
    expect(items[0]?.hasAttribute("data-list-gap-before")).toBe(false);
    expect(items[1]?.hasAttribute("data-list-gap-before")).toBe(false);
    expect(items[2]?.dataset.listGapBefore).toBe("1");
    expect(items[2]?.style.getPropertyValue("--markdown-list-gap-before")).toBe("1");
    await act(async () => root.unmount());
  });

  it("preserves multiple authored blank rows between reading-mode list blocks", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={"- one\n\n\n- two"} /></I18nProvider>
    );

    expect(html).toContain('data-list-gap-before="2"');
    expect(html).toContain('--markdown-list-gap-before:2');
  });

  it("renders an attachment reference from its in-memory Blob URL", () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    const blobUrl = "blob:http://localhost/read-only-image";
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor
        markdown={`![example](webmd-attachment:${attachmentId})`}
        attachmentUrls={new Map([[attachmentId, blobUrl]])}
      /></I18nProvider>
    );

    expect(html).toContain(`src="${blobUrl}"`);
    expect(html).not.toContain("webmd-attachment:");
  });

  it("shows a placeholder while an attachment is unavailable", () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={`![example](webmd-attachment:${attachmentId})`} /></I18nProvider>
    );

    expect(html).toContain("附件尚未加载：example");
    expect(html).not.toContain("webmd-attachment:");
  });

  it("renders frontmatter properties and callouts without exposing their source markers", () => {
    localStorage.setItem("webmd-notes-language", "en");
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={[
        "---",
        "version:",
        'modified: "{{date}}"',
        "tags:",
        "---",
        "",
        "> [!IMPORTANT]- Read this {color=cyan icon=tip}",
        "> Body",
        "",
        "> [!custom-kind]",
        "> Custom body",
        "",
        "> Plain quote"
      ].join("\n")} /></I18nProvider>
    );

    expect(html).toContain("Note properties");
    expect(html).toContain("version");
    expect(html).toContain("{{date}}");
    expect(html).toContain("callout-tip");
    expect(html).toContain("callout-color-cyan");
    expect(html).toContain("<summary>");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Read this");
    expect(html).toContain("callout-custom");
    expect(html).toContain("class=\"markdown-quote\"");
    expect(html).not.toContain("[!IMPORTANT]");
  });

  it("renders math, Mermaid fences, and WikiLinks without raw HTML", () => {
    localStorage.setItem("webmd-notes-language", "en");
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={[
        "Inline $E_i = mc^2$.",
        "",
        "$$\\int_0^1 x^2\\,dx$$",
        "",
        "> $$",
        "> A_B",
        "> $$",
        "",
        "[[Guide/Setup#Install|Open setup]]",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```"
      ].join("\n")} /></I18nProvider>
    );

    expect(html).toContain("class=\"katex\"");
    expect(html.match(/class=\"katex-display\"/g)).toHaveLength(2);
    expect(html).toContain("katex-sizing reset-size6 size3");
    expect(html).toContain("class=\"wiki-link\"");
    expect(html).toContain("mint-wikilink:");
    expect(html).toContain("class=\"mermaid-diagram\"");
    expect(html).not.toContain("<script");
  });

  it("omits Obsidian comments from Reading mode", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={"visible %%secret%% text"} /></I18nProvider>
    );
    expect(html).toContain("visible  text");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("%%");
  });

  it("renders Obsidian named and inline footnotes as current-document links", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={[
        "Named footnote[^release] and inline footnote ^[Inline detail.]",
        "",
        "[^release]: Release detail.",
      ].join("\n")} /></I18nProvider>
    );

    expect(html).toContain('data-footnote-ref="true"');
    expect(html).toContain('data-footnotes="true"');
    expect(html).toContain("Inline detail.");
    expect(html.match(/data-footnote-ref="true"/g)).toHaveLength(2);
    expect(html.match(/<li id="mint-footnote-/g)).toHaveLength(2);
    expect(html).not.toMatch(/data-footnote-(?:ref|backref)[^>]*target="_blank"/);
  });

  it("keeps Obsidian inline-footnote syntax literal in code and when escaped", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={[
        "`^[inline code]` and \\^[escaped]",
        "",
        "```md",
        "^[fenced code]",
        "```",
      ].join("\n")} /></I18nProvider>
    );

    expect(html).not.toContain('data-footnote-ref="true"');
    expect(html).toContain("^[inline code]");
    expect(html).toContain("^[escaped]");
    expect(html).toContain("^[fenced code]");
  });

  it("keeps footnote references and backlinks in the current reading surface", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <I18nProvider><ReadingEditor markdown={[
        "Reference[^note].",
        "",
        "[^note]: Footnote body.",
      ].join("\n")} /></I18nProvider>
    ));

    const reference = container.querySelector<HTMLAnchorElement>("a[data-footnote-ref]");
    const definition = container.querySelector<HTMLElement>("li[data-footnote-definition]");
    const backlink = container.querySelector<HTMLAnchorElement>("a[data-footnote-backref]");
    const label = container.querySelector<HTMLElement>("section[data-footnotes] > h2");
    const referenceScroll = vi.fn();
    const definitionScroll = vi.fn();
    Object.defineProperty(reference, "scrollIntoView", { configurable: true, value: referenceScroll });
    Object.defineProperty(definition, "scrollIntoView", { configurable: true, value: definitionScroll });

    expect(reference?.target).toBe("");
    expect(backlink?.target).toBe("");
    expect(definition?.tabIndex).toBe(-1);
    expect(reference?.getAttribute("aria-describedby")).toBe(label?.id);
    await act(async () => reference?.click());
    expect(definitionScroll).toHaveBeenCalledOnce();
    await act(async () => backlink?.click());
    expect(referenceScroll).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("continues to open external Reading-mode links in a new tab", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown="[External](https://example.test)" /></I18nProvider>
    );

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("copies every line from a fenced code block", async () => {
    localStorage.setItem("webmd-notes-language", "en");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <I18nProvider><ReadingEditor markdown={[
        "```ts",
        "const first = 1;",
        "const second = first + 1;",
        "```"
      ].join("\n")} /></I18nProvider>
    ));
    const copyButton = container.querySelector<HTMLButtonElement>(".reading-code-copy");
    expect(copyButton?.getAttribute("aria-label")).toBe("Copy code");

    await act(async () => copyButton?.click());

    expect(writeText).toHaveBeenCalledWith("const first = 1;\nconst second = first + 1;\n");
    expect(copyButton?.getAttribute("aria-label")).toBe("Code copied");
    await act(async () => root.unmount());
  });

  it("shows fenced-code languages in Reading mode", () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ReadingEditor markdown={[
        "```ts",
        "const value = 1;",
        "```",
        "",
        "```custom-lang",
        "value",
        "```",
        "",
        "```",
        "plain",
        "```",
      ].join("\n")} /></I18nProvider>
    );

    expect(html).toContain('class="reading-code-language">TypeScript</span>');
    expect(html).toContain('class="reading-code-language">custom-lang</span>');
    expect(html.match(/class="reading-code-language"/g)).toHaveLength(2);
    expect(html.match(/class="reading-code-actions"/g)).toHaveLength(3);
  });
});

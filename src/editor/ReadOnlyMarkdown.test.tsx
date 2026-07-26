import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { ReadOnlyMarkdown } from "./ReadOnlyMarkdown";

describe("ReadOnlyMarkdown", () => {
  it("renders an attachment reference from its in-memory Blob URL", () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    const blobUrl = "blob:http://localhost/read-only-image";
    const html = renderToStaticMarkup(
      <I18nProvider><ReadOnlyMarkdown
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
      <I18nProvider><ReadOnlyMarkdown markdown={`![example](webmd-attachment:${attachmentId})`} /></I18nProvider>
    );

    expect(html).toContain("附件尚未加载：example");
    expect(html).not.toContain("webmd-attachment:");
  });

  it("renders frontmatter properties and callouts without exposing their source markers", () => {
    localStorage.setItem("webmd-notes-language", "en");
    const html = renderToStaticMarkup(
      <I18nProvider><ReadOnlyMarkdown markdown={[
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
        "> Custom body"
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
    expect(html).not.toContain("[!IMPORTANT]");
  });

  it("renders math, Mermaid fences, and WikiLinks without raw HTML", () => {
    localStorage.setItem("webmd-notes-language", "en");
    const html = renderToStaticMarkup(
      <I18nProvider><ReadOnlyMarkdown markdown={[
        "Inline $E = mc^2$.",
        "",
        "$$\\int_0^1 x^2\\,dx$$",
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
    expect(html).toContain("class=\"katex-display\"");
    expect(html).toContain("class=\"wiki-link\"");
    expect(html).toContain("mint-wikilink:");
    expect(html).toContain("class=\"mermaid-diagram\"");
    expect(html).not.toContain("<script");
  });
});

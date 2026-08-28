import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "./lib";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Live footnotes", () => {
  it("renders Obsidian named footnotes numerically without changing canonical Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = [
      "First[^release], again[^release], then[^details].",
      "",
      "[^release]: Release detail.",
      "[^details]: Details on the next line.",
      "  Continued detail.",
    ].join("\n");
    const changes: string[] = [];
    const editor = createEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });

    const references = [...host.querySelectorAll<HTMLAnchorElement>("a[data-footnote-ref]")];
    const definitions = [...host.querySelectorAll<HTMLElement>("[data-footnote-definition]")];
    expect(references.map((reference) => reference.textContent)).toEqual(["1", "1", "2"]);
    expect(definitions.map((definition) => definition.getAttribute("data-footnote-number")))
      .toEqual(["1", "2"]);
    expect(host.textContent).toContain("Continued detail.");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);

    editor.destroy();
  });

  it("navigates references and backlinks inside the Live editor without opening a tab", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const editor = createEditor(host, {
      initialContent: "Reference[^note].\n\n[^note]: Footnote body.",
    });
    const reference = host.querySelector<HTMLAnchorElement>("a[data-footnote-ref]");
    const definition = host.querySelector<HTMLElement>("[data-footnote-definition]");
    const backlink = host.querySelector<HTMLAnchorElement>("a[data-footnote-backref]");
    const referenceScroll = vi.fn();
    const definitionScroll = vi.fn();
    Object.defineProperty(reference, "scrollIntoView", { configurable: true, value: referenceScroll });
    Object.defineProperty(definition, "scrollIntoView", { configurable: true, value: definitionScroll });

    reference?.click();
    expect(definitionScroll).toHaveBeenCalledOnce();
    backlink?.click();
    expect(referenceScroll).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();

    editor.destroy();
  });

  it("keeps Obsidian inline footnotes literal in Live mode", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, {
      initialContent: "Inline ^[reading-only detail].",
    });

    expect(host.querySelector("[data-footnote-ref]")).toBeNull();
    expect(host.textContent).toContain("^[reading-only detail]");

    editor.destroy();
  });

  it("edits footnote source through canonical offsets instead of rendered widgets", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Reference[^note].\n\n[^note]: Footnote body.";
    const editor = createEditor(host, { initialContent: markdown });
    const bodyOffset = markdown.indexOf("Footnote body");

    editor.setSelectionOffset(bodyOffset);
    editor.insertMarkdown("Expanded ");

    expect(editor.getMarkdown()).toBe(
      "Reference[^note].\n\n[^note]: Expanded Footnote body.",
    );
    expect(host.querySelector("a[data-footnote-ref]")?.textContent).toBe("1");

    editor.destroy();
  });
});

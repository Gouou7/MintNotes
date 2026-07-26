import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type TyporaWebEditor } from "typora-web";
import { I18nProvider } from "../i18n";
import { TyporaEditor } from "./TyporaEditor";

vi.mock("typora-web", () => ({ createEditor: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const attachmentId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("TyporaEditor live mode", () => {
  it("updates an attachment image without rebuilding the editor document", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      getMarkdown: vi.fn(),
      getMarkdownOffsetAtPoint: vi.fn(),
      insertMarkdown: vi.fn(),
      isSourceMode: vi.fn(),
      setMarkdown: vi.fn(),
      toggleSource: vi.fn()
    } as unknown as TyporaWebEditor;
    vi.mocked(createEditor).mockImplementation((host) => {
      const image = document.createElement("img");
      image.setAttribute("src", `webmd-attachment:${attachmentId}`);
      host.append(image);
      return editor;
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (attachmentUrls: Map<string, string>) => (
      <TyporaEditor
        markdown={`![image](webmd-attachment:${attachmentId})`}
        mode="live"
        attachmentUrls={attachmentUrls}
        onChange={vi.fn()}
      />
    );

    await act(async () => root.render(render(new Map())));
    await act(async () => root.render(render(new Map([[attachmentId, "blob:http://localhost/image"]]))));

    const image = container.querySelector("img");
    expect(image?.dataset.webmdAttachment).toBe(`webmd-attachment:${attachmentId}`);
    expect(image?.getAttribute("src")).toBe("blob:http://localhost/image");
    expect(editor.setMarkdown).toHaveBeenCalledOnce();
    expect(editor.setMarkdown).toHaveBeenCalledWith(`![image](blob:http://localhost/image)`);

    await act(async () => root.unmount());
  });

  it("materializes attachments when the live editor is created and canonicalizes changes", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    let editorChange: ((markdown: string) => void) | undefined;
    vi.mocked(createEditor).mockImplementation((_host, options) => {
      editorChange = options?.onChange;
      return editor;
    });
    const onChange = vi.fn();
    const blobUrl = "blob:http://localhost/initial-image";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <TyporaEditor
        markdown={`![image](webmd-attachment:${attachmentId})`}
        mode="live"
        attachmentUrls={new Map([[attachmentId, blobUrl]])}
        onChange={onChange}
      />
    ));

    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).toBe(`![image](${blobUrl})`);
    act(() => editorChange?.(`![image](${blobUrl})`));
    expect(onChange).not.toHaveBeenCalled();

    act(() => editorChange?.(`text\n\n![image](${blobUrl})`));
    expect(onChange).toHaveBeenCalledWith(`text\n\n![image](webmd-attachment:${attachmentId})`);
    act(() => editorChange?.(`text\n\n![image](${blobUrl})`));
    expect(onChange).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("applies Markdown inserted outside the live editor", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    vi.mocked(createEditor).mockReturnValue(editor);
    const blobUrl = "blob:http://localhost/inserted-image";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (markdown: string) => (
      <TyporaEditor
        markdown={markdown}
        mode="live"
        attachmentUrls={new Map([[attachmentId, blobUrl]])}
        onChange={vi.fn()}
      />
    );

    await act(async () => root.render(render("before")));
    await act(async () => root.render(render(`before\n\n![image](webmd-attachment:${attachmentId})`)));

    expect(editor.setMarkdown).toHaveBeenCalledOnce();
    expect(editor.setMarkdown).toHaveBeenCalledWith(`before\n\n![image](${blobUrl})`);

    await act(async () => root.unmount());
  });

  it("keeps frontmatter outside the live editor and canonicalizes callout changes", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    let editorChange: ((markdown: string) => void) | undefined;
    vi.mocked(createEditor).mockImplementation((_host, options) => {
      editorChange = options?.onChange;
      return editor;
    });
    const onChange = vi.fn();
    const markdown = "---\nversion:\n---\n> [!TIP]\n> Body";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <I18nProvider><TyporaEditor
        markdown={markdown}
        mode="live"
        onChange={onChange}
      /></I18nProvider>
    ));

    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).toBe("> [!TIP]\n>\n> Body");
    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).not.toContain("==`");
    act(() => editorChange?.("> [!TIP]\n>\n> Changed"));
    expect(onChange).toHaveBeenCalledWith("---\nversion:\n---\n> [!TIP]\n> Changed");
    expect(container.textContent).toContain("Note properties");

    await act(async () => root.unmount());
  });

  it("keeps an empty callout body stable without rebuilding the live editor", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    let editorChange: ((markdown: string) => void) | undefined;
    vi.mocked(createEditor).mockImplementation((_host, options) => {
      editorChange = options?.onChange;
      return editor;
    });
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (markdown: string) => (
      <TyporaEditor markdown={markdown} mode="live" onChange={onChange} />
    );

    await act(async () => root.render(render("> [!NOTE]\n> Body")));
    act(() => editorChange?.("> [!NOTE]"));

    expect(onChange).toHaveBeenLastCalledWith("> [!NOTE]\n> ");

    await act(async () => root.render(render("> [!NOTE]\n> ")));
    expect(editor.setMarkdown).not.toHaveBeenCalled();

    act(() => editorChange?.("> [!NOTE]\n>\n> Restored"));
    expect(onChange).toHaveBeenLastCalledWith("> [!NOTE]\n> Restored");

    await act(async () => root.unmount());
  });

  it("keeps multiline math private to Live mode and forwards WikiLink navigation", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    let editorChange: ((markdown: string) => void) | undefined;
    vi.mocked(createEditor).mockImplementation((_host, options) => {
      editorChange = options?.onChange;
      return editor;
    });
    const onChange = vi.fn();
    const onWikiLink = vi.fn();
    const markdown = "$$\nE = mc^2\n$$\n\n[[Guide]]";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <TyporaEditor markdown={markdown} mode="live" onChange={onChange} onWikiLink={onWikiLink} />
    ));

    const options = vi.mocked(createEditor).mock.calls[0]?.[1];
    expect(options?.initialContent).toBe("```mint-math\nE = mc^2\n```\n\n[[Guide]]");
    expect(options?.liveSyntax?.renderMath).toBeTypeOf("function");
    expect(options?.liveSyntax?.renderMermaid).toBeTypeOf("function");
    act(() => options?.liveSyntax?.onWikiLink?.("Guide"));
    expect(onWikiLink).toHaveBeenCalledWith("Guide");

    act(() => editorChange?.("```mint-math\nE = ma\n```\n\n[[Guide]]"));
    expect(onChange).toHaveBeenCalledWith("$$\nE = ma\n$$\n\n[[Guide]]");

    await act(async () => root.unmount());
  });

  it("keeps the Callout frame in sync and makes only its header interactive", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      focusCalloutMarker: vi.fn(() => true),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    let height = 80;
    let markerParagraph: HTMLParagraphElement | null = null;
    let bodyParagraph: HTMLParagraphElement | null = null;
    vi.mocked(createEditor).mockImplementation((host) => {
      const blockquote = document.createElement("blockquote");
      Object.defineProperty(blockquote, "getBoundingClientRect", {
        value: () => ({
          bottom: height,
          height,
          left: 0,
          right: 320,
          top: 0,
          width: 320,
          x: 0,
          y: 0,
          toJSON: () => ({})
        })
      });
      markerParagraph = document.createElement("p");
      markerParagraph.textContent = "[!NOTE]";
      bodyParagraph = document.createElement("p");
      bodyParagraph.textContent = "Body";
      blockquote.append(markerParagraph, bodyParagraph);
      host.append(blockquote);
      return editor;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <TyporaEditor markdown={"> [!NOTE]\n> Body"} mode="live" onChange={vi.fn()} />
    ));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.querySelector<HTMLElement>(".live-callout-overlay")?.style.height).toBe("50px");
    expect(container.querySelector<HTMLElement>(".live-callout-surface")?.style.height).toBe("80px");

    act(() => {
      if (markerParagraph) markerParagraph.textContent = "[!NOTE] Custom title";
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.querySelector(".live-callout-overlay")?.getAttribute("aria-label")).toBe("Custom title");
    expect(container.querySelector(".live-callout-overlay .callout-header strong")?.textContent).toBe("Custom title");

    const title = container.querySelector<HTMLElement>(".live-callout-overlay .callout-header strong");
    const icon = container.querySelector<HTMLElement>(".live-callout-overlay .callout-icon");
    const overlay = container.querySelector<HTMLElement>(".live-callout-overlay");
    if (!title?.firstChild || !icon || !overlay) throw new Error("Missing interactive Callout header");
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: vi.fn(() => ({ offsetNode: title.firstChild!, offset: 3 }))
    });

    act(() => title.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 100,
      clientY: 10
    })));
    expect(editor.focusCalloutMarker).toHaveBeenLastCalledWith(0, 11);

    act(() => icon.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true
    })));
    expect(editor.focusCalloutMarker).toHaveBeenLastCalledWith(0, "[!NOTE] Custom title".length);

    act(() => overlay.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true
    })));
    expect(editor.focusCalloutMarker).toHaveBeenLastCalledWith(0, "[!NOTE] Custom title".length);
    Reflect.deleteProperty(document, "caretPositionFromPoint");

    height = 140;
    act(() => {
      bodyParagraph?.append(document.createTextNode("\nMore"));
      window.dispatchEvent(new Event("resize"));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.querySelector<HTMLElement>(".live-callout-surface")?.style.height).toBe("140px");

    height = 80;
    act(() => {
      bodyParagraph?.lastChild?.remove();
      window.dispatchEvent(new Event("resize"));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.querySelector<HTMLElement>(".live-callout-surface")?.style.height).toBe("80px");

    act(() => {
      if (markerParagraph) markerParagraph.textContent = "[!NOTE";
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.querySelector(".live-callout-overlay")).toBeNull();

    await act(async () => root.unmount());
  });

  it("moves an empty callout body back to its marker without deleting the block", async () => {
    let editorChange: ((markdown: string) => void) | undefined;
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      insertMarkdown: vi.fn(),
      replaceMarkdown: vi.fn((markdown: string) => editorChange?.(markdown)),
      setMarkdown: vi.fn()
    } as unknown as TyporaWebEditor;
    let bodyParagraph: HTMLParagraphElement | null = null;
    vi.mocked(createEditor).mockImplementation((host, options) => {
      editorChange = options?.onChange;
      const blockquote = document.createElement("blockquote");
      const markerParagraph = document.createElement("p");
      markerParagraph.textContent = "[!NOTE]";
      bodyParagraph = document.createElement("p");
      bodyParagraph.append(document.createElement("br"));
      blockquote.append(markerParagraph, bodyParagraph);
      host.append(blockquote);
      return editor;
    });
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <TyporaEditor
        markdown={"Before\n\n> [!NOTE]\n> \n\nAfter"}
        mode="live"
        onChange={onChange}
      />
    ));

    const range = document.createRange();
    range.selectNodeContents(bodyParagraph!);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const deleteEvent = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    act(() => bodyParagraph?.dispatchEvent(deleteEvent));
    expect(deleteEvent.defaultPrevented).toBe(false);
    expect(editor.replaceMarkdown).not.toHaveBeenCalled();

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    act(() => bodyParagraph?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.replaceMarkdown).toHaveBeenCalledWith(
      "Before\n\n> [!NOTE]\n\nAfter",
      "Before\n\n> [!NOTE]".length
    );
    expect(editor.setMarkdown).not.toHaveBeenCalled();
    expect(editor.insertMarkdown).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});

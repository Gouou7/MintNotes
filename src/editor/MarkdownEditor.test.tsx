import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor as EditorController } from "./core/lib";
import { createCalloutExtension } from "./extensions/callout";
import { createMathExtension } from "./extensions/math";
import { createMermaidExtension } from "./extensions/mermaid";
import { createWikiLinkExtension } from "./extensions/wikilink";
import { I18nProvider } from "../i18n";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

vi.mock("./core/lib", () => ({ createEditor: vi.fn() }));
vi.mock("./extensions/callout", () => ({
  createCalloutExtension: vi.fn(() => ({ id: "mint-callout" })),
}));
vi.mock("./extensions/math", () => ({
  createMathExtension: vi.fn(() => ({ id: "mint-math" })),
}));
vi.mock("./extensions/mermaid", () => ({
  createMermaidExtension: vi.fn(() => ({ id: "mint-mermaid" })),
}));
vi.mock("./extensions/wikilink", () => ({
  createWikiLinkExtension: vi.fn(() => ({ id: "mint-wikilink" })),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const attachmentId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
});

function imageTransfer(file: File, files: File[] = [file]): DataTransfer {
  return {
    files,
    items: [{
      getAsFile: () => file,
      kind: "file",
      type: file.type
    }]
  } as unknown as DataTransfer;
}

function transferEvent(
  type: "drop" | "paste",
  transfer: DataTransfer,
  coordinates?: { clientX: number; clientY: number }
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: transfer });
  if (coordinates) {
    Object.defineProperties(event, {
      clientX: { value: coordinates.clientX },
      clientY: { value: coordinates.clientY }
    });
  }
  return event;
}

describe("MarkdownEditor live mode", () => {
  it("exposes focus and shows a non-persistent hint for an empty note", async () => {
    localStorage.setItem("webmd-notes-language", "en");
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
    vi.mocked(createEditor).mockReturnValue(editor);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const ref = createRef<MarkdownEditorHandle>();
    const render = (markdown: string) => (
      <I18nProvider>
        <MarkdownEditor ref={ref} markdown={markdown} mode="live" emptyHint="Start writing…" onChange={vi.fn()} />
      </I18nProvider>
    );

    await act(async () => root.render(render("")));
    expect(container.querySelector(".markdown-editor-host.is-empty")?.getAttribute("data-empty-hint")).toBe("Start writing…");
    act(() => ref.current?.focus());
    expect(editor.focus).toHaveBeenCalledTimes(2);

    await act(async () => root.render(render("Body")));
    expect(container.querySelector(".markdown-editor-host.is-empty")).toBeNull();

    await act(async () => root.unmount());
  });

  it("refreshes an asynchronously resolved attachment without rebuilding or refocusing the editor", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      getMarkdown: vi.fn(),
      getMarkdownOffsetAtPoint: vi.fn(),
      insertMarkdown: vi.fn(),
      isSourceMode: vi.fn(),
      refreshPresentation: vi.fn(),
      setMarkdown: vi.fn(),
      toggleSource: vi.fn()
    } as unknown as EditorController;
    let resolveImageSource: ((source: string) => string | null | undefined) | undefined;
    vi.mocked(createEditor).mockImplementation((_host, options) => {
      resolveImageSource = options?.resolveImageSource;
      return editor;
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (attachmentUrls: Map<string, string>) => (
      <MarkdownEditor
        markdown={`![image](webmd-attachment:${attachmentId})`}
        mode="live"
        attachmentUrls={attachmentUrls}
        attachmentsPending={!attachmentUrls.size}
        onChange={vi.fn()}
      />
    );

    await act(async () => root.render(render(new Map())));
    expect(resolveImageSource?.(`webmd-attachment:${attachmentId}`)).toBeNull();
    await act(async () => root.render(render(new Map([[attachmentId, "blob:http://localhost/image"]]))));

    expect(resolveImageSource?.(`webmd-attachment:${attachmentId}`)).toBe("blob:http://localhost/image");
    expect(editor.refreshPresentation).toHaveBeenCalledTimes(2);
    expect(editor.setMarkdown).not.toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("materializes attachments when the live editor is created and canonicalizes changes", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
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
      <MarkdownEditor
        markdown={`![image](webmd-attachment:${attachmentId})`}
        mode="live"
        attachmentUrls={new Map([[attachmentId, blobUrl]])}
        onChange={onChange}
      />
    ));

    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).toBe(`![image](webmd-attachment:${attachmentId})`);
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
    } as unknown as EditorController;
    vi.mocked(createEditor).mockReturnValue(editor);
    const blobUrl = "blob:http://localhost/inserted-image";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (markdown: string) => (
      <MarkdownEditor
        markdown={markdown}
        mode="live"
        attachmentUrls={new Map([[attachmentId, blobUrl]])}
        onChange={vi.fn()}
      />
    );

    await act(async () => root.render(render("before")));
    await act(async () => root.render(render(`before\n\n![image](webmd-attachment:${attachmentId})`)));

    expect(editor.setMarkdown).toHaveBeenCalledOnce();
    expect(editor.setMarkdown).toHaveBeenCalledWith(`before\n\n![image](webmd-attachment:${attachmentId})`);

    await act(async () => root.unmount());
  });

  it("inserts dragged and pasted clipboard images", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      getMarkdownOffsetAtPoint: vi.fn(() => 7),
      insertMarkdown: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
    vi.mocked(createEditor).mockReturnValue(editor);
    const onImageInsert = vi.fn(async () => `\n![image](webmd-attachment:${attachmentId})\n`);
    const image = new File(["image"], "image.png", { type: "image/png" });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <MarkdownEditor
        markdown="Before after"
        mode="live"
        onChange={vi.fn()}
        onImageInsert={onImageInsert}
      />
    ));
    const host = container.querySelector<HTMLElement>(".markdown-editor-host");
    if (!host) throw new Error("Missing Live editor host");

    await act(async () => {
      host.dispatchEvent(transferEvent("drop", imageTransfer(image), { clientX: 40, clientY: 80 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor.getMarkdownOffsetAtPoint).toHaveBeenCalledWith(40, 80);
    expect(editor.insertMarkdown).toHaveBeenLastCalledWith(
      `\n![image](webmd-attachment:${attachmentId})\n`,
      7
    );

    const pasteEvent = transferEvent("paste", imageTransfer(image, []));
    await act(async () => {
      host.dispatchEvent(pasteEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onImageInsert).toHaveBeenCalledTimes(2);
    expect(editor.insertMarkdown).toHaveBeenLastCalledWith(
      `\n![image](webmd-attachment:${attachmentId})\n`
    );

    await act(async () => root.unmount());
  });

  it("keeps frontmatter outside the live editor without materializing callout syntax", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
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
      <I18nProvider><MarkdownEditor
        markdown={markdown}
        mode="live"
        onChange={onChange}
      /></I18nProvider>
    ));

    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).toBe("> [!TIP]\n> Body");
    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).not.toContain("==`");
    act(() => editorChange?.("> [!TIP]\n> Changed"));
    expect(onChange).toHaveBeenCalledWith("---\nversion:\n---\n> [!TIP]\n> Changed");
    expect(container.textContent).toContain("Note properties");

    await act(async () => root.unmount());
  });

  it("keeps an empty callout body stable without rebuilding the live editor", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
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
      <MarkdownEditor markdown={markdown} mode="live" onChange={onChange} />
    );

    await act(async () => root.render(render("> [!NOTE]\n> Body")));
    act(() => editorChange?.("> [!NOTE]"));

    expect(onChange).toHaveBeenLastCalledWith("> [!NOTE]");

    await act(async () => root.render(render("> [!NOTE]")));
    expect(editor.setMarkdown).not.toHaveBeenCalled();

    act(() => editorChange?.("> [!NOTE]\n> Restored"));
    expect(onChange).toHaveBeenLastCalledWith("> [!NOTE]\n> Restored");

    await act(async () => root.unmount());
  });

  it("passes canonical multiline math directly to Live mode and forwards WikiLink navigation", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
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
      <MarkdownEditor markdown={markdown} mode="live" onChange={onChange} onWikiLink={onWikiLink} />
    ));

    const options = vi.mocked(createEditor).mock.calls[0]?.[1];
    const math = vi.mocked(createMathExtension).mock.calls[0]?.[0];
    const mermaid = vi.mocked(createMermaidExtension).mock.calls[0]?.[0];
    const wikiLink = vi.mocked(createWikiLinkExtension).mock.calls[0]?.[0];
    expect(options?.initialContent).toBe(markdown);
    expect(options?.extensions?.map((extension) => extension.id)).toEqual([
      "mint-comment",
      "mint-callout",
      "mint-math",
      "mint-mermaid",
      "mint-wikilink",
    ]);
    expect(createCalloutExtension).toHaveBeenCalledOnce();
    expect(math?.renderInline).toBeTypeOf("function");
    expect(math?.renderBlock).toBeTypeOf("function");
    expect(mermaid?.render).toBeTypeOf("function");
    act(() => wikiLink?.onNavigate?.("Guide"));
    expect(onWikiLink).toHaveBeenCalledWith("Guide");

    act(() => editorChange?.("$$\nE = ma\n$$\n\n[[Guide]]"));
    expect(onChange).toHaveBeenCalledWith("$$\nE = ma\n$$\n\n[[Guide]]");

    await act(async () => root.unmount());
  });

  it("passes a React Callout preview renderer into the presentation extension", async () => {
    const editor = {
      destroy: vi.fn(),
      focus: vi.fn(),
      setMarkdown: vi.fn()
    } as unknown as EditorController;
    vi.mocked(createEditor).mockReturnValue(editor);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <MarkdownEditor markdown={"> [!NOTE]\n> Body"} mode="live" onChange={vi.fn()} />
    ));
    const extensionOptions = vi.mocked(createCalloutExtension).mock.calls[0]?.[0];
    const preview = document.createElement("div");
    let cleanup: void | (() => void);
    await act(async () => {
      cleanup = extensionOptions?.renderBlockquotePreview?.(
        preview,
        "> [!NOTE] Custom title\n> Body",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(preview.querySelector(".markdown-callout.callout-note")).not.toBeNull();
    expect(preview.querySelector(".callout-header strong")?.textContent).toBe("Custom title");
    await act(async () => cleanup?.());

    await act(async () => root.unmount());
  });

});

describe("MarkdownEditor source mode", () => {
  it("inserts a dragged image at the captured source selection", async () => {
    let finishInsertion: ((insertion: string) => void) | undefined;
    const onImageInsert = vi.fn(() => new Promise<string>((resolve) => {
      finishInsertion = resolve;
    }));
    const onChange = vi.fn();
    const image = new File(["image"], "image.png", { type: "image/png" });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <I18nProvider>
        <MarkdownEditor
          markdown="Before selected after"
          mode="source"
          onChange={onChange}
          onImageInsert={onImageInsert}
        />
      </I18nProvider>
    ));
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("Missing Source editor");
    textarea.setSelectionRange(7, 15);

    const dropEvent = transferEvent("drop", imageTransfer(image));
    act(() => {
      textarea.dispatchEvent(dropEvent);
    });
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(onImageInsert).toHaveBeenCalledWith(image);

    await act(async () => {
      finishInsertion?.("![pasted](webmd-attachment:image)");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onChange).toHaveBeenCalledWith("Before ![pasted](webmd-attachment:image) after");

    await act(async () => root.unmount());
  });

  it("pastes a clipboard image while leaving ordinary text paste untouched", async () => {
    const onImageInsert = vi.fn(async () => "![clipboard](webmd-attachment:image)");
    const onChange = vi.fn();
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <I18nProvider>
        <MarkdownEditor
          markdown="Before after"
          mode="source"
          onChange={onChange}
          onImageInsert={onImageInsert}
        />
      </I18nProvider>
    ));
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("Missing Source editor");
    textarea.setSelectionRange(7, 7);

    const imagePaste = transferEvent("paste", imageTransfer(image, []));
    await act(async () => {
      textarea.dispatchEvent(imagePaste);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(imagePaste.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith("Before ![clipboard](webmd-attachment:image)after");

    const textPaste = transferEvent("paste", { files: [], items: [] } as unknown as DataTransfer);
    act(() => {
      textarea.dispatchEvent(textPaste);
    });
    expect(textPaste.defaultPrevented).toBe(false);
    expect(onImageInsert).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});

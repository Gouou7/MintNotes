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

    expect(vi.mocked(createEditor).mock.calls[0]?.[1]?.initialContent).toBe("> ==`[!TIP]`==\n> Body");
    act(() => editorChange?.("> ==`[!TIP]`==\n> Changed"));
    expect(onChange).toHaveBeenCalledWith("---\nversion:\n---\n> [!TIP]\n> Changed");
    expect(container.textContent).toContain("Note properties");

    await act(async () => root.unmount());
  });
});

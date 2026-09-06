import { AlignCenter, AlignLeft, AlignRight, Image as ImageIcon, ImageOff, TableProperties, Trash2 } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import {
  forwardRef,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  useImperativeHandle,
  useEffect,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";
import { createEditor, type Editor as EditorController } from "./core/lib";
import "./core/styles/widgets.css";
import "./core/styles/theme-typora.css";
import { createCalloutExtension } from "./extensions/callout";
import { createCommentExtension } from "./extensions/comment";
import { createMathExtension } from "./extensions/math";
import { createMermaidExtension } from "./extensions/mermaid";
import { createWikiLinkExtension } from "./extensions/wikilink";
import { I18nProvider, useI18n } from "../i18n";
import type { WorkspaceEditorMode } from "../types";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter } from "./frontmatter";
import { ReadingEditor } from "./ReadingEditor";
import { renderMathInto, renderMermaidInto } from "./richRenderers";

interface Props {
  markdown: string;
  mode: WorkspaceEditorMode;
  onChange: (markdown: string) => void;
  attachmentUrls?: Map<string, string>;
  attachmentsPending?: boolean;
  onImageInsert?: (file: File) => Promise<string | null>;
  onWikiLink?: (target: string) => void;
  emptyHint?: string;
  wrapCodeBlocks?: boolean;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  getSelectionOffset: () => number;
  setSelectionOffset: (offset: number) => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor({ markdown, mode, onChange, attachmentUrls = new Map(), attachmentsPending = false, onImageInsert, onWikiLink, emptyHint, wrapCodeBlocks = true }, ref) {
  const frontmatter = parseFrontmatter(markdown);
  const [displayMode, setDisplayMode] = useState(mode);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorController | null>(null);
  const changeRef = useRef(onChange);
  const attachmentUrlsRef = useRef(attachmentUrls);
  const attachmentsPendingRef = useRef(attachmentsPending);
  const editorMarkdownRef = useRef(markdown);
  const wikiLinkRef = useRef(onWikiLink);
  changeRef.current = onChange;
  attachmentUrlsRef.current = attachmentUrls;
  attachmentsPendingRef.current = attachmentsPending;
  wikiLinkRef.current = onWikiLink;
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getSelectionOffset: () => editorRef.current?.getSelectionOffset() ?? editorMarkdownRef.current.length,
    setSelectionOffset: (offset) => editorRef.current?.setSelectionOffset(offset)
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createEditor(hostRef.current, {
      initialContent: markdown,
      renderControlIcon: (name) => {
        const icons = { image: ImageIcon, "image-unavailable": ImageOff, "table-size": TableProperties, "table-delete": Trash2, "align-left": AlignLeft, "align-center": AlignCenter, "align-right": AlignRight };
        const container = document.createElement("span");
        const root = createRoot(container);
        root.render(<AppIcon icon={icons[name]} size={16} />);
        return { element: container, destroy: () => queueMicrotask(() => root.unmount()) };
      },
      onSourceModeChange: (source) => setDisplayMode(source ? "source" : modeRef.current === "reading" ? "reading" : "live"),
      onCompositionChange: (composing) => {
        if (!composing) {
          editorRef.current?.setSourceMode(modeRef.current === "source");
          setDisplayMode(modeRef.current);
        }
      },
      extensions: [
        createCommentExtension(),
        createCalloutExtension({
          renderBlockquotePreview: (container, source) => {
            const root = createRoot(container);
            root.render(
              <I18nProvider>
                <ReadingEditor
                  markdown={source}
                  wrapCodeBlocks={false}
                  attachmentUrls={attachmentUrlsRef.current}
                  onWikiLink={(target) => wikiLinkRef.current?.(target)}
                />
              </I18nProvider>
            );
            return () => root.unmount();
          },
        }),
        createMathExtension({
          renderInline: (container, source) => renderMathInto(container, source),
          renderBlock: (container, source) => renderMathInto(container, source, true),
        }),
        createMermaidExtension({ render: renderMermaidInto }),
        createWikiLinkExtension({
          onNavigate: (target) => wikiLinkRef.current?.(target),
        }),
      ],
      resolveImageSource: (source) => {
        const match = /^webmd-attachment:([0-9a-f-]{36})$/i.exec(source);
        if (!match) return undefined;
        return attachmentUrlsRef.current.get(match[1].toLowerCase())
          ?? (attachmentsPendingRef.current ? null : undefined);
      },
      onChange: (next) => {
        if (next === editorMarkdownRef.current) return;
        editorMarkdownRef.current = next;
        changeRef.current(next);
      }
    });
    editorRef.current = editor;
    editor.setSourceMode(modeRef.current === "source");
    if (modeRef.current !== "reading") editor.focus();
    return () => {
      editorRef.current = null;
      editor.destroy();
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    // Attachment Blob URLs are refreshed through the presentation resolver
    // below. Only authored Markdown changes rebuild the editor document.
    if (markdown === editorMarkdownRef.current) return;
    editorMarkdownRef.current = markdown;
    editorRef.current.setMarkdown(markdown);
  }, [markdown]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor?.isComposing()) return;
    editor?.setSourceMode(mode === "source");
    setDisplayMode(mode);
  }, [mode]);

  useEffect(() => {
    editorRef.current?.refreshPresentation?.();
  }, [attachmentUrls, attachmentsPending]);

  const drop = async (event: DragEvent<HTMLDivElement>) => {
    const file = imageFileFromTransfer(event.dataTransfer);
    if (!file || !onImageInsert || !editorRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const editor = editorRef.current;
    const selection = editor.isSourceMode() ? editor.getSelection() : null;
    const offset = editor.getMarkdownOffsetAtPoint(event.clientX, event.clientY);
    const insertion = await onImageInsert(file);
    if (insertion === null) return;
    if (editorRef.current !== editor) return;
    if (selection) { editor.setSelection(selection); editor.insertMarkdown(insertion); }
    else editor.insertMarkdown(insertion, offset);
  };
  const paste = async (event: ReactClipboardEvent<HTMLDivElement>) => {
    const file = imageFileFromTransfer(event.clipboardData);
    const editor = editorRef.current;
    if (!file || !onImageInsert || !editor) return;
    event.preventDefault();
    event.stopPropagation();
    const insertion = await onImageInsert(file);
    if (insertion === null) return;
    if (editorRef.current === editor) editor.insertMarkdown(insertion);
  };

  const changeProperties = (next: string) => {
    if (next === editorMarkdownRef.current) return;
    editorRef.current?.replaceMarkdown(next, editorRef.current.getSelectionOffset());
  };

  return (
    <>
    <div hidden={displayMode === "reading"} className={`live-editor-document mode-${displayMode}${wrapCodeBlocks ? " wrap-code-blocks" : ""}`}>
      {displayMode === "live" && frontmatter.status !== "absent" && <FrontmatterProperties markdown={markdown} editable onChange={changeProperties} />}
      <div
        ref={hostRef}
        className={`markdown-editor-host${emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? " is-empty" : ""}`}
        data-empty-hint={emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? emptyHint : undefined}
        onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
        onDropCapture={(event) => void drop(event)}
        onPasteCapture={(event) => void paste(event)}
      />
    </div>
    {displayMode === "reading" && <ReadingEditor markdown={markdown} wrapCodeBlocks={wrapCodeBlocks}
      attachmentUrls={attachmentUrls} onWikiLink={onWikiLink}
      onSelectionChange={(selection) => editorRef.current?.setSelection(selection)} />}
    </>
  );
});

function imageFileFromTransfer(transfer: Pick<DataTransfer, "files" | "items">): File | null {
  const file = Array.from(transfer.files).find((entry) => entry.type.startsWith("image/"));
  if (file) return file;
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const entry = item.getAsFile();
    if (entry) return entry;
  }
  return null;
}

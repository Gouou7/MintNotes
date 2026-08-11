import {
  forwardRef,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  useImperativeHandle,
  useEffect,
  useRef
} from "react";
import { createRoot } from "react-dom/client";
import { createEditor, type Editor as EditorController } from "./core/lib";
import "./core/styles/widgets.css";
import "./core/styles/theme-typora.css";
import { createCalloutExtension } from "./extensions/callout";
import { createMathExtension } from "./extensions/math";
import { createMermaidExtension } from "./extensions/mermaid";
import { createWikiLinkExtension } from "./extensions/wikilink";
import { I18nProvider, useI18n } from "../i18n";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter, replaceFrontmatterBody } from "./frontmatter";
import { canonicalizeMathBlocksFromLive, materializeMathBlocksForLive } from "./liveMathCodec";
import { ReadOnlyMarkdown } from "./ReadOnlyMarkdown";
import { renderMathInto, renderMermaidInto } from "./richRenderers";

interface Props {
  markdown: string;
  mode: "live" | "source";
  onChange: (markdown: string) => void;
  attachmentUrls?: Map<string, string>;
  attachmentsPending?: boolean;
  onImageInsert?: (file: File) => Promise<string | null>;
  onWikiLink?: (target: string) => void;
  emptyHint?: string;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  getSelectionOffset: () => number;
  setSelectionOffset: (offset: number) => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(props, ref) {
  if (props.mode === "source") return <SourceEditor {...props} ref={ref} />;
  return <LiveEditor {...props} ref={ref} />;
});

const SourceEditor = forwardRef<MarkdownEditorHandle, Props>(function SourceEditor({ markdown, onChange, onImageInsert }, ref) {
  const { t } = useI18n();
  const textarea = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    getSelectionOffset: () => textarea.current?.selectionStart ?? markdown.length,
    setSelectionOffset: (offset) => {
      const target = textarea.current;
      if (target) target.setSelectionRange(offset, offset);
    }
  }), [markdown.length]);
  const insertImage = async (file: File, start: number, end: number) => {
    if (!onImageInsert) return;
    const insertion = await onImageInsert(file);
    if (insertion === null) return;
    const currentMarkdown = textarea.current?.value ?? markdown;
    onChange(currentMarkdown.slice(0, start) + insertion + currentMarkdown.slice(end));
  };
  const drop = async (event: DragEvent<HTMLTextAreaElement>) => {
    const file = imageFileFromTransfer(event.dataTransfer);
    if (!file || !onImageInsert) return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart ?? markdown.length;
    const end = event.currentTarget.selectionEnd ?? start;
    await insertImage(file, start, end);
  };
  const paste = async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const file = imageFileFromTransfer(event.clipboardData);
    if (!file || !onImageInsert) return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart ?? markdown.length;
    const end = event.currentTarget.selectionEnd ?? start;
    await insertImage(file, start, end);
  };
  return (
    <textarea
      ref={textarea}
      className="source-editor"
      value={markdown}
      onChange={(event) => onChange(event.target.value)}
      onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
      onDrop={(event) => void drop(event)}
      onPaste={(event) => void paste(event)}
      aria-label={t("app.markdownSource")}
      placeholder={t("app.emptyNoteHint")}
      spellCheck={false}
      autoFocus
    />
  );
});

const LiveEditor = forwardRef<MarkdownEditorHandle, Props>(function LiveEditor({ markdown, onChange, attachmentUrls = new Map(), attachmentsPending = false, onImageInsert, onWikiLink, emptyHint }, ref) {
  const frontmatter = parseFrontmatter(markdown);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorController | null>(null);
  const changeRef = useRef(onChange);
  const attachmentUrlHistoryRef = useRef(new Map<string, string>());
  const attachmentUrlsRef = useRef(attachmentUrls);
  const attachmentsPendingRef = useRef(attachmentsPending);
  const frontmatterRef = useRef(frontmatter);
  const editorMarkdownRef = useRef(markdown);
  const renderedMarkdownRef = useRef(materializeLiveMarkdown(frontmatter.body));
  const wikiLinkRef = useRef(onWikiLink);
  changeRef.current = onChange;
  attachmentUrlsRef.current = attachmentUrls;
  attachmentsPendingRef.current = attachmentsPending;
  frontmatterRef.current = frontmatter;
  wikiLinkRef.current = onWikiLink;
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getSelectionOffset: () => editorRef.current?.getSelectionOffset() ?? editorMarkdownRef.current.length,
    setSelectionOffset: (offset) => editorRef.current?.setSelectionOffset(offset)
  }), []);
  for (const [attachmentId, url] of attachmentUrls) attachmentUrlHistoryRef.current.set(url, attachmentId);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createEditor(hostRef.current, {
      initialContent: renderedMarkdownRef.current,
      extensions: [
        createCalloutExtension({
          renderBlockquotePreview: (container, source) => {
            const root = createRoot(container);
            root.render(
              <I18nProvider>
                <ReadOnlyMarkdown
                  markdown={source}
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
        const canonicalizedLiveBody = canonicalizeMathBlocksFromLive(next);
        let canonicalBody = canonicalizedLiveBody;
        for (const [url, attachmentId] of attachmentUrlHistoryRef.current) {
          canonicalBody = canonicalBody.split(url).join(`webmd-attachment:${attachmentId}`);
        }
        const canonical = replaceFrontmatterBody(frontmatterRef.current, canonicalBody);
        const previousMarkdown = editorMarkdownRef.current;
        renderedMarkdownRef.current = materializeLiveSyntax(canonicalizedLiveBody);
        if (canonical === previousMarkdown) return;
        editorMarkdownRef.current = canonical;
        changeRef.current(canonical);
      }
    });
    editorRef.current = editor;
    editor.focus();
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
    const renderedMarkdown = materializeLiveMarkdown(frontmatter.body);
    editorMarkdownRef.current = markdown;
    renderedMarkdownRef.current = renderedMarkdown;
    editorRef.current.setMarkdown(renderedMarkdown);
  }, [markdown, frontmatter.body]);

  useEffect(() => {
    editorRef.current?.refreshPresentation?.();
  }, [attachmentUrls, attachmentsPending]);

  const drop = async (event: DragEvent<HTMLDivElement>) => {
    const file = imageFileFromTransfer(event.dataTransfer);
    if (!file || !onImageInsert || !editorRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const offset = editorRef.current.getMarkdownOffsetAtPoint(event.clientX, event.clientY);
    const insertion = await onImageInsert(file);
    if (insertion === null) return;
    editorRef.current?.insertMarkdown(insertion, offset);
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
    editorMarkdownRef.current = next;
    frontmatterRef.current = parseFrontmatter(next);
    changeRef.current(next);
  };

  return (
    <div className="live-editor-document">
      {frontmatter.status !== "absent" && <FrontmatterProperties markdown={markdown} editable onChange={changeProperties} />}
      <div
        ref={hostRef}
        className={`markdown-editor-host${emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? " is-empty" : ""}`}
        data-empty-hint={emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? emptyHint : undefined}
        onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
        onDrop={(event) => void drop(event)}
        onPaste={(event) => void paste(event)}
      />
    </div>
  );
});

function materializeLiveMarkdown(markdown: string): string {
  return materializeLiveSyntax(markdown);
}

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

function materializeLiveSyntax(markdown: string): string {
  return materializeMathBlocksForLive(markdown);
}

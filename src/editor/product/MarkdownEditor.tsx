import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useI18n } from "../../i18n";
import type { WorkspaceEditorMode } from "../../types";
import { createMintEditor, type Editor } from "../engine";
import { editorPresentation } from "./controls";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter } from "./frontmatter";
import { editorScrollViewport } from "./scrollViewport";
import { useImageReconnectRetry } from "./useImageReconnectRetry";
import "../../../.generated/typora-web/src/styles/widgets.css";
import "../../../.generated/typora-web/src/styles/theme-typora.css";
import "./typora-overrides.css";

interface Props {
  documentKey?: string;
  markdown: string;
  mode: WorkspaceEditorMode;
  onChange: (markdown: string, documentKey?: string) => void;
  onModeChange?: (mode: WorkspaceEditorMode) => void;
  attachmentUrls?: Map<string, string>;
  attachmentsPending?: boolean;
  onImageInsert?: (file: File) => Promise<string | null>;
  onInsertionCancelled?: () => void;
  onWikiLink?: (target: string) => void;
  emptyHint?: string;
  wrapCodeBlocks?: boolean;
}
export interface MarkdownEditorHandle { focus(): void; getSelectionOffset(): number; setSelectionOffset(offset: number): void }

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(props, ref) {
  const { t } = useI18n();
  const current = useRef({ ...props, t }); current.current = { ...props, t };
  const host = useRef<HTMLDivElement>(null), editor = useRef<Editor | null>(null);
  const identity = useRef(props.documentKey ?? "note"), shown = useRef(props.markdown);
  const [displayMode, setDisplayMode] = useState(props.mode);
  useImageReconnectRetry(host);
  useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus(), getSelectionOffset: () => editor.current?.getSelectionOffset() ?? 0, setSelectionOffset: offset => editor.current?.setSelectionOffset(offset) }), []);
  useEffect(() => {
    if (!host.current) return;
    const instance = createMintEditor(host.current, {
      ...editorPresentation(() => current.current.t), initialContent: current.current.markdown, documentKey: identity.current,
      readOnly: current.current.mode === "reading",
      getScrollViewport: () => { const area = host.current?.closest<HTMLElement>(".editor-area"); return area ? editorScrollViewport(area) : null; },
      resolveImageSource: source => { const id = /^webmd-attachment:([0-9a-f-]{36})$/i.exec(source)?.[1].toLowerCase(); return id ? current.current.attachmentUrls?.get(id) ?? (current.current.attachmentsPending ? null : undefined) : undefined; },
      onNavigate: target => current.current.onWikiLink?.(target),
      onChange: (text, key) => { if (identity.current === key) shown.current = text; current.current.onChange(text, key); },
      onModeChange: mode => { setDisplayMode(mode); current.current.onModeChange?.(mode); },
    });
    editor.current = instance; instance.setMode(current.current.mode);
    return () => { editor.current = null; instance.destroy(); };
  }, []);
  useEffect(() => {
    const key = props.documentKey ?? "note";
    if (key !== identity.current || shown.current !== props.markdown) {
      identity.current = key; shown.current = props.markdown; editor.current?.loadDocument(key, props.markdown);
    }
  }, [props.markdown, props.documentKey]);
  useEffect(() => { editor.current?.setMode(props.mode); }, [props.mode]);
  useEffect(() => { editor.current?.refreshPresentation(); }, [props.attachmentUrls, props.attachmentsPending, t]);
  const insertImage = async (event: ClipboardEvent<HTMLDivElement> | DragEvent<HTMLDivElement>) => {
    const transfer = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
    const file = imageFileFromTransfer(transfer), instance = editor.current;
    if (!file || !props.onImageInsert || !instance || displayMode === "reading") return;
    event.preventDefault(); event.stopPropagation();
    const bookmark = "clientX" in event && displayMode !== "source" ? instance.createInsertionBookmarkAtPoint(event.clientX, event.clientY) : instance.createInsertionBookmark();
    const key = identity.current;
    try {
      const text = await props.onImageInsert(file);
      if (text !== null && (editor.current !== instance || identity.current !== key || !bookmark.insert(text))) current.current.onInsertionCancelled?.();
    } finally { bookmark.dispose(); }
  };
  const frontmatter = parseFrontmatter(props.markdown);
  return <div className={`live-editor-document mode-${displayMode}${displayMode === "reading" ? " reading-editor" : ""}${props.wrapCodeBlocks !== false ? " wrap-code-blocks" : ""}`}>
    {displayMode !== "source" && <FrontmatterProperties markdown={props.markdown} editable={displayMode !== "reading"} onChange={next => editor.current?.replaceMarkdown(next)} />}
    <div ref={host} className={`markdown-editor-host${props.emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? " is-empty" : ""}`} data-empty-hint={props.emptyHint}
      onDragOver={event => { if (displayMode !== "reading" && Array.from(event.dataTransfer.items).some(item => item.kind === "file")) event.preventDefault(); }}
      onDropCapture={event => void insertImage(event)} onPasteCapture={event => void insertImage(event)} />
  </div>;
});
function imageFileFromTransfer(transfer: Pick<DataTransfer, "files" | "items">): File | null {
  return Array.from(transfer.files).find(file => file.type.startsWith("image/"))
    ?? Array.from(transfer.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile() ?? null;
}

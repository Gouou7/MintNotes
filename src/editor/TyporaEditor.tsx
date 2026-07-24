import { type DragEvent, useEffect, useRef } from "react";
import { createEditor, type TyporaWebEditor } from "typora-web";
import "typora-web/widgets.css";
import "typora-web/theme-typora.css";
import { materializeAttachmentUrls } from "../features/attachmentFormat";
import { useI18n } from "../i18n";

interface Props {
  markdown: string;
  mode: "live" | "source";
  onChange: (markdown: string) => void;
  attachmentUrls?: Map<string, string>;
  onImageDrop?: (file: File, markdownOffset: number) => Promise<string>;
}

export function TyporaEditor(props: Props) {
  if (props.mode === "source") return <SourceEditor {...props} />;
  return <LiveEditor {...props} />;
}

function SourceEditor({ markdown, onChange, onImageDrop }: Props) {
  const { t } = useI18n();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const drop = async (event: DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
    if (!file || !onImageDrop) return;
    event.preventDefault();
    const offset = event.currentTarget.selectionStart ?? markdown.length;
    const insertion = await onImageDrop(file, offset);
    onChange(markdown.slice(0, offset) + insertion + markdown.slice(event.currentTarget.selectionEnd ?? offset));
  };
  return (
    <textarea
      ref={textarea}
      className="source-editor"
      value={markdown}
      onChange={(event) => onChange(event.target.value)}
      onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
      onDrop={(event) => void drop(event)}
      aria-label={t("app.markdownSource")}
      spellCheck={false}
      autoFocus
    />
  );
}

function LiveEditor({ markdown, onChange, attachmentUrls = new Map(), onImageDrop }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TyporaWebEditor | null>(null);
  const changeRef = useRef(onChange);
  const attachmentUrlHistoryRef = useRef(new Map<string, string>());
  const editorMarkdownRef = useRef(markdown);
  const renderedMarkdownRef = useRef(materializeAttachmentUrls(markdown, attachmentUrls));
  changeRef.current = onChange;
  for (const [attachmentId, url] of attachmentUrls) attachmentUrlHistoryRef.current.set(url, attachmentId);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createEditor(hostRef.current, {
      initialContent: renderedMarkdownRef.current,
      onChange: (next) => {
        let canonical = next;
        for (const [url, attachmentId] of attachmentUrlHistoryRef.current) {
          canonical = canonical.split(url).join(`webmd-attachment:${attachmentId}`);
        }
        renderedMarkdownRef.current = next;
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
    const renderedMarkdown = materializeAttachmentUrls(markdown, attachmentUrls);
    if (markdown === editorMarkdownRef.current && renderedMarkdown === renderedMarkdownRef.current) return;
    editorMarkdownRef.current = markdown;
    renderedMarkdownRef.current = renderedMarkdown;
    editorRef.current.setMarkdown(renderedMarkdown);
  }, [markdown, attachmentUrls]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resolveImages = () => {
      for (const image of host.querySelectorAll<HTMLImageElement>("img")) {
        const source = image.dataset.webmdAttachment ?? image.getAttribute("src") ?? "";
        const match = /^webmd-attachment:([0-9a-f-]{36})$/i.exec(source);
        const materializedId = match ? null : [...attachmentUrls].find(([, url]) => url === source)?.[0];
        const attachmentId = match?.[1].toLowerCase() ?? materializedId;
        if (!attachmentId) continue;
        image.dataset.webmdAttachment = `webmd-attachment:${attachmentId}`;
        const resolved = attachmentUrls.get(attachmentId);
        if (resolved && image.getAttribute("src") !== resolved) image.src = resolved;
        else if (!resolved && image.hasAttribute("src")) image.removeAttribute("src");
      }
    };
    resolveImages();
    const observer = new MutationObserver(resolveImages);
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    return () => observer.disconnect();
  }, [attachmentUrls]);

  const drop = async (event: DragEvent<HTMLDivElement>) => {
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
    if (!file || !onImageDrop || !editorRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const offset = editorRef.current.getMarkdownOffsetAtPoint(event.clientX, event.clientY);
    const insertion = await onImageDrop(file, offset);
    editorRef.current?.insertMarkdown(insertion, offset);
  };

  return (
    <div
      ref={hostRef}
      className="typora-host"
      onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
      onDrop={(event) => void drop(event)}
    />
  );
}

import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { createEditor, type TyporaWebEditor } from "typora-web";
import "typora-web/widgets.css";
import "typora-web/theme-typora.css";
import { materializeAttachmentUrls } from "../features/attachmentFormat";
import { useI18n } from "../i18n";
import { CalloutHeader } from "./Callout";
import {
  canonicalizeCalloutsFromLive,
  materializeCalloutsForLive,
  parseCalloutMarker,
  removeCalloutAtIndex,
  type CalloutKind
} from "./callouts";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter, replaceFrontmatterBody } from "./frontmatter";

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
  const frontmatter = parseFrontmatter(markdown);
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TyporaWebEditor | null>(null);
  const changeRef = useRef(onChange);
  const attachmentUrlHistoryRef = useRef(new Map<string, string>());
  const frontmatterRef = useRef(frontmatter);
  const editorMarkdownRef = useRef(markdown);
  const renderedMarkdownRef = useRef(materializeLiveMarkdown(frontmatter.body, attachmentUrls));
  const [calloutOverlays, setCalloutOverlays] = useState<LiveCalloutOverlay[]>([]);
  changeRef.current = onChange;
  frontmatterRef.current = frontmatter;
  for (const [attachmentId, url] of attachmentUrls) attachmentUrlHistoryRef.current.set(url, attachmentId);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createEditor(hostRef.current, {
      initialContent: renderedMarkdownRef.current,
      onChange: (next) => {
        const canonicalizedLiveBody = canonicalizeCalloutsFromLive(next);
        let canonicalBody = canonicalizedLiveBody;
        for (const [url, attachmentId] of attachmentUrlHistoryRef.current) {
          canonicalBody = canonicalBody.split(url).join(`webmd-attachment:${attachmentId}`);
        }
        const canonical = replaceFrontmatterBody(frontmatterRef.current, canonicalBody);
        const previousMarkdown = editorMarkdownRef.current;
        // Track the reversible live representation rather than typora-web's
        // serializer output, which omits a trailing empty callout paragraph.
        renderedMarkdownRef.current = materializeCalloutsForLive(canonicalizedLiveBody);
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
    const renderedMarkdown = materializeLiveMarkdown(frontmatter.body, attachmentUrls);
    if (markdown === editorMarkdownRef.current && renderedMarkdown === renderedMarkdownRef.current) return;
    editorMarkdownRef.current = markdown;
    renderedMarkdownRef.current = renderedMarkdown;
    editorRef.current.setMarkdown(renderedMarkdown);
  }, [markdown, attachmentUrls, frontmatter.body]);

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

  useEffect(() => {
    const host = hostRef.current;
    const shell = shellRef.current;
    if (!host || !shell) return;
    let frame = 0;

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const shellRect = shell.getBoundingClientRect();
        const overlays: LiveCalloutOverlay[] = [];
        const selectionAnchor = document.getSelection()?.anchorNode ?? null;
        let index = 0;
        for (const blockquote of host.querySelectorAll<HTMLElement>("blockquote")) {
          const firstParagraph = blockquote.firstElementChild instanceof HTMLParagraphElement
            ? blockquote.firstElementChild
            : null;
          const firstLine = firstParagraph?.textContent?.split(/\r?\n/, 1)[0] ?? "";
          const marker = parseCalloutMarker(firstLine);
          if (!marker || !firstParagraph) continue;

          const rect = blockquote.getBoundingClientRect();
          const editingMarker = Boolean(selectionAnchor && firstParagraph.contains(selectionAnchor));
          overlays.push({
            key: `${index++}:${marker.rawType}:${marker.title}`,
            kind: marker.kind,
            title: marker.title,
            editingMarker,
            style: {
              top: rect.top - shellRect.top,
              left: rect.left - shellRect.left,
              width: rect.width,
              height: rect.height
            }
          });
        }
        setCalloutOverlays((current) => overlaysEqual(current, overlays) ? current : overlays);
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    resizeObserver?.observe(host);
    document.addEventListener("selectionchange", sync);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const drop = async (event: DragEvent<HTMLDivElement>) => {
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
    if (!file || !onImageDrop || !editorRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const offset = editorRef.current.getMarkdownOffsetAtPoint(event.clientX, event.clientY);
    const insertion = await onImageDrop(file, offset);
    editorRef.current?.insertMarkdown(insertion, offset);
  };

  const deleteEmptyCallout = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      (event.key !== "Backspace" && event.key !== "Delete")
      || event.nativeEvent.isComposing
      || !editorRef.current
    ) return;

    const host = hostRef.current;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const blockquote = anchorElement?.closest("blockquote");
    if (!host || !selection?.isCollapsed || !anchorElement || !blockquote || !host.contains(blockquote)) return;

    const markerParagraph = blockquote.firstElementChild instanceof HTMLParagraphElement
      ? blockquote.firstElementChild
      : null;
    const markerLine = markerParagraph?.textContent?.split(/\r?\n/, 1)[0] ?? "";
    if (!parseCalloutMarker(markerLine)) return;

    const bodyElements = Array.from(blockquote.children).slice(1) as HTMLElement[];
    if (!bodyElements.some((element) => element === anchorElement || element.contains(anchorElement))) return;
    const hasStructuredBody = bodyElements.some((element) => (
      element.matches("blockquote, hr, ol, pre, table, ul")
      || Boolean(element.querySelector("blockquote, hr, img, ol, pre, table, ul"))
    ));
    const bodyText = bodyElements.map((element) => element.textContent ?? "").join("");
    if (hasStructuredBody || bodyText.replace(/[\s\u00a0\u2060]/g, "")) return;

    const liveCallouts = Array.from(host.querySelectorAll<HTMLElement>("blockquote")).filter((candidate) => {
      const paragraph = candidate.firstElementChild instanceof HTMLParagraphElement
        ? candidate.firstElementChild
        : null;
      const firstLine = paragraph?.textContent?.split(/\r?\n/, 1)[0] ?? "";
      return Boolean(parseCalloutMarker(firstLine));
    });
    const calloutIndex = liveCallouts.indexOf(blockquote as HTMLElement);
    const removed = removeCalloutAtIndex(frontmatterRef.current.body, calloutIndex);
    if (!removed) return;

    event.preventDefault();
    event.stopPropagation();
    const nextRendered = materializeLiveMarkdown(removed.markdown, attachmentUrls);
    const renderedOffset = materializeLiveMarkdown(removed.markdown.slice(0, removed.offset), attachmentUrls).length;

    editorRef.current.replaceMarkdown(nextRendered, renderedOffset);
  };

  const changeProperties = (next: string) => {
    if (next === editorMarkdownRef.current) return;
    editorMarkdownRef.current = next;
    frontmatterRef.current = parseFrontmatter(next);
    changeRef.current(next);
  };

  return (
    <div ref={shellRef} className="live-editor-document">
      {frontmatter.status !== "absent" && <FrontmatterProperties markdown={markdown} editable onChange={changeProperties} />}
      <div
        ref={hostRef}
        className="typora-host"
        onKeyDownCapture={deleteEmptyCallout}
        onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
        onDrop={(event) => void drop(event)}
      />
      <div className="live-callout-overlays">
        {calloutOverlays.map((overlay) => <div className="live-callout-overlay-group" key={overlay.key}>
          <div className={`live-callout-surface callout-${overlay.kind}`} style={overlay.style} aria-hidden="true" />
          <div
            className={`live-callout-overlay callout-${overlay.kind}${overlay.editingMarker ? " is-marker-editing" : ""}`}
            style={overlay.style}
            role="note"
            aria-label={overlay.title}
          >
            <CalloutHeader kind={overlay.kind} title={overlay.title} />
          </div>
        </div>)}
      </div>
    </div>
  );
}

interface LiveCalloutOverlay {
  key: string;
  kind: CalloutKind;
  title: string;
  editingMarker: boolean;
  style: CSSProperties;
}

function materializeLiveMarkdown(markdown: string, attachmentUrls: Map<string, string>): string {
  return materializeCalloutsForLive(materializeAttachmentUrls(markdown, attachmentUrls));
}

function overlaysEqual(left: LiveCalloutOverlay[], right: LiveCalloutOverlay[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.key === other?.key
      && entry.kind === other.kind
      && entry.title === other.title
      && entry.editingMarker === other.editingMarker
      && entry.style.top === other.style.top
      && entry.style.left === other.style.left
      && entry.style.width === other.style.width
      && entry.style.height === other.style.height;
  });
}

import {
  forwardRef,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useImperativeHandle,
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
  calloutTitleSourceRange,
  canonicalizeCalloutsFromLive,
  collapseEmptyCalloutBodyForMarkerEdit,
  materializeCalloutsForLive,
  parseCalloutMarker,
  type CalloutColor,
  type CalloutIcon,
  type CalloutKind
} from "./callouts";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter, replaceFrontmatterBody } from "./frontmatter";
import { canonicalizeMathBlocksFromLive, materializeMathBlocksForLive } from "./liveMathCodec";
import { renderMathInto, renderMermaidInto } from "./richRenderers";

interface Props {
  markdown: string;
  mode: "live" | "source";
  onChange: (markdown: string) => void;
  attachmentUrls?: Map<string, string>;
  onImageInsert?: (file: File) => Promise<string | null>;
  onWikiLink?: (target: string) => void;
  emptyHint?: string;
}

export interface TyporaEditorHandle {
  focus: () => void;
}

export const TyporaEditor = forwardRef<TyporaEditorHandle, Props>(function TyporaEditor(props, ref) {
  if (props.mode === "source") return <SourceEditor {...props} ref={ref} />;
  return <LiveEditor {...props} ref={ref} />;
});

const SourceEditor = forwardRef<TyporaEditorHandle, Props>(function SourceEditor({ markdown, onChange, onImageInsert }, ref) {
  const { t } = useI18n();
  const textarea = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);
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

const LiveEditor = forwardRef<TyporaEditorHandle, Props>(function LiveEditor({ markdown, onChange, attachmentUrls = new Map(), onImageInsert, onWikiLink, emptyHint }, ref) {
  const frontmatter = parseFrontmatter(markdown);
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TyporaWebEditor | null>(null);
  const changeRef = useRef(onChange);
  const attachmentUrlHistoryRef = useRef(new Map<string, string>());
  const frontmatterRef = useRef(frontmatter);
  const editorMarkdownRef = useRef(markdown);
  const renderedMarkdownRef = useRef(materializeLiveMarkdown(frontmatter.body, attachmentUrls));
  const wikiLinkRef = useRef(onWikiLink);
  const [calloutOverlays, setCalloutOverlays] = useState<LiveCalloutOverlay[]>([]);
  changeRef.current = onChange;
  frontmatterRef.current = frontmatter;
  wikiLinkRef.current = onWikiLink;
  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus() }), []);
  for (const [attachmentId, url] of attachmentUrls) attachmentUrlHistoryRef.current.set(url, attachmentId);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createEditor(hostRef.current, {
      initialContent: renderedMarkdownRef.current,
      liveSyntax: {
        renderMath: (container, source) => renderMathInto(container, source),
        renderMathBlock: (container, source) => renderMathInto(container, source, true),
        renderMermaid: renderMermaidInto,
        onWikiLink: (target) => wikiLinkRef.current?.(target)
      },
      onChange: (next) => {
        const canonicalizedLiveBody = canonicalizeCalloutsFromLive(canonicalizeMathBlocksFromLive(next));
        let canonicalBody = canonicalizedLiveBody;
        for (const [url, attachmentId] of attachmentUrlHistoryRef.current) {
          canonicalBody = canonicalBody.split(url).join(`webmd-attachment:${attachmentId}`);
        }
        const canonical = replaceFrontmatterBody(frontmatterRef.current, canonicalBody);
        const previousMarkdown = editorMarkdownRef.current;
        // Track the reversible live representation rather than typora-web's
        // serializer output, which omits a trailing empty callout paragraph.
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
          const calloutIndex = index++;
          overlays.push({
            key: `${calloutIndex}:${marker.rawType}:${marker.title}`,
            calloutIndex,
            kind: marker.kind,
            title: marker.title,
            markerText: firstLine,
            color: marker.color,
            icon: marker.icon,
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

  const focusCalloutMarker = (
    event: ReactPointerEvent<HTMLDivElement>,
    overlay: LiveCalloutOverlay
  ) => {
    if (!editorRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    let markerOffset = overlay.markerText.length;
    const target = event.target instanceof Element ? event.target.closest("strong") : null;
    const titleRange = target && event.currentTarget.contains(target)
      ? calloutTitleSourceRange(overlay.markerText)
      : null;
    if (target && titleRange) {
      const titleOffset = textOffsetAtPoint(target, event.clientX, event.clientY);
      markerOffset = Math.min(titleRange.end, titleRange.start + titleOffset);
    }
    editorRef.current.focusCalloutMarker(overlay.calloutIndex, markerOffset);
  };

  const editEmptyCalloutMarker = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Backspace"
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
    const renderedMarkdown = materializeLiveMarkdown(frontmatterRef.current.body, attachmentUrls);
    const collapsed = collapseEmptyCalloutBodyForMarkerEdit(renderedMarkdown, calloutIndex);
    if (!collapsed) return;

    event.preventDefault();
    event.stopPropagation();
    editorRef.current.replaceMarkdown(collapsed.markdown, collapsed.offset);
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
        className={`typora-host${emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? " is-empty" : ""}`}
        data-empty-hint={emptyHint && frontmatter.status === "absent" && !frontmatter.body.trim() ? emptyHint : undefined}
        onKeyDownCapture={editEmptyCalloutMarker}
        onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault(); }}
        onDrop={(event) => void drop(event)}
        onPaste={(event) => void paste(event)}
      />
      <div className="live-callout-overlays">
        {calloutOverlays.map((overlay) => <div className="live-callout-overlay-group" key={overlay.key}>
          <div className={`live-callout-surface callout-${overlay.kind}${overlay.color ? ` callout-color-${overlay.color}` : ""}`} style={overlay.style} aria-hidden="true" />
          <div
            className={`live-callout-overlay callout-${overlay.kind}${overlay.color ? ` callout-color-${overlay.color}` : ""}${overlay.editingMarker ? " is-marker-editing" : ""}`}
            style={{ ...overlay.style, height: 50 }}
            role="note"
            aria-label={overlay.title}
            onPointerDown={(event) => focusCalloutMarker(event, overlay)}
          >
            <CalloutHeader kind={overlay.kind} title={overlay.title} icon={overlay.icon} />
          </div>
        </div>)}
      </div>
    </div>
  );
});

interface LiveCalloutOverlay {
  key: string;
  calloutIndex: number;
  kind: CalloutKind;
  title: string;
  markerText: string;
  color?: CalloutColor;
  icon?: CalloutIcon;
  editingMarker: boolean;
  style: CSSProperties;
}

function materializeLiveMarkdown(markdown: string, attachmentUrls: Map<string, string>): string {
  return materializeLiveSyntax(materializeAttachmentUrls(markdown, attachmentUrls));
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
  return materializeMathBlocksForLive(materializeCalloutsForLive(markdown));
}

function overlaysEqual(left: LiveCalloutOverlay[], right: LiveCalloutOverlay[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.key === other?.key
      && entry.calloutIndex === other.calloutIndex
      && entry.kind === other.kind
      && entry.title === other.title
      && entry.markerText === other.markerText
      && entry.color === other.color
      && entry.icon === other.icon
      && entry.editingMarker === other.editingMarker
      && entry.style.top === other.style.top
      && entry.style.left === other.style.left
      && entry.style.width === other.style.width
      && entry.style.height === other.style.height;
  });
}

function textOffsetAtPoint(element: Element, clientX: number, clientY: number): number {
  const ownerDocument = element.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caretPosition = ownerDocument.caretPositionFromPoint?.(clientX, clientY);
  const offsetNode = caretPosition?.offsetNode;
  const offset = caretPosition?.offset;
  if (offsetNode && offset !== undefined && element.contains(offsetNode)) {
    return textOffsetWithin(element, offsetNode, offset);
  }

  const caretRange = ownerDocument.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange && element.contains(caretRange.startContainer)) {
    return textOffsetWithin(element, caretRange.startContainer, caretRange.startOffset);
  }

  const rect = element.getBoundingClientRect();
  return clientX <= rect.left ? 0 : element.textContent?.length ?? 0;
}

function textOffsetWithin(element: Element, node: Node, offset: number): number {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

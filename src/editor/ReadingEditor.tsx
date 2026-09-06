import { ReadingSource, readingSelection, rehypeReadingSource, type ReadingReplacement } from "./reading-source";
import { Check, Copy } from "lucide-react";
import { Children, isValidElement, type CSSProperties, type HTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { AppIcon } from "../components/AppIcon";
import { useI18n } from "../i18n";
import { CalloutBlock } from "./Callout";
import {
  remarkCallouts,
  type CalloutColor,
  type CalloutFold,
  type CalloutIcon,
  type CalloutKind
} from "./callouts";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter } from "./frontmatter";
import { materializeSingleLineDisplayMathForReading } from "./liveMathCodec";
import { materializeInlineFootnotesForReading } from "./inlineFootnotes";
import { remarkReadingHighlight } from "./reading-highlight";
import { remarkReadingListSpacing } from "./reading-list-spacing";
import { commentSourceRanges } from "./extensions/comment";
import { displayCodeLanguage } from "./core/fenced-code-source";
import { navigateToDocumentFragment } from "./core/fragment-navigation";
import { MathFormula, MermaidDiagram } from "./richRenderers";
import { remarkWikiLinks } from "./wikilinks";

function renderedText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return renderedText(child.props.children);
    return "";
  }).join("");
}

function ReadingCodeBlock({
  children,
  language,
  ...props
}: HTMLAttributes<HTMLPreElement> & { language?: string }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  const label = copyState === "copied"
    ? t("editor.codeCopied")
    : copyState === "failed"
      ? t("editor.codeCopyFailed")
      : t("editor.copyCode");

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copyCode = async () => {
    window.clearTimeout(resetTimer.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(renderedText(children));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <div className="reading-code-block">
      <pre {...props}>{children}</pre>
      <div className="reading-code-actions">
        {language && <span className="reading-code-language">{displayCodeLanguage(language)}</span>}
        <button
          type="button"
          className="reading-code-copy"
          data-copy-state={copyState}
          aria-label={label}
          title={label}
          onClick={() => void copyCode()}
        >
          <AppIcon icon={copyState === "copied" ? Check : Copy} size={15} />
          <span className="sr-only" aria-live="polite">{copyState === "idle" ? "" : label}</span>
        </button>
      </div>
    </div>
  );
}

export function ReadingEditor({
  markdown,
  wrapCodeBlocks = true,
  attachmentUrls = new Map(),
  onWikiLink,
  onSelectionChange
}: {
  markdown: string;
  wrapCodeBlocks?: boolean;
  attachmentUrls?: Map<string, string>;
  onWikiLink?: (target: string) => void;
  onSelectionChange?: (selection: { anchor: number; head: number }) => void;
}) {
  const [sourceFallback, setSourceFallback] = useState(false);
  useEffect(() => setSourceFallback(false), [markdown]);
  const { t } = useI18n();
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const footnoteLabelId = `mint-footnote-${renderId}-label`;
  const articleRef = useRef<HTMLElement>(null);
  const allowedAttachmentUrls = new Set(attachmentUrls.values());
  const frontmatter = parseFrontmatter(markdown);
  let projection = ReadingSource.authored(frontmatter.body, markdown.length - frontmatter.body.length);
  projection = projection.replace(commentSourceRanges(projection.text).map((range) => ({
    ...range, pieces: [],
  })));
  const mathReplacements: ReadingReplacement[] = [];
  materializeSingleLineDisplayMathForReading(projection.text, mathReplacements);
  projection = projection.replace(mathReplacements);
  const footnoteReplacements: ReadingReplacement[] = [];
  materializeInlineFootnotesForReading(projection.text, footnoteReplacements);
  projection = projection.replace(footnoteReplacements);
  const renderedMarkdown = projection.text;
  const rememberSelection = () => {
    const selected = articleRef.current && readingSelection(articleRef.current);
    if (selected) onSelectionChange?.(selected);
  };

  return (
    <article ref={articleRef} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onCopy={(event) => {
      const selected = articleRef.current && readingSelection(articleRef.current);
      if (!selected) {
        const native = articleRef.current?.ownerDocument.getSelection();
        if (native && !native.isCollapsed && articleRef.current?.contains(native.anchorNode)) {
          event.preventDefault();
          setSourceFallback(true);
        }
        return;
      }
      event.clipboardData.setData("text/plain", markdown.slice(Math.min(selected.anchor, selected.head), Math.max(selected.anchor, selected.head)));
      event.preventDefault();
    }} className={`reading-editor${wrapCodeBlocks ? " wrap-code-blocks" : ""}`}>
      {sourceFallback ? <pre className="reading-source-fallback"><span
        data-source-offsets={Array.from({ length: markdown.length + 1 }, (_, i) => i).join(",")}
        data-source-ends={Array.from({ length: markdown.length + 1 }, (_, i) => i).join(",")}
      >{markdown}</span></pre> : <><FrontmatterProperties markdown={markdown} />
      <ReactMarkdown
        remarkPlugins={[
          remarkMath,
          remarkGfm,
          remarkReadingHighlight,
          remarkCallouts,
          remarkWikiLinks,
          remarkReadingListSpacing,
        ]}
        rehypePlugins={[[rehypeReadingSource, { projection }]]}
        skipHtml
        remarkRehypeOptions={{ clobberPrefix: `mint-footnote-${renderId}-` }}
        urlTransform={(url, key, node) => (
          key === "href" && url.startsWith("mint-wikilink:")
            ? url
            :
          key === "src" && node.tagName === "img" && (allowedAttachmentUrls.has(url) || url.startsWith("webmd-attachment:"))
            ? url
            : defaultUrlTransform(url)
        )}
        components={{
          h2: ({ node: _node, id, children, ...props }) => (
            <h2 {...props} id={id === "footnote-label" ? footnoteLabelId : id}>{children}</h2>
          ),
          li: ({ node, children, style, ...props }) => {
            const properties = node?.properties ?? {};
            const footnoteDefinition = String(properties.id ?? "")
              .startsWith(`mint-footnote-${renderId}-fn-`);
            const blankRows = Number(
              properties["data-list-gap-before"] ?? properties.dataListGapBefore ?? 0,
            );
            const listStyle = Number.isInteger(blankRows) && blankRows > 0
              ? {
                  ...style,
                  "--markdown-list-gap-before": String(blankRows),
                } as CSSProperties
              : style;
            return <li
              {...props}
              style={listStyle}
              {...(footnoteDefinition ? {
                tabIndex: -1,
                "data-footnote-definition": "true",
              } : {})}
            >{children}</li>;
          },
          p: ({ node: _node, children, ...props }) => (
            <p {...props} className="markdown-softbreak-paragraph">{children}</p>
          ),
          blockquote: ({ node, children, ...props }) => {
            const properties = node?.properties ?? {};
            const kind = (properties["data-callout-kind"] ?? properties["dataCalloutKind"]) as CalloutKind | undefined;
            if (!kind) return <blockquote {...props} className="markdown-quote">{children}</blockquote>;
            return <CalloutBlock
              kind={kind}
              title={String(properties["data-callout-title"] ?? properties["dataCalloutTitle"] ?? "")}
              fold={String(properties["data-callout-fold"] ?? properties["dataCalloutFold"] ?? "") as CalloutFold}
              color={(properties["data-callout-color"] ?? properties["dataCalloutColor"]) as CalloutColor | undefined}
              icon={(properties["data-callout-icon"] ?? properties["dataCalloutIcon"]) as CalloutIcon | undefined}
            >{children}</CalloutBlock>;
          },
          pre: ({ node, children, ...props }) => {
            const child = node?.children[0];
            const properties = child && "properties" in child ? child.properties : undefined;
            const classNames = Array.isArray(properties?.className)
              ? properties.className.map(String)
              : [String(properties?.className ?? "")];
            const textChild = child && "children" in child ? child.children?.[0] : undefined;
            if (classNames.includes("math-display") && textChild && "value" in textChild) {
              return <div data-source-atomic="true" data-source-from={Number(node?.properties["data-source-from"])} data-source-to={Number(node?.properties["data-source-to"])}><MathFormula source={String(textChild.value ?? "")} displayMode /></div>;
            }
            if (classNames.includes("language-mermaid") && textChild && "value" in textChild) {
              return <div data-source-atomic="true" data-source-from={Number(node?.properties["data-source-from"])} data-source-to={Number(node?.properties["data-source-to"])}><MermaidDiagram source={String(textChild.value ?? "").replace(/\n$/, "")} /></div>;
            }
            const language = classNames
              .find((className) => className.startsWith("language-"))
              ?.slice("language-".length);
            return <ReadingCodeBlock {...props} language={language}>{children}</ReadingCodeBlock>;
          },
          code: ({ node: _node, className, children, ...props }) => {
            const classNames = className?.split(/\s+/) ?? [];
            return classNames.includes("math-inline")
              ? <span {...props} data-source-atomic="true"><MathFormula source={renderedText(children)} /></span>
              : <code {...props} className={className}>{children}</code>;
          },
          a: ({ node, href, children, ...props }) => {
            const properties = node?.properties ?? {};
            const target = String(properties["data-wikilink-target"] ?? properties["dataWikilinkTarget"] ?? "");
            if (target) {
              return <a
                {...props}
                href={href}
                className="wiki-link"
                onClick={(event) => {
                  event.preventDefault();
                  onWikiLink?.(target);
                }}
              >{children}</a>;
            }
            if (href?.startsWith("#")) {
              const footnoteReference = Boolean(
                properties["data-footnote-ref"] ?? properties.dataFootnoteRef,
              );
              return <a
                {...props}
                href={href}
                aria-describedby={footnoteReference ? footnoteLabelId : props["aria-describedby"]}
                onClick={(event) => {
                  const root = articleRef.current;
                  if (root && navigateToDocumentFragment(root, href)) event.preventDefault();
                }}
              >{children}</a>;
            }
            return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
          img: ({ node: _node, src, alt, ...props }) => {
            const attachment = /^webmd-attachment:([0-9a-f-]{36})$/i.exec(src ?? "");
            const displaySource = attachment ? attachmentUrls.get(attachment[1].toLowerCase()) : src;
            return displaySource
              ? <img {...props} src={displaySource} alt={alt ?? ""} />
              : <span className="attachment-placeholder">{t("app.attachmentNotLoaded", { name: alt ?? "" })}</span>;
          }
        }}
      >
        {renderedMarkdown}
      </ReactMarkdown></>}
    </article>
  );
}

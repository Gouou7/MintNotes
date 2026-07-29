import { Check, Copy } from "lucide-react";
import rehypeKatex from "rehype-katex";
import { Children, isValidElement, type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { AppIcon } from "../components/AppIcon";
import { materializeAttachmentUrls } from "../features/attachmentFormat";
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
import { MermaidDiagram } from "./richRenderers";
import { remarkWikiLinks } from "./wikilinks";

function renderedText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return renderedText(child.props.children);
    return "";
  }).join("");
}

function ReadOnlyCodeBlock({
  children,
  ...props
}: HTMLAttributes<HTMLPreElement>) {
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
    <div className="readonly-code-block">
      <pre {...props}>{children}</pre>
      <button
        type="button"
        className="readonly-code-copy"
        data-copy-state={copyState}
        aria-label={label}
        title={label}
        onClick={() => void copyCode()}
      >
        <AppIcon icon={copyState === "copied" ? Check : Copy} size={15} />
        <span className="sr-only" aria-live="polite">{copyState === "idle" ? "" : label}</span>
      </button>
    </div>
  );
}

export function ReadOnlyMarkdown({
  markdown,
  attachmentUrls = new Map(),
  onWikiLink
}: {
  markdown: string;
  attachmentUrls?: Map<string, string>;
  onWikiLink?: (target: string) => void;
}) {
  const { t } = useI18n();
  const allowedAttachmentUrls = new Set(attachmentUrls.values());
  const frontmatter = parseFrontmatter(markdown);
  const renderedMarkdown = materializeSingleLineDisplayMathForReading(
    materializeAttachmentUrls(frontmatter.body, attachmentUrls)
  );

  return (
    <article className="readonly-markdown">
      <FrontmatterProperties markdown={markdown} />
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm, remarkCallouts, remarkWikiLinks]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        urlTransform={(url, key, node) => (
          key === "href" && url.startsWith("mint-wikilink:")
            ? url
            :
          key === "src" && node.tagName === "img" && allowedAttachmentUrls.has(url)
            ? url
            : defaultUrlTransform(url)
        )}
        components={{
          blockquote: ({ node, children }) => {
            const properties = node?.properties ?? {};
            const kind = (properties["data-callout-kind"] ?? properties["dataCalloutKind"]) as CalloutKind | undefined;
            if (!kind) return <blockquote>{children}</blockquote>;
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
            if (classNames.includes("language-mermaid") && textChild && "value" in textChild) {
              return <MermaidDiagram source={String(textChild.value ?? "").replace(/\n$/, "")} />;
            }
            return <ReadOnlyCodeBlock {...props}>{children}</ReadOnlyCodeBlock>;
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
            return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
          img: ({ node: _node, src, alt, ...props }) => {
            return src
              ? <img {...props} src={src} alt={alt ?? ""} />
              : <span className="attachment-placeholder">{t("app.attachmentNotLoaded", { name: alt ?? "" })}</span>;
          }
        }}
      >
        {renderedMarkdown}
      </ReactMarkdown>
    </article>
  );
}

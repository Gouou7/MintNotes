import rehypeKatex from "rehype-katex";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
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
            return <pre {...props}>{children}</pre>;
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

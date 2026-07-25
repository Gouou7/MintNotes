import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { materializeAttachmentUrls } from "../features/attachmentFormat";
import { useI18n } from "../i18n";
import { CalloutBlock } from "./Callout";
import { remarkCallouts, type CalloutFold, type CalloutKind } from "./callouts";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { parseFrontmatter } from "./frontmatter";

export function ReadOnlyMarkdown({ markdown, attachmentUrls = new Map() }: { markdown: string; attachmentUrls?: Map<string, string> }) {
  const { t } = useI18n();
  const allowedAttachmentUrls = new Set(attachmentUrls.values());
  const frontmatter = parseFrontmatter(markdown);
  const renderedMarkdown = materializeAttachmentUrls(frontmatter.body, attachmentUrls);

  return (
    <article className="readonly-markdown">
      <FrontmatterProperties markdown={markdown} />
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        skipHtml
        urlTransform={(url, key, node) => (
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
            >{children}</CalloutBlock>;
          },
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
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

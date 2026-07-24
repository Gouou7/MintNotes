import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { materializeAttachmentUrls } from "../features/attachmentFormat";
import { useI18n } from "../i18n";

export function ReadOnlyMarkdown({ markdown, attachmentUrls = new Map() }: { markdown: string; attachmentUrls?: Map<string, string> }) {
  const { t } = useI18n();
  const allowedAttachmentUrls = new Set(attachmentUrls.values());
  const renderedMarkdown = materializeAttachmentUrls(markdown, attachmentUrls);

  return (
    <article className="readonly-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key, node) => (
          key === "src" && node.tagName === "img" && allowedAttachmentUrls.has(url)
            ? url
            : defaultUrlTransform(url)
        )}
        components={{
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

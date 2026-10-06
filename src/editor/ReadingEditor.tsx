import { MarkdownEditor } from "./MarkdownEditor";
export function ReadingEditor({ markdown, wrapCodeBlocks = true, attachmentUrls, onWikiLink }: {
  markdown: string; wrapCodeBlocks?: boolean; attachmentUrls?: Map<string, string>; onWikiLink?: (target: string) => void;
}) {
  return <MarkdownEditor markdown={markdown} mode="reading" onChange={() => {}} wrapCodeBlocks={wrapCodeBlocks} attachmentUrls={attachmentUrls} onWikiLink={onWikiLink} />;
}

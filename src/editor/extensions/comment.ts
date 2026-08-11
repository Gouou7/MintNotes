import type { EditorExtension, InlineSourcePresentation } from "../core/lib";

type CommentMatch = { kind: "comment" };

function commentPresentation(): InlineSourcePresentation<CommentMatch> {
  return {
    id: "mint-comment-inline",
    sourceClassName: "live-comment-source",
    widgetClassName: "live-comment-widget",
    find(source) {
      const matches = [];
      const pattern = /%%[\s\S]*?%%/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        matches.push({
          from: match.index,
          to: match.index + match[0].length,
          source: match[0],
          renderSource: "",
          key: match[0],
          data: { kind: "comment" as const },
        });
      }
      return matches;
    },
    render() {},
  };
}

export function createCommentExtension(): EditorExtension {
  return {
    id: "mint-comment",
    presentations: { inline: [commentPresentation()] },
  };
}

export function stripCommentsForReading(markdown: string): string {
  return markdown.replace(/%%[\s\S]*?%%/g, "");
}

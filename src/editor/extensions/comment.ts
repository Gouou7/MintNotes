import type { EditorExtension, InlineSourcePresentation } from "../core/lib";

type CommentMatch = { kind: "comment" };

/** Comments are recognized outside authored code and escaped delimiters. */
export function commentSourceRanges(source: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let fence: string | null = null;
  for (let index = 0; index < source.length;) {
    if (index === 0 || source[index - 1] === "\n" || source[index - 1] === "\r") {
      const line = /^[^\r\n]*/.exec(source.slice(index))![0];
      const marker = /^[\t >]*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.slice(line.indexOf(marker) + marker.length).trim()) fence = null;
        index += line.length + 1;
        continue;
      }
      if (marker) { fence = marker; index += line.length + 1; continue; }
    }
    if (source[index] === "\\") { index += 2; continue; }
    if (source[index] === "`") {
      const ticks = /^`+/.exec(source.slice(index))![0];
      let end = index + ticks.length;
      while ((end = source.indexOf(ticks, end)) >= 0) {
        if (source[end - 1] !== "`" && source[end + ticks.length] !== "`") break;
        end += ticks.length;
      }
      index = end >= 0 ? end + ticks.length : index + ticks.length;
      continue;
    }
    if (source.startsWith("%%", index)) {
      const end = source.indexOf("%%", index + 2);
      if (end >= 0) { ranges.push({ from: index, to: end + 2 }); index = end + 2; continue; }
    }
    index++;
  }
  return ranges;
}

function commentPresentation(): InlineSourcePresentation<CommentMatch> {
  return {
    id: "mint-comment-inline",
    sourceClassName: "live-comment-source",
    widgetClassName: "live-comment-widget",
    find(source) {
      return commentSourceRanges(source).map(({ from, to }) => ({
          from,
          to,
          source: source.slice(from, to),
          renderSource: "",
          key: source.slice(from, to),
          data: { kind: "comment" as const },
      }));
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
  let result = markdown;
  for (const range of commentSourceRanges(markdown).reverse()) result = result.slice(0, range.from) + result.slice(range.to);
  return result;
}

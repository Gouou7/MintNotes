export interface TextStatistics {
  words: number;
  characters: number;
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function countText(markdown: string): TextStatistics {
  let words = 0;
  for (const segment of wordSegmenter.segment(markdown)) {
    if (segment.isWordLike) words += 1;
  }
  let characters = 0;
  for (const segment of graphemeSegmenter.segment(markdown)) {
    if (!/^\s+$/u.test(segment.segment)) characters += 1;
  }
  return { words, characters };
}

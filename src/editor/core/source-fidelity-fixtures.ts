export const SOURCE_FIDELITY_STRINGS = [
  "",
  "\n",
  "\n\n",
  "\n\na",
  "a\n",
  "a\n\n",
  "a\n\n\n",
  "a\nb",
  "a\n\nb",
  "a\n\n\nb",
  "a\n \n\t\nb",
  " \t",
  " \n\t\n",
] as const;

export function withLineEndingVariants(source: string): string[] {
  if (!source.includes("\n")) return [source];
  const variants = [source, source.replaceAll("\n", "\r\n")];
  if (source.match(/\n/g)?.length && source.match(/\n/g)!.length > 1) {
    let index = 0;
    variants.push(source.replaceAll("\n", () => index++ % 2 === 0 ? "\r\n" : "\n"));
  }
  return [...new Set(variants)];
}

export const SOURCE_FIDELITY_LINE_ENDING_STRINGS = SOURCE_FIDELITY_STRINGS.flatMap(
  withLineEndingVariants,
);

export const INVALID_SOURCE_FIDELITY_STRINGS = [
  "#",
  "##  ",
  ">",
  "> [!",
  "> [!NOTE",
  "```",
  "````ts\nbody\n```",
  "| a | b\n| --- |",
  "[label](",
  "[label][missing]",
  "[TO",
  "---\nkey: [\n---\nbody",
] as const;

export function onlyChangedRange(
  before: string,
  after: string,
): { from: number; to: number; inserted: string } {
  let from = 0;
  const prefixLimit = Math.min(before.length, after.length);
  while (from < prefixLimit && before[from] === after[from]) from += 1;
  let suffix = 0;
  const suffixLimit = Math.min(before.length, after.length) - from;
  while (
    suffix < suffixLimit
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1;
  return {
    from,
    to: before.length - suffix,
    inserted: after.slice(from, after.length - suffix),
  };
}

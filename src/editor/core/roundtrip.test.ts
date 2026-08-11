import { describe, expect, it } from "vitest";

import { parse } from "./parser";
import { serialize } from "./serializer";
import { INVALID_SOURCE_FIDELITY_STRINGS } from "./source-fidelity-fixtures";

const upstreamRoundTripCases = [
  "hello world",
  "one\n\ntwo\n\nthree",
  "# h1\n\n## h2\n\n###### h6",
  "Heading 1\n===",
  "> quoted text",
  "> first\n>\n> second",
  "- a\n- b\n- c",
  "- [ ] todo\n- [x] done\n- plain",
  "5. a\n6. b",
  "- outer\n  - inner\n- next",
  "```ts\nconst x = 1;\n```",
  "| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |",
  "---\ntitle: Hello\ndate: 2024-01-01\n---\n\nbody",
  "**bold** and *italic*",
  "***both***",
  "run `npm test`",
  "see [site](https://example.com)",
  "![alt](https://example.com/x.png)",
  "line a  \nline b",
  "before <!-- a note --> after",
  "ship it :rocket: now",
] as const;

describe("Mint editor core Markdown round trips", () => {
  it.each(upstreamRoundTripCases)("preserves exact canonical Markdown for %j", (markdown) => {
    const initial = parse(markdown, { sourceGaps: false });
    // Compatibility mode intentionally omits source snapshots, so retain the
    // structural imported-core assertion there.
    const reparsed = parse(serialize(initial), { sourceGaps: false });
    expect(reparsed.eq(initial)).toBe(true);

    const sourceBacked = parse(markdown);
    expect(serialize(sourceBacked)).toBe(markdown);
  });

  it.each([
    "#  spaced heading ##",
    "Title\n-----",
    "* item\n+ item two",
    "01) first\n02) second",
    "- [X] complete\n- [ ]  spaced",
    "|a| b  |\n|:---|---:|\n|x|y|",
    "[TOC]",
    "[ref][id]\n\n[id]: <https://example.com> 'title'",
    "---\n# comment\ntitle: 'quoted'\nflow: { a: 1 }\n---\n\nbody",
  ])("keeps equivalent structured spelling byte-for-byte for %j", (markdown) => {
    expect(serialize(parse(markdown))).toBe(markdown);
  });

  it.each([
    "\\# not a heading",
    "\\- not a bullet",
    "literal \\*not italic\\*",
    "snake\\_case\\_ident",
    "\\>",
  ])("preserves an authored escape in %j", (markdown) => {
    expect(serialize(parse(markdown))).toBe(markdown);
  });

  it("never introduces an escape that the author did not write", () => {
    const markdown = "plain # - + * _ [ ] < > \\ `";
    expect(serialize(parse(markdown))).toBe(markdown);
  });

  it.each(INVALID_SOURCE_FIDELITY_STRINGS)("keeps incomplete syntax literal and exact for %j", (markdown) => {
    expect(serialize(parse(markdown))).toBe(markdown);
  });
});

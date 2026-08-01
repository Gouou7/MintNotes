import { describe, expect, it } from "vitest";

import { parse } from "./parser";
import { serialize } from "./serializer";

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
  it.each(upstreamRoundTripCases)("preserves the parsed document for %j", (markdown) => {
    const initial = parse(markdown);
    const reparsed = parse(serialize(initial));
    expect(reparsed.eq(initial)).toBe(true);
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
});

import { describe, expect, test } from "vitest";

import { parseFencedCodeSource } from "./fenced-code-source";

describe("parseFencedCodeSource", () => {
  test.each([
    ["backticks", "```\n```", "```", "", 4, 4, 4, 7],
    ["language info", "```ts\n```", "```", "ts", 6, 6, 6, 9],
    ["longer tilde fence", "~~~~\n~~~~", "~~~~", "", 5, 5, 5, 9],
  ] as const)(
    "recognizes an empty block with an adjacent %s closing fence",
    (_name, source, marker, lang, bodyFrom, bodyTo, closingFrom, closingTo) => {
      expect(parseFencedCodeSource(source)).toEqual({
        marker,
        lang,
        body: "",
        bodyFrom,
        bodyTo,
        openingFrom: 0,
        openingTo: bodyFrom - 1,
        closingFrom,
        closingTo,
      });
    },
  );

  test("keeps a fence without a closing line open", () => {
    expect(parseFencedCodeSource("```\n")).toMatchObject({
      body: "",
      bodyFrom: 4,
      bodyTo: 4,
      closingFrom: null,
      closingTo: null,
    });
  });
});

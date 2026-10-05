import { describe, expect, test } from "vitest";

import { fencedCodeStructureSignature, parseFencedCodeSource } from "./fenced-code-source";

describe("parseFencedCodeSource", () => {
  test.each(["\n", "\r\n", "\r"])("keeps exact fence and body offsets with %j endings", (ending) => {
    const source = `\`\`\`ts${ending}body${ending}\`\`\``;
    expect(parseFencedCodeSource(source)).toEqual({
      marker: "```", lang: "ts", body: "body",
      bodyFrom: 5 + ending.length, bodyTo: 9 + ending.length,
      openingFrom: 0, openingTo: 5,
      closingFrom: 9 + ending.length * 2, closingTo: source.length,
    });
    expect(fencedCodeStructureSignature(source)).toBe(fencedCodeStructureSignature("```ts\nbody\n```"));
    expect(parseFencedCodeSource(`\`\`\`${ending}\`\`\``)?.body).toBe("");
  });
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

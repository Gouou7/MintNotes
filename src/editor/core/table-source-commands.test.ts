import { describe, expect, it } from "vitest";

import {
  alignAuthoredTableSource,
  resizeAuthoredTableSource,
} from "./features/table";

describe("authored table source commands", () => {
  const source = "| name | value |\n| :--- | ---: |\n| a\\|b | 1 |";

  it("resizes without rewriting retained cell spellings or escaped pipes", () => {
    expect(resizeAuthoredTableSource(source, 3, 3)).toBe([
      "| name | value | |",
      "| :--- | ---: | --- |",
      "| a\\|b | 1 | |",
      "| | | |",
    ].join("\n"));
    expect(resizeAuthoredTableSource(source, 1, 1)).toBe([
      "| name |",
      "| :--- |",
    ].join("\n"));
  });

  it("changes only the selected divider cell alignment", () => {
    expect(alignAuthoredTableSource(source, 0, "right")).toBe(
      "| name | value |\n| ---: | ---: |\n| a\\|b | 1 |",
    );
    expect(alignAuthoredTableSource(source, 1, "center")).toBe(
      "| name | value |\n| :--- | :---: |\n| a\\|b | 1 |",
    );
  });
});

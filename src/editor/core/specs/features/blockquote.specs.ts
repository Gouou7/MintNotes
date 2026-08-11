import type { FeatureSpecs } from "../_types";

export const blockquoteSpecs: FeatureSpecs = {
  name: "blockquote",
  cases: [
    {
      id: "enter-confirms-source",
      label: "a line-leading `>` stays authored text until Enter confirms it",
      seed: "",
      events: [">", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 1, expect: ">|" },
        { at: 2, expect: "> |" },
        { at: 3, expect: "> a|" },
        { at: 4, expect: "<bq>> a\n> |</bq>" },
        { at: 5, expect: "<bq>> a\n> b|</bq>" },
      ],
    },
    {
      id: "enter-extends-source",
      label: "Enter inside a source-backed quote adds an authored quote line",
      seed: "> a",
      events: ["<Enter>", "b"],
      checkpoints: [
        { at: 1, expect: "<bq>> a\n> |</bq>" },
        { at: 2, expect: "<bq>> a\n> b|</bq>" },
      ],
    },
    {
      id: "empty-line-exits",
      label: "Enter on the final empty authored quote line exits the block",
      seed: "> a",
      events: ["<Enter>", "<Enter>"],
      checkpoints: [
        { at: 1, expect: "<bq>> a\n> |</bq>" },
        { at: 2, expect: "<bq>a</bq>\n|" },
      ],
    },
    {
      id: "mid-line-enter",
      label: "Enter in the middle preserves both real quote prefixes",
      seed: "> ab",
      events: ["<Home>", "<ArrowRight>", "<ArrowRight>", "<ArrowRight>", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "<bq>> a\n> |b</bq>" },
      ],
    },
  ],
};

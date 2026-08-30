import type { FeatureSpecs } from "../_types";

export const fencedCodeSpecs: FeatureSpecs = {
  name: "code_block",
  renderCases: {
    pre: (_children, el) => {
      const codeEl = el.querySelector("code");
      let text = "";
      if (codeEl) {
        for (const child of Array.from(codeEl.childNodes)) {
          if (child.nodeType === 3) {
            text += (child as Text).data;
          } else if (child.nodeType === 1) {
            const childEl = child as Element;
            const tag = childEl.tagName.toLowerCase();
            const list = childEl.classList;
            if (tag === "span" && list.contains("play-caret")) {
              text += "|";
            } else if (tag === "span" && list.contains("selection-marker"))
              text += childEl.textContent ?? "";
            else if (tag === "br" && list.contains("ProseMirror-trailingBreak")) {
              // skip PM's empty-textblock placeholder
            } else {
              text += childEl.textContent ?? "";
            }
          }
        }
      }
      return text;
    },
  },
  cases: [
    // ──────────────────────────────────────────────────────────────
    // 1. Ordinary source input remains exactly as authored. The fenced-code
    //    feature may recognize the result, but it does not synthesize input.
    // ──────────────────────────────────────────────────────────────
    {
      id: "authored-opening-fence",
      label: "backticks and info text remain exactly as authored",
      seed: "",
      events: ["`", "`", "`", "t", "s", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        { at: 3, expect: "```|" },
        { at: 5, expect: "```ts|" },
        { at: 6, expect: "```ts |" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 2. Backticks away from a line start are ordinary source too.
    // ──────────────────────────────────────────────────────────────
    {
      id: "non-line-start",
      label: "a``` remains exactly as authored",
      seed: "",
      events: ["a", "`", "`", "`"],
      checkpoints: [
        { at: 4, expect: "a```|" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 8. ArrowDown from the main body's end reveals the closing fence.
    // ──────────────────────────────────────────────────────────────
    {
      id: "arrow-down-enters-closing-fence",
      label: "main body end + ArrowDown → closing fence source",
      seed: "```ts\nfoo\n```",
      events: ["<ArrowDown>"],
      checkpoints: [
        { at: 0, expect: "```ts\nfoo|\n```" },
        { at: 1, expect: "```ts\nfoo\n```|" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 9. Once source is active, the fence characters are real document text.
    // ──────────────────────────────────────────────────────────────
    {
      id: "arrow-up-back-to-main",
      label: "closing fence remains a normal caret position",
      seed: "```ts\nfoo\n```",
      events: ["<ArrowDown>", "<ArrowUp>"],
      checkpoints: [
        { at: 1, expect: "```ts\nfoo\n```|" },
        { at: 2, expect: "```ts\nfoo|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 10. Below-block ArrowUp lands on the closing fence (not main body).
    //     Seed has a trailing paragraph below the code_block.
    // ──────────────────────────────────────────────────────────────
    {
      id: "below-block-arrow-up-enters-closing-fence",
      label: "paragraph below code_block + ArrowUp → closing fence source",
      seed: "```ts\nfoo\n```\n\nhello",
      events: ["<Home>", "<ArrowUp>", "<ArrowDown>"],
      checkpoints: [
        // After Home: caret at start of "hello" paragraph.
        { at: 1, expect: "```ts\nfoo\n```\n|hello" },
        // ArrowUp from start-of-block reveals the preceding close fence.
        { at: 2, expect: "```ts\nfoo\n```|\nhello" },
        { at: 3, expect: "```ts\nfoo\n```\n|hello" },
      ],
    },
    {
      id: "body-start-arrow-up-enters-opening-fence",
      label: "main body start + ArrowUp → opening fence source",
      seed: "```ts\nfoo\n```",
      events: ["<Home>", "<ArrowUp>", "<ArrowDown>"],
      checkpoints: [
        // Home follows the canonical source line, so it reaches the opening
        // fence rather than a rendered-only body boundary.
        { at: 1, expect: "|```ts\nfoo\n```" },
        { at: 2, expect: "|```ts\nfoo\n```" },
        { at: 3, expect: "```ts\n|foo\n```" },
      ],
    },
  ],
};

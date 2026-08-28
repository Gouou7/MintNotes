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
    // 1. Third backtick completes the closing fence without moving the caret.
    // ──────────────────────────────────────────────────────────────
    {
      id: "draft-trigger",
      label: "``` completes a closing fence and keeps the caret after the opener",
      seed: "",
      events: ["`", "`", "`"],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        { at: 3, expect: "```|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 2. Language can be typed on the completed opening fence.
    // ──────────────────────────────────────────────────────────────
    {
      id: "draft-with-lang",
      label: "``` autocomplete keeps language input on the opening line",
      seed: "",
      events: ["`", "`", "`", "t", "s"],
      checkpoints: [
        { at: 3, expect: "```|\n```" },
        { at: 4, expect: "```t|\n```" },
        { at: 5, expect: "```ts|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 3. Enter after an optional language opens the body line.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-body-inside",
      label: "```ts + Enter → cursor inside the completed code block",
      seed: "",
      events: ["`", "`", "`", "t", "s", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "```ts|\n```" },
        { at: 6, expect: "```ts\n|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 4. After Enter-commit, typing inserts into the code_block.
    //    Enter inside produces a newline (baseKeymap for code_block).
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-then-type",
      label: "after commit, x<Enter>y types inside the code_block",
      seed: "",
      events: ["`", "`", "`", "t", "s", "<Enter>", "x", "<Enter>", "y"],
      checkpoints: [
        { at: 7, expect: "```ts\nx|\n```" },
        { at: 9, expect: "```ts\nx\ny|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 5. Enter opens the body when no language is supplied.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-body-no-lang",
      label: "``` + Enter → cursor inside a language-free code block",
      seed: "",
      events: ["`", "`", "`", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "```|\n```" },
        { at: 4, expect: "```\n|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 6. Opening-fence info remains ordinary editable source.
    // ──────────────────────────────────────────────────────────────
    {
      id: "opening-info-space",
      label: "```ts<space> keeps editing the completed opening fence",
      seed: "",
      events: ["`", "`", "`", "t", "s", " "],
      checkpoints: [
        { at: 5, expect: "```ts|\n```" },
        { at: 6, expect: "```ts |\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 7. Non-line-start ``` should NOT fire (pattern anchored at ^).
    // ──────────────────────────────────────────────────────────────
    {
      id: "non-line-start",
      label: "a``` — backticks not at start of line, no draft",
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

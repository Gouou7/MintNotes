import type { FeatureSpecs } from "../_types";

export const imageSpecs: FeatureSpecs = {
  name: "image",
  cases: [
    {
      id: "type-image",
      label: "![alt](url) — full literal typing path",
      seed: "",
      events: [
        "!", "[", "a", "l", "t", "]", "(", "u", "r", "l", ")", " ",
      ],
      checkpoints: [
        { at: 1, expect: "!|" },
        { at: 2, expect: "![|" },
        { at: 5, expect: "![alt|" },
        { at: 6, expect: "![alt]|" },
        { at: 7, expect: "![alt](|" },
        { at: 8, expect: "![alt](u|" },
        // The explicitly authored close `)` completes the image. Source is
        // visible above the preview while the caret remains on its boundary.
        { at: 11, expect: "<img-icon/>![alt](url)<img:url>alt</img>|" },
        // space pushes cursor outside → source hidden, only <img> remains.
        { at: 12, expect: "<img:url>alt</img> |" },
      ],
    },
    {
      id: "empty-alt",
      label: "![](url) — empty alt still recognized; url used as alt fallback",
      seed: "",
      events: ["!", "[", "]", "(", "u", "r", "l", ")", " "],
      checkpoints: [
        { at: 3, expect: "![]|" },
        { at: 4, expect: "![](|" },
        { at: 5, expect: "![](u|" },
        { at: 8, expect: "<img-icon/>![](url)<img:url></img>|" },
        // Stable view: empty alt → <img> alt="" → pretty empty children.
        { at: 9, expect: "<img:url></img> |" },
      ],
    },
    {
      id: "leave-and-reenter",
      label: "moving cursor out and back in toggles render/source",
      seed: "",
      events: [
        "!", "[", "a", "]", "(", "u", ")", " ", "<ArrowLeft>",
      ],
      checkpoints: [
        { at: 7, expect: "<img-icon/>![a](u)<img:u>a</img>|" },
        { at: 8, expect: "<img:u>a</img> |" },
        // Cursor moves to boundary `)|<space>` → still inside span, source
        // re-revealed; image still under it.
        { at: 9, expect: "<img-icon/>![a](u)<img:u>a</img>| " },
      ],
    },
  ],
};

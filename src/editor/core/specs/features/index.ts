// Aggregation of every feature's test/spec data. Imported by:
//   - tests/utils.ts (runFeatureCases drives assertions)
//   - specs/pretty.ts (collectRenderCases feeds the DOM→pretty projection)
//   - website/main.ts (specs panel — "live demo" of every case)
//
// Lib mode never imports anything under specs/, so cases + renderCases
// stay out of the editor bundle.

import type { Case, FeatureSpecs, RenderCase } from "../_types";

import { autoPairSpecs } from "./auto-pair.specs";
import { autolinkSpecs } from "./autolink.specs";
import { blockquoteSpecs } from "./blockquote.specs";
import { codeSpecs } from "./code.specs";
import { emojiSpecs } from "./emoji.specs";
import { emphasisSpecs } from "./emphasis.specs";
import { fencedCodeSpecs } from "./fenced-code.specs";
import { frontMatterSpecs } from "./front-matter.specs";
import { headingSpecs } from "./heading.specs";
import { highlightSpecs } from "./highlight.specs";
import { hrSpecs } from "./hr.specs";
import { htmlCommentSpecs } from "./html-comment.specs";
import { imageSpecs } from "./image.specs";
import { linkSpecs } from "./link.specs";
import { listSpecs } from "./list.specs";
import { refDefSpecs } from "./ref-def.specs";
import { strikeSpecs } from "./strike.specs";
import { subSupSpecs } from "./sub-sup.specs";
import { tableSpecs } from "./table.specs";
import { taskSpecs } from "./task.specs";
import { tocSpecs } from "./toc.specs";

export const ALL_SPECS: FeatureSpecs[] = [
  htmlCommentSpecs,
  emojiSpecs,
  emphasisSpecs,
  codeSpecs,
  strikeSpecs,
  subSupSpecs,
  highlightSpecs,
  autolinkSpecs,
  linkSpecs,
  imageSpecs,
  hrSpecs,
  blockquoteSpecs,
  headingSpecs,
  taskSpecs,
  listSpecs,
  fencedCodeSpecs,
  frontMatterSpecs,
  refDefSpecs,
  tableSpecs,
  tocSpecs,
  autoPairSpecs,
];

export function collectRenderCases(): Record<string, RenderCase> {
  return Object.assign({}, ...ALL_SPECS.map((s) => s.renderCases ?? {}));
}

// Cases get namespaced by feature so ids stay unique across the app.
export function collectCases(): Array<Case & { feature: string }> {
  return ALL_SPECS.flatMap((s) =>
    (s.cases ?? []).map((c) => ({ ...c, feature: s.name })),
  );
}

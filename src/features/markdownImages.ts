import { fromMarkdown } from "mdast-util-from-markdown";
import { parse, postprocess, preprocess } from "micromark";
import type { Definition, RootContent } from "mdast";
import { parseFrontmatter } from "../editor/frontmatter";

interface Range { from: number; to: number }
export interface MarkdownImage {
  url: string;
  from: number;
  to: number;
  destination?: Range;
  definition?: { range: Range; destination: Range; shared: boolean; identifier: string };
  labelEnd?: number;
}
interface Edit extends Range { text: string }

/** Offsets always address the original UTF-16 source, including CRLF and front matter. */
export function markdownImages(markdown: string): MarkdownImage[] {
  if (!markdown.includes("![")) return [];
  const frontmatter = parseFrontmatter(markdown);
  const source = frontmatter.prefix.replace(/[^\r\n]/g, " ") + frontmatter.body;
  const tree = fromMarkdown(source);
  const tokens = postprocess(parse().document().write(preprocess()(source, undefined, true)))
    .filter(([kind]) => kind === "enter").map(([, token]) => token);
  const nodes: RootContent[] = [];
  const walk = (children: readonly RootContent[]) => {
    for (const node of children) {
      nodes.push(node);
      if ("children" in node) walk(node.children as RootContent[]);
    }
  };
  walk(tree.children);
  const definitions = new Map<string, Definition>();
  const shared = new Set<string>();
  for (const node of nodes) {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === "linkReference") shared.add(node.identifier);
  }
  const range = (node: { position?: { start: { offset?: number }; end: { offset?: number } } }): Range | undefined => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    return from === undefined || to === undefined ? undefined : { from, to };
  };
  const tokenRange = (type: string, within: Range) => {
    const token = tokens.find((entry) => entry.type === type && entry.start.offset >= within.from && entry.end.offset <= within.to);
    return token && { from: token.start.offset, to: token.end.offset };
  };
  const images: MarkdownImage[] = [];
  for (const node of nodes) {
    if (node.type !== "image" && node.type !== "imageReference") continue;
    const bounds = range(node);
    if (!bounds) continue;
    if (node.type === "image") {
      const label = tokenRange("label", bounds);
      images.push({ ...bounds, url: node.url, destination: label ? tokenRange("resourceDestination", { from: label.to, to: bounds.to }) : undefined });
    } else {
      const definition = definitions.get(node.identifier);
      if (!definition) continue;
      const definitionRange = range(definition);
      const destination = definitionRange && tokenRange("definitionDestination", definitionRange);
      images.push({
        ...bounds, url: definition.url, labelEnd: tokenRange("label", bounds)?.to,
        definition: definitionRange && destination ? { range: definitionRange, destination, shared: shared.has(node.identifier), identifier: node.identifier } : undefined
      });
    }
  }
  return images;
}

export function rewriteMarkdownImages(markdown: string, replacements: ReadonlyMap<MarkdownImage, string>): string {
  const edits = new Map<string, Edit>();
  const definitions = new Map<string, string>();
  const additions: string[] = [];
  const eol = markdown.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  const edit = (range: Range, text: string) => edits.set(`${range.from}:${range.to}`, { ...range, text });
  for (const [image, target] of replacements) {
    // Targets are generated local attachment URLs/portable paths; encode delimiters defensively.
    const destination = `<${target.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
    if (image.destination) edit(image.destination, destination);
    else if (image.definition) {
      const definition = image.definition;
      if (!definition.shared) edit(definition.destination, destination);
      else if (image.labelEnd !== undefined) {
        const key = `${definition.identifier}:${target}`;
        let label = definitions.get(key);
        if (!label) {
          let counter = definitions.size + 1;
          do { label = `mint-image-${counter++}`; } while (markdown.toLowerCase().includes(label) || [...definitions.values()].includes(label));
          definitions.set(key, label);
          const suffix = markdown.slice(definition.destination.to, definition.range.to);
          additions.push(`[${label}]: ${destination}${suffix}`);
        }
        edit({ from: image.labelEnd, to: image.to }, `[${label}]`);
      }
    }
  }
  for (const change of [...edits.values()].sort((a, b) => b.from - a.from)) {
    markdown = markdown.slice(0, change.from) + change.text + markdown.slice(change.to);
  }
  return markdown + (additions.length ? `${eol}${eol}${additions.join(eol)}${eol}` : "");
}

export function imageAttachmentId(url: string): string | undefined {
  return /^webmd-attachment:([0-9a-f-]{36})$/i.exec(url)?.[1].toLowerCase();
}

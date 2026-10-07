import { describe, expect, it } from "vitest";
import { parse } from "../../../.generated/typora-web/src/parser";
import { serialize } from "../../../.generated/typora-web/src/serializer";
import { safeLink } from "../../../.generated/typora-web/src/mint/context";
import { literals } from "../../../.generated/typora-web/src/mint/syntax";
import { highlightRanges } from "../../../.generated/typora-web/src/mint/code";
import { createMintEditor } from "../engine";
import { parseCalloutMarker } from "../product/calloutMarker";
const cases = [
  '$x_1 + y$ and $$a^2$$', '$$\nx = \\frac{a}{b}\n$$',
  '[[Note#Heading|别名]] ![[Note]]', '%%hidden **text** [[link]]%% visible',
  'before %%hidden\n\n# hidden title\n%% after',
  '> [!tip] Title\n> body without blank line',
  '> [!warning]- 标题 {color=red icon=bug}\n>\n> 内容 $x$\n>\n> > [!note] 嵌套\n> > 正文',
  'named [^a] inline ^[text [link](https://example.com)]\n\n[^a]: **body**\n    continuation',
  '---\ntitle: Test\ntags: [one, two]\n---\n\nbody',
  '```mermaid\nflowchart LR\n A --> B\n```',
  '```ts\nconst text = "[[literal]] $x$ %%comment%% ^[foot]";\n```',
  '| A | B |\n| --- | --- |\n| $x$ | [[Note]] |',
  '$incomplete [[unfinished ^[unfinished %%unfinished',
];
describe("feature patch data preservation", () => {
  for (const source of cases) it(`round trips ${source.slice(0, 40)}`, () => {
    const first = parse(source), serialized = serialize(first), next = parse(serialized);
    expect(next.toJSON()).toEqual(first.toJSON());
  });
  it("does not interpret escaped or inline code syntax", () => {
    expect(literals('`$x$ [[a]] %%b%%` \\[[a]] \\$y$')).toEqual([]);
    expect(literals('^[body [link](url)]')[0].body).toBe('body [link](url)');
  });
  it("blocks executable URLs even with browser-normalized whitespace", () => {
    for (const href of ['javascript:alert(1)', ' \tjava\nscript:alert(1)', 'data:text/html,evil', '//remote.test/path']) expect(safeLink(href)).toBe(false);
    for (const href of ['https://example.com', 'mailto:hello@example.com', '#Heading', 'relative.md']) expect(safeLink(href)).toBe(true);
  });
  it("registers the supported local languages without changing source", () => {
    for (const [language, source] of Object.entries({ js: 'const x = "hello"', ts: 'const x: number = 1', json: '{"x":1}', html: '<p>x</p>', css: 'p { color: red; }', python: 'def f(): return 1', shell: 'echo "$HOME"', yaml: 'key: true', markdown: '# Title', sql: 'SELECT * FROM notes' })) {
      const ranges = highlightRanges(source, language); expect(ranges.length, language).toBeGreaterThan(0); expect(ranges.every(range => range.from >= 0 && range.to <= source.length)).toBe(true);
    }
    expect(highlightRanges('const x = 1', 'not-a-language')).toEqual([]);
  });
  it("uses the shared plugins for readonly math, callouts, footnotes and wiki links", () => {
    const host = document.createElement('div'); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: 'math $x$ [[Note|Alias]] [^a]\n\n[^a]: body\n\n> [!tip]- title\n>\n> hidden body', readOnly: true, parseCallout: parseCalloutMarker, renderMath: (element, text) => { element.textContent = `math:${text}`; } });
    expect(host.textContent).toContain('math:x'); expect(host.querySelector('.wiki-link')?.textContent).toBe('Alias'); expect(host.querySelector('.mint-callout-folded')).not.toBeNull(); expect(host.querySelector('[id="footnote-a"]')).not.toBeNull(); editor.destroy(); host.remove();
  });
});

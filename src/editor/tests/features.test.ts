import { describe, expect, it, vi } from "vitest";
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
  it("refreshes code labels without changing Markdown and releases both header icons", () => {
    const source = '```\nplain text\n```\n\n```ts\nconst value = 1;\n```';
    const host = document.createElement('div'), changed = vi.fn(), disposals: ReturnType<typeof vi.fn>[] = [];
    document.body.append(host);
    let textLabel = 'Text';
    const editor = createMintEditor(host, { initialContent: source, readOnly: true, onChange: changed,
      label: name => name === 'codeText' ? textLabel : name,
      icon: name => { const element = document.createElement('span'), destroy = vi.fn(); element.dataset.icon = name; disposals.push(destroy); return { element, destroy }; },
    });
    try {
      expect([...host.querySelectorAll('.mint-code-language-label')].map(label => label.textContent)).toEqual(['Text', 'ts']);
      expect(host.querySelectorAll('[data-icon="code"]')).toHaveLength(2);
      textLabel = '文本'; editor.refreshPresentation();
      expect(host.querySelector('.mint-code-language-label')?.textContent).toBe('文本');
      editor.setMode('live'); editor.setMode('reading');
      expect(editor.getMarkdown()).toBe(source); expect(changed).not.toHaveBeenCalled();
    } finally { editor.destroy(); host.remove(); }
    expect(disposals.length).toBeGreaterThanOrEqual(4);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("code copy feedback", () => {
  it("restores the copy icon promptly, restarts feedback on repeat clicks and releases its timer", async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const host = document.createElement('div'), changed = vi.fn(), disposals: ReturnType<typeof vi.fn>[] = [];
    document.body.append(host);
    const source = '```js\nconst x = 1;\n```';
    const editor = createMintEditor(host, { initialContent: source, readOnly: true, onChange: changed,
      icon: name => { const element = document.createElement('span'), destroy = vi.fn(); element.dataset.icon = name; disposals.push(destroy); return { element, destroy }; },
    });
    const copy = host.querySelector<HTMLButtonElement>('.mint-code-actions button')!;
    try {
      copy.click(); await Promise.resolve();
      expect(write).toHaveBeenCalledWith('const x = 1;\n');
      expect(copy.querySelector('[data-icon="copy-success"]')).not.toBeNull(); expect(copy.getAttribute('aria-label')).toBe('Copied');
      await vi.advanceTimersByTimeAsync(400); copy.click(); await Promise.resolve();
      await vi.advanceTimersByTimeAsync(799); expect(copy.dataset.copyState).toBe('copied');
      await vi.advanceTimersByTimeAsync(1);
      expect(copy.dataset.copyState).toBeUndefined(); expect(copy.querySelector('[data-icon="copy"]')).not.toBeNull(); expect(copy.getAttribute('aria-label')).toBe('Copy code');
      expect(editor.getMarkdown()).toBe(source); expect(changed).not.toHaveBeenCalled();
      copy.click(); await Promise.resolve(); editor.destroy();
      const iconCount = disposals.length; await vi.runAllTimersAsync(); expect(disposals).toHaveLength(iconCount);
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    } finally { editor.destroy(); host.remove(); write.mockRestore(); vi.useRealTimers(); }
  });
  it("ignores older clipboard responses and completions after the note was replaced", async () => {
    vi.useFakeTimers();
    let resolveOld!: () => void, rejectLatest!: (error: Error) => void, resolveDetached!: () => void;
    const old = new Promise<void>(resolve => { resolveOld = resolve; }), latest = new Promise<void>((_resolve, reject) => { rejectLatest = reject; });
    const detached = new Promise<void>(resolve => { resolveDetached = resolve; });
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockReturnValueOnce(old).mockReturnValueOnce(latest).mockReturnValueOnce(detached);
    const host = document.createElement('div'), changed = vi.fn(); document.body.append(host);
    const editor = createMintEditor(host, { initialContent: '```js\nbody\n```', readOnly: true, onChange: changed });
    const copy = host.querySelector<HTMLButtonElement>('.mint-code-actions button')!;
    try {
      copy.click(); copy.click(); rejectLatest(new Error('Unavailable')); await Promise.resolve();
      expect(copy.dataset.copyState).toBe('failed'); expect(copy.getAttribute('aria-label')).toBe('Copy failed');
      resolveOld(); await Promise.resolve(); expect(copy.dataset.copyState).toBe('failed');
      await vi.advanceTimersByTimeAsync(1200); expect(copy.dataset.copyState).toBeUndefined();
      copy.click(); editor.loadDocument('other', 'Other note'); resolveDetached(); await Promise.resolve();
      expect(copy.dataset.copyState).toBeUndefined(); expect(editor.getMarkdown()).toBe('Other note'); expect(changed).not.toHaveBeenCalled();
    } finally { editor.destroy(); host.remove(); write.mockRestore(); vi.useRealTimers(); }
  });
});

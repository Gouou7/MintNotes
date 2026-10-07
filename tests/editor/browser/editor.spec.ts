import { test, expect, type Page } from '@playwright/test';
async function load(page: Page, text: string) { await page.evaluate(text => window.mintFixture.load(text), text); }
async function saved(page: Page) { return page.evaluate(() => window.mintFixture.saves()); }
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as unknown as { mintCopied: string }).mintCopied = text; } }, configurable: true }); });
  await page.goto('/'); await expect(page.locator('.markdown-editor-host .ProseMirror').first()).toBeVisible();
});
test('loads and switches modes without saving; real native edits serialize', async ({ page }) => {
  await load(page, '__bold__\n\n[unused]: https://example.com/unused');
  for (const mode of ['source', 'reading', 'live']) await page.getByRole('button', { name: mode, exact: true }).click();
  expect(await saved(page)).toBe(0); expect(await page.evaluate(() => window.mintFixture.markdown())).toContain('__bold__');
  await load(page, 'Alpha\n\nBeta'); await page.getByText('Alpha', { exact: true }).click(); await page.keyboard.press('End'); await page.keyboard.insertText('!');
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('Alpha!'); expect(await saved(page)).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+z'); await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('Alpha\n');
});
test('readonly uses math, diagram, wiki, callout, footnote and highlight plugins', async ({ page }) => {
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  await expect(page.locator('.katex').first()).toBeVisible(); await expect(page.locator('.mint-block-preview img')).toBeVisible();
  await expect(page.locator('.mint-callout-folded').first()).toBeVisible();
  await page.getByRole('button', { name: 'Toggle callout' }).first().click(); const body = page.locator('.markdown-callout > .callout-content > p').first(); await expect(body).toBeVisible(); await expect(body).toContainText('body without a blank line'); await expect(body.locator('.callout-marker-source')).toHaveCSS('display', 'none');
  await page.getByRole('button', { name: 'Toggle callout' }).first().click(); await expect(body).not.toBeVisible(); await page.getByRole('button', { name: 'Toggle callout' }).first().click();
  await page.getByRole('button', { name: 'Alias' }).click(); expect(await page.evaluate(() => window.mintFixture.navigation())).toBe('Note#Heading');
  await expect(page.locator('#footnote-one')).toBeVisible(); await expect(page.locator('.mint-inline-footnotes:not(:empty)')).toBeVisible(); await expect(page.getByRole('link', { name: 'Back to footnote reference' })).toHaveCount(2); await page.getByRole('link', { name: 'Back to footnote reference' }).last().click();
  await expect(page.locator('.hljs-keyword').first()).toHaveText('const');
  await expect(page.locator('.syntax-hidden').filter({ hasText: '%%hidden comment%%' })).toHaveCSS('font-size', '0px');
  const copy = page.getByRole('button', { name: 'Copy code' }), originalColor = await copy.evaluate(element => getComputedStyle(element).color);
  await copy.click(); await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Code copied' }).locator('.lucide-check')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Code copied' })).toHaveCSS('color', originalColor);
  await expect(page.getByRole('button', { name: 'Copy code' }).locator('.lucide-copy')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { mintCopied: string }).mintCopied)).toBe('const value: number = 1;\n'); expect(await saved(page)).toBe(0);
});
test('source edits preserve literal extensions, references and unfinished input', async ({ page }) => {
  const text = '[[Note|Alias]] $x_1$ %%hidden%% ^[body]\n\n[unused]: https://example.com/path\n\n```ts\nconst text = "[[literal]] $x$";\n```\n\n$unfinished';
  await load(page, text); await page.getByRole('button', { name: 'source', exact: true }).click(); await page.locator('textarea.typora-web-source:not([hidden])').fill(text + '!');
  await page.getByRole('button', { name: 'live', exact: true }).click();
  await page.getByRole('button', { name: 'source', exact: true }).click(); await expect(page.locator('textarea.typora-web-source:not([hidden])')).toHaveValue(text + '!');
  expect(await saved(page)).toBe(1);
});
test('table edits and property panel submit through the native controller', async ({ page }) => {
  await load(page, '---\ncount: 2\nenabled: true\n---\n\n| A | B |\n| --- | --- |\n| cell | value |');
  await page.locator('.property-row input[type="number"]').fill('3'); await page.locator('.property-row input[type="number"]').blur();
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('count: 3');
  await page.getByText('cell', { exact: true }).click(); await page.keyboard.press('End'); await page.keyboard.insertText('!');
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('cell!'); await expect(page.getByRole('button', { name: 'Resize table' })).toBeVisible();
  await page.getByRole('button', { name: 'reading', exact: true }).click(); await expect(page.locator('.table-toolbar')).toHaveCount(0);
});
test('source IME commits once and defers the input surface switch', async ({ page }) => {
  await load(page, 'Alpha'); await page.getByRole('button', { name: 'source', exact: true }).click();
  await page.locator('textarea.typora-web-source:not([hidden])').evaluate(element => { element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); (element as HTMLTextAreaElement).value = 'Alpha中文'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.getByRole('button', { name: 'live', exact: true }).click(); expect(await saved(page)).toBe(0); await expect(page.locator('textarea.typora-web-source:not([hidden])')).toBeVisible();
  await page.locator('textarea.typora-web-source:not([hidden])').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe('Alpha中文'); await expect(page.locator('textarea.typora-web-source:not([hidden])')).toHaveCount(0); expect(await saved(page)).toBe(1);
});
test('live composition commits native DOM input once after composition ends', async ({ page }) => {
  await load(page, 'Alpha'); await page.getByText('Alpha', { exact: true }).click(); await page.keyboard.press('End');
  const live = page.locator('.markdown-editor-host .ProseMirror').first();
  await live.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.keyboard.insertText('中文'); expect(await saved(page)).toBe(0);
  await live.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe('Alpha中文'); expect(await saved(page)).toBe(1);
});
test('code language controls remain editable after returning from readonly mode', async ({ page }) => {
  await load(page, '```ts\nconst value = 1;\n```');
  await expect(page.locator('.mint-code-language-label')).toHaveText('ts');
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  await page.locator('.cb-lang-input').evaluate(element => { (element as HTMLInputElement).value = 'python'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await saved(page)).toBe(0);
  await page.getByRole('button', { name: 'live', exact: true }).click();
  await page.getByRole('button', { name: 'Code language', exact: true }).click();
  const language = page.getByRole('textbox', { name: 'Code language' }); await expect(language).toBeEnabled(); await language.fill('python');
  expect(await saved(page)).toBe(0); await language.press('Enter');
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('```python');
  await expect(page.locator('.mint-code-language-label')).toHaveText('python');
  await expect(language).toBeHidden();
});
test('code arrows follow above, language, body, below in both directions without saving', async ({ page }) => {
  await load(page, 'Above\n\n```js\nbody\n```\n\nBelow');
  const live = page.locator('.markdown-editor-host .ProseMirror').first();
  const language = page.getByRole('textbox', { name: 'Code language' });
  const caret = () => live.evaluate(root => {
    const selection = root.ownerDocument.getSelection(), node = selection?.focusNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    const block = element?.closest('p, code');
    if (!selection || !block) return null;
    const range = root.ownerDocument.createRange(); range.selectNodeContents(block); range.setEnd(selection.focusNode!, selection.focusOffset);
    return { text: block.textContent, offset: range.toString().length };
  });
  await page.getByText('Above', { exact: true }).click(); await page.keyboard.press('End'); await page.keyboard.press('ArrowDown');
  await expect(language).toBeFocused(); expect(await saved(page)).toBe(0);
  await language.press('ArrowDown'); await expect(language).toBeHidden();
  await expect.poll(caret).toEqual({ text: 'body', offset: 0 });
  await page.keyboard.press('End'); await page.keyboard.press('ArrowDown');
  await expect.poll(caret).toEqual({ text: 'Below', offset: 0 });
  await page.keyboard.press('ArrowUp'); await expect(language).toBeHidden();
  await expect.poll(caret).toEqual({ text: 'body', offset: 4 });
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp'); await expect(language).toBeFocused();
  await language.press('ArrowUp'); await expect(language).toBeHidden();
  await expect.poll(caret).toEqual({ text: 'Above', offset: 5 });
  expect(await saved(page)).toBe(0);
});
test('pending attachment cannot write into another note', async ({ page }) => {
  await load(page, 'Alpha'); await page.getByText('Alpha', { exact: true }).click();
  await page.locator('.markdown-editor-host').evaluate(element => { const transfer = new DataTransfer(); transfer.items.add(new File(['image'], 'photo.png', { type: 'image/png' })); const rect = element.querySelector('.ProseMirror p')!.getBoundingClientRect(); element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 10, clientY: rect.top + 8 })); });
  await page.getByRole('button', { name: 'Switch note' }).click(); await page.evaluate(() => window.mintFixture.resolveAttachment());
  await expect.poll(() => page.evaluate(() => window.mintFixture.notice())).toBe('Retry insertion'); expect(await page.evaluate(() => window.mintFixture.markdown())).toBe('Other note'); expect(await saved(page)).toBe(0);
});
test('locking and history preview reject native edits and pending insertion', async ({ page }) => {
  await load(page, '- [ ] task\n\nAlpha'); await page.getByRole('button', { name: 'Lock note' }).click();
  await expect(page.locator('.markdown-editor-host .ProseMirror').first()).toHaveAttribute('contenteditable', 'false');
  await page.getByText('Alpha', { exact: true }).click(); await page.keyboard.insertText('BAD');
  expect(await page.evaluate(() => window.mintFixture.markdown())).toBe('- [ ] task\n\nAlpha'); expect(await saved(page)).toBe(0);
  await page.getByRole('button', { name: 'History preview', exact: true }).click(); await expect(page.locator('.markdown-editor-host .ProseMirror').first()).toHaveAttribute('contenteditable', 'false');
});
test('literal syntax in fenced code has no math, wiki, comments or HTML execution', async ({ page }) => {
  await load(page, '```js\nconst x = "[[Note]] $x$ %%hidden%% ^[body]";\n```\n\n<script>window.bad = true</script>'); await page.getByRole('button', { name: 'reading', exact: true }).click();
  await expect(page.locator('.wiki-link,.katex,.mint-inline-footnotes > div')).toHaveCount(0); await expect(page.locator('.ProseMirror code').first()).toContainText('[[Note]] $x$ %%hidden%%'); expect(await page.evaluate(() => (window as unknown as { bad?: boolean }).bad)).toBeUndefined();
});
for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 834, 1112], ['mobile', 390, 844]] as const) {
  test(`${name} containers, theme, font size, code wrap and outline`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await load(page, '# Heading\n\n```js\nconst reallyLongLine = "' + 'x'.repeat(140) + '";\n```\n\n## End');
    await page.getByRole('button', { name: 'reading', exact: true }).click();
    const code = page.locator('.ProseMirror pre').first(); await expect(code).toHaveCSS('white-space', 'pre-wrap');
    await page.getByRole('button', { name: 'Code wrap' }).click(); await expect(code.locator('code')).toHaveCSS('white-space', 'pre');
    await page.getByRole('button', { name: 'Font size' }).click(); await expect(page.locator('.ProseMirror').first()).toHaveCSS('font-size', '20px');
    await page.getByRole('button', { name: 'Theme' }).click(); await expect(page.locator('.ProseMirror').first()).toHaveCSS('color', 'rgb(236, 235, 231)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width > 720) { await page.locator('.fixture-outline').getByRole('button', { name: 'End', exact: true }).click(); await expect(page.locator('.ProseMirror h2')).toBeInViewport(); }
    await page.screenshot({ path: `test-results/${test.info().project.name}-${name}.png` }); expect(await saved(page)).toBe(0);
    await load(page, '> [!tip] Callout title ' + 'long-title-'.repeat(30) + '\n> Body\n>\n> > [!warning] Nested\n> > Nested body');
    const quote = page.locator('.markdown-callout').first();
    await expect(quote).toHaveCSS('border-radius', '20px'); await expect(quote).toHaveCSS('padding', '15px');
    await expect(quote.locator(':scope > .callout-header')).toBeVisible();
    await expect(quote.locator(':scope > .callout-header strong')).toHaveCSS('text-overflow', 'ellipsis');
    const nestedBody = page.locator('.markdown-callout').nth(1).locator(':scope > .callout-content > p');
    await expect(nestedBody).toBeVisible(); await expect(nestedBody).toContainText('Nested body');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${test.info().project.name}-${name}-callout.png` }); expect(await saved(page)).toBe(0);
  });
}
test('secure image retry only refreshes real previews and sends no referrer', async ({ page }) => {
  let requests = 0, literalRequests = 0, referrer: string | undefined;
  await page.route('https://images.example.test/code.png', async route => { literalRequests++; await route.abort(); });
  await page.route('https://images.example.test/test.png', async route => {
    requests++; referrer = route.request().headers().referer;
    if (requests === 1) await route.abort(); else await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NxsAAAAASUVORK5CYII=', 'base64') });
  });
  await page.getByRole('button', { name: 'reading', exact: true }).click(); await load(page, '![remote](https://images.example.test/test.png)\n\n```md\n![literal](https://images.example.test/code.png)\n```');
  const image = page.locator('.image-render'); await expect(image).toHaveAttribute('data-image-failed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer'); expect(referrer).toBeUndefined(); expect(await saved(page)).toBe(0); await expect(page.locator('.image-render')).toHaveCount(1); expect(literalRequests).toBe(0); await expect(image).not.toHaveAttribute('data-image-failed', 'true');
});
test('pending attachment is cancelled on lock and successful insertion preserves the attachment reference', async ({ page }) => {
  await load(page, 'Alpha'); await page.getByText('Alpha', { exact: true }).click();
  const drop = () => page.locator('.markdown-editor-host').evaluate(element => { const transfer = new DataTransfer(); transfer.items.add(new File(['image'], 'photo.png', { type: 'image/png' })); const rect = element.querySelector('.ProseMirror p')!.getBoundingClientRect(); element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 10, clientY: rect.top + 8 })); });
  await drop(); await page.getByRole('button', { name: 'Lock note' }).click(); await page.evaluate(() => window.mintFixture.resolveAttachment());
  await expect.poll(() => page.evaluate(() => window.mintFixture.notice())).toBe('Retry insertion'); expect(await saved(page)).toBe(0);
  await page.getByRole('button', { name: 'Lock note' }).click(); await page.getByRole('button', { name: 'live', exact: true }).click(); await page.getByText('Alpha', { exact: true }).click();
  await drop(); await page.evaluate(() => window.mintFixture.resolveAttachment()); await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('webmd-attachment:12345678-1234-1234-1234-123456789abc'); expect(await saved(page)).toBeGreaterThan(0);
});

test('quote input stays unescaped and creates nested quotes; authored escapes remain literal', async ({ page }) => {
  await load(page, '');
  const live = page.locator('.markdown-editor-host .ProseMirror').first(); await live.click();
  await page.keyboard.type('>'); await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe('>');
  await page.keyboard.type(' quoted'); await expect(live.locator('blockquote')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe('> quoted');
  await page.keyboard.press('Enter'); await page.keyboard.type('> nested'); await expect(live.locator('blockquote blockquote')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('> > nested');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('outer');
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('> outer');
  await load(page, '\\> literal'); await expect(live.locator('blockquote')).toHaveCount(0);
  await expect(live.locator('p')).toContainText('> literal');
  await live.locator('p').click(); await page.keyboard.press('End'); await page.keyboard.type('!');
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe('\\> literal!');
  for (const mode of ['source', 'reading', 'live']) await page.getByRole('button', { name: mode, exact: true }).click();
  await expect(live.locator('blockquote')).toHaveCount(0); await expect(live.locator('p')).toContainText('> literal!');
});

test('Callout header controls edit titles and types while retaining body and nesting', async ({ page }) => {
  await load(page, 'Before\n\n> [!tip]+ Hello title {color=red icon=bug}\n>\n> Body\n>\n> > [!note] Nested\n> > nested body');
  const outer = page.locator('.markdown-callout').first(), header = outer.locator(':scope > .callout-header');
  await page.getByText('Body', { exact: true }).click(); await page.keyboard.press('End'); await page.keyboard.type('!');
  await expect(header).toBeVisible(); await expect(outer).toHaveClass(/mint-callout-rendered/);
  const before = await saved(page); await header.getByRole('button', { name: 'Callout title' }).click();
  const title = header.getByRole('textbox', { name: 'Callout title' }); await expect(title).toBeFocused();
  await title.fill('Hello! title'); expect(await saved(page)).toBe(before); await title.press('Enter');
  await expect(header).toBeVisible(); await expect(title).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('[!tip]+ Hello! title {color=red icon=bug}');
  await page.getByText('Body!', { exact: true }).click(); await expect(header).toBeVisible();
  await header.getByRole('combobox', { name: 'Callout type' }).selectOption('success');
  await expect(header.locator('strong')).toHaveText('Hello! title'); await expect(outer).toHaveClass(/callout-success/);
  const nested = page.locator('.markdown-callout').nth(1);
  await nested.getByRole('button', { name: 'Callout title' }).click();
  const nestedTitle = nested.getByRole('textbox', { name: 'Callout title' }); await nestedTitle.fill('XNested');
  await page.getByText('Body!', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('[!note] XNested');
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  const savedBeforeFold = await saved(page); await page.getByRole('button', { name: 'Toggle callout' }).click();
  await expect(outer.locator(':scope > .callout-content')).not.toBeVisible(); expect(await saved(page)).toBe(savedBeforeFold);
});

test('Callout display and folded content have no caret while native inputs remain editable', async ({ page }) => {
  await load(page, 'Before\n\n> [!note]+ note\n>\n> Body');
  const quote = page.locator('.markdown-callout'), header = quote.locator('.callout-header');
  const label = header.getByRole('button', { name: 'Callout title' });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByText('Body', { exact: true }).click();
    await expect(quote).toHaveCSS('caret-color', theme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
    await expect(header).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    await expect(header).toHaveCSS('user-select', 'none');
    await expect(label).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    const before = await saved(page); await label.click();
    const input = header.getByRole('textbox', { name: 'Callout title' });
    await expect(input).toBeFocused(); await expect(input).toHaveCSS('user-select', 'text');
    await expect(input).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    await expect(input).toHaveCSS('color', theme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
    await input.press('Enter'); await expect(label).toBeVisible();
    await header.getByRole('button', { name: 'Toggle callout' }).click();
    await expect(quote.locator(':scope > .callout-content')).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.play-caret')).toHaveCount(0); expect(await saved(page)).toBe(before);
    await header.getByRole('button', { name: 'Toggle callout' }).click();
  }
});

test('Callout creation keeps empty Enter and Backspace inside the new header/body interaction', async ({ page }) => {
  await load(page, '');
  const live = page.locator('.markdown-editor-host .ProseMirror').first(); await live.click();
  await page.keyboard.type('> [!note] Title'); await expect(page.locator('.markdown-callout')).toHaveCount(0);
  await page.keyboard.press('Enter');
  const quote = page.locator('.markdown-callout'), header = quote.locator(':scope > .callout-header');
  await expect(header).toBeVisible(); await expect(header.locator('strong')).toHaveText('Title');
  await expect(quote.locator(':scope > .callout-content > p')).toHaveCount(2);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await expect(quote.locator(':scope > .callout-content > p')).toHaveCount(4); await expect(live.locator(':scope > p')).toHaveCount(0);
  await page.keyboard.type('Body'); await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('> Body');
  await load(page, '> [!note] Title');
  await quote.locator(':scope > .callout-content').click(); await page.keyboard.press('Backspace');
  await expect(header.getByRole('textbox', { name: 'Callout title' })).toBeFocused(); await expect(header).toBeVisible();
  await expect(quote.locator(':scope > .callout-content > p')).toHaveCount(2); await expect(page.locator('.mint-callout-editing')).toHaveCount(0);
});

test('Callout arrows visit title before body in both directions and never expose marker source', async ({ page }) => {
  await load(page, 'Above\n\n> [!note] Title\n> Body\n\nBelow');
  const live = page.locator('.markdown-editor-host .ProseMirror').first();
  const quote = page.locator('.markdown-callout'), header = quote.locator(':scope > .callout-header');
  const title = header.getByRole('textbox', { name: 'Callout title' });
  const caret = () => live.evaluate(root => {
    const selection = root.ownerDocument.getSelection(), node = selection?.focusNode;
    const paragraph = (node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement)?.closest('p');
    if (!selection || !paragraph) return null;
    const range = root.ownerDocument.createRange(); range.selectNodeContents(paragraph); range.setEnd(selection.focusNode!, selection.focusOffset);
    return { text: paragraph.textContent, offset: range.toString().length };
  });
  await page.getByText('Above', { exact: true }).click(); await page.keyboard.press('End'); await page.keyboard.press('ArrowDown');
  await expect(title).toBeFocused(); await title.press('ArrowDown'); await expect(title).toBeHidden();
  await expect.poll(caret).toEqual({ text: '[!note] Title\nBody', offset: '[!note] Title\n'.length });
  await page.keyboard.press('End'); await page.keyboard.press('ArrowDown'); await expect.poll(caret).toEqual({ text: 'Below', offset: 0 });
  await page.keyboard.press('ArrowUp'); await expect(title).toBeHidden();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp'); await expect(title).toBeFocused();
  await title.press('ArrowUp'); await expect.poll(caret).toEqual({ text: 'Above', offset: 5 });
  await expect(header).toBeVisible(); await expect(quote.locator('.callout-marker-source')).toHaveCSS('display', 'none');
  await expect(page.locator('.mint-callout-editing')).toHaveCount(0); expect(await saved(page)).toBe(0);
});

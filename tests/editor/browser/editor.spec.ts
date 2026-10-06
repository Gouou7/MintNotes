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
  await page.getByRole('button', { name: 'Copy code' }).click(); await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible();
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
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  await page.locator('.cb-lang-input').evaluate(element => { (element as HTMLInputElement).value = 'python'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await saved(page)).toBe(0);
  await page.getByRole('button', { name: 'live', exact: true }).click();
  await page.locator('.ProseMirror .hljs-keyword').click();
  const language = page.getByRole('textbox', { name: 'Code language' }); await expect(language).toBeEnabled(); await language.fill('python');
  await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('```python');
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

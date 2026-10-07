import { expect, test, type Page } from '@playwright/test';

async function load(page: Page, source: string) {
  await page.evaluate(source => window.mintFixture.load(source), source);
}
const markdown = (page: Page) => page.evaluate(() => window.mintFixture.markdown());
const saves = (page: Page) => page.evaluate(() => window.mintFixture.saves());

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.markdown-editor-host .ProseMirror').first()).toBeVisible();
});

test('inline and multiline display formulas share rendering and preserve source through all modes', async ({ page }) => {
  const source = 'Before $A_B$ and $$ C_D $$ after\n\n$$\nA_B\n$$\n\n$$E_F$$';
  await load(page, source);
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  await expect(page.locator('.katex')).toHaveCount(4);
  await expect(page.locator('math msub')).toHaveCount(4);
  await expect(page.locator('.mint-math-block')).toHaveCount(2);
  await expect(page.locator('.mint-math-preview').first()).toBeVisible();
  expect(await saves(page)).toBe(0);
  for (const mode of ['live', 'source', 'reading', 'live', 'source']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
  }
  await expect(page.locator('textarea.typora-web-source:not([hidden])')).toHaveValue(source);
  expect(await markdown(page)).toBe(source); expect(await saves(page)).toBe(0);
});

test('native input creates, undoes and edits a multiline formula without leaving the block on Enter', async ({ page }) => {
  await load(page, '');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.insertText('$$'); await page.keyboard.press('Enter');
  await expect(page.locator('.mint-math-block > pre')).toBeVisible();
  await expect.poll(() => markdown(page)).toBe('$$\n\n$$');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.mint-math-block')).toHaveCount(0);
  await expect.poll(() => markdown(page)).toBe('$$');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.mint-math-block')).toHaveCount(1);
  await page.keyboard.insertText('A_B'); await page.keyboard.press('Enter'); await page.keyboard.insertText('C_D');
  await expect.poll(() => markdown(page)).toBe('$$\nA_B\nC_D\n$$');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.mint-math-preview .katex')).toBeVisible();
  await page.keyboard.insertText('Below');
  await expect.poll(() => markdown(page)).toContain('$$\nA_B\nC_D\n$$\n\nBelow');
});

test('clicking inline and block previews reveals authoritative source without saving', async ({ page }) => {
  const source = 'Before $A_B$ after\n\n$$\nC_D\n$$\n\nBelow';
  await load(page, source);
  await page.locator('.mint-math').click();
  await expect(page.locator('.mint-math')).toHaveCount(0);
  await page.keyboard.insertText('X');
  await expect.poll(() => markdown(page)).toContain('$XA_B$');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => markdown(page)).toBe(source);
  const before = await saves(page);
  await page.locator('.mint-math-preview .katex').click();
  await expect(page.locator('.mint-math-block > pre')).toBeVisible();
  expect(await saves(page)).toBe(before);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.mint-math-preview .katex')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.mint-math-block > pre')).toBeVisible();
  expect(await markdown(page)).toBe(source); expect(await saves(page)).toBe(before);
});

test('plain Markdown paste creates one standalone formula and supports native undo', async ({ page }) => {
  await load(page, ''); await page.locator('.ProseMirror').first().click();
  await page.locator('.ProseMirror').first().evaluate(element => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '$$\nA_B\n$$');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.mint-math-block')).toHaveCount(1);
  await expect.poll(() => markdown(page)).toContain('$$\nA_B\n$$');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => markdown(page)).toBe('');
});

test('incomplete formulas and code retain source and reading rejects editing', async ({ page }) => {
  const source = '$$\nA_B\n\n# Following\n\n```tex\n$$\nC_D\n$$\n```';
  await load(page, source);
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('Following');
  await expect(page.locator('.katex')).toHaveCount(0);
  expect(await markdown(page)).toBe(source); expect(await saves(page)).toBe(0);
  await load(page, '$$\nA_B\n$$');
  await page.locator('.mint-math-preview .katex').click(); await page.keyboard.insertText('WRONG');
  expect(await markdown(page)).toBe('$$\nA_B\n$$'); expect(await saves(page)).toBe(0);
});

for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 834, 1112], ['mobile', 390, 844]] as const) {
  test(`${name} multiline formula remains visible and long display math scrolls within the note`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await load(page, '$$\nA_B\n$$\n\n$$\n' + 'x'.repeat(160) + '\n$$');
    await page.getByRole('button', { name: 'reading', exact: true }).click();
    await expect(page.locator('.mint-math-preview').first().locator('math msub')).toHaveCount(1);
    await expect(page.locator('.mint-math-preview .katex').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const formula = page.locator('.mint-math-preview').last();
    await expect(formula).toBeVisible();
    expect(await formula.evaluate(element => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('button', { name: 'Font size' }).click();
    expect(await saves(page)).toBe(0);
  });
}

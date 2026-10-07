import { expect, test, type Page } from '@playwright/test';

async function load(page: Page, source: string) {
  await page.evaluate(source => window.mintFixture.load(source), source);
  await expect.poll(() => markdown(page)).toBe(source);
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

test('inline math stays with the text while paragraph display math centers between the surrounding lines', async ({ page }) => {
  for (const delimiter of ['$', '$$']) {
    const source = `Before ${delimiter}A_B${delimiter} after`;
    await load(page, source);
    await page.getByRole('button', { name: 'reading', exact: true }).click();
    const selector = delimiter === '$' ? '.mint-math' : '.mint-display-math';
    const formula = page.locator(selector);
    await expect(formula.locator('math msub')).toHaveCount(1);
    const layout = await formula.evaluate(element => {
      const paragraph = element.parentElement!, bounds = paragraph.getBoundingClientRect();
      const textRect = (node: Node) => {
        const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect();
      };
      const before = textRect(paragraph.firstChild!), after = textRect(paragraph.lastChild!);
      const tex = element.querySelector('.katex-html > .katex-base')!.getBoundingClientRect();
      return { display: getComputedStyle(element).display, beforeBottom: before.bottom, afterTop: after.top,
        beforeTop: before.top, texTop: tex.top, texBottom: tex.bottom,
        center: (tex.left + tex.right) / 2, paragraphCenter: (bounds.left + bounds.right) / 2 };
    });
    if (delimiter === '$') {
      expect(layout.display).toBe('inline-block');
      expect(Math.abs(layout.beforeTop - layout.afterTop)).toBeLessThan(1);
    } else {
      expect(layout.display).toBe('block');
      expect(layout.texTop).toBeGreaterThan(layout.beforeBottom);
      expect(layout.afterTop).toBeGreaterThan(layout.texBottom);
      expect(Math.abs(layout.center - layout.paragraphCenter)).toBeLessThan(2);
    }
    await page.getByRole('button', { name: 'live', exact: true }).click();
    await formula.click();
    await expect(formula).toHaveCount(0);
    await expect(page.locator('.ProseMirror p').first()).toHaveText(source);
    await expect(page.locator('.ProseMirror p .syntax-hint')).toHaveText([delimiter, delimiter]);
    expect(await markdown(page)).toBe(source); expect(await saves(page)).toBe(0);
  }
});

test('single and multiline formula sources use plain body styling with muted delimiters', async ({ page }) => {
  for (const source of ['$$A_B$$', '$$\nA_B\n$$', '$$\nA_B\nC_D\n$$']) {
    await load(page, 'Above\n\n' + source + '\n\nBelow');
    await page.locator('.mint-math-preview .katex').click();
    const code = page.locator('.mint-math-block > pre > code');
    await expect(code).toBeVisible();
    await expect(code).toHaveText(source);
    await expect(code.locator('.syntax-hint')).toHaveText(['$$', '$$']);
    for (const action of [undefined, 'Theme', 'Font size'] as const) {
      if (action) await page.getByRole('button', { name: action }).click();
      const styles = await code.evaluate(element => {
        const pre = element.parentElement!, body = element.closest('.ProseMirror')!;
        const codeStyle = getComputedStyle(element), preStyle = getComputedStyle(pre), bodyStyle = getComputedStyle(body);
        const delimiterStyle = getComputedStyle(element.querySelector('.syntax-hint')!);
        return { font: codeStyle.fontFamily, bodyFont: bodyStyle.fontFamily, size: codeStyle.fontSize, bodySize: bodyStyle.fontSize,
          color: codeStyle.color, bodyColor: bodyStyle.color, delimiterColor: delimiterStyle.color,
          padding: preStyle.padding, border: preStyle.borderWidth, background: preStyle.backgroundColor,
          chrome: getComputedStyle(pre, '::before').display, lineHeight: codeStyle.lineHeight, bodyLineHeight: bodyStyle.lineHeight };
      });
      expect(styles.font).toBe(styles.bodyFont); expect(styles.size).toBe(styles.bodySize);
      expect(styles.color).toBe(styles.bodyColor); expect(styles.delimiterColor).not.toBe(styles.bodyColor);
      expect(styles.lineHeight).toBe(styles.bodyLineHeight);
      expect(styles.padding).toBe('0px'); expect(styles.border).toBe('0px');
      expect(styles.background).toBe('rgba(0, 0, 0, 0)'); expect(styles.chrome).toBe('none');
    }
    expect(await markdown(page)).toBe('Above\n\n' + source + '\n\nBelow'); expect(await saves(page)).toBe(0);
  }
});

test('empty single and multiline dollar fences stay visible in live and reading modes', async ({ page }) => {
  for (const source of ['$$ $$', '$$\t$$', '$$\n$$', '$$\n\n$$', '$$\n  \t\n$$']) {
    await load(page, source);
    for (const mode of ['reading', 'live']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.locator('.mint-math-block,.mint-math,.mint-display-math,.katex')).toHaveCount(0);
      const widths = await page.locator('.ProseMirror').first().evaluate(root => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), widths: number[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) for (const match of node.textContent!.matchAll(/\$/g)) {
          const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + 1);
          widths.push(range.getBoundingClientRect().width);
        }
        return widths;
      });
      expect(widths).toHaveLength(4); expect(widths.every(width => width > 0)).toBe(true);
      expect(await markdown(page)).toBe(source); expect(await saves(page)).toBe(0);
    }
  }
});

test('clearing a formula keeps the empty fences visible after leaving the source', async ({ page }) => {
  await load(page, 'Above\n\n$$\nA_B\n$$\n\nBelow');
  await page.locator('.mint-math-preview .katex').click();
  for (let index = 0; index < 3; index++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Backspace');
  await expect.poll(() => markdown(page)).toBe('Above\n\n$$\n\n$$\n\nBelow');
  const before = await saves(page);
  await page.locator('.ProseMirror p').first().click();
  await expect(page.locator('.mint-math-block > pre > code')).toBeVisible();
  await expect(page.locator('.mint-math-block > pre > code')).toHaveText('$$\n\n$$');
  await expect(page.locator('.katex')).toHaveCount(0);
  await page.getByRole('button', { name: 'reading', exact: true }).click();
  await expect(page.locator('.mint-math-block > pre > code')).toBeVisible();
  expect(await saves(page)).toBe(before);
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
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    // Firefox drops clipboardData passed to the synthetic event constructor.
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    element.dispatchEvent(event);
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
    await load(page, '$$\nA_B\n$$\n\n$$\n' + 'x'.repeat(160) + '\n$$\n\nBefore $$' + 'x'.repeat(160) + '$$ after');
    await page.getByRole('button', { name: 'reading', exact: true }).click();
    await expect(page.locator('.mint-math-preview').first().locator('math msub')).toHaveCount(1);
    await expect(page.locator('.mint-math-preview .katex').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const formula = page.locator('.mint-math-preview').last();
    await expect(formula).toBeVisible();
    expect(await formula.evaluate(element => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
    await expect(page.locator('.mint-display-math')).toBeVisible();
    expect(await page.locator('.mint-display-math').evaluate(element => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Theme' }).click(); await page.getByRole('button', { name: 'Font size' }).click();
    expect(await saves(page)).toBe(0);
  });
}

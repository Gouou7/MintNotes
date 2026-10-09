import { expect, test } from '@playwright/test';

const codeText = 'fix(ui): 扩大编辑输入区域并修正光标显示\n\n- 让正文与源码输入区域铺满笔记窗格，保留原有行宽和页边留白';
const sample = `> [!note] Note\n> 这是一条 Callout 信息提示！\n\n\`\`\`text\n${codeText}\n\`\`\`\n\n---\n\n[[Note|WikiLink]]`;

for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 834, 1112], ['mobile', 390, 844]] as const) {
  test(`${name} design surfaces preserve layout, scrolling and content in both themes`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.evaluate(text => window.mintFixture.load(text), sample);
    await page.getByRole('button', { name: 'reading', exact: true }).click();
    const code = page.locator('.ProseMirror pre'), body = code.locator('code'), header = code.locator('.mint-code-language');
    const callout = page.locator('.markdown-callout'), wiki = page.getByRole('button', { name: 'WikiLink', exact: true });
    await expect(code.locator('.mint-code-language-label')).toHaveText('Text');
    await expect(body).toHaveCSS('font-weight', '400'); await expect(body).toHaveCSS('line-height', '20px');
    await expect(code.locator('.mint-code-language svg')).toBeVisible();
    await expect(callout.locator('.callout-icon .lucide-info')).toBeVisible();

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.locator('.note-pane')).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 24)');
      const surface = await code.evaluate(element => ({ fill: getComputedStyle(element, '::before').backgroundColor, outline: getComputedStyle(element, '::after').backgroundColor, mask: getComputedStyle(element, '::before').maskImage }));
      expect(surface.fill).toBe(theme === 'light' ? 'rgb(242, 243, 243)' : 'rgb(42, 42, 42)');
      expect(surface.outline).toBe(theme === 'light' ? 'rgb(226, 226, 226)' : 'rgb(51, 51, 51)');
      expect(surface.mask).toContain('data:image/svg+xml');
      await expect(wiki).toHaveCSS('color', theme === 'light' ? 'rgb(97, 210, 160)' : 'rgb(97, 210, 153)');
      await expect(wiki).toHaveCSS('text-decoration-line', 'underline');
      const tinted = await callout.evaluate(element => getComputedStyle(element, '::after').backgroundColor);
      expect(tinted).toBe('rgb(56, 168, 232)');

      const bounds = await code.boundingBox(), headerBounds = await header.boundingBox(), bodyBounds = await body.boundingBox();
      expect(bounds).not.toBeNull(); expect(headerBounds).not.toBeNull(); expect(bodyBounds).not.toBeNull();
      expect(headerBounds!.x - bounds!.x).toBeCloseTo(16, 0);
      expect(headerBounds!.y - bounds!.y).toBeCloseTo(16, 0);
      expect(bodyBounds!.y - headerBounds!.y - headerBounds!.height).toBeGreaterThanOrEqual(15);
      expect(bodyBounds!.width).toBeLessThanOrEqual(bounds!.width - 32);
      const copyBounds = await code.getByRole('button', { name: 'Copy code' }).boundingBox();
      expect(copyBounds!.width).toBe(28); expect(copyBounds!.height).toBe(28);
      expect(copyBounds!.y - bounds!.y).toBeCloseTo(10, 0);
      expect(bounds!.x + bounds!.width - copyBounds!.x - copyBounds!.width).toBeCloseTo(10, 0);
      if (name === 'desktop') await page.locator('.editor-area').screenshot({ path: testInfo.outputPath(`editor-design-${theme}.png`) });
    }

    const longLine = 'long_code_value_'.repeat(100);
    await page.evaluate(text => window.mintFixture.load(`\`\`\`text\n${text}\n\`\`\``), longLine);
    await expect(body).toContainText(longLine);
    await page.getByRole('button', { name: 'Code wrap' }).click();
    expect(await body.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    const fixedHeader = await header.boundingBox();
    await body.evaluate(element => { element.scrollLeft = 150; });
    expect(await header.boundingBox()).toEqual(fixedHeader);
    await expect(code.getByRole('button', { name: 'Copy code' })).toBeVisible();
    await page.getByRole('button', { name: 'Code wrap' }).click();
    expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => window.mintFixture.saves())).toBe(0);
  });
}

import { expect, test } from '@playwright/test';

for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 834, 1112], ['mobile', 390, 844]] as const) {
  test(`${name} blank page margins focus the actual input surface`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const live = page.locator('.markdown-editor-host > .typora-web-wrap > .typora-web-editor-host > .ProseMirror');
    await expect(live).toBeVisible();

    for (const mode of ['live', 'source'] as const) {
      const button = page.getByRole('button', { name: mode, exact: true });
      await button.click();
      const input = mode === 'live' ? live : page.locator('textarea.typora-web-source:not([hidden])');
      for (const text of ['', 'Short note']) {
        await page.evaluate(text => window.mintFixture.load(text), text);
        if (mode === 'live') await expect(live.locator('p')).toHaveText(text);
        else await expect(input).toHaveValue(text);
        const geometry = await page.locator('.editor-area').evaluate(area => {
          const rect = area.getBoundingClientRect();
          return { x: rect.left, y: rect.top, width: area.clientWidth, height: area.clientHeight };
        });
        const box = (await input.boundingBox())!;
        expect(box.x).toBeCloseTo(geometry.x, 0);
        expect(box.width).toBeCloseTo(geometry.width, 0);
        expect(box.height).toBeGreaterThanOrEqual(geometry.height - 1);
        const top = (await page.locator('.note-pane-top').boundingBox())!;
        const bottom = (await page.locator('.note-pane-bottom').boundingBox())!;
        if (mode === 'live') {
          const paragraph = (await live.locator('p').boundingBox())!;
          const gutter = width > 720 ? Math.max(48, (geometry.width - 852) / 2) : 18;
          expect(paragraph.x).toBeCloseTo(geometry.x + gutter, 0);
          expect(paragraph.y).toBeCloseTo(top.y + top.height + (width > 720 ? 46 : 30), 0);
        }
        const saves = await page.evaluate(() => window.mintFixture.saves());
        for (const point of [
          { x: geometry.x + 8, y: top.y + top.height + 8 },
          { x: geometry.x + geometry.width - 8, y: top.y + top.height + 8 },
          { x: geometry.x + geometry.width / 2, y: bottom.y - 8 },
        ]) {
          await button.click();
          await expect(input).not.toBeFocused();
          await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
          await page.mouse.click(point.x, point.y);
          await expect(input).toBeFocused();
          expect(await page.evaluate(() => window.mintFixture.saves())).toBe(saves);
        }
        await page.keyboard.insertText('!');
        await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe(text + '!');
      }
    }

    await page.evaluate(() => window.mintFixture.load(Array.from({ length: 100 }, (_, index) => `Line ${index}`).join('\n')));
    const source = page.locator('textarea.typora-web-source:not([hidden])');
    await expect(source).toHaveValue(/Line 99$/);
    expect(await source.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await page.locator('.editor-area').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.getByRole('button', { name: 'reading', exact: true }).click();
    await expect(live).toHaveAttribute('contenteditable', 'false');
    await live.locator('p').first().click();
    await expect(live).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  });
}

import { expect, test } from '@playwright/test';

const source = 'Above\n\n![preview](https://images.example.test/preview.png "Caption")\n\nBelow';

for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 834, 1112], ['mobile', 390, 844]] as const) {
  test(`${name} images show rounded previews and edit source above the selected image`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('https://images.example.test/preview.png', route => route.fulfill({ path: 'public/icon-512.png', contentType: 'image/png' }));
    await page.goto('/');
    await page.evaluate(text => window.mintFixture.load(text), source);
    const image = page.locator('img.image-render'), paragraph = page.locator('.ProseMirror p').filter({ has: image });
    await expect(image).toBeVisible(); await expect(image).toHaveCSS('border-radius', '20px');
    await expect(paragraph.locator('.syntax-hidden')).toHaveCSS('font-size', '0px');
    const bounds = await image.boundingBox(), parent = await paragraph.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(parent!.width + 1); expect(bounds!.height).toBeCloseTo(bounds!.width, 0);
    const above = page.getByText('Above', { exact: true }), below = page.getByText('Below', { exact: true });
    const checkSpacing = async () => {
      const preview = (await image.boundingBox())!, previous = (await above.boundingBox())!, next = (await below.boundingBox())!;
      expect(preview.y - previous.y - previous.height).toBeCloseTo(16, 0);
      expect(next.y - preview.y - preview.height).toBeCloseTo(16, 0);
    };
    await checkSpacing();

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await image.click();
      await expect(image).toHaveClass(/mint-image-selected/);
      await expect(image).toHaveCSS('outline-width', '2px'); await expect(image).toHaveCSS('outline-color', theme === 'light' ? 'rgb(97, 210, 160)' : 'rgb(97, 210, 153)');
      await expect(paragraph.locator('.syntax-hidden')).toHaveCount(0); await expect(paragraph.locator('.mint-image-icon')).toBeHidden();
      expect(await page.evaluate(() => {
        const selection = window.getSelection()!;
        return selection.isCollapsed && selection.anchorNode?.nodeType === Node.TEXT_NODE && selection.anchorNode.textContent?.endsWith(')') && selection.anchorOffset === selection.anchorNode.textContent.length;
      })).toBe(true);
      const imageTop = (await image.boundingBox())!.y;
      const caretBottom = await page.evaluate(() => {
        const range = window.getSelection()!.getRangeAt(0).cloneRange();
        range.setStart(range.startContainer, range.startOffset - 1);
        return range.getBoundingClientRect().bottom;
      });
      expect(caretBottom).toBeLessThanOrEqual(imageTop);
      for (const backwards of [false, true]) {
        await image.click();
        if (!backwards) await page.keyboard.press('ArrowLeft');
        await page.keyboard.press(backwards ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
        await expect(paragraph.locator('.syntax-hidden')).toHaveCount(0);
        await expect(image).toHaveClass(/mint-image-selected/);
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(')');
      }
      await page.getByText('Below', { exact: true }).click();
      await expect(image).not.toHaveClass(/mint-image-selected/); await expect(paragraph.locator('.syntax-hidden')).toHaveCSS('font-size', '0px');
      await checkSpacing();
    }

    await page.getByRole('button', { name: 'reading', exact: true }).click(); await image.click();
    await expect(image).toHaveCSS('border-radius', '20px'); await expect(image).toHaveCSS('outline-width', '0px');
    await expect(paragraph.locator('.syntax-hidden')).toHaveCSS('font-size', '0px');
    await checkSpacing();
    expect(await page.evaluate(() => window.mintFixture.saves())).toBe(0);
    expect(await page.evaluate(() => window.mintFixture.markdown())).toBe(source);

    await page.getByRole('button', { name: 'live', exact: true }).click(); await image.click(); await page.keyboard.insertText('!');
    await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toContain('"Caption")!');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => page.evaluate(() => window.mintFixture.markdown())).toBe(source);
  });
}

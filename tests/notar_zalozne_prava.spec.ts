import { test, expect } from '@playwright/test';

test('notar založné práva search', async ({ page }) => {
  await page.goto('https://www.notar.sk/zalozne-prava/');
  await page.getByRole('textbox', { name: 'IČO záložcu' }).click();
  await page.getByRole('textbox', { name: 'IČO záložcu' }).fill('36312941');
  await page.getByRole('button', { name: 'Hľadať' }).click();
});

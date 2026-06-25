import { test, expect } from '@playwright/test';

test('registeruz accounting entity search', async ({ page }) => {
  await page.goto('https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch');
  await page.getByRole('link', { name: 'Povoliť všetko' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).fill('35849703');
  await page.getByRole('button', { name: 'Vyhľadať' }).click();
  await page.getByRole('link').filter({ hasText: /^$/ }).click();
  await page.getByRole('link', { name: ' 01/2025 - 12/2025 Individuá' }).click();
  await page.getByRole('link', { name: 'Úč POD: Účtovná závierka (' }).click();
  await page.getByRole('link', { name: 'Titulná strana' }).click();
  await page.getByRole('link', { name: 'Strana aktív' }).click();
  await page.getByRole('link', { name: 'Strana pasív' }).click();
  await page.getByRole('link', { name: 'Výkaz ziskov a strát' }).click();
});

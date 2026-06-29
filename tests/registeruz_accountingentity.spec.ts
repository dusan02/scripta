import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch');
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  await page.getByRole('link', { name: 'Povoliť všetko' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).fill('31322832');
  await page.getByRole('link', { name: 'SLOVNAFT, a.s. IČO: 31322832 DIČ:' }).click();
  await page.getByRole('link', { name: ' 01/2024 - 12/2024 Individuá' }).click();
  await page.getByRole('link', { name: 'IFRS účtovná závierka: Účtovn' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).click();
  const download = await downloadPromise;
  await page.goto('https://www.registeruz.sk/cruz-public/domain/accountingentity/show/449752');
  await page.getByRole('link', { name: ' 01/2023 - 12/2023 Individuá' }).click();
  await page.getByRole('link', { name: 'IFRS účtovná závierka: Účtovn' }).click();
  const download1Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).click();
  const download1 = await download1Promise;
  await page.getByRole('link', { name: ' 01/2022 - 12/2022 Individuá' }).click();
  await page.getByRole('link', { name: 'IFRS účtovná závierka: Účtovn' }).click();
  const download2Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).click();
  const download2 = await download2Promise;
});
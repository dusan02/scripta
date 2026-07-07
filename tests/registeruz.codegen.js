const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch');
  await page.getByRole('link', { name: 'Povoliť všetko' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).fill('36699624');
  await page.getByRole('button', { name: 'Vyhľadať' }).click();
  await page.getByRole('link').filter({ hasText: /^$/ }).click();
  await page.getByRole('link', { name: ' 01/2025 - 12/2025 Individuá' }).click();
  await page.getByRole('link', { name: 'Úč POD: Účtovná závierka (' }).click();
  await page.getByRole('link', { name: 'Strana aktív' }).click();
  await page.getByRole('link', { name: 'Strana pasív' }).click();
  await page.getByRole('link', { name: 'Výkaz ziskov a strát' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).nth(1).click();
  const download = await downloadPromise;
  const download1Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).nth(2).click();
  const download1 = await download1Promise;
  await page.getByRole('link', { name: 'Detail ÚJ a jej ÚZ' }).click();
  await page.getByRole('link', { name: 'Výročné správy' }).click();
  await page.getByRole('link', { name: ' 01/2024 - 12/2024 Individuá' }).click();
  const download2Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: ' VS - Výročná správa.PDF, ve' }).click();
  const download2 = await download2Promise;
  await page.getByRole('link', { name: 'Individuálne účtovné závierky' }).click();
  await page.getByRole('link', { name: ' 01/2024 - 12/2024 Individuá' }).click();
  await page.getByRole('link', { name: 'Úč POD: Účtovná závierka (' }).click();
  await page.getByRole('link', { name: 'Strana aktív' }).click();
  await page.getByRole('link', { name: 'Strana pasív' }).click();
  await page.getByRole('link', { name: 'Výkaz ziskov a strát' }).click();
  const download3Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).first().click();
  const download3 = await download3Promise;
  const download4Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).nth(1).click();
  const download4 = await download4Promise;
  const download5Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Stiahnuť' }).nth(2).click();
  const download5 = await download5Promise;
  await page.getByRole('link', { name: 'Detail ÚJ a jej ÚZ' }).click();
  await page.getByRole('link', { name: 'Výročné správy' }).click();
  await page.getByRole('link', { name: ' 01/2024 - 12/2024 Individuá' }).click();
  const download6Promise = page.waitForEvent('download');
  await page.getByRole('link', { name: ' VS - Výročná správa.PDF, ve' }).click();
  const download6 = await download6Promise;
  await page.close();

  // ---------------------
  await context.close();
  await browser.close();
})();
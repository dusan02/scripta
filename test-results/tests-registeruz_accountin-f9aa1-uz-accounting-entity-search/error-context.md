# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/registeruz_accountingentity.spec.ts >> registeruz accounting entity search
- Location: tests/registeruz_accountingentity.spec.ts:3:5

# Error details

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('link').filter({ hasText: /^$/ })
    - locator resolved to <a class="full-item-anchor-th" href="/cruz-public/domain/accountingentity/show/124318"></a>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 100ms
    17 × waiting for element to be visible, enabled and stable
       - element is not visible
     - retrying click action
       - waiting 500ms
  - element was detached from the DOM, retrying

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('registeruz accounting entity search', async ({ page }) => {
  4  |   await page.goto('https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch');
  5  |   await page.getByRole('link', { name: 'Povoliť všetko' }).click();
  6  |   await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  7  |   await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).click();
  8  |   await page.getByRole('textbox', { name: 'Zadajte názov účtovnej' }).fill('35849703');
  9  |   await page.getByRole('button', { name: 'Vyhľadať' }).click();
> 10 |   await page.getByRole('link').filter({ hasText: /^$/ }).click();
     |                                                          ^ Error: locator.click: Target page, context or browser has been closed
  11 |   await page.getByRole('link', { name: ' 01/2025 - 12/2025 Individuá' }).click();
  12 |   await page.getByRole('link', { name: 'Úč POD: Účtovná závierka (' }).click();
  13 |   await page.getByRole('link', { name: 'Titulná strana' }).click();
  14 |   await page.getByRole('link', { name: 'Strana aktív' }).click();
  15 |   await page.getByRole('link', { name: 'Strana pasív' }).click();
  16 |   await page.getByRole('link', { name: 'Výkaz ziskov a strát' }).click();
  17 | });
  18 | 
```
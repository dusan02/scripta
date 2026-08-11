import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Test 1: Default /firmy
  await page.goto("http://localhost:3000/firmy", { waitUntil: "networkidle", timeout: 15000 });
  await page.screenshot({ path: "/tmp/firmy-default.png", fullPage: true });
  console.log("✅ Default /firmy");

  // Test 2: Filtered by IT sector
  await page.goto("http://localhost:3000/firmy?odvetvie=J", { waitUntil: "networkidle", timeout: 15000 });
  await page.screenshot({ path: "/tmp/firmy-it.png", fullPage: true });
  console.log("✅ /firmy?odvetvie=J");

  // Test 3: Filtered by size + revenue
  await page.goto("http://localhost:3000/firmy?velkost=50-99 zamestnancov&trzby=1M-10M", { waitUntil: "networkidle", timeout: 15000 });
  await page.screenshot({ path: "/tmp/firmy-filtered.png", fullPage: true });
  console.log("✅ /firmy?velkost=50-99&trzby=1M-10M");

  // Test 4: Page 2
  await page.goto("http://localhost:3000/firmy?page=2", { waitUntil: "networkidle", timeout: 15000 });
  await page.screenshot({ path: "/tmp/firmy-page2.png", fullPage: true });
  console.log("✅ /firmy?page=2");

  await browser.close();
}

main();

import { chromium } from "playwright";

const companies = [
  { ico: "00634034", label: "1-zdrava-mala-sro", name: "Behac, spol. s r.o." },
  { ico: "31711651", label: "2-zdrava-velka", name: "HUDOS s.r.o." },
  { ico: "00205869", label: "3-rastuca", name: "PD Veľké Uherce" },
  { ico: "00590797", label: "4-klesajuca", name: "ZTS Sabinov, a.s." },
  { ico: "00166481", label: "5-negativne-imanie", name: "Generálna prokuratúra SR" },
  { ico: "36450847", label: "6-konkurz", name: "BUKÓZA HOLDING v konkurze" },
  { ico: "00896586", label: "7-minimal-data", name: "ATRAKT s.r.o." },
  { ico: "10887989", label: "8-zivnostnik", name: "Viliam Senko" },
  { ico: "00603201", label: "9-obec", name: "MC Petržalka" },
  { ico: "00603741", label: "10-nike", name: "NIKÉ spol. s r.o." },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const c of companies) {
    try {
      await page.goto(`http://localhost:3000/firma/${c.ico}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.screenshot({ path: `/tmp/audit-${c.label}.png`, fullPage: true });
      console.log(`✅ ${c.label}: ${c.name}`);
    } catch (e) {
      console.log(`❌ ${c.label}: ${String(e).substring(0, 80)}`);
    }
  }

  await browser.close();
}

main();

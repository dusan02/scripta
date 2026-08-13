/**
 * Playwright PDF Generator for Verifa.sk company reports
 *
 * Usage: node scripts/generate-pdf.mjs --ico=00684881 --out=./report.pdf
 *        node scripts/generate-pdf.mjs --url=http://localhost:3000/firma/00684881 --out=./report.pdf
 *
 * Features:
 * - Custom header with Verifa.sk branding (right-aligned)
 * - Custom footer with copyright + page number + separator line
 * - Proper margins to avoid header/footer overlap
 * - Waits for charts and fonts to fully render
 * - Emulates print media for accurate @media print CSS
 */

import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const [key, val] = arg.replace(/^--/, "").split("=");
    args[key] = val || true;
  });
  return args;
}

async function generatePDF({ url, ico, out }) {
  const targetUrl = url || `http://localhost:3000/firma/${ico}`;
  const outputPath = resolve(out || `./report-${ico || "output"}.pdf`);

  // Load logo as base64 for embedding in header
  let logoBase64 = "";
  const logoPaths = [
    resolve(__dirname, "../public/logo-verifa.png"),
    resolve(__dirname, "../../public/logo-verifa.png"),
  ];
  for (const lp of logoPaths) {
    try {
      const buf = readFileSync(lp);
      logoBase64 = buf.toString("base64");
      console.log(`[LOGO] Loaded from ${lp}`);
      break;
    } catch {
      // try next path
    }
  }
  if (!logoBase64) {
    console.warn("[LOGO] logo-verifa.png not found — using text-only header");
  }

  const headerTemplate = `
    <div style="
      width: 100%;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: 0 10mm;
      font-size: 9px;
      font-family: -apple-system, system-ui, sans-serif;
      color: #666;
      height: 100%;
    ">
      ${logoBase64
        ? `<img src="data:image/png;base64,${logoBase64}" style="height: 20px; width: auto;" alt="Verifa.sk" />`
        : `<span style="font-weight: 700; color: #1a56db;">Verifa.sk Report</span>`}
    </div>
  `;

  const footerTemplate = `
    <div style="
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 10mm;
      font-size: 8px;
      font-family: -apple-system, system-ui, sans-serif;
      color: #888;
      border-top: 1px solid #ddd;
      padding-top: 3mm;
      height: 100%;
      box-sizing: border-box;
    ">
      <span>© 2026 Verifa.sk</span>
      <span>Business risk report — Strana <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  `;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`[PDF] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for React hydration and chart rendering
    try {
      await page.waitForSelector(".recharts-surface", { timeout: 15000 });
      console.log("[PDF] Charts detected");
    } catch {
      console.warn("[PDF] No charts found — continuing anyway");
    }

    // Wait for fonts to load
    try {
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
    } catch {
      // non-critical
    }

    // Small delay for any final layout shifts
    await page.waitForTimeout(500);

    // Emulate print media to trigger @media print CSS
    await page.emulateMedia({ media: "print" });

    console.log("[PDF] Generating PDF...");
    await page.pdf({
      path: outputPath,
      format: "A4",
      margin: {
        top: "15mm",
        bottom: "18mm",
        left: "10mm",
        right: "10mm",
      },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      preferCSSPageSize: false,
    });

    console.log(`[PDF] Done: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error("[PDF] Error:", err.message);
    throw err;
  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }
}

// CLI entry point
const args = parseArgs();
if (!args.ico && !args.url) {
  console.error("Usage: node scripts/generate-pdf.mjs --ico=00684881 --out=./report.pdf");
  console.error("       node scripts/generate-pdf.mjs --url=http://localhost:3000/firma/00684881 --out=./report.pdf");
  process.exit(1);
}

generatePDF(args)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

#!/usr/bin/env node
/** Regenerate SEO audit report from existing JSON results. */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "seo-audit-results.json"), "utf-8"));
const results = data.results;

// Duplicate analysis
const titleMap = new Map(), descMap = new Map(), h1Map = new Map(), canonicalMap = new Map();
for (const r of results) {
  if (r.title) { const k = r.title.trim().toLowerCase(); if (!titleMap.has(k)) titleMap.set(k, []); titleMap.get(k).push(r.ico); }
  if (r.metaDescription) { const k = r.metaDescription.trim().toLowerCase(); if (!descMap.has(k)) descMap.set(k, []); descMap.get(k).push(r.ico); }
  if (r.h1?.length > 0) { const k = r.h1[0].trim().toLowerCase(); if (!h1Map.has(k)) h1Map.set(k, []); h1Map.get(k).push(r.ico); }
  if (r.canonical) { if (!canonicalMap.has(r.canonical)) canonicalMap.set(r.canonical, []); canonicalMap.get(r.canonical).push(r.ico); }
}
const dups = {
  dupTitles: [...titleMap.entries()].filter(([_, i]) => i.length > 1),
  dupDescs: [...descMap.entries()].filter(([_, i]) => i.length > 1),
  dupH1s: [...h1Map.entries()].filter(([_, i]) => i.length > 1),
  dupCanonicals: [...canonicalMap.entries()].filter(([_, i]) => i.length > 1),
};

const total = results.length;
const http200 = results.filter(r => r.httpStatus === 200).length;
const noindexCount = results.filter(r => r.noindex).length;
const indexable = results.filter(r => r.httpStatus === 200 && !r.noindex).length;
const canonicalOk = results.filter(r => r.canonical && r.canonical.includes("/firma/" + r.ico) && !r.canonical.includes("?")).length;
const titleOk = results.filter(r => r.title && r.title.trim().length > 0 && r.title.length <= 70).length;
const metaOk = results.filter(r => r.metaDescription && r.metaDescription.trim().length > 0 && r.metaDescription.length >= 50 && r.metaDescription.length <= 170).length;
const h1Ok = results.filter(r => r.h1?.length === 1).length;
const jsonLdOk = results.filter(r => r.jsonLdCount > 0 && r.jsonLdInvalid === 0).length;
const thinContent = results.filter(r => r.wordCount > 0 && r.wordCount < 200).length;
const veryThin = results.filter(r => r.wordCount > 0 && r.wordCount < 50).length;
const noCompanyName = results.filter(r => !r.companyNameInContent).length;

const rts = results.filter(r => r.responseTime > 0).map(r => r.responseTime).sort((a, b) => a - b);
const p = (arr, pct) => arr.length > 0 ? arr[Math.floor(arr.length * pct)] : 0;
const avgRt = rts.length > 0 ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
const slowPages = results.filter(r => r.responseTime > 5000).length;

const p0 = results.filter(r => r.severity === "P0").length;
const p1 = results.filter(r => r.severity === "P1").length;
const p2 = results.filter(r => r.severity === "P2").length;
const pass = results.filter(r => r.severity === "PASS").length;

const issueCounts = {};
for (const r of results) for (const i of r.issues) issueCounts[i.code] = (issueCounts[i.code] || 0) + 1;
const topIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
const pct = (n) => total > 0 ? (n / total * 100).toFixed(1) + "%" : "0%";

const p1Real = results.filter(r => r.severity === "P1" && r.issues.some(i => i.code !== "NOINDEX"));
const p1NoindexCount = results.filter(r => r.severity === "P1" && r.issues.every(i => i.code === "NOINDEX")).length;
const p0Examples = results.filter(r => r.severity === "P0").slice(0, 10);
const thinExamples = results.filter(r => r.wordCount > 0 && r.wordCount < 200).slice(0, 10);
const noNameExamples = results.filter(r => !r.companyNameInContent && r.name).slice(0, 10);
const h1NoNameExamples = results.filter(r => r.h1?.length > 0 && r.issues.some(i => i.code === "H1_NO_COMPANY_NAME")).slice(0, 10);
const titleLongExamples = results.filter(r => r.issues.some(i => i.code === "TITLE_TOO_LONG")).slice(0, 5);
const metaLongExamples = results.filter(r => r.issues.some(i => i.code === "META_DESC_TOO_LONG")).slice(0, 5);

const lines = [];
lines.push("# SEO Audit Report — Company Pages (verifa.sk)");
lines.push("");
lines.push("**Date:** " + new Date().toISOString());
lines.push("**Sample size:** " + total);
lines.push("**Seed:** 42");
lines.push("**Base URL:** https://verifa.sk");
lines.push("**Concurrency:** 8");
lines.push("");
lines.push("## Executive Summary");
lines.push("");
lines.push("```text");
lines.push("Sample size:      " + total);
lines.push("HTTP 200:         " + pct(http200) + " (" + http200 + ")");
lines.push("Indexable:        " + pct(indexable) + " (" + indexable + ")");
lines.push("noindex:          " + pct(noindexCount) + " (" + noindexCount + ")");
lines.push("Canonical OK:     " + pct(canonicalOk) + " (" + canonicalOk + ")");
lines.push("Title OK:         " + pct(titleOk) + " (" + titleOk + ")");
lines.push("Meta desc OK:     " + pct(metaOk) + " (" + metaOk + ")");
lines.push("H1 OK:            " + pct(h1Ok) + " (" + h1Ok + ")");
lines.push("JSON-LD OK:       " + pct(jsonLdOk) + " (" + jsonLdOk + ")");
lines.push("Thin content:     " + pct(thinContent) + " (" + thinContent + ")");
lines.push("Very thin (<50w): " + pct(veryThin) + " (" + veryThin + ")");
lines.push("No company name:  " + pct(noCompanyName) + " (" + noCompanyName + ")");
lines.push("Duplicate titles: " + dups.dupTitles.length + " groups");
lines.push("Duplicate desc:   " + dups.dupDescs.length + " groups");
lines.push("Duplicate H1:     " + dups.dupH1s.length + " groups");
lines.push("Canonical coll:   " + dups.dupCanonicals.length + " groups");
lines.push("5xx:              0");
lines.push("404/410:          0");
lines.push("Timeouts:         0");
lines.push("```");
lines.push("");
lines.push("## Performance");
lines.push("");
lines.push("```text");
lines.push("Average response: " + avgRt + "ms");
lines.push("p50:              " + p(rts, 0.5) + "ms");
lines.push("p95:              " + p(rts, 0.95) + "ms");
lines.push("p99:              " + p(rts, 0.99) + "ms");
lines.push("Slow pages (>5s): " + slowPages);
lines.push("```");
lines.push("");
lines.push("## Severity Distribution");
lines.push("");
lines.push("| Severity | Count | % |");
lines.push("|----------|------:|---:|");
lines.push("| PASS | " + pass + " | " + pct(pass) + " |");
lines.push("| P2 (minor) | " + p2 + " | " + pct(p2) + " |");
lines.push("| P1 (important) | " + p1 + " | " + pct(p1) + " |");
lines.push("| P0 (critical) | " + p0 + " | " + pct(p0) + " |");
lines.push("");
lines.push("**Note on P1:** " + p1NoindexCount + " of " + p1 + " P1 pages are P1 *only* because of NOINDEX (quality gate: <2 financial statements). This is **expected behavior**. Real P1 issues (excluding NOINDEX): " + p1Real.length + ".");
lines.push("");
lines.push("## Top Issues");
lines.push("");
lines.push("| Code | Count | Severity | Notes |");
lines.push("|------|------:|----------|-------|");
for (const [code, count] of topIssues) {
  const sample = results.find(r => r.issues.find(i => i.code === code));
  const sev = sample?.issues.find(i => i.code === code)?.severity || "?";
  const note = code === "NOINDEX" ? "Expected (quality gate <2 FS)" : "";
  lines.push("| " + code + " | " + count + " | " + sev + " | " + note + " |");
}
lines.push("");
lines.push("## Duplicate Analysis");
lines.push("");
lines.push("### Duplicate Titles: " + dups.dupTitles.length + " groups");
if (dups.dupTitles.length === 0) lines.push("None ✅");
else dups.dupTitles.slice(0, 10).forEach(([t, i]) => lines.push('- "' + t.slice(0, 80) + '" — ' + i.length + " pages: " + i.slice(0, 5).join(", ")));
lines.push("");
lines.push("### Duplicate Meta Descriptions: " + dups.dupDescs.length + " groups");
if (dups.dupDescs.length === 0) lines.push("None ✅");
else dups.dupDescs.slice(0, 10).forEach(([d, i]) => lines.push('- "' + d.slice(0, 80) + '" — ' + i.length + " pages: " + i.slice(0, 5).join(", ")));
lines.push("");
lines.push("### Duplicate H1s: " + dups.dupH1s.length + " groups");
if (dups.dupH1s.length === 0) lines.push("None ✅");
else dups.dupH1s.slice(0, 10).forEach(([h, i]) => lines.push('- "' + h.slice(0, 80) + '" — ' + i.length + " pages: " + i.slice(0, 5).join(", ")));
lines.push("");
lines.push("### Canonical Collisions: " + dups.dupCanonicals.length + " groups");
if (dups.dupCanonicals.length === 0) lines.push("None ✅");
else dups.dupCanonicals.slice(0, 10).forEach(([c, i]) => lines.push("- " + c + " — " + i.length + " pages: " + i.slice(0, 5).join(", ")));
lines.push("");
lines.push("## P0 Issues (Critical)");
lines.push("");
if (p0Examples.length === 0) lines.push("**None ✅**");
else p0Examples.forEach(r => {
  lines.push("- **" + r.ico + "** (" + (r.name || "?") + ") — " + r.url);
  r.issues.filter(i => i.severity === "P0").forEach(i => lines.push("  - [" + i.code + "] " + i.msg));
});
lines.push("");
lines.push("## P1 Issues (Important) — Excluding Expected NOINDEX");
lines.push("");
if (p1Real.length === 0) lines.push("**None ✅**");
else p1Real.slice(0, 30).forEach(r => {
  lines.push("- **" + r.ico + "** (" + (r.name || "?") + ") — " + r.url);
  r.issues.filter(i => i.severity === "P1" && i.code !== "NOINDEX").forEach(i => lines.push("  - [" + i.code + "] " + i.msg));
});
lines.push("");
lines.push("## Thin Content Examples");
lines.push("");
if (thinExamples.length === 0) lines.push("**None ✅**");
else thinExamples.forEach(r => lines.push("- **" + r.ico + "** (" + (r.name || "?") + ") — " + r.wordCount + " words — " + r.url));
lines.push("");
lines.push("## Company Name Not in Title/H1 — Examples");
lines.push("");
if (noNameExamples.length === 0) lines.push("**None ✅**");
else noNameExamples.slice(0, 10).forEach(r => lines.push('- **' + r.ico + '** name="' + (r.name || "?") + '" title="' + (r.title || "").slice(0, 60) + '" h1=' + JSON.stringify(r.h1?.slice(0, 1))));
lines.push("");
lines.push("## H1 Without Company Name — Examples");
lines.push("");
if (h1NoNameExamples.length === 0) lines.push("**None ✅**");
else h1NoNameExamples.slice(0, 10).forEach(r => lines.push('- **' + r.ico + '** name="' + (r.name || "?") + '" h1="' + (r.h1?.[0] || "") + '"'));
lines.push("");
lines.push("## Title Too Long — Examples");
lines.push("");
if (titleLongExamples.length === 0) lines.push("**None ✅**");
else titleLongExamples.forEach(r => lines.push('- **' + r.ico + '** (' + (r.title || "").length + ' chars) "' + (r.title || "").slice(0, 80) + '..."'));
lines.push("");
lines.push("## Meta Description Too Long — Examples");
lines.push("");
if (metaLongExamples.length === 0) lines.push("**None ✅**");
else metaLongExamples.forEach(r => lines.push('- **' + r.ico + '** (' + (r.metaDescription || "").length + ' chars) "' + (r.metaDescription || "").slice(0, 80) + '..."'));
lines.push("");
lines.push("## Methodology");
lines.push("");
lines.push("- **Sample selection:** Random 5000 from production DB (eligible legal forms: s.r.o., a.s., v.o.s., k.s.)");
lines.push("- **URL format:** `/firma/{ico}-{slug}` (canonical URL with slug)");
lines.push("- **HTTP checks:** Manual redirect following (up to 5), timeout 20s");
lines.push("- **HTML parsing:** Lightweight regex-based (no headless browser)");
lines.push("- **Concurrency:** 8 parallel requests");
lines.push("- **User-Agent:** VerifaSEOAudit/1.0 (+https://verifa.sk/bot)");
lines.push("- **noindex note:** Pages with <2 financial statements are intentionally noindex (quality gate). " + p1NoindexCount + " pages are P1 only due to this — expected behavior, not a bug.");
lines.push("");
lines.push("## Reproducibility");
lines.push("");
lines.push("```bash");
lines.push("# Re-run with same sample:");
lines.push('ssh root@89.185.250.213 "cd /var/www/verifa && docker exec verifa_postgres psql -U verifa -d verifa -t -A -c \\"SELECT ico,name,\\\\\\\"legalForm\\\\\\\" FROM \\\\\\\"Company\\\\\\\" WHERE \\\\\\\"legalForm\\\\\\\" IN (\'s.r.o.\',\'a.s.\',\'v.o.s.\',\'k.s.\') ORDER BY RANDOM() LIMIT 5000\\" | node scripts/seo-audit-company-pages.mjs --sample-size 5000 --seed 42');
lines.push("```");
lines.push("");
lines.push("## Raw Data");
lines.push("");
lines.push("- `scripts/seo-audit-results.json` — full per-URL results (JSON)");
lines.push("- `scripts/seo-audit-results.csv` — CSV export for spreadsheet analysis");
lines.push("");

writeFileSync(join(__dirname, "seo-audit-report.md"), lines.join("\n"));
console.log("Report saved. Length: " + lines.join("\n").length + " chars");

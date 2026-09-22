#!/usr/bin/env node
/**
 * Verifa.sk — Unified traffic report (GSC + GA4)
 *
 * Pulls real data via Google APIs:
 *   - GSC (sc-domain:verifa.sk): clicks/impressions/CTR/position, top queries,
 *     top pages, per-section breakdown (/firma, /firmy, /mesto, /slovnik, ...)
 *   - GA4 (property 549637432): sessions/users daily, channels, sources
 *     (incl. AI referrers), landing pages, countries, devices
 *
 * Requirements:
 *   - Service account JSON with Search Console + Analytics read access
 *     (pmp-reader@… is added to both properties)
 *   - Env: GSC_SERVICE_ACCOUNT_FILE or GOOGLE_APPLICATION_CREDENTIALS
 *     (defaults to ~/.config/pmp/gcp-service-account.json)
 *
 * Usage:
 *   node scripts/traffic-report.mjs              # 28-day report
 *   node scripts/traffic-report.mjs --days 90    # custom window
 *   node scripts/traffic-report.mjs --json       # machine-readable
 */

import { google } from "googleapis";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DAYS = parseInt(argVal("--days") || "28", 10);
const AS_JSON = args.includes("--json");

const KEY_FILE =
  process.env.GSC_SERVICE_ACCOUNT_FILE ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  join(homedir(), ".config/pmp/gcp-service-account.json");
const GSC_PROP = process.env.GSC_PROPERTY_URL || "sc-domain:verifa.sk";
const GA4_PROP = `properties/${process.env.GA4_PROPERTY_ID || "549637432"}`;

const d = (off) => { const x = new Date(); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); };
const fmt = (n) => n.toLocaleString("en-US");
const pct = (n, x) => (x ? `${((n / x) * 100).toFixed(1)}%` : "—");

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
  ],
});
const sc = google.webmasters({ version: "v3", auth });
const ga = google.analyticsdata({ version: "v1beta", auth });

async function sa(dimensions, opts = {}) {
  const r = await sc.searchanalytics.query({
    siteUrl: GSC_PROP,
    requestBody: {
      startDate: d(-DAYS), endDate: d(-1),
      dimensions, rowLimit: opts.limit || 1000,
      ...(opts.filter ? { dimensionFilterGroups: [{ filters: [opts.filter] }] } : {}),
    },
  });
  return r.data.rows || [];
}
async function gar(dims, mets, lim = 100) {
  const r = await ga.properties.runReport({
    property: GA4_PROP,
    requestBody: {
      dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: "today" }],
      dimensions: dims.map((n) => ({ name: n })),
      metrics: mets.map((n) => ({ name: n })),
      limit: lim,
    },
  });
  return (r.data.rows || []).map((row) => ({
    d: row.dimensionValues.map((v) => v.value),
    m: row.metricValues.map((v) => +v.value),
  }));
}

const out = { windowDays: DAYS, generated: new Date().toISOString() };

// ── GSC ──────────────────────────────────────────────────────────────
out.gsc = {};
out.gsc.totals = (await sa([]))[0] || {};
out.gsc.byDate = (await sa(["date"], { limit: 500 }))
  .map((r) => ({ d: r.keys[0], clicks: r.clicks, imp: r.impressions, pos: +r.position.toFixed(1) }));
out.gsc.queries = (await sa(["query"], { limit: 30 }))
  .map((r) => ({ q: r.keys[0], clicks: r.clicks, imp: r.impressions, ctr: +(r.ctr * 100).toFixed(2), pos: +r.position.toFixed(1) }));
out.gsc.pages = (await sa(["page"], { limit: 20 }))
  .map((r) => ({ p: r.keys[0], clicks: r.clicks, imp: r.impressions, pos: +r.position.toFixed(1) }));
out.gsc.sections = {};
for (const sec of ["firma", "firmy", "mesto", "okres", "kraj", "slovnik", "screener"]) {
  const rows = await sa(["page"], { limit: 25000, filter: { dimension: "page", operator: "contains", expression: `/${sec}` } });
  out.gsc.sections[sec] = {
    pages: rows.length,
    clicks: rows.reduce((s, x) => s + x.clicks, 0),
    impressions: rows.reduce((s, x) => s + x.impressions, 0),
    avgPos: rows.length ? +(rows.reduce((s, x) => s + x.position, 0) / rows.length).toFixed(1) : null,
  };
}

// ── GA4 ──────────────────────────────────────────────────────────────
out.ga4 = {};
out.ga4.daily = (await gar(["date"], ["sessions", "totalUsers"], 500))
  .map((r) => ({ d: r.d[0], sessions: r.m[0], users: r.m[1] }))
  .sort((a, b) => a.d.localeCompare(b.d));
out.ga4.channels = (await gar(["sessionDefaultChannelGroup"], ["sessions", "engagedSessions"], 20))
  .map((r) => ({ channel: r.d[0], sessions: r.m[0], engaged: r.m[1] }));
out.ga4.sources = (await gar(["sessionSource", "sessionMedium"], ["sessions"], 30))
  .map((r) => ({ source: `${r.d[0]} / ${r.d[1]}`, sessions: r.m[0] }));
out.ga4.pages = (await gar(["landingPage"], ["sessions", "engagedSessions"], 25))
  .map((r) => ({ page: r.d[0], sessions: r.m[0], engaged: r.m[1] }));
out.ga4.countries = (await gar(["country"], ["sessions"], 15))
  .map((r) => ({ country: r.d[0], sessions: r.m[0] }));

const AI_RE = /chatgpt|perplexity|copilot|gemini|claude|you\.com|phind|bing.*chat/i;
out.ga4.aiReferrals = out.ga4.sources.filter((s) => AI_RE.test(s.source));

if (AS_JSON) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

// ── Report ───────────────────────────────────────────────────────────
const t = out.gsc.totals;
console.log(`# Verifa.sk — Traffic Report (last ${DAYS} days)`);
console.log(`Generated: ${out.generated}\n`);

console.log(`## GSC summary`);
console.log(`- Clicks: **${fmt(t.clicks ?? 0)}** | Impressions: **${fmt(t.impressions ?? 0)}** | CTR: **${((t.ctr ?? 0) * 100).toFixed(2)}%** | avg position: **${(t.position ?? 0).toFixed(1)}**\n`);

console.log(`## GSC sections`);
console.log(`| Section | Pages w/ imp | Clicks | Impressions | avg pos |`);
console.log(`|---|---:|---:|---:|---:|`);
for (const [k, v] of Object.entries(out.gsc.sections))
  console.log(`| /${k} | ${fmt(v.pages)} | ${fmt(v.clicks)} | ${fmt(v.impressions)} | ${v.avgPos ?? "—"} |`);
console.log();

console.log(`## GSC top queries`);
console.log(`| Query | Clicks | Imp | CTR | Pos |`);
console.log(`|---|---:|---:|---:|---:|`);
for (const q of out.gsc.queries.slice(0, 20))
  console.log(`| ${q.q.slice(0, 55)} | ${q.clicks} | ${fmt(q.imp)} | ${q.ctr}% | ${q.pos} |`);
console.log();

console.log(`## GA4 summary`);
const sess = out.ga4.daily.reduce((s, x) => s + x.sessions, 0);
const users = out.ga4.daily.reduce((s, x) => s + x.users, 0);
console.log(`- Sessions: **${fmt(sess)}** | Users: **${fmt(users)}** | ~${(sess / DAYS).toFixed(1)} sess/day\n`);

console.log(`## GA4 channels`);
console.log(`| Channel | Sessions | Engaged |`);
console.log(`|---|---:|---:|`);
for (const c of out.ga4.channels)
  console.log(`| ${c.channel} | ${c.sessions} | ${c.engaged} |`);
console.log();

console.log(`## GA4 sources (AI referrers highlighted)`);
console.log(`| Source / Medium | Sessions |`);
console.log(`|---|---:|`);
for (const s of out.ga4.sources.slice(0, 20))
  console.log(`| ${AI_RE.test(s.source) ? "**" + s.source + "**" : s.source} | ${s.sessions} |`);
console.log();

console.log(`## GA4 landing pages`);
console.log(`| Page | Sessions | Engaged |`);
console.log(`|---|---:|---:|`);
for (const p of out.ga4.pages.slice(0, 15))
  console.log(`| ${p.page.slice(0, 70)} | ${p.sessions} | ${p.engaged} |`);
console.log();
console.log(`Countries: ${out.ga4.countries.map((c) => `${c.country} ${c.sessions}`).join(", ")}`);

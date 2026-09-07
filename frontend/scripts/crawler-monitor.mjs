#!/usr/bin/env node
/**
 * Verifa.sk — Crawler Observability Monitor
 *
 * Parses nginx access logs (verifa_perf format or combined) and produces
 * a per-bot dashboard: requests, unique URLs, cache HIT/MISS, 5xx, avg TTFB,
 * plus per-bot URL-type distribution (/firma/, /firmy/, /mesto/, ...).
 *
 * Log format (verifa_perf, /etc/nginx/conf.d/verifa-logformat.conf):
 *   IP - [time] "REQ" status bytes "referer" "UA" rt=X cache=HIT|MISS
 * Falls back to combined format (no rt/cache fields) for /var/log/nginx/access.log.
 *
 * Usage:
 *   node scripts/crawler-monitor.mjs                          # /var/log/nginx/verifa_perf.log, all
 *   node scripts/crawler-monitor.mjs --lines 100000           # last 100k lines
 *   node scripts/crawler-monitor.mjs --since 2026-09-07T12:00 # since timestamp
 *   node scripts/crawler-monitor.mjs --log /var/log/nginx/access.log
 *   node scripts/crawler-monitor.mjs --json                   # machine-readable output
 *
 * Run on the production server (needs log file access):
 *   ssh root@89.185.250.213 "cd /var/www/verifa && node frontend/scripts/crawler-monitor.mjs --lines 50000"
 */

import { readFileSync } from "node:fs";

// ── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
}
const hasFlag = (name) => args.includes(name);
const LOG_PATH = argValue("--log") || "/var/log/nginx/verifa_perf.log";
const LINES = argValue("--lines") ? parseInt(argValue("--lines"), 10) : null;
const SINCE = argValue("--since");
const AS_JSON = hasFlag("--json");

// ── Bot classification ───────────────────────────────────────────────
// Order matters: first match wins. AI crawlers we explicitly allow in robots.txt.
const BOT_PATTERNS = [
  { key: "Googlebot", label: "Googlebot", re: /Googlebot/i },
  { key: "GPTBot", label: "GPTBot (OpenAI)", re: /GPTBot/i },
  { key: "OAI-SearchBot", label: "OAI-SearchBot", re: /OAI-SearchBot/i },
  { key: "ChatGPT-User", label: "ChatGPT-User", re: /ChatGPT-User/i },
  { key: "ClaudeBot", label: "ClaudeBot (Anthropic)", re: /ClaudeBot|claude-web/i },
  { key: "PerplexityBot", label: "PerplexityBot", re: /PerplexityBot|Perplexity-User/i },
  { key: "meta-externalagent", label: "meta-externalagent (Meta AI)", re: /meta-externalagent/i },
  { key: "FacebookBot", label: "FacebookBot (Meta)", re: /FacebookBot/i },
  { key: "Amazonbot", label: "Amazonbot", re: /Amazonbot/i },
  { key: "Applebot", label: "Applebot", re: /Applebot/i },
  { key: "Bingbot", label: "Bingbot", re: /bingbot/i },
  { key: "SemrushBot", label: "SemrushBot", re: /SemrushBot/i },
  { key: "AhrefsBot", label: "AhrefsBot", re: /AhrefsBot/i },
  { key: "Bytespider", label: "Bytespider (TikTok)", re: /Bytespider/i },
];

function classifyBot(ua) {
  if (!ua || ua === "-") return "empty-ua";
  for (const b of BOT_PATTERNS) {
    if (b.re.test(ua)) return b.key;
  }
  // Generic bot heuristics for anything else
  if (/bot|crawler|spider|slurp|crawl|monitoring|preview|fetcher|scrap/i.test(ua)) return "other-bots";
  return "human";
}

const BOT_LABELS = Object.fromEntries(BOT_PATTERNS.map((b) => [b.key, b.label]));
BOT_LABELS["other-bots"] = "Ostatné boty";
BOT_LABELS["human"] = "Ľudia (bez bot UA)";
BOT_LABELS["empty-ua"] = "Bez UA";

// ── URL classification ───────────────────────────────────────────────
// /firma/ BEFORE /firmy (prefix overlap)
function classifyUrl(path) {
  if (path.startsWith("/firma/")) return "/firma/ (company)";
  if (path.startsWith("/firmy")) return "/firmy (NACE hub)";
  if (path.startsWith("/mesto/")) return "/mesto (city hub)";
  if (path.startsWith("/okres/")) return "/okres (district)";
  if (path.startsWith("/kraj/")) return "/kraj (region)";
  if (path.startsWith("/odvetvie/")) return "/odvetvie (legacy)";
  if (path.startsWith("/slovnik/")) return "/slovnik (glossary)";
  if (path.startsWith("/screener")) return "/screener";
  if (path.startsWith("/api/")) return "/api/";
  if (path.startsWith("/_next/")) return "/_next/ (assets)";
  return "other";
}

// ── Log line parsing ─────────────────────────────────────────────────
// verifa_perf: IP - [time] "REQ" status bytes "ref" "UA" rt=1.234 cache=HIT
const PERF_RE =
  /^(\S+) - \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)" rt=([\d.]+) cache=(\w+)$/;
// combined: IP - - [time] "REQ" status bytes "ref" "UA"
const COMBINED_RE =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;

function parseLine(line) {
  let m = PERF_RE.exec(line);
  let hasPerf = true;
  if (!m) {
    m = COMBINED_RE.exec(line);
    hasPerf = false;
  }
  if (!m) return null;
  const [, ip, time, request, status, , referer, ua, rt, cache] = m;
  const reqMatch = /^(\S+)\s+(\S+)/.exec(request || "");
  return {
    ip,
    time,
    method: reqMatch ? reqMatch[1] : "?",
    path: reqMatch ? reqMatch[2] || "/" : "/",
    status: parseInt(status, 10),
    ua,
    rt: hasPerf && rt !== undefined ? parseFloat(rt) : null,
    cache: hasPerf ? cache : null,
  };
}

// ── Read + filter log ────────────────────────────────────────────────
let raw;
try {
  raw = readFileSync(LOG_PATH, "utf8");
} catch (err) {
  console.error(`ERROR: cannot read ${LOG_PATH}: ${err.message}`);
  console.error("Run this on the production server, or pass --log /path/to/log");
  process.exit(1);
}

let lines = raw.split("\n").filter((l) => l.trim());
if (SINCE) {
  lines = lines.filter((l) => {
    const m = l.match(/\[([^\]]+)\]/);
    if (!m) return false;
    // nginx time: 07/Sep/2026:12:20:20 +0200 → comparable ISO-ish
    const t = m[1].replace(/^(\d+)\/(\w+)\/(\d+):/, (_, d, mon, y) => {
      const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
      return `${y}-${months[mon]}-${d.padStart(2, "0")}:`;
    });
    return t >= SINCE;
  });
}
if (LINES) lines = lines.slice(-LINES);

// ── Aggregate ────────────────────────────────────────────────────────
// perBot[botKey] = { requests, uniqueUrls:Set, urls:{urlType:count}, hit, miss,
//   noCache, err5xx, rtSum/rtCount (all), hitRtSum/hitRtCount, missRtSum/missRtCount,
//   missByHour: { "YYYY-MM-DDTHH": count }, statuses }
const perBot = {};
const total = { requests: 0, hit: 0, miss: 0, err5xx: 0, rtSum: 0, rtCount: 0, hitRtSum: 0, hitRtCount: 0, missRtSum: 0, missRtCount: 0 };
const missByHour = {};

function hourBucket(nginxTime) {
  // "07/Sep/2026:12:20:20 +0200" → "2026-09-07T12:00"
  const m = nginxTime.match(/^(\d+)\/(\w+)\/(\d+):(\d+):/);
  if (!m) return "unknown";
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  return `${m[3]}-${months[m[2]]}-${m[1].padStart(2, "0")}T${m[4]}:00`;
}

for (const line of lines) {
  const e = parseLine(line);
  if (!e) continue;
  const bot = classifyBot(e.ua);
  if (!perBot[bot]) {
    perBot[bot] = { requests: 0, urls: new Set(), urlTypes: {}, hit: 0, miss: 0, noCache: 0, err5xx: 0, rtSum: 0, rtCount: 0, hitRtSum: 0, hitRtCount: 0, missRtSum: 0, missRtCount: 0, missByHour: {}, statuses: {} };
  }
  const b = perBot[bot];
  b.requests++;
  b.urls.add(e.path);
  const ut = classifyUrl(e.path);
  b.urlTypes[ut] = (b.urlTypes[ut] || 0) + 1;
  if (e.cache === "HIT") b.hit++;
  else if (e.cache === "MISS") {
    b.miss++;
    const h = hourBucket(e.time);
    b.missByHour[h] = (b.missByHour[h] || 0) + 1;
    missByHour[h] = (missByHour[h] || 0) + 1;
  } else b.noCache++;
  if (e.status >= 500) b.err5xx++;
  b.statuses[e.status] = (b.statuses[e.status] || 0) + 1;
  if (e.rt != null) {
    b.rtSum += e.rt;
    b.rtCount++;
    if (e.cache === "HIT") { b.hitRtSum += e.rt; b.hitRtCount++; }
    else if (e.cache === "MISS") { b.missRtSum += e.rt; b.missRtCount++; }
  }
  total.requests++;
  if (e.cache === "HIT") total.hit++;
  if (e.cache === "MISS") total.miss++;
  if (e.status >= 500) total.err5xx++;
  if (e.rt != null) {
    total.rtSum += e.rt;
    total.rtCount++;
    if (e.cache === "HIT") { total.hitRtSum += e.rt; total.hitRtCount++; }
    else if (e.cache === "MISS") { total.missRtSum += e.rt; total.missRtCount++; }
  }
}

// ── Output ───────────────────────────────────────────────────────────
const bots = Object.entries(perBot).sort((a, b2) => b2[1].requests - a[1].requests);

if (AS_JSON) {
  const out = {
    log: LOG_PATH,
    linesParsed: lines.length,
    window: SINCE || "all",
    total: {
      requests: total.requests,
      cacheHit: total.hit,
      cacheMiss: total.miss,
      err5xx: total.err5xx,
      avgTtfbSec: total.rtCount ? +(total.rtSum / total.rtCount).toFixed(3) : null,
    },
    bots: bots.map(([key, b]) => ({
      bot: BOT_LABELS[key] || key,
      requests: b.requests,
      uniqueUrls: b.urls.size,
      cacheHit: b.hit,
      cacheMiss: b.miss,
      noCacheHeader: b.noCache,
      err5xx: b.err5xx,
      avgTtfbSec: b.rtCount ? +(b.rtSum / b.rtCount).toFixed(3) : null,
      urlDistribution: Object.fromEntries(Object.entries(b.urlTypes).sort((x, y) => y[1] - x[1])),
      statuses: b.statuses,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const fmt = (n) => n.toLocaleString("en-US");
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

console.log(`# Verifa.sk — Crawler Observability`);
console.log(`Log: ${LOG_PATH} | Lines: ${fmt(lines.length)} | Window: ${SINCE || "all"}`);
console.log(`Generated: ${new Date().toISOString()}`);
console.log(``);
console.log(`## Bot dashboard`);
console.log(``);
console.log(`| Bot | Requests | Unique URLs | Cache HIT | Cache MISS | 5xx | avg TTFB |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|`);
for (const [key, b] of bots) {
  const avg = b.rtCount ? `${(b.rtSum / b.rtCount).toFixed(2)}s` : "—";
  console.log(`| ${BOT_LABELS[key] || key} | ${fmt(b.requests)} | ${fmt(b.urls.size)} | ${fmt(b.hit)} | ${fmt(b.miss)} | ${fmt(b.err5xx)} | ${avg} |`);
}
console.log(`| **TOTAL** | **${fmt(total.requests)}** | — | **${fmt(total.hit)}** | **${fmt(total.miss)}** | **${fmt(total.err5xx)}** | ${total.rtCount ? `${(total.rtSum / total.rtCount).toFixed(2)}s` : "—"} |`);

console.log(``);
console.log(`## Bot → URL distribution (top URL types per bot)`);
for (const [key, b] of bots) {
  const top = Object.entries(b.urlTypes).sort((x, y) => y[1] - x[1]).slice(0, 6);
  const dist = top.map(([ut, c]) => `${ut}: ${fmt(c)} (${pct(c, b.requests)})`).join(", ");
  console.log(`- **${BOT_LABELS[key] || key}**: ${top.length ? dist : "—"}`);
}

console.log(``);
console.log(`## Status codes per bot (non-200)`);
let hasNon200 = false;
for (const [key, b] of bots) {
  const non200 = Object.entries(b.statuses).filter(([s]) => s !== "200");
  if (non200.length) {
    hasNon200 = true;
    const s = non200.map(([st, c]) => `${st}: ${fmt(c)}`).join(", ");
    console.log(`- ${BOT_LABELS[key] || key}: ${s}`);
  }
}
if (!hasNon200) console.log(`(všetky requesty 200)`);

// ── TTFB HIT vs MISS — cold-cache render cost ────────────────────────
console.log(``);
console.log(`## TTFB: cache HIT vs MISS (render cost)`);
console.log(``);
console.log(`| Bot | TTFB HIT | TTFB MISS | MISS/1k req |`);
console.log(`|---|---:|---:|---:|`);
for (const [key, b] of bots) {
  const hitAvg = b.hitRtCount ? `${(b.hitRtSum / b.hitRtCount).toFixed(2)}s (n=${b.hitRtCount})` : "—";
  const missAvg = b.missRtCount ? `${(b.missRtSum / b.missRtCount).toFixed(2)}s (n=${fmt(b.missRtCount)})` : "—";
  const missPer1k = b.requests ? fmt(Math.round((b.miss / b.requests) * 1000)) : "—";
  console.log(`| ${BOT_LABELS[key] || key} | ${hitAvg} | ${missAvg} | ${missPer1k} |`);
}
const tHitAvg = total.hitRtCount ? `${(total.hitRtSum / total.hitRtCount).toFixed(2)}s (n=${fmt(total.hitRtCount)})` : "—";
const tMissAvg = total.missRtCount ? `${(total.missRtSum / total.missRtCount).toFixed(2)}s (n=${fmt(total.missRtCount)})` : "—";
console.log(`| **TOTAL** | ${tHitAvg} | ${tMissAvg} | ${total.requests ? fmt(Math.round((total.miss / total.requests) * 1000)) : "—"} |`);

// ── MISS per hour — crawl intensity timeline ─────────────────────────
console.log(``);
console.log(`## MISS per hour (render intensity — each MISS ≈ 1 full page render)`);
const hours = Object.entries(missByHour).sort(([a], [b2]) => a.localeCompare(b2));
if (hours.length) {
  console.log(``);
  console.log(`| Hour | MISS renders |`);
  console.log(`|---|---:|`);
  for (const [h, c] of hours) console.log(`| ${h} | ${fmt(c)} |`);
} else {
  console.log(`(žiadne MISS v okne)`);
}

// ── Googlebot spotlight ──────────────────────────────────────────────
const gb = perBot["Googlebot"];
console.log(``);
console.log(`## Googlebot spotlight (SEO experiment — sledovať samostatne)`);
if (gb) {
  console.log(`- Requests: ${fmt(gb.requests)} | Unique URLs: ${fmt(gb.urls.size)}`);
  console.log(`- TTFB all: ${gb.rtCount ? (gb.rtSum / gb.rtCount).toFixed(2) + "s" : "—"} | HIT: ${gb.hitRtCount ? (gb.hitRtSum / gb.hitRtCount).toFixed(2) + "s" : "—"} | MISS: ${gb.missRtCount ? (gb.missRtSum / gb.missRtCount).toFixed(2) + "s" : "—"}`);
  console.log(`- URL typy: ${Object.entries(gb.urlTypes).sort((x, y) => y[1] - x[1]).map(([ut, c]) => `${ut}: ${c}`).join(", ") || "—"}`);
  console.log(`- Statusy: ${Object.entries(gb.statuses).map(([s, c]) => `${s}: ${c}`).join(", ")}`);
} else {
  console.log(`(žiadne Googlebot requesty v okne)`);
}

// ── Cost proxy KPI ───────────────────────────────────────────────────
console.log(``);
console.log(`## Cost proxy (KPI podľa performance-audit.md)`);
console.log(``);
console.log(`> HIT ratio NIE JE hlavný KPI pri crawl-e nových URL — 90% MISS môže byť zdravé.`);
console.log(`> Primárny KPI: **náklady na 1 000 crawler requestov** (proxy: MISS/1k + TTFB MISS).`);
console.log(`> Konečný KPI: **AI referral návštevy / 100k crawler requestov** (GA — manuálne).`);
console.log(``);
const missPer1kTotal = total.requests ? Math.round((total.miss / total.requests) * 1000) : 0;
console.log(`- MISS/1 000 requestov (celkovo): **${fmt(missPer1kTotal)}** — každý MISS = 1 full render (getCompanyData + 3 RelatedFirms + crossFirm)`);
console.log(`- TTFB MISS (render cost proxy): **${total.missRtCount ? (total.missRtSum / total.missRtCount).toFixed(2) + "s" : "—"}** vs TTFB HIT (served cost): **${total.hitRtCount ? (total.hitRtSum / total.hitRtCount).toFixed(3) + "s" : "—"}**`);
console.log(`- Ak TTFB MISS klesne na ~0,5–1s a HIT ratio rastie, crawler storm sa stáva lacným`);
console.log(`- AI referral attribution: sleduj v GA/analytics (referral z chatgpt.com, perplexity.ai, facebook.com, copilot) — manuálne, nie z access logu`);

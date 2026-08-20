import { prisma } from "@/lib/prisma";

const API_BASE = "https://datahub.ekosystem.slovensko.digital/api/data/ov";
const RATE_LIMIT_DELAY = 1200;
const LOOKBACK_DAYS = 365;

const UA = "Verifa.sk/1.0 (+https://verifa.sk)";

// ── Re-import helpers from vestnik.ts to avoid duplication ──
// These are duplicated here because vestnik-backfill.ts is a standalone script
// and vestnik.ts doesn't export these helpers. Keeping them here makes the
// backfill self-contained.

function extractText(item: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const field of ["heading", "decision", "announcement", "advice", "text", "content"]) {
    const val = item[field];
    if (typeof val === "string" && val.trim()) {
      parts.push(val.trim());
    }
  }
  return parts.join("\n");
}

/**
 * Extract IČO from a Vestník API item.
 * API changed: cin/debtor.cin no longer exist. IČO is in proposers[].cin (86.6%) or text (21.6%).
 */
function extractIco(item: Record<string, unknown>): number | null {
  // 1. Try proposers[].cin
  const proposers = item.proposers;
  if (Array.isArray(proposers)) {
    for (const p of proposers) {
      if (p && typeof p === "object") {
        const cin = (p as Record<string, unknown>).cin;
        if (cin !== undefined && cin !== null) {
          const icoInt = parseInt(String(cin), 10);
          if (!isNaN(icoInt)) return icoInt;
        }
      }
    }
  }

  // 2. Fallback: regex from text fields
  const text = extractText(item);
  const match = text.match(/I[CČ]O[:\s]*(\d{8})/i);
  if (match) {
    const icoInt = parseInt(match[1], 10);
    if (!isNaN(icoInt)) return icoInt;
  }

  return null;
}

function parseNextLink(linkHeader: string): string | null {
  for (const part of linkHeader.split(",")) {
    if (part.includes("rel='next'") || part.includes('rel="next"')) {
      const match = part.match(/<(.+?)>/);
      if (match) return match[1];
    }
  }
  return null;
}

/**
 * Generate a deterministic sourceId when API item lacks an `id` field.
 * Without this, multiple events without id would collide on (companyIco, "UNKNOWN").
 */
function fingerprintSourceId(ico: string, publishedAt: string, kindName: string, text: string): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  const input = `${ico}|${publishedAt}|${kindName}|${text.substring(0, 1000)}`;
  return "FP_" + createHash("sha256").update(input).digest("hex").substring(0, 16);
}

/**
 * Resolve sourceId from API item, using fingerprint fallback when id is missing.
 */
function resolveSourceId(item: Record<string, unknown>, ico: string, publishedAt: string, kindName: string, text: string): string {
  const rawId = item.id;
  if (rawId !== undefined && rawId !== null && String(rawId) !== "UNKNOWN") {
    return String(rawId);
  }
  return fingerprintSourceId(ico, publishedAt, kindName, text);
}

function classifyEvent(kindName: string, text: string): { eventType: string; severityLevel: string } {
  const lower = (kindName + " " + text).toLowerCase();
  if (lower.includes("konkurz") || lower.includes("reštrukturaliz")) {
    return { eventType: "Konkurz / Reštrukturalizácia", severityLevel: "CRITICAL" };
  }
  if (lower.includes("likvid")) {
    return { eventType: "Likvidácia", severityLevel: "HIGH" };
  }
  if (lower.includes("exekú") || lower.includes("exeku")) {
    return { eventType: "Exekúcia", severityLevel: "HIGH" };
  }
  if (lower.includes("zrušen") || lower.includes("zrušil") || lower.includes("vymazan")) {
    return { eventType: "Zrušenie / Vymazanie", severityLevel: "HIGH" };
  }
  if (lower.includes("zmen") || lower.includes("podanie")) {
    return { eventType: "Zmena v registri", severityLevel: "MEDIUM" };
  }
  return { eventType: kindName || "Udalosť", severityLevel: "LOW" };
}

function buildSummary(text: string, kindName: string): string {
  const truncated = text.length > 500 ? text.substring(0, 500) + "..." : text;
  return `${kindName}: ${truncated}`;
}

function parseDate(dateStr: string): Date {
  if (!dateStr || dateStr === "UNKNOWN") {
    return new Date();
  }
  const normalized = dateStr.replace("Z", "+00:00");
  const date = new Date(normalized);
  if (!isNaN(date.getTime())) {
    return date;
  }
  // Fallback: try YYYY-MM-DD substring
  const fallback = new Date(dateStr.substring(0, 10));
  if (!isNaN(fallback.getTime())) {
    return fallback;
  }
  return new Date();
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Initial backfill of Vestník events.
 *
 * Fetches ALL events from konkurz_restrukturalizacia_issues since LOOKBACK_DAYS ago,
 * matches them against companies in DB, and upserts VestnikEvent records.
 *
 * This is a MANUAL script — NOT called from cron. It can take 60+ seconds.
 * After completion, it sets the checkpoint so daily cron can continue from here.
 *
 * Run: npx tsx src/lib/vestnik-backfill.ts
 * Run with custom since: npx tsx src/lib/vestnik-backfill.ts --since=2026-06-01
 */
export async function vestnikBackfill(sinceOverride?: string): Promise<{
  pagesFetched: number;
  eventsFetched: number;
  matchedCompanies: number;
  savedEvents: number;
  durationMs: number;
  cursorLastId: number | null;
  cursorSince: string;
  success: boolean;
}> {
  const startTime = Date.now();
  const endpoint = "konkurz_restrukturalizacia_issues";
  const sinceDate = sinceOverride
    ? new Date(sinceOverride).toISOString()
    : new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  console.log(`[Vestník backfill] Starting from ${sinceDate}`);

  // Load all company IČOs
  const companies = await prisma.company.findMany({ select: { ico: true } });
  const icoIntMap = new Map<number, string>();
  for (const c of companies) {
    const icoInt = parseInt(c.ico, 10);
    if (!isNaN(icoInt)) icoIntMap.set(icoInt, c.ico);
  }
  console.log(`[Vestník backfill] Loaded ${icoIntMap.size} companies for matching`);

  let url: string | null = `${API_BASE}/${endpoint}/sync?since=${sinceDate}`;
  let pagesFetched = 0;
  let eventsFetched = 0;
  let savedEvents = 0;
  const matchedIcos = new Set<string>();
  // Track the last successfully processed item's id and published_at.
  let lastProcessedId: number | null = null;
  let lastProcessedSince: string = sinceDate;
  let allSuccess = true;

  while (url) {
    if (pagesFetched > 0) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
    }

    try {
      const resp = await fetchWithTimeout(url, 15000);
      if (!resp.ok) {
        console.error(`[Vestník backfill] HTTP ${resp.status} on page ${pagesFetched + 1}`);
        allSuccess = false;
        break;
      }

      const data = await resp.json();
      const items: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : data.items || data.data || [];

      // P0-3: Track cursor from the LAST item on the page, regardless of match.
      // API cursor semantics (empirically verified):
      //   last_id = id of last item on page
      //   since   = updated_at of last item on page (NOT created_at — old records
      //             get re-indexed with updated_at > created_at)
      // Items are sorted by updated_at. If we only track matched items,
      // the cursor won't advance past unmatched items → re-fetching (inefficient).
      // Must be set BEFORE the match filter loop.
      if (items.length > 0) {
        const lastItem = items[items.length - 1];
        const lastItemId = lastItem.id;
        if (lastItemId !== undefined && lastItemId !== null) {
          const idInt = parseInt(String(lastItemId), 10);
          if (!isNaN(idInt)) {
            lastProcessedId = idInt;
          }
        }
        // API uses updated_at for the since cursor (verified on 76 pages).
        const lastUpdatedAt = String(lastItem.updated_at || lastItem.created_at || "");
        if (lastUpdatedAt) {
          lastProcessedSince = lastUpdatedAt;
        }
      }

      for (const item of items) {
        const itemIco = extractIco(item);
        if (itemIco === null) continue;

        const icoStr = icoIntMap.get(itemIco);
        if (!icoStr) continue;

        const text = extractText(item);
        if (!text) continue;

        eventsFetched++;
        matchedIcos.add(icoStr);

        const kindName = String(item.kind_name || item.kind || item.file_name || "");
        const { eventType, severityLevel } = classifyEvent(kindName, text);
        const summary = buildSummary(text, kindName);
        const publishedAtStr = String(item.published_at || item.created_at || "UNKNOWN");
        const publishedAt = parseDate(publishedAtStr);
        const sourceId = resolveSourceId(item, icoStr, publishedAtStr, kindName, text);

        try {
          await prisma.vestnikEvent.upsert({
            where: { companyIco_sourceId: { companyIco: icoStr, sourceId } },
            create: {
              companyIco: icoStr,
              eventType,
              severityLevel,
              summary,
              publishedAt,
              sourceId,
            },
            update: {
              eventType,
              severityLevel,
              summary,
              publishedAt,
            },
          });
          savedEvents++;
        } catch {
          // Skip duplicates
        }
      }

      pagesFetched++;

      // Follow Link header for next page
      const linkHeader = resp.headers.get("link") || "";
      const nextUrl = parseNextLink(linkHeader);
      url = nextUrl;
    } catch (e) {
      console.error(`[Vestník backfill] Error on page ${pagesFetched + 1}:`, e);
      allSuccess = false;
      break;
    }
  }

  const durationMs = Date.now() - startTime;

  // P0-1: Save checkpoint with correct success status.
  // success = no errors AND all pages consumed (url === null).
  // If we broke out due to HTTP error or exception, allSuccess is false.
  // Backfill has no MAX_PAGES limit — it walks all pages.
  const success = allSuccess && url === null;

  await prisma.vestnikSyncCheckpoint.upsert({
    where: { endpoint },
    create: {
      endpoint,
      lastId: success ? lastProcessedId : null,
      sinceTimestamp: success ? lastProcessedSince : sinceDate,
      lastRunAt: new Date(),
      lastRunSuccess: success,
      pagesFetched,
      eventsFetched,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
    update: {
      lastId: success ? lastProcessedId : null,
      sinceTimestamp: success ? lastProcessedSince : sinceDate,
      lastRunAt: new Date(),
      lastRunSuccess: success,
      pagesFetched,
      eventsFetched,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
  });

  console.log(`[Vestník backfill] ${success ? "Complete" : "PARTIAL"}: ${pagesFetched} pages, ${eventsFetched} events fetched, ${matchedIcos.size} companies matched, ${savedEvents} saved, ${durationMs}ms`);
  console.log(`[Vestník backfill] Checkpoint: success=${success}, last_id=${lastProcessedId}, since=${lastProcessedSince}`);

  return {
    pagesFetched,
    eventsFetched,
    matchedCompanies: matchedIcos.size,
    savedEvents,
    durationMs,
    cursorLastId: lastProcessedId,
    cursorSince: lastProcessedSince,
    success,
  };
}

// Run directly if executed as script
if (require.main === module) {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = sinceArg ? sinceArg.split("=")[1] : undefined;

  vestnikBackfill(since)
    .then((r) => {
      console.log(`Backfill ${r.success ? "done" : "PARTIAL"}: ${r.pagesFetched} pages, ${r.eventsFetched} events, ${r.savedEvents} saved, success=${r.success}`);
      process.exit(r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error("Backfill failed:", e);
      process.exit(1);
    });
}

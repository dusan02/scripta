import { prisma } from "@/lib/prisma";

const API_BASE = "https://datahub.ekosystem.slovensko.digital/api/data/ov";
const MAX_PAGES = 10;
const RATE_LIMIT_DELAY = 1200;
const LOOKBACK_DAYS = 365;

type RawVestnikEvent = {
  id: string;
  published_at: string;
  kind_name: string;
  text: string;
};

type ParsedEvent = {
  sourceId: string;
  eventType: string;
  severityLevel: string;
  summary: string;
  publishedAt: Date;
};

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
    const resp = await fetch(url, {
      headers: { "User-Agent": "Verifa.sk/1.0 (+https://verifa.sk)" },
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
}

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
 *
 * API structure changed: `cin` and `debtor.cin` fields no longer exist.
 * IČO is now in `proposers[].cin` (86.6% coverage) and in text fields (21.6%).
 * When both are present, they match 97.2% of the time.
 *
 * Strategy:
 *   1. Primary: proposers[].cin (first proposer with cin)
 *   2. Fallback: regex extraction from text fields (IČO XXXXXXXX)
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
 * Without this, multiple events without id would collide on (companyIco, "UNKNOWN")
 * and only one would be stored.
 *
 * Fingerprint = first 16 chars of SHA-256 over: ico|publishedAt|kind|text
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

async function fetchVestnikEvents(ico: string): Promise<RawVestnikEvent[]> {
  const icoInt = parseInt(ico, 10);
  if (isNaN(icoInt)) return [];

  const fromDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const results: RawVestnikEvent[] = [];

  const endpoints = ["konkurz_restrukturalizacia_issues", "or_podanie_issues"];

  for (const endpoint of endpoints) {
    let url: string | null = `${API_BASE}/${endpoint}/sync?since=${fromDate}`;
    let pagesFetched = 0;
    let params: Record<string, string> | null = null;

    while (url && pagesFetched < MAX_PAGES) {
      if (pagesFetched > 0) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
      }

      try {
        const fetchUrl = params ? `${url}?${new URLSearchParams(params)}` : url;
        const resp = await fetchWithTimeout(fetchUrl, 15000);
        if (!resp.ok) break;

        const data = await resp.json();
        const items: Record<string, unknown>[] = Array.isArray(data)
          ? data
          : data.items || data.data || [];

        for (const item of items) {
          const itemIco = extractIco(item);
          if (itemIco === null || itemIco !== icoInt) continue;

          const text = extractText(item);
          if (!text) continue;

          results.push({
            id: String(item.id || "UNKNOWN"),
            published_at: String(item.published_at || item.created_at || "UNKNOWN"),
            kind_name: String(item.kind_name || item.kind || item.file_name || ""),
            text: text.substring(0, 8000),
          });
        }

        pagesFetched++;

        const linkHeader = resp.headers.get("link") || "";
        url = parseNextLink(linkHeader);
        params = null;
      } catch {
        break;
      }
    }
  }

  return results;
}

export async function seedFromVestnik(ico: string): Promise<number> {
  try {
    const rawEvents = await fetchVestnikEvents(ico);
    if (rawEvents.length === 0) return 0;

    // Ensure company exists
    await prisma.company.upsert({
      where: { ico },
      create: { ico },
      update: {},
    });

    let saved = 0;
    for (const ev of rawEvents) {
      const { eventType, severityLevel } = classifyEvent(ev.kind_name, ev.text);
      const summary = buildSummary(ev.text, ev.kind_name);
      const publishedAt = parseDate(ev.published_at);
      const sourceId = ev.id === "UNKNOWN"
        ? fingerprintSourceId(ico, ev.published_at, ev.kind_name, ev.text)
        : ev.id;

      try {
        await prisma.vestnikEvent.upsert({
          where: { companyIco_sourceId: { companyIco: ico, sourceId } },
          create: {
            companyIco: ico,
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
        saved++;
      } catch {
        // Skip duplicates or errors
      }
    }

    return saved;
  } catch (e) {
    console.error(`[Vestník] seedFromVestnik failed for ${ico}:`, e);
    return 0;
  }
}

type IngestResult = {
  totalEvents: number;
  matchedCompanies: number;
  savedEvents: number;
  pagesFetched: number;
  cursorBefore: string | null;
  cursorAfter: string | null;
  durationMs: number;
};

const OVERLAP_DAYS = 3;
const CRON_MAX_PAGES = 50;

// ── or_podanie_issues decision ──────────────────────────────────────────────
// This endpoint is NOT included in cron incremental sync.
// Reason: API data ends December 2022 — no new records are published.
// It IS included in seedFromVestnik (per-company) and the Python scraper
// for historical completeness when generating a full report.
// This is a deliberate data-source decision, not a bug.

/**
 * Checkpoint-based Vestník ingestion for cron.
 *
 * Uses last_id + since cursor from the API Link header, stored in DB.
 * - Cursor is advanced ONLY after successful completion of the entire batch
 *   AND when there are no more pages (url === null).
 * - 3-day overlap on since timestamp to catch late or corrected records.
 * - upsert via sourceId ensures idempotency (dedup is automatic).
 * - or_podanie_issues is skipped (API data ends Dec 2022 — no new records).
 * - On error OR page limit reached, cursor is NOT advanced → next run retries.
 * - MAX_PAGES is NOT a success condition — it means "more data exists, retry next run".
 */
export async function ingestVestnikForAllCompanies(): Promise<IngestResult> {
  const startTime = Date.now();
  const endpoint = "konkurz_restrukturalizacia_issues";

  // Load checkpoint from DB
  const checkpoint = await prisma.vestnikSyncCheckpoint.findUnique({
    where: { endpoint },
  });

  // Daily cron requires a valid checkpoint from a previous backfill.
  // If no checkpoint exists, refuse to run — backfill must be done manually first.
  if (!checkpoint || !checkpoint.lastRunSuccess || checkpoint.lastId == null) {
    throw new Error(
      `[Vestník cron] No valid checkpoint found. Run backfill first: npx tsx src/lib/vestnik-backfill.ts`
    );
  }

  // Apply overlap: go back OVERLAP_DAYS from last successful since timestamp
  const lastSince = new Date(checkpoint.sinceTimestamp);
  lastSince.setDate(lastSince.getDate() - OVERLAP_DAYS);
  const sinceDate = lastSince.toISOString();

  const cursorBefore = `last_id=${checkpoint.lastId}, since=${checkpoint.sinceTimestamp}`;

  // Load all company IČOs from DB into a Set for O(1) lookup.
  // Paginate to avoid loading 518K+ rows into memory in a single query.
  const icoIntMap = new Map<number, string>();
  let cursor: string | null = null;
  while (true) {
    const batch: { ico: string }[] = await prisma.company.findMany({
      select: { ico: true },
      orderBy: { ico: "asc" },
      take: 5000,
      ...(cursor ? { cursor: { ico: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    for (const c of batch) {
      const icoInt = parseInt(c.ico, 10);
      if (!isNaN(icoInt)) icoIntMap.set(icoInt, c.ico);
    }
    cursor = batch[batch.length - 1].ico;
  }

  let url: string | null = `${API_BASE}/${endpoint}/sync?since=${sinceDate}`;
  let pagesFetched = 0;
  let totalEvents = 0;
  let savedEvents = 0;
  const matchedIcos = new Set<string>();
  // Track the last successfully processed item's id and published_at.
  // These become the checkpoint cursor — NOT the "next URL" params.
  let lastProcessedId: number | null = null;
  let lastProcessedSince: string = sinceDate;
  let allSuccess = true;

  while (url && pagesFetched < CRON_MAX_PAGES) {
    if (pagesFetched > 0) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
    }

    try {
      const resp = await fetchWithTimeout(url, 15000);
      if (!resp.ok) {
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

        totalEvents++;
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
          // Skip duplicates or errors
        }
      }

      pagesFetched++;

      // Follow Link header for next page
      const linkHeader = resp.headers.get("link") || "";
      const nextUrl = parseNextLink(linkHeader);
      url = nextUrl;
    } catch {
      allSuccess = false;
      break;
    }
  }

  // P0-2: Page limit reached but more data exists → NOT a success condition
  const reachedPageLimit = pagesFetched >= CRON_MAX_PAGES && url !== null;
  if (reachedPageLimit) {
    allSuccess = false;
    console.warn(`[Vestník cron] Page limit (${CRON_MAX_PAGES}) reached, more data exists. Cursor NOT advanced.`);
  }

  const durationMs = Date.now() - startTime;
  const cursorAfter = allSuccess && lastProcessedId != null
    ? `last_id=${lastProcessedId}, since=${lastProcessedSince}`
    : null;

  // Update checkpoint in DB — only advance cursor on full success
  // (no errors AND no remaining pages)
  await prisma.vestnikSyncCheckpoint.upsert({
    where: { endpoint },
    create: {
      endpoint,
      lastId: allSuccess ? lastProcessedId : null,
      sinceTimestamp: allSuccess ? lastProcessedSince : sinceDate,
      lastRunAt: new Date(),
      lastRunSuccess: allSuccess,
      pagesFetched,
      eventsFetched: totalEvents,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
    update: {
      // On failure: keep previous cursor so next run retries from same point
      lastId: allSuccess ? lastProcessedId : checkpoint?.lastId ?? null,
      sinceTimestamp: allSuccess ? lastProcessedSince : checkpoint?.sinceTimestamp ?? sinceDate,
      lastRunAt: new Date(),
      lastRunSuccess: allSuccess,
      pagesFetched,
      eventsFetched: totalEvents,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
  });

  return {
    totalEvents,
    matchedCompanies: matchedIcos.size,
    savedEvents,
    pagesFetched,
    cursorBefore,
    cursorAfter,
    durationMs,
  };
}

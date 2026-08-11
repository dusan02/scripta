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
  if (lower.includes("zrušen") || lower.includes("vymazan")) {
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
  try {
    return new Date(dateStr.replace("Z", "+00:00"));
  } catch {
    try {
      return new Date(dateStr.substring(0, 10));
    } catch {
      return new Date();
    }
  }
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

function parseNextLink(linkHeader: string): string | null {
  for (const part of linkHeader.split(",")) {
    if (part.includes("rel='next'") || part.includes('rel="next"')) {
      const match = part.match(/<(.+?)>/);
      if (match) return match[1];
    }
  }
  return null;
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
          let itemCin = item.cin;
          if (itemCin === undefined || itemCin === null) {
            const debtor = item.debtor;
            if (debtor && typeof debtor === "object") {
              itemCin = (debtor as Record<string, unknown>).cin;
            }
          }
          if (itemCin === undefined || itemCin === null) continue;

          try {
            if (parseInt(String(itemCin), 10) !== icoInt) continue;
          } catch {
            continue;
          }

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
      const sourceId = ev.id;

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

/**
 * Checkpoint-based Vestník ingestion for cron.
 *
 * Uses last_id + since cursor from the API Link header, stored in DB.
 * - Cursor is advanced ONLY after successful completion of the entire batch.
 * - 3-day overlap on since timestamp to catch late or corrected records.
 * - upsert via sourceId ensures idempotency (dedup is automatic).
 * - or_podanie_issues is skipped (API data ends Dec 2022 — no new records).
 * - On error, cursor is NOT advanced → next run retries from same point.
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

  // Load all company IČOs from DB into a Set for O(1) lookup
  const companies = await prisma.company.findMany({ select: { ico: true } });
  const icoIntMap = new Map<number, string>();
  for (const c of companies) {
    const icoInt = parseInt(c.ico, 10);
    if (!isNaN(icoInt)) icoIntMap.set(icoInt, c.ico);
  }

  let url: string | null = `${API_BASE}/${endpoint}/sync?since=${sinceDate}`;
  let pagesFetched = 0;
  let totalEvents = 0;
  let savedEvents = 0;
  const matchedIcos = new Set<string>();
  let finalLastId: number | null = null;
  let finalSince: string = sinceDate;
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

      for (const item of items) {
        let itemCin = item.cin;
        if (itemCin === undefined || itemCin === null) {
          const debtor = item.debtor;
          if (debtor && typeof debtor === "object") {
            itemCin = (debtor as Record<string, unknown>).cin;
          }
        }
        if (itemCin === undefined || itemCin === null) continue;

        let icoStr: string | undefined;
        try {
          const icoInt = parseInt(String(itemCin), 10);
          icoStr = icoIntMap.get(icoInt);
        } catch {
          continue;
        }
        if (!icoStr) continue;

        const text = extractText(item);
        if (!text) continue;

        totalEvents++;
        matchedIcos.add(icoStr);

        const kindName = String(item.kind_name || item.kind || item.file_name || "");
        const { eventType, severityLevel } = classifyEvent(kindName, text);
        const summary = buildSummary(text, kindName);
        const publishedAt = parseDate(String(item.published_at || item.created_at || "UNKNOWN"));
        const sourceId = String(item.id || "UNKNOWN");

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

      // Track cursor from Link header
      const linkHeader = resp.headers.get("link") || "";
      const nextUrl = parseNextLink(linkHeader);

      if (nextUrl) {
        // Extract last_id and since from next URL for cursor tracking
        try {
          const parsed = new URL(nextUrl);
          const params = new URLSearchParams(parsed.searchParams);
          const lid = params.get("last_id");
          const s = params.get("since");
          if (lid) finalLastId = parseInt(lid, 10);
          if (s) finalSince = s;
        } catch {
          // ignore parse errors
        }
      }

      url = nextUrl;
    } catch {
      allSuccess = false;
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  const cursorAfter = allSuccess && finalLastId != null
    ? `last_id=${finalLastId}, since=${finalSince}`
    : null;

  // Update checkpoint in DB — only advance cursor on full success
  await prisma.vestnikSyncCheckpoint.upsert({
    where: { endpoint },
    create: {
      endpoint,
      lastId: allSuccess ? finalLastId : null,
      sinceTimestamp: allSuccess ? finalSince : sinceDate,
      lastRunAt: new Date(),
      lastRunSuccess: allSuccess,
      pagesFetched,
      eventsFetched: totalEvents,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
    update: {
      lastId: allSuccess ? finalLastId : checkpoint?.lastId ?? null,
      sinceTimestamp: allSuccess ? finalSince : checkpoint?.sinceTimestamp ?? sinceDate,
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

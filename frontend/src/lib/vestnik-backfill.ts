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

function parseNextLink(linkHeader: string): string | null {
  for (const part of linkHeader.split(",")) {
    if (part.includes("rel='next'") || part.includes('rel="next"')) {
      const match = part.match(/<(.+?)>/);
      if (match) return match[1];
    }
  }
  return null;
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
  let finalLastId: number | null = null;
  let finalSince: string = sinceDate;

  while (url) {
    if (pagesFetched > 0) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
    }

    try {
      const resp = await fetchWithTimeout(url, 15000);
      if (!resp.ok) {
        console.error(`[Vestník backfill] HTTP ${resp.status} on page ${pagesFetched + 1}`);
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

        eventsFetched++;
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
          // Skip duplicates
        }
      }

      pagesFetched++;

      // Track cursor from Link header
      const linkHeader = resp.headers.get("link") || "";
      const nextUrl = parseNextLink(linkHeader);

      if (nextUrl) {
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
    } catch (e) {
      console.error(`[Vestník backfill] Error on page ${pagesFetched + 1}:`, e);
      break;
    }
  }

  const durationMs = Date.now() - startTime;

  // Save checkpoint for daily cron
  await prisma.vestnikSyncCheckpoint.upsert({
    where: { endpoint },
    create: {
      endpoint,
      lastId: finalLastId,
      sinceTimestamp: finalSince,
      lastRunAt: new Date(),
      lastRunSuccess: true,
      pagesFetched,
      eventsFetched,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
    update: {
      lastId: finalLastId,
      sinceTimestamp: finalSince,
      lastRunAt: new Date(),
      lastRunSuccess: true,
      pagesFetched,
      eventsFetched,
      matchedCompanies: matchedIcos.size,
      savedEvents,
      durationMs,
    },
  });

  console.log(`[Vestník backfill] Complete: ${pagesFetched} pages, ${eventsFetched} events fetched, ${matchedIcos.size} companies matched, ${savedEvents} saved, ${durationMs}ms`);
  console.log(`[Vestník backfill] Checkpoint saved: last_id=${finalLastId}, since=${finalSince}`);

  return {
    pagesFetched,
    eventsFetched,
    matchedCompanies: matchedIcos.size,
    savedEvents,
    durationMs,
    cursorLastId: finalLastId,
    cursorSince: finalSince,
  };
}

// Run directly if executed as script
if (require.main === module) {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = sinceArg ? sinceArg.split("=")[1] : undefined;

  vestnikBackfill(since)
    .then((r) => {
      console.log(`Backfill done: ${r.pagesFetched} pages, ${r.eventsFetched} events, ${r.savedEvents} saved`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Backfill failed:", e);
      process.exit(1);
    });
}

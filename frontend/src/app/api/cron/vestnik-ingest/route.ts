import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { ingestVestnikForAllCompanies } from "@/lib/vestnik";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — Vestník background ingestion
// Fetches all recent Vestník events in one API walk, matches against DB companies, upserts.
// Should run daily via Vercel Cron.
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimitByKey("cron:vestnik-ingest", {
    windowMs: 60 * 60 * 1000,
    maxRequests: 3,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const result = await ingestVestnikForAllCompanies();

    console.log("[Vestník cron]", {
      pagesFetched: result.pagesFetched,
      eventsFetched: result.totalEvents,
      matchedCompanies: result.matchedCompanies,
      savedEvents: result.savedEvents,
      cursorBefore: result.cursorBefore,
      cursorAfter: result.cursorAfter,
      durationMs: result.durationMs,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("No valid checkpoint")) {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    console.error("POST /api/cron/vestnik-ingest error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Vercel Cron sends GET requests by default — delegate to POST handler.
export async function GET(req: NextRequest) {
  return POST(req);
}

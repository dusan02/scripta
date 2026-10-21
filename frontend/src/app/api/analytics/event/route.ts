import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Server-side funnel tracking — doplnok ku GA4, ktorý beží aj bez cookie
// súhlasu. Whitelist drží záznamy čisté (žiadne custom eventy zvonka).
const ALLOWED_EVENTS = new Set([
  "live_check_click",
  "live_check_started",
  "live_check_limit_hit",
  "live_check_completed",
]);

const MAX_PROPS_BYTES = 2048;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { event, ico, ...props } = body ?? {};
  if (typeof event !== "string" || !ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }
  if (JSON.stringify(props).length > MAX_PROPS_BYTES) {
    return NextResponse.json({ error: "Props too large" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown";

  // Bot-spam ochrana — analytics su nenáročné, stačí mäkký limit
  const rl = await rateLimitByKey(`analytics:${ip}`, {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // IP len ako hash — deduplikácia bez uchovávania PII. Salt zabraňuje
  // rainbow-table reversing (IPv4 space je malý).
  const salt = process.env.WORKER_SECRET || "verifa-analytics";
  const ipHash = createHash("sha256").update(`${salt}:${ip}`).digest("hex");

  try {
    const session = await getServerSession();
    await prisma.analyticsEvent.create({
      data: {
        event,
        companyIco:
          typeof ico === "string" && /^\d{8,10}$/.test(ico) ? ico : null,
        props: Object.keys(props).length ? (props as object) : undefined,
        ipHash,
        registered: Boolean(session?.user?.id),
      },
    });
  } catch (err) {
    // Analytics nikdy nesmie pokaziť user flow — len zaloguj
    console.error("[analytics] insert failed:", err);
  }

  return NextResponse.json({ ok: true });
}

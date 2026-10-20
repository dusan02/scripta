import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { slugify } from "@/lib/slug";

function getClientIp(req: NextRequest): string {
  // x-real-ip is set by nginx from $remote_addr (not client-controllable).
  // x-forwarded-for appends client-supplied values FIRST — the leftmost entry
  // is spoofable, so take the LAST one (the real client IP seen by nginx).
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const xff = req.headers.get("x-forwarded-for")?.split(",");
  return xff?.[xff.length - 1]?.trim() || "unknown";
}

/**
 * Public company autocomplete endpoint for /slovnik/orsr and /firma/* header.
 * - Uses Company_pkey for numeric IČO prefix queries (>=3 digits)
 * - Uses Company_name_trgm_idx (GIN pg_trgm) for name queries (>=3 chars)
 * - Orders by latestRevenue DESC NULLS LAST so real active firms rank first
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimitByKey(`pub-search:${ip}`, { windowMs: 60 * 1000, maxRequests: 40 });
  if (!rl.allowed) return rateLimitResponse(rl);

  const raw = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (raw.length < 3 || raw.length > 80) {
    return NextResponse.json({ results: [] });
  }

  const digitsOnly = raw.replace(/\s+/g, "");
  const isNumericIco = /^\d{3,10}$/.test(digitsOnly);

  try {
    const rows = await prisma.company.findMany({
      where: isNumericIco
        ? digitsOnly.length === 8
          ? { ico: digitsOnly }
          : { ico: { startsWith: digitsOnly } }
        : { name: { contains: raw, mode: "insensitive" } },
      select: {
        ico: true,
        name: true,
        city: true,
        latestRevenue: true,
        latestYear: true,
      },
      orderBy: [{ latestRevenue: { sort: "desc", nulls: "last" } }],
      take: 8,
    });

    const results = rows.map((r) => {
      const name = r.name || `IČO ${r.ico}`;
      return {
        ico: r.ico,
        name,
        city: r.city ?? null,
        latestRevenue: r.latestRevenue != null ? Number(r.latestRevenue) : null,
        latestYear: r.latestYear ?? null,
        href: `/firma/${r.ico}-${slugify(name)}`,
      };
    });

    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } }
    );
  } catch {
    return NextResponse.json({ results: [] }, { status: 500 });
  }
}

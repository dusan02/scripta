import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit by user ID (not just IP) — prevents enumeration via IP rotation
  const rl = await rateLimitByKey(`lookup:${session.user.id}`, { windowMs: 10 * 60 * 1000, maxRequests: 30 });
  if (!rl.allowed) return rateLimitResponse(rl);

  const ico = req.nextUrl.searchParams.get("ico");
  if (!ico || !/^\d{8}$/.test(ico)) {
    return NextResponse.json({ error: "Neplatné IČO" }, { status: 400 });
  }

  // 1. Check our DB first — we may have the company even if ORSR doesn't list it
  //    (e.g. deleted/merged companies, ORSR temporarily unavailable, companies
  //    sourced from RPO rather than ORSR)
  try {
    const dbCompany = await prisma.company.findUnique({
      where: { ico },
      select: { name: true },
    });
    if (dbCompany?.name) {
      const response = NextResponse.json({ found: true, companyName: dbCompany.name });
      response.headers.set("Cache-Control", "private, max-age=300");
      return response;
    }
  } catch {
    // DB error — fall through to ORSR
  }

  // 2. Fall back to ORSR live lookup
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`https://www.orsr.sk/hladaj_ico.asp?ICO=${ico}&SID=0`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: "Register nedostupný" }, { status: 502 });
    }

    // ORSR returns windows-1250 encoding — decode manually
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("windows-1250").decode(buf);

    const companyName = parseCompanyName(html);

    if (!companyName) {
      return NextResponse.json({ found: false, companyName: null });
    }

    // Cache successful lookups for 5 minutes (company names rarely change,
    // but we don't want stale data if a company renames)
    const response = NextResponse.json({ found: true, companyName });
    response.headers.set("Cache-Control", "private, max-age=300");
    return response;
  } catch {
    return NextResponse.json({ error: "Lookup zlyhal" }, { status: 502 });
  }
}

function parseCompanyName(html: string): string | null {
  const emptyMarkers = ["Nenašli sa žiadne", "nezodpovedá žiadny", "Záznamy: 0 - 0 / 0"];
  if (emptyMarkers.some((m) => html.includes(m))) {
    return null;
  }

  // ORSR search results: company name is in <a> tag with alt="Aktuálny výpis"
  const nameRegex = /<a[^>]*alt="Aktuálny výpis"[^>]*>([^<]+)<\/a>/i;
  const match = nameRegex.exec(html);
  if (match) {
    return match[1]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  // Fallback: find any link to vypis.asp that's not "Aktuálny"/"Úplný"
  const linkRegex = /<a[^>]*href="vypis\.asp[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const text = linkMatch[1].trim();
    if (text && text !== "Aktuálny" && text !== "Úplný" && text.length > 2) {
      return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
    }
  }

  return null;
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ico = req.nextUrl.searchParams.get("ico");
  if (!ico || !/^\d{8}$/.test(ico)) {
    return NextResponse.json({ error: "Neplatné IČO" }, { status: 400 });
  }

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

    return NextResponse.json({ found: true, companyName });
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

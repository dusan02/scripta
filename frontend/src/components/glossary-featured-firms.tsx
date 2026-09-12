import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildCompanyUrl } from "@/lib/slug";

/**
 * Featured firms section for glossary pages — internal linking from
 * high-traffic glossary pages (e.g. /slovnik/orsr with 16k impressions)
 * to top company pages, helping Google discover them via internal links.
 *
 * Fetches the largest companies by revenue from the DB (cached via ISR).
 */
export async function GlossaryFeaturedFirms({ limit = 12 }: { limit?: number }) {
  let firms: Array<{ ico: string; name: string | null; city: string | null; latestRevenue: string | null }> = [];
  try {
    const rows = await prisma.company.findMany({
      where: {
        fsCount: { gte: 2 },
        latestRevenue: { not: null },
      },
      select: {
        ico: true,
        name: true,
        city: true,
        latestRevenue: true,
      },
      orderBy: { latestRevenue: "desc" },
      take: limit,
    });
    firms = rows.map((r) => ({
      ico: r.ico,
      name: r.name,
      city: r.city,
      latestRevenue: r.latestRevenue ? r.latestRevenue.toString() : null,
    }));
  } catch {
    return null;
  }

  if (firms.length === 0) return null;

  return (
    <div style={{ marginTop: 48, marginBottom: 48 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
        Najväčšie slovenské firmy
      </h3>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
        Preverte finančné údaje a rizikové signály týchto firiem v ich verejných profiloch na Verifa.sk.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
        {firms.map((f) => (
          <Link
            key={f.ico}
            href={buildCompanyUrl(f.ico, f.name)}
            style={{
              display: "block",
              padding: "14px 18px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              textDecoration: "none",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.name || `IČO ${f.ico}`}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {f.city ? `${f.city} · ` : ""}IČO {f.ico}
              {f.latestRevenue && ` · ${formatRevenue(f.latestRevenue)}`}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function formatRevenue(rev: string): string {
  const n = parseFloat(rev);
  if (isNaN(n)) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M €`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k €`;
  return `${n.toFixed(0)} €`;
}


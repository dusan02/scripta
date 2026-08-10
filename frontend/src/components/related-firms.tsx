import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildCompanyUrl } from "@/lib/slug";

type RelatedFirm = {
  ico: string;
  name: string | null;
  city: string | null;
  latestRevenue: string | null;
};

async function getRelatedByCity(ico: string, city: string | null): Promise<RelatedFirm[]> {
  if (!city) return [];
  const firms = await prisma.company.findMany({
    where: {
      city,
      ico: { not: ico },
      financialStatements: { some: {} },
      latestRevenue: { not: null },
    },
    select: { ico: true, name: true, city: true, latestRevenue: true },
    orderBy: { latestRevenue: "desc" },
    take: 5,
  });
  return firms.map((f) => ({
    ico: f.ico,
    name: f.name,
    city: f.city,
    latestRevenue: f.latestRevenue?.toString() ?? null,
  }));
}

async function getRelatedByNace(ico: string, naceCode: string | null): Promise<RelatedFirm[]> {
  if (!naceCode) return [];
  const firms = await prisma.company.findMany({
    where: {
      naceCode,
      ico: { not: ico },
      financialStatements: { some: {} },
      latestRevenue: { not: null },
    },
    select: { ico: true, name: true, city: true, latestRevenue: true },
    orderBy: { latestRevenue: "desc" },
    take: 5,
  });
  return firms.map((f) => ({
    ico: f.ico,
    name: f.name,
    city: f.city,
    latestRevenue: f.latestRevenue?.toString() ?? null,
  }));
}

async function getRelatedBySize(ico: string, latestRevenue: bigint | string | null): Promise<RelatedFirm[]> {
  if (!latestRevenue) return [];
  const rev = typeof latestRevenue === "string" ? parseFloat(latestRevenue) : Number(latestRevenue);
  if (!rev || isNaN(rev) || rev <= 0) return [];
  const lower = Math.floor(rev * 0.5);
  const upper = Math.ceil(rev * 2);

  const firms = await prisma.company.findMany({
    where: {
      ico: { not: ico },
      financialStatements: { some: {} },
      latestRevenue: { gte: lower, lte: upper },
    },
    select: { ico: true, name: true, city: true, latestRevenue: true },
    orderBy: { latestRevenue: "desc" },
    take: 5,
  });
  return firms.map((f) => ({
    ico: f.ico,
    name: f.name,
    city: f.city,
    latestRevenue: f.latestRevenue?.toString() ?? null,
  }));
}

function formatRevenue(rev: string | null): string {
  if (!rev) return "";
  const n = parseFloat(rev);
  if (isNaN(n)) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M €`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k €`;
  return `${n.toFixed(0)} €`;
}

export async function RelatedFirms({
  ico,
  city,
  naceCode,
  latestRevenue,
}: {
  ico: string;
  city: string | null;
  naceCode: string | null;
  latestRevenue: string | null;
}) {
  const [byCity, byNace, bySize] = await Promise.all([
    getRelatedByCity(ico, city),
    getRelatedByNace(ico, naceCode),
    getRelatedBySize(ico, latestRevenue),
  ]);

  if (byCity.length === 0 && byNace.length === 0 && bySize.length === 0) return null;

  return (
    <section className="mt-8 sm:mt-12">
      <h2 className="text-lg sm:text-xl font-bold mb-4" style={{ color: "var(--text)" }}>
        Súvisiace firmy
      </h2>

      {byCity.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
            Firmy v meste {city}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byCity.map((f) => (
              <Link
                key={f.ico}
                href={buildCompanyUrl(f.ico, f.name)}
                className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <div className="font-medium truncate" style={{ color: "var(--text)" }}>
                  {f.name || `IČO ${f.ico}`}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  IČO: {f.ico}
                  {f.latestRevenue && ` · Tržby: ${formatRevenue(f.latestRevenue)}`}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {byNace.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
            Firmy v rovnakom odvetví
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byNace.map((f) => (
              <Link
                key={f.ico}
                href={buildCompanyUrl(f.ico, f.name)}
                className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <div className="font-medium truncate" style={{ color: "var(--text)" }}>
                  {f.name || `IČO ${f.ico}`}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  IČO: {f.ico}
                  {f.city && ` · ${f.city}`}
                  {f.latestRevenue && ` · ${formatRevenue(f.latestRevenue)}`}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {bySize.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
            Podobné firmy podľa veľkosti
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {bySize.map((f) => (
              <Link
                key={f.ico}
                href={buildCompanyUrl(f.ico, f.name)}
                className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <div className="font-medium truncate" style={{ color: "var(--text)" }}>
                  {f.name || `IČO ${f.ico}`}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  IČO: {f.ico}
                  {f.city && ` · ${f.city}`}
                  {f.latestRevenue && ` · Tržby: ${formatRevenue(f.latestRevenue)}`}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

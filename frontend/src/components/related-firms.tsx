import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildCompanyUrl } from "@/lib/slug";
import { getNaceSectionFromCode, getNaceSectionLabel, getKrajLabel, getKrajLabelLocative } from "@/lib/screener";

type RelatedFirm = {
  ico: string;
  name: string | null;
  city: string | null;
  latestRevenue: string | null;
};

const KRAJ_NAMES: Record<string, string> = {
  SK010: "Bratislavský kraj",
  SK021: "Trnavský kraj",
  SK022: "Nitriansky kraj",
  SK023: "Trenčiansky kraj",
  SK031: "Žilinský kraj",
  SK032: "Banskobystrický kraj",
  SK041: "Prešovský kraj",
  SK042: "Košický kraj",
};

async function getRelatedByNaceInKraj(ico: string, naceCode: string | null, kraj: string | null): Promise<RelatedFirm[]> {
  if (!naceCode) return [];
  const where: any = {
    naceCode,
    ico: { not: ico },
    financialStatements: { some: {} },
    latestRevenue: { not: null },
  };
  if (kraj) where.kraj = kraj;
  const firms = await prisma.company.findMany({
    where,
    select: { ico: true, name: true, city: true, latestRevenue: true },
    orderBy: { latestRevenue: "desc" },
    take: 6,
  });
  return firms.map((f) => ({
    ico: f.ico,
    name: f.name,
    city: f.city,
    latestRevenue: f.latestRevenue?.toString() ?? null,
  }));
}

async function getLargestByNace(ico: string, naceCode: string | null): Promise<RelatedFirm[]> {
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
    take: 6,
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
  kraj,
}: {
  ico: string;
  city: string | null;
  naceCode: string | null;
  kraj?: string | null;
  latestRevenue?: string | null;
}) {
  const [byNaceInKraj, largestByNace] = await Promise.all([
    getRelatedByNaceInKraj(ico, naceCode, kraj ?? null),
    getLargestByNace(ico, naceCode),
  ]);

  if (byNaceInKraj.length === 0 && largestByNace.length === 0) return null;

  const krajLabel = kraj ? getKrajLabel(kraj) || KRAJ_NAMES[kraj] || kraj : null;
  const krajLocative = kraj ? getKrajLabelLocative(kraj) || krajLabel : null;

  // Build hub backlinks for internal linking
  const naceSection = getNaceSectionFromCode(naceCode);
  const naceSectionLabel = naceSection ? getNaceSectionLabel(naceSection) : null;
  const hubLinks: Array<{ href: string; label: string }> = [];
  if (naceSection && naceSectionLabel) {
    hubLinks.push({ href: `/odvetvie/${naceSection}`, label: `Firmy — ${naceSectionLabel}` });
    if (kraj) {
      hubLinks.push({ href: `/odvetvie/${naceSection}/${kraj}`, label: `${naceSectionLabel} — ${krajLabel}` });
    }
  }
  if (kraj) {
    hubLinks.push({ href: `/kraj/${kraj}`, label: `Firmy v ${krajLocative}` });
  }

  return (
    <section className="mt-8 sm:mt-12">
      <h2 className="text-lg sm:text-xl font-bold mb-4" style={{ color: "var(--text)" }}>
        Súvisiace firmy
      </h2>

      {/* Hub backlinks for internal linking */}
      {hubLinks.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {hubLinks.map((h) => (
            <Link
              key={h.href}
              href={h.href}
              className="inline-block rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              {h.label}
            </Link>
          ))}
        </div>
      )}

      {byNaceInKraj.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
            Firmy v rovnakom odvetví{krajLabel ? ` v ${krajLabel}` : ""}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byNaceInKraj.map((f) => (
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

      {largestByNace.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
            Najväčšie firmy v rovnakom odvetví
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {largestByNace.map((f) => (
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
    </section>
  );
}

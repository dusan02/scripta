import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildCompanyUrl } from "@/lib/slug";
import { getNaceSectionFromCode, getNaceSectionLabel, getKrajLabel, getKrajLabelLocative } from "@/lib/screener";
import { translate, type Lang } from "@/lib/i18n";

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

async function getFirmsInCity(ico: string, city: string | null): Promise<RelatedFirm[]> {
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
  excludeIcos = [],
  noHeading = false,
  lang = "sk",
}: {
  ico: string;
  city: string | null;
  naceCode: string | null;
  kraj?: string | null;
  latestRevenue?: string | null;
  excludeIcos?: string[];
  noHeading?: boolean;
  lang?: Lang;
}) {
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);
  const [byNaceInKraj, largestByNace, firmsInCity] = await Promise.all([
    getRelatedByNaceInKraj(ico, naceCode, kraj ?? null),
    getLargestByNace(ico, naceCode),
    getFirmsInCity(ico, city),
  ]);

  // Deduplication with priority: cross-firm (already excluded) → city → nace/kraj → largest
  const seenIcos = new Set<string>([ico, ...excludeIcos]);

  const dedupFirmsInCity = firmsInCity.filter(f => {
    if (seenIcos.has(f.ico)) return false;
    seenIcos.add(f.ico);
    return true;
  });

  const dedupByNaceInKraj = byNaceInKraj.filter(f => {
    if (seenIcos.has(f.ico)) return false;
    seenIcos.add(f.ico);
    return true;
  });

  const dedupLargestByNace = largestByNace.filter(f => {
    if (seenIcos.has(f.ico)) return false;
    seenIcos.add(f.ico);
    return true;
  });

  if (dedupByNaceInKraj.length === 0 && dedupLargestByNace.length === 0 && dedupFirmsInCity.length === 0) return null;

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
    <section className={noHeading ? "" : "mt-8 sm:mt-12"}>
      {!noHeading && (
        <h2 className="text-lg sm:text-xl font-bold mb-4" style={{ color: "var(--text)" }}>
          {t("firma.suvisiaceFirmy")}
        </h2>
      )}

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {dedupFirmsInCity.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
              {t("firma.firmyVMeste", { city: city ?? "" })}
            </h3>
            <div className="space-y-2">
              {dedupFirmsInCity.map((f) => (
                <Link
                  key={f.ico}
                  href={buildCompanyUrl(f.ico, f.name)}
                  className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <div className="font-medium truncate" style={{ color: "var(--text)" }}>
                    {f.name || `${t("firma.icoLabel")} ${f.ico}`}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("firma.icoLabel")}: {f.ico}
                    {f.latestRevenue && ` · ${t("firma.trzbyLabel")}: ${formatRevenue(f.latestRevenue)}`}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {dedupByNaceInKraj.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
              {krajLabel
                ? t("firma.firmyVOdvetviVKraji", { kraj: krajLabel })
                : t("firma.firmyVOdvetvi")}
            </h3>
            <div className="space-y-2">
              {dedupByNaceInKraj.map((f) => (
                <Link
                  key={f.ico}
                  href={buildCompanyUrl(f.ico, f.name)}
                  className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <div className="font-medium truncate" style={{ color: "var(--text)" }}>
                    {f.name || `${t("firma.icoLabel")} ${f.ico}`}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("firma.icoLabel")}: {f.ico}
                    {f.city && ` · ${f.city}`}
                    {f.latestRevenue && ` · ${t("firma.trzbyLabel")}: ${formatRevenue(f.latestRevenue)}`}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {dedupLargestByNace.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
              {t("firma.najvsieFirmy")}
            </h3>
            <div className="space-y-2">
              {dedupLargestByNace.map((f) => (
                <Link
                  key={f.ico}
                  href={buildCompanyUrl(f.ico, f.name)}
                  className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <div className="font-medium truncate" style={{ color: "var(--text)" }}>
                    {f.name || `${t("firma.icoLabel")} ${f.ico}`}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("firma.icoLabel")}: {f.ico}
                    {f.city && ` · ${f.city}`}
                    {f.latestRevenue && ` · ${formatRevenue(f.latestRevenue)}`}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

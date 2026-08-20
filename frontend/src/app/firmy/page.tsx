import { queryFirmy, getFirmyFilterOptions, type FirmyFilters, type FirmySort } from "@/lib/firmy";
import { fmtEUR } from "@/lib/format";
import { FirmyFilters as FirmyFiltersClient } from "@/components/firmy-filters";
import { slugify } from "@/lib/slug";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmtEur(val: string | null): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  if (n >= 1000000) return `€${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `€${(n / 1000).toFixed(0)}k`;
  return `€${n.toFixed(0)}`;
}

function parseFilters(searchParams: Record<string, string | string[] | undefined>): FirmyFilters {
  return {
    odvetvie: typeof searchParams.odvetvie === "string" ? searchParams.odvetvie : undefined,
    velkost: typeof searchParams.velkost === "string" ? searchParams.velkost : undefined,
    trzby: typeof searchParams.trzby === "string" ? searchParams.trzby : undefined,
    zisk: typeof searchParams.zisk === "string" ? searchParams.zisk : undefined,
    lokalita: typeof searchParams.lokalita === "string" ? searchParams.lokalita : undefined,
    pravnaForma: typeof searchParams.pravnaForma === "string" ? searchParams.pravnaForma : undefined,
    status: typeof searchParams.status === "string" ? searchParams.status : undefined,
  };
}

function parseSort(searchParams: Record<string, string | string[] | undefined>): FirmySort {
  const field = typeof searchParams.sort === "string" ? searchParams.sort : "nazov";
  const dir = typeof searchParams.dir === "string" ? searchParams.dir : "asc";
  return {
    field: (["nazov", "trzby", "zisk", "mesto"].includes(field) ? field : "nazov") as FirmySort["field"],
    dir: (["asc", "desc"].includes(dir) ? dir : "asc") as FirmySort["dir"],
  };
}

function parsePage(searchParams: Record<string, string | string[] | undefined>): number {
  const p = typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) : 1;
  return isNaN(p) || p < 1 ? 1 : p;
}

function buildUrl(filters: FirmyFilters, sort: FirmySort, page: number): string {
  const params = new URLSearchParams();
  if (filters.odvetvie) params.set("odvetvie", filters.odvetvie);
  if (filters.velkost) params.set("velkost", filters.velkost);
  if (filters.trzby) params.set("trzby", filters.trzby);
  if (filters.zisk) params.set("zisk", filters.zisk);
  if (filters.lokalita) params.set("lokalita", filters.lokalita);
  if (filters.pravnaForma) params.set("pravnaForma", filters.pravnaForma);
  if (filters.status) params.set("status", filters.status);
  if (sort.field !== "nazov" || sort.dir !== "asc") {
    params.set("sort", sort.field);
    params.set("dir", sort.dir);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/firmy${qs ? `?${qs}` : ""}`;
}

export default async function FirmyPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseFilters(searchParams);
  const sort = parseSort(searchParams);
  const page = parsePage(searchParams);

  const [result, options] = await Promise.all([
    queryFirmy(filters, sort, page),
    getFirmyFilterOptions(),
  ]);

  const { firms, total, totalPages } = result;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header className="sticky top-0 z-50 border-b" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold" style={{ color: "var(--text)" }}>Verifa.sk</Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
              Prihlásiť sa
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center gap-2 text-xs sm:text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          <Link href="/" className="hover:underline">Verifa.sk</Link>
          <span>/</span><span style={{ color: "var(--text)" }}>Firmy</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black mb-2" style={{ color: "var(--text)" }}>
          Firmy na Slovensku
        </h1>

        <div className="mb-6 p-3 rounded-lg flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Hľadáte pokročilejší filter? Skúste nový Screener firiem.
          </p>
          <Link
            href="/screener"
            className="text-sm font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            Spustiť Screener →
          </Link>
        </div>

        <FirmyFiltersClient
          naceSections={options.naceSections}
          sizeCategories={options.sizeCategories}
          cities={options.cities}
          legalForms={options.legalForms}
          statuses={options.statuses}
          revenueRanges={options.revenueRanges}
          profitRanges={options.profitRanges}
        />

        <div className="flex items-center justify-between mb-4 mt-4">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {total.toLocaleString("sk-SK")} firiem
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--surface)" }}>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Firma</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Odvetvie</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Veľkosť</th>
                <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Tržby</th>
                <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Zisk</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Mesto</th>
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => (
                <tr key={f.ico} className="border-t hover:bg-[var(--surface)]" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-3">
                    <Link href={`/firma/${f.ico}-${slugify(f.name)}`} className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                      {f.name || f.ico}
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{f.naceText || "—"}</td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{f.sizeCategory || "—"}</td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                    {f.latestRevenue ? (
                      <span>
                        {fmtEur(f.latestRevenue)}
                        <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>· {f.latestYear}</span>
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                    {f.latestProfit ? (
                      <span>
                        {fmtEur(f.latestProfit)}
                        <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>· {f.latestYear}</span>
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{f.city || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            {page > 1 && (
              <Link
                href={buildUrl(filters, sort, page - 1)}
                className="px-3 py-1 rounded text-sm border"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                ← Predchádzajúca
              </Link>
            )}
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Strana {page} z {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={buildUrl(filters, sort, page + 1)}
                className="px-3 py-1 rounded text-sm border"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                Ďalšia →
              </Link>
            )}
          </div>
        )}

        {firms.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Žiadne firmy nespĺňajú zvolené kritériá.
            </p>
            <Link href="/firmy" className="text-sm mt-2 inline-block hover:underline" style={{ color: "var(--accent)" }}>
              Zrušiť filtre
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

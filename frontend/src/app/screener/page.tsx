import { queryScreener, resolveTier, getScreenerFilterOptions, type ScreenerTier } from "@/lib/screener";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey } from "@/lib/rateLimit";
import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import { ScreenerFilters } from "@/components/screener-filters";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// ── Rate limits per frozen contract ──────────────────────────────────────────
// FREE (anonymous): 10 req/min, 100 req/hour
// AUTH (registered): 30 req/min, 500 req/hour
// PREMIUM (Pro): 60 req/min, unlimited
//
// We apply the per-minute limit in SSR. The hourly limit is enforced at the
// middleware/edge layer (separate concern). For SSR we use the minute window.
const RATE_LIMITS: Record<ScreenerTier, { windowMs: number; maxRequests: number }> = {
  FREE: { windowMs: 60 * 1000, maxRequests: 10 },
  AUTH: { windowMs: 60 * 1000, maxRequests: 30 },
  PREMIUM: { windowMs: 60 * 1000, maxRequests: 60 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(): string {
  // headers() is sync in Next.js 14 server components (called via await above)
  const h = headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

function fmtEur(val: string | null): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  if (n >= 1000000) return `€${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `€${(n / 1000).toFixed(0)}k`;
  return `€${n.toFixed(0)}`;
}

function fmtEstablished(establishedAt: Date | null): string {
  if (!establishedAt) return "—";
  const year = establishedAt.getFullYear();
  if (isNaN(year) || year < 1900) return "—";
  return String(year);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // 1. Tier resolution from session
  const session = await getServerSession();
  const tier = await resolveTier(session);

  // 2. Rate limiting — per IP, per tier
  const ip = getClientIp();
  const rateLimitKey = `screener:${tier}:${ip}`;
  const rateLimitResult = await rateLimitByKey(rateLimitKey, RATE_LIMITS[tier]);

  if (!rateLimitResult.allowed) {
    // Rate limited — render a 429-style page (not a redirect, to preserve crawlability)
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--text)" }}>
            Príliš veľa požiadaviek
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            Prekročili ste limit vyhľadávaní. Skúste to znova o chvíľu.
          </p>
          <Link
            href="/screener"
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            Skúsiť znova
          </Link>
        </div>
      </div>
    );
  }

  // 3. Query screener (sanitized params → WHERE → COUNT → tier SELECT)
  //    and fetch filter options for the sidebar
  // Run sequentially to avoid exhausting Prisma connection pool (limit 5).
  // Parallel execution of findMany + count + 4× queryRaw = 6 concurrent queries → pool timeout.
  const result = await queryScreener(searchParams, tier);
  const options = await getScreenerFilterOptions();

  const { companies, total, page, totalPages, appliedFilters, resultLimit } = result;

  // 4. Render SSR HTML — no premium leakage
  //    - Only authorized filter values appear in HTML
  //    - No premium fields, booleans, or score existence
  //    - Deterministic URL state via searchParams
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header className="sticky top-0 z-50 border-b" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" aria-label="Verifa.sk" style={{ textDecoration: "none" }}>
            <Image
              src="/logo-verifa.png"
              alt="Verifa.sk"
              width={120}
              height={40}
              style={{ height: 40, width: "auto", display: "block" }}
              priority
            />
          </Link>
          <div className="flex items-center gap-3">
            {tier === "FREE" ? (
              <Link
                href="/login"
                className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}
              >
                Prihlásiť sa
              </Link>
            ) : (
              <Link
                href="/dashboard"
                className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}
              >
                Dashboard
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs sm:text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          <Link href="/" className="hover:underline">Verifa.sk</Link>
          <span>/</span>
          <span style={{ color: "var(--text)" }}>Screener</span>
        </div>

        {/* Heading */}
        <h1 className="text-2xl sm:text-3xl font-black mb-2" style={{ color: "var(--text)" }}>
          Screener firiem
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          Vyhľadávajte firmy podľa odvetvia, právnej formy, finančných ukazovateľov a ďalších kritérií.
          {tier === "FREE" && " Prihláste sa pre viac výsledkov a pokročilé filtre."}
        </p>

        {/* Layout: sidebar + results */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Filter sidebar (client component — Task 5) */}
          <aside className="lg:w-64 flex-shrink-0">
            <ScreenerFilters
              options={options}
              tier={tier}
              appliedFilters={appliedFilters}
            />
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            {/* Result count + tier badge */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {total.toLocaleString("sk-SK")} firiem
                {tier === "FREE" && total > resultLimit && (
                  <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                    (zobrazených prvých {resultLimit})
                  </span>
                )}
              </p>
              <span
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: tier === "FREE" ? "var(--surface)" : "var(--accent)",
                  color: tier === "FREE" ? "var(--text-muted)" : "#fff",
                }}
              >
                {tier === "FREE" ? "Anonymný" : tier === "AUTH" ? "Prihlásený" : "Pro"}
              </span>
            </div>

            {/* Results table */}
            {companies.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--surface)" }}>
                      <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Firma</th>
                      <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>IČO</th>
                      <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Právna forma</th>
                      <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Mesto</th>
                      <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Založenie</th>
                      <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Tržby</th>
                      <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Zisk</th>
                      <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Aktíva</th>
                      <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Imanie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => (
                      <tr key={c.ico} className="border-t hover:bg-[var(--surface)]" style={{ borderColor: "var(--border)" }}>
                        <td className="px-4 py-3">
                          <Link
                            href={`/firma/${c.ico}-${slugify(c.name)}`}
                            className="font-medium hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {c.name || c.ico}
                          </Link>
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{c.ico}</td>
                        <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{c.legalForm || "—"}</td>
                        <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{c.city || "—"}</td>
                        <td className="px-4 py-3 text-right" style={{ color: "var(--text-secondary)" }}>{fmtEstablished(c.establishedAt)}</td>
                        <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                          {c.latestRevenue ? fmtEur(c.latestRevenue) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                          {c.latestProfit ? fmtEur(c.latestProfit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                          {c.latestAssets ? fmtEur(c.latestAssets) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                          {c.latestEquity ? fmtEur(c.latestEquity) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                  Žiadne firmy nespĺňajú zvolené kritériá.
                </p>
                <Link
                  href="/screener"
                  className="text-sm inline-block hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  Zrušiť filtre
                </Link>
              </div>
            )}

            {/* Pagination — only for AUTH/PREMIUM (FREE has no pagination, cap=20) */}
            {tier !== "FREE" && totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                {page > 1 && (
                  <Link
                    href={buildPaginationUrl(searchParams, page - 1)}
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
                    href={buildPaginationUrl(searchParams, page + 1)}
                    className="px-3 py-1 rounded text-sm border"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    Ďalšia →
                  </Link>
                )}
              </div>
            )}

            {/* FREE tier CTA — upgrade to AUTH for pagination + more results */}
            {tier === "FREE" && total > resultLimit && (
              <div className="mt-6 p-4 rounded-lg text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
                  Zobrazených {resultLimit} z {total.toLocaleString("sk-SK")} firiem.
                  Prihláste sa pre pagination a až 50 výsledkov na stránku.
                </p>
                <Link
                  href="/login"
                  className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Prihlásiť sa
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pagination URL builder (deterministic, preserves filter state) ───────────
function buildPaginationUrl(
  searchParams: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    const s = typeof value === "string" ? value : value[0];
    if (s) params.set(key, s);
  }
  if (page > 1) {
    params.set("page", String(page));
  } else {
    params.delete("page");
  }
  const qs = params.toString();
  return `/screener${qs ? `?${qs}` : ""}`;
}

// ── SEO metadata — /screener is crawlable per ADR-010 ────────────────────────
export async function generateMetadata() {
  return {
    title: "Screener firiem | Verifa.sk",
    description: "Vyhľadávajte firmy na Slovensku podľa odvetvia, právnej formy, mesta, finančných ukazovateľov a veku firmy.",
    robots: { index: true, follow: true },
  };
}

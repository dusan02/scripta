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
const RATE_LIMITS: Record<ScreenerTier, { windowMs: number; maxRequests: number }> = {
  FREE: { windowMs: 60 * 1000, maxRequests: 10 },
  AUTH: { windowMs: 60 * 1000, maxRequests: 30 },
  PREMIUM: { windowMs: 60 * 1000, maxRequests: 60 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(): string {
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
  const session = await getServerSession();
  const tier = await resolveTier(session);

  const ip = getClientIp();
  const rateLimitKey = `screener:${tier}:${ip}`;
  const rateLimitResult = await rateLimitByKey(rateLimitKey, RATE_LIMITS[tier]);

  if (!rateLimitResult.allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center max-w-md px-6">
          <h1 className="text-xl font-bold mb-3" style={{ color: "var(--text)" }}>
            Príliš veľa požiadaviek
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            Prekročili ste limit vyhľadávaní. Skúste to znova o chvíľu.
          </p>
          <Link
            href="/screener"
            className="inline-block px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
          >
            Skúsiť znova
          </Link>
        </div>
      </div>
    );
  }

  const result = await queryScreener(searchParams, tier);
  const options = await getScreenerFilterOptions();

  const { companies, total, page, totalPages, appliedFilters, resultLimit } = result;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header — standalone only for anonymous users (NavBar shown for authenticated) */}
      {!session?.user && (
        <header className="glass-nav sticky top-0 z-50">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-16">
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
                <Link
                  href="/login"
                  className="text-xs sm:text-sm font-medium px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
                >
                  Prihlásiť sa
                </Link>
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Main content — max-w matches dashboard/landing */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          <Link href="/" className="hover:underline">Verifa.sk</Link>
          <span>›</span>
          <span style={{ color: "var(--text)" }}>Screener</span>
        </nav>

        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-black mb-1.5" style={{ color: "var(--text)" }}>
            Screener firiem
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Vyhľadávajte firmy podľa odvetvia, právnej formy, finančných ukazovateľov a ďalších kritérií.
            {tier === "FREE" && " Prihláste sa pre viac výsledkov a pokročilé filtre."}
          </p>
        </div>

        {/* Layout: sidebar + results */}
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Filter sidebar */}
          <aside className="lg:w-60 flex-shrink-0">
            <div
              className="rounded-xl p-4 lg:sticky lg:top-20"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <ScreenerFilters
                options={options}
                tier={tier}
                appliedFilters={appliedFilters}
              />
            </div>
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            {/* Result count + tier badge */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                <span className="font-semibold" style={{ color: "var(--text)" }}>
                  {total.toLocaleString("sk-SK")}
                </span> firiem
                {tier === "FREE" && total > resultLimit && (
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    (zobrazených prvých {resultLimit})
                  </span>
                )}
              </p>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  background: tier === "FREE" ? "var(--bg-muted)" : "var(--accent-light)",
                  color: tier === "FREE" ? "var(--text-muted)" : "var(--accent)",
                  border: tier === "FREE" ? "1px solid var(--border)" : "1px solid var(--accent-border)",
                }}
              >
                {tier === "FREE" ? "Anonymný" : tier === "AUTH" ? "Prihlásený" : "Pro"}
              </span>
            </div>

            {/* Results table */}
            {companies.length > 0 ? (
              <div
                className="overflow-x-auto rounded-xl"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Firma</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>IČO</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Právna forma</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Mesto</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Založenie</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Tržby</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Zisk</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Aktíva</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Imanie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c, i) => (
                      <tr
                        key={c.ico}
                        style={{
                          borderTop: i > 0 ? "1px solid var(--border)" : "none",
                          transition: "background 0.1s",
                        }}
                        className="hover:bg-[var(--surface-hover)]"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/firma/${c.ico}-${slugify(c.name)}`}
                            className="font-medium hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {c.name || c.ico}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs" style={{ color: "var(--text-muted)" }}>{c.ico}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>{c.legalForm || "—"}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>{c.city || "—"}</td>
                        <td className="px-3 py-2.5 text-right text-xs" style={{ color: "var(--text-secondary)" }}>{fmtEstablished(c.establishedAt)}</td>
                        <td className="px-3 py-2.5 text-right font-medium" style={{ color: "var(--text)" }}>
                          {c.latestRevenue ? fmtEur(c.latestRevenue) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right" style={{ color: "var(--text)" }}>
                          {c.latestProfit ? fmtEur(c.latestProfit) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right" style={{ color: "var(--text)" }}>
                          {c.latestAssets ? fmtEur(c.latestAssets) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right" style={{ color: "var(--text)" }}>
                          {c.latestEquity ? fmtEur(c.latestEquity) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                className="text-center py-16 rounded-xl"
                style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
              >
                <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                  Žiadne firmy nespĺňajú zvolené kritériá.
                </p>
                <Link
                  href="/screener"
                  className="text-sm inline-block font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  Zrušiť filtre
                </Link>
              </div>
            )}

            {/* Pagination */}
            {tier !== "FREE" && totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-5">
                {page > 1 && (
                  <Link
                    href={buildPaginationUrl(searchParams, page - 1)}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ border: "1px solid var(--border)", color: "var(--text)" }}
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
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ border: "1px solid var(--border)", color: "var(--text)" }}
                  >
                    Ďalšia →
                  </Link>
                )}
              </div>
            )}

            {/* FREE tier CTA */}
            {tier === "FREE" && total > resultLimit && (
              <div
                className="mt-5 p-5 rounded-xl text-center"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
                  Zobrazených {resultLimit} z {total.toLocaleString("sk-SK")} firiem.
                  Prihláste sa pre pagination a až 50 výsledkov na stránku.
                </p>
                <Link
                  href="/login"
                  className="inline-block px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
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

// ── Pagination URL builder ───────────────────────────────────────────────────
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

// ── SEO metadata ─────────────────────────────────────────────────────────────
export async function generateMetadata() {
  return {
    title: "Screener firiem | Verifa.sk",
    description: "Vyhľadávajte firmy na Slovensku podľa odvetvia, právnej formy, mesta, finančných ukazovateľov a roku založenia.",
    robots: { index: true, follow: true },
  };
}

import { Suspense } from "react";
import { queryScreener, resolveTier, getScreenerFilterOptions, type ScreenerTier } from "@/lib/screener";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey } from "@/lib/rateLimit";
import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import { ScreenerFilters } from "@/components/screener-filters";
import { ScreenerTable } from "@/components/screener-table";

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

// ── Loading fallbacks ────────────────────────────────────────────────────────

function FiltersFallback() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-9 rounded-lg" style={{ background: "var(--bg-muted)" }} />
      <div className="h-9 rounded-lg" style={{ background: "var(--bg-muted)" }} />
      <div className="h-9 rounded-lg" style={{ background: "var(--bg-muted)" }} />
      <div className="h-9 rounded-lg" style={{ background: "var(--bg-muted)" }} />
    </div>
  );
}

function TableFallback() {
  return (
    <div className="space-y-2 animate-pulse p-4">
      <div className="h-8 rounded" style={{ background: "var(--bg-muted)" }} />
      <div className="h-8 rounded" style={{ background: "var(--bg-muted)" }} />
      <div className="h-8 rounded" style={{ background: "var(--bg-muted)" }} />
      <div className="h-8 rounded" style={{ background: "var(--bg-muted)" }} />
      <div className="h-8 rounded" style={{ background: "var(--bg-muted)" }} />
    </div>
  );
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
          <h1 className="text-2xl font-bold mb-1.5" style={{ color: "var(--text)" }}>
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
              className="rounded-xl p-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <Suspense fallback={<FiltersFallback />}>
                <ScreenerFilters
                  options={options}
                  tier={tier}
                  appliedFilters={appliedFilters}
                />
              </Suspense>
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
                className="rounded-xl overflow-hidden"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                }}
              >
                <Suspense fallback={<TableFallback />}>
                  <ScreenerTable companies={companies} />
                </Suspense>
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

// ── SEO metadata ─────────────────────────────────────────────────────────────
export async function generateMetadata() {
  return {
    title: "Screener firiem | Verifa.sk",
    description: "Vyhľadávajte firmy na Slovensku podľa odvetvia, právnej formy, mesta, finančných ukazovateľov a roku založenia.",
    robots: { index: true, follow: true },
  };
}

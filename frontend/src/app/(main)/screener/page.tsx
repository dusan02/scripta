import { queryScreener, resolveTier, getScreenerFilterOptions, getKrajLabel, getKrajLabelLocative, getNaceSectionLabel, getNaceSectionGenitive, type ScreenerTier } from "@/lib/screener";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey } from "@/lib/rateLimit";
import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import { ScreenerFilters } from "@/components/screener-filters";
import { ScreenerTable } from "@/components/screener-table";
import { ActiveFilterChips } from "@/components/screener-chips";
import { ScreenerPresets } from "@/components/screener-presets";

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Start session resolve + filter options fetch in parallel.
  // getScreenerFilterOptions is unstable_cache(1h) and doesn't depend on
  // session/tier, so it can run concurrently with auth — saves 50-100ms
  // for authenticated users (tier resolve hits DB).
  const [session, options] = await Promise.all([
    getServerSession(),
    getScreenerFilterOptions(),
  ]);

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
            Prekročili ste limit vyhľadávaní ({RATE_LIMITS[tier].maxRequests}/min). Skúste to znova o chvíľu
            {tier === "FREE" && " alebo sa prihláste pre vyšší limit"}.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/screener"
              className="inline-block px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
            >
              Skúsiť znova
            </Link>
            {tier === "FREE" && (
              <Link
                href="/login"
                className="inline-block px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}
              >
                Prihlásiť sa
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Filter options already fetched in parallel with session above.
  // queryScreener runs findMany + count in parallel internally (Promise.all).
  const result = await queryScreener(searchParams, tier);

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

        {/* Heading — dynamic H1 based on active filters */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1.5" style={{ color: "var(--text)" }}>
            {buildDynamicH1(searchParams)}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {buildDynamicSubtitle(searchParams, total)}
            {tier === "FREE" && " Prihláste sa pre viac výsledkov a pokročilé filtre."}
          </p>
        </div>

        {/* Quick presets */}
        <div className="mb-4">
          <ScreenerPresets />
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
              <ScreenerFilters
                options={options}
                tier={tier}
                appliedFilters={appliedFilters}
                searchParams={searchParams}
              />
            </div>
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            {/* Active filter chips */}
            <ActiveFilterChips
              searchParams={searchParams}
              options={options}
            />

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
                <ScreenerTable companies={companies} searchParams={searchParams} />
              </div>
            ) : (
              <div
                className="text-center py-16 rounded-xl"
                style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
              >
                <p className="text-base font-semibold mb-2" style={{ color: "var(--text)" }}>
                  Žiadne firmy nespĺňajú zvolené kritériá
                </p>
                <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
                  Skúste uvoľniť niektorý z aktívnych filtrov — napríklad zrušte finančný
                  limit, rozšírte región alebo zmente odvetvie.
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Link
                    href="/screener"
                    className="text-sm inline-block px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-90"
                    style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
                  >
                    Zrušiť všetky filtre
                  </Link>
                  {appliedFilters.length > 0 && (
                    <Link
                      href={buildPaginationUrl(searchParams, 1).replace(/&?minRevenue=[^&]*/g, "").replace(/&?maxRevenue=[^&]*/g, "").replace(/&?minEmployees=[^&]*/g, "").replace(/&?maxEmployees=[^&]*/g, "").replace(/&?minFoundedYear=[^&]*/g, "")}
                      className="text-sm inline-block px-4 py-2 rounded-lg font-medium hover:opacity-90"
                      style={{ border: "1px solid var(--border)", color: "var(--text)" }}
                    >
                      Uvoľniť finančné filtre
                    </Link>
                  )}
                </div>
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

        {/* SEO text — dynamic based on active filters */}
        <div className="mt-8 max-w-none prose prose-sm" style={{ color: "var(--text-secondary)" }}>
          <h2 className="text-base font-semibold mb-2" style={{ color: "var(--text)" }}>
            {buildDynamicH1(searchParams)} — prehľad
          </h2>
          <p className="text-sm leading-relaxed">
            {buildSeoText(searchParams, total, companies)}
          </p>
          <p className="text-sm leading-relaxed mt-2">
            Screener firiem Verifa.sk umožňuje filtrovanie podľa odvetvia (NACE), právnej formy, regiónu, mesta, finančných ukazovateľov (tržby, zisk, aktíva, vlastné imanie) a roku založenia. Dáta pochádzajú z Registru účtovných jednotiek (RÚZ) a Obchodného registra SR (ORSR).
          </p>
        </div>

        {/* JSON-LD ItemList — structured data for search engines */}
        {companies.length > 0 && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(buildItemListJsonLd(companies, searchParams)),
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── SEO metadata ─────────────────────────────────────────────────────────────
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  const krajLabel = getKrajLabel(sp("kraj"));
  const krajLocative = getKrajLabelLocative(sp("kraj"));
  const naceLabel = getNaceSectionLabel(sp("naceSection"));
  const naceGenitive = getNaceSectionGenitive(sp("naceSection"));
  const city = sp("city");
  const legalForm = sp("legalForm");
  const q = sp("q");

  // Build dynamic title parts
  const parts: string[] = [];
  if (q) parts.push(`"${q}"`);
  if (krajLabel) parts.push(krajLabel);
  if (city) parts.push(city);
  if (naceLabel) parts.push(naceLabel);
  if (legalForm) parts.push(legalForm);

  const hasFilters = parts.length > 0;
  const filterStr = parts.join(", ");

  // Title: "Firmy — Bratislavský kraj, Priemyselná výroba" (layout adds | Verifa.sk)
  // Default: "Screener firiem na Slovensku" (layout adds | Verifa.sk)
  const title = hasFilters
    ? `Firmy — ${filterStr}`
    : "Screener firiem na Slovensku";

  // Description — uses grammatically correct locative/genitive
  let description: string;
  if (hasFilters) {
    const descParts: string[] = [];
    if (krajLocative) descParts.push(`v ${krajLocative.toLowerCase()}`);
    if (city) descParts.push(`v meste ${city}`);
    if (naceGenitive) descParts.push(`v odvetví ${naceGenitive}`);
    if (legalForm) descParts.push(`právna forma ${legalForm}`);
    description = `Zoznam firiem ${descParts.join(", ")}. Filtrovanie podľa tržieb, zisku, aktív, imania a roku založenia. Dáta z RÚZ a ORSR.`;
  } else {
    description = "Vyhľadávajte firmy na Slovensku podľa odvetvia, právnej formy, mesta, finančných ukazovateľov a roku založenia. Dáta z RÚZ a ORSR.";
  }

  // ── Faceted navigation control (crawl-trap prevention) ──
  // - q (free-text search) → noindex: infinite URL space
  // - kraj only → canonical to curated SSG hub /screener/kraj/{kraj}
  // - naceSection only → canonical to curated SSG hub /screener/odvetvie/{section}
  // - any other filter combination → noindex (not curated, thin/duplicate)
  // - no filters → index, canonical to clean /screener
  const filterKeys = Object.keys(searchParams).filter(
    k => k !== "sort" && k !== "dir" && k !== "page" && sp(k)
  );
  let robots: { index: boolean; follow: boolean } = { index: true, follow: true };
  let canonicalOverride: string | null = null;

  if (q) {
    robots = { index: false, follow: true };
  } else if (filterKeys.length === 1 && filterKeys[0] === "kraj") {
    canonicalOverride = `https://verifa.sk/screener/kraj/${sp("kraj")}`;
  } else if (filterKeys.length === 1 && filterKeys[0] === "naceSection") {
    canonicalOverride = `https://verifa.sk/screener/odvetvie/${sp("naceSection")}`;
  } else if (filterKeys.length > 0) {
    robots = { index: false, follow: true };
  }

  // Canonical — clean URL without sort/dir defaults
  const canonicalParts: string[] = [];
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    const s = typeof value === "string" ? value : value[0];
    if (s && key !== "sort" && key !== "dir" && key !== "page") {
      canonicalParts.push(`${key}=${encodeURIComponent(s)}`);
    }
  }
  const canonical = canonicalOverride
    ?? `https://verifa.sk/screener${canonicalParts.length > 0 ? `?${canonicalParts.join("&")}` : ""}`;

  return {
    title,
    description,
    robots,
    alternates: { canonical },
  };
}

// ── Dynamic H1 builder ───────────────────────────────────────────────────────
function buildDynamicH1(searchParams: Record<string, string | string[] | undefined>): string {
  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  const krajLabel = getKrajLabel(sp("kraj"));
  const naceLabel = getNaceSectionLabel(sp("naceSection"));
  const city = sp("city");
  const legalForm = sp("legalForm");
  const q = sp("q");

  if (q) return `Firmy vyhľadávané "${q}"`;

  const parts: string[] = [];
  if (krajLabel) parts.push(krajLabel);
  if (city) parts.push(city);
  if (naceLabel) parts.push(naceLabel);
  if (legalForm) parts.push(legalForm);

  if (parts.length === 0) return "Screener firiem na Slovensku";
  return `Firmy — ${parts.join(", ")}`;
}

function buildDynamicSubtitle(searchParams: Record<string, string | string[] | undefined>, total: number): string {
  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  const hasFilters = Object.keys(searchParams).some(k =>
    k !== "sort" && k !== "dir" && k !== "page" && sp(k)
  );

  if (hasFilters) {
    return `Nájdených ${total.toLocaleString("sk-SK")} firiem zodpovedajúcich zvoleným filtrom.`;
  }
  return "Vyhľadávajte firmy podľa odvetvia, právnej formy, finančných ukazovateľov a ďalších kritérií.";
}

function buildSeoText(
  searchParams: Record<string, string | string[] | undefined>,
  total: number,
  companies: Array<{ name?: string | null; ico: string; latestRevenue?: string | null; city?: string | null }>,
): string {
  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  const krajLocative = getKrajLabelLocative(sp("kraj"));
  const naceGenitive = getNaceSectionGenitive(sp("naceSection"));
  const city = sp("city");

  const parts: string[] = [];
  if (krajLocative) parts.push(`v ${krajLocative.toLowerCase()}`);
  if (city) parts.push(`v meste ${city}`);
  if (naceGenitive) parts.push(`v odvetví ${naceGenitive}`);

  const location = parts.length > 0 ? parts.join(", ") : "na Slovensku";

  // Top companies mention
  const topNames = companies
    .slice(0, 3)
    .map(c => c.name)
    .filter(Boolean)
    .slice(0, 3);

  if (topNames.length > 0) {
    return `Vyhľadávaním bolo nájdených ${total.toLocaleString("sk-SK")} firiem ${location}. Medzi najvýznamnejšie patria ${topNames.join(", ")}. Filtrovanie umožňuje obmedziť výsledky podľa finančných ukazovateľov a roku založenia.`;
  }

  return `Vyhľadávaním bolo nájdených ${total.toLocaleString("sk-SK")} firiem ${location}. Filtrovanie umožňuje obmedziť výsledky podľa finančných ukazovateľov a roku založenia.`;
}

function buildItemListJsonLd(
  companies: Array<{ name?: string | null; ico: string; latestRevenue?: string | null; city?: string | null }>,
  searchParams: Record<string, string | string[] | undefined>,
): object {
  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  const h1 = buildDynamicH1(searchParams);
  const canonicalParts: string[] = [];
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    const s = typeof value === "string" ? value : value[0];
    if (s && key !== "sort" && key !== "dir" && key !== "page") {
      canonicalParts.push(`${key}=${encodeURIComponent(s)}`);
    }
  }
  const url = `https://verifa.sk/screener${canonicalParts.length > 0 ? `?${canonicalParts.join("&")}` : ""}`;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: h1,
    url,
    numberOfItems: companies.length,
    itemListElement: companies.slice(0, 20).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Organization",
        name: c.name || c.ico,
        identifier: c.ico,
        url: `https://verifa.sk/firma/${c.ico}`,
      },
    })),
  };
}

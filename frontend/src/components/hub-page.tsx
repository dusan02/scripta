import { headers } from "next/headers";
import Link from "next/link";
import { queryHubCompanies, getHubMetadata, getHubJsonLd, type HubParams } from "@/lib/hub";
import { getLangFromHeaders, getHreflangAlternates } from "@/lib/seo";
import { HubTable, SubHubLinks, HubPagination, HubBreadcrumbs } from "@/components/hub-ui";
import type { Metadata } from "next";

const BASE_URL = "https://verifa.sk";

/**
 * Shared hub page renderer — used by all hub route types.
 * Handles SEO metadata, JSON-LD, breadcrumbs, company table, pagination, sub-hubs.
 */
export async function renderHubPage(
  params: HubParams,
  searchParams: Record<string, string | string[] | undefined>,
  basePath: string
): Promise<React.ReactElement> {
  const h = await headers();
  const lang = getLangFromHeaders(h);

  const page = typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) : 1;
  const safePage = isNaN(page) || page < 1 ? 1 : Math.min(page, 10);

  const result = await queryHubCompanies(params, safePage);

  if (!result || result.total === 0) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <HubBreadcrumbs items={[
            { label: "Verifa.sk", href: "/" },
            { label: "Firmy", href: "/firmy" },
            { label: result?.hubLabel || "Hub" },
          ]} />
          <h1 className="text-2xl sm:text-3xl font-black mb-4" style={{ color: "var(--text)" }}>
            {result?.hubLabel || "Firmy"}
          </h1>
          <p style={{ color: "var(--text-secondary)" }}>
            Žiadne firmy nespĺňajú kritériá (min. 2 účtovné závierky).
          </p>
        </div>
      </div>
    );
  }

  const jsonLd = getHubJsonLd(params, result.companies, BASE_URL);

  // Build breadcrumbs
  const breadcrumbItems: Array<{ label: string; href?: string }> = [
    { label: "Verifa.sk", href: "/" },
    { label: "Firmy", href: "/firmy" },
  ];

  if (result.hubType === "odvetvie") {
    breadcrumbItems.push({ label: result.hubLabel });
  } else if (result.hubType === "kraj") {
    breadcrumbItems.push({ label: result.hubLabel });
  } else if (result.hubType === "odvetvie-kraj") {
    // Add parent NACE section
    const sectionLabel = result.hubLabel.split(" — ")[0];
    breadcrumbItems.push({ label: sectionLabel, href: `/odvetvie/${params.section}` });
    breadcrumbItems.push({ label: result.hubLabel.split(" — ")[1] || result.hubLabel });
  } else if (result.hubType === "okres") {
    breadcrumbItems.push({ label: result.hubLabel });
  } else if (result.hubType === "mesto") {
    breadcrumbItems.push({ label: result.hubLabel });
  }

  // Sub-hub title
  let subHubTitle = "";
  if (result.hubType === "odvetvie") subHubTitle = "Firmy podľa regiónu";
  else if (result.hubType === "kraj") subHubTitle = "Firmy podľa okresu";
  else if (result.hubType === "odvetvie-kraj") subHubTitle = "Firmy podľa okresu";
  else if (result.hubType === "okres") subHubTitle = "Firmy podľa mesta";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* JSON-LD */}
      {jsonLd.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <HubBreadcrumbs items={breadcrumbItems} />

        <h1 className="text-2xl sm:text-3xl font-black mb-2" style={{ color: "var(--text)" }}>
          {result.hubLabel}
        </h1>

        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          {result.total.toLocaleString("sk-SK")} firiem s finančnými dátami z verejných registrov SR.
          Zoradené podľa tržieb.
        </p>

        {/* Sub-hub links (for large hubs) */}
        <SubHubLinks subHubs={result.subHubs} title={subHubTitle} />

        {/* Company table */}
        <HubTable companies={result.companies} />

        {/* Pagination */}
        <HubPagination
          page={result.page}
          totalPages={result.totalPages}
          basePath={basePath}
        />

        {/* Link to screener for more filtering */}
        <div className="mt-8 p-4 rounded-lg flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Chcete filtrovať podľa tržieb, zisku, odvetvia alebo ďalších kritérií?
          </p>
          <Link
            href="/screener"
            className="text-sm font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            Spustiť Screener →
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Generate metadata for a hub page.
 */
export async function generateHubMetadata(params: HubParams): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const { title, description, canonical } = getHubMetadata(params, lang);

  // Build path for hreflang
  let path = "/";
  if (params.section && params.kraj) path = `/odvetvie/${params.section}/${params.kraj}`;
  else if (params.section) path = `/odvetvie/${params.section}`;
  else if (params.kraj) path = `/kraj/${params.kraj}`;
  else if (params.okres) path = `/okres/${params.okres}`;
  else if (params.city) path = `/mesto/${slugifyInline(params.city)}`;

  const alternates = getHreflangAlternates(path);

  return {
    title: { absolute: title },
    description,
    alternates: { canonical, languages: alternates },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${title} | Verifa.sk`,
      description,
      url: canonical,
      type: "website",
      siteName: "Verifa.sk",
    },
  };
}

function slugifyInline(name: string | null | undefined): string {
  if (!name) return "firma";
  return name
    .toLowerCase()
    .replace(/[áä]/g, "a").replace(/[éě]/g, "e").replace(/[í]/g, "i")
    .replace(/[óô]/g, "o").replace(/[úů]/g, "u").replace(/[ý]/g, "y")
    .replace(/[ž]/g, "z").replace(/[š]/g, "s").replace(/[č]/g, "c")
    .replace(/[ř]/g, "r").replace(/[ď]/g, "d").replace(/[ť]/g, "t")
    .replace(/[ň]/g, "n").replace(/[ľĺ]/g, "l")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60) || "firma";
}

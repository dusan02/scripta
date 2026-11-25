import type { MetadataRoute } from "next";

// Prefix match: "/dashboard" blocks /dashboard, /dashboard/, /dashboard?ico=…
// (a "/dashboard/" rule alone would NOT match bare /dashboard?ico= — observed 69k/day 307 storm).
// "/objednat" blocks /objednat and /objednat?ico=… (guest checkout funnel — observed 66k/day bot storm,
// 74.5k hits from GPTBot and 13.8k from Baiduspider in 34h, zero SEO value).
export const PRIVATE_PATHS = [
  "/api/",
  "/admin",
  "/dashboard",
  "/objednat",
  "/reports",
  "/history",
  "/credits",
  "/settings",
  "/messages",
] as const;

export const AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
] as const;

// Non-default locales served by Next.js route groups (pub-en, pub-de, pub-cs, pub-hu, pub-pl)
export const LOCALES = ["en", "de", "cs", "hu", "pl"] as const;

// Private / checkout paths exist under every locale too — e.g. /de/dashboard?ico=…, /en/objednat?ico=…
export const LOCALIZED_PRIVATE = LOCALES.flatMap((l) => [
  `/${l}/dashboard`,
  `/${l}/objednat`,
]);

export const LOCALIZED_FIRMA_PATHS = LOCALES.map((l) => `/${l}/firma/`);
export const LOCALIZED_ROOT_PATHS = LOCALES.map((l) => `/${l}/`);

// Next.js App Router client-side RSC prefetch payloads (?_rsc=...) have zero SEO value
// and generated 63.2k GPTBot hits + 988 OAI-SearchBot hits in 34h.
export const RSC_QUERY_DISALLOW = ["/*?_rsc=", "/*&_rsc="] as const;

export const PUBLIC_ALLOW = [
  "/",
  "/firma/",
  "/pricing",
  "/slovnik",
  "/documents",
] as const;

// Zero-value crawlers that burn massive SSR CPU & ISR cache with zero Slovak/EU B2B conversion value:
// - YandexBot: 102,282s RT (22.5% of total server time), 22,993 ISR MISSes in 34h
// - Baiduspider: 51,609s RT (11.3% of total server time), 12,472 ISR MISSes, 13,842 /objednat hits in 34h
// - SEO/scraper bots: already 403'd at Nginx, mirrored here for defense-in-depth
export const BLOCKED_CRAWLERS = [
  "YandexBot",
  "Yandex",
  "Baiduspider",
  "Bytespider",
  "PetalBot",
  "SemrushBot",
  "AhrefsBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "DataForSeoBot",
  "BacklinksExtendedBot",
] as const;

// AI / GEO crawlers: allow canonical SK public pages, block localized explosion, /objednat,
// /firmy & /screener dynamic hubs, and Next.js RSC prefetch queries.
export const AI_GEO_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "meta-webindexer",
  "Amazonbot",
  "ExaSearchBot",
] as const;

export default function robots(): MetadataRoute.Robots {
  const defaultDisallow = [
    ...PRIVATE_PATHS,
    ...LOCALIZED_PRIVATE,
    ...AUTH_PATHS,
    ...RSC_QUERY_DISALLOW,
  ];

  const aiDisallow = [
    ...PRIVATE_PATHS,
    ...AUTH_PATHS,
    ...LOCALIZED_ROOT_PATHS,
    ...RSC_QUERY_DISALLOW,
    "/firmy",
    "/screener",
  ];

  return {
    rules: [
      // Default rule — protects Googlebot & legitimate search engines on canonical SK /firma/,
      // localized hreflang targets, sitemaps, hubs, and glossary, while blocking private/checkout/RSC waste.
      {
        userAgent: "*",
        allow: [
          "/",
          "/firma/",
          "/firmy",
          "/screener",
          "/pricing",
          "/register",
          "/terms",
          "/privacy",
          "/refund",
          "/dpa",
          "/documents",
          "/slovnik",
        ],
        disallow: defaultDisallow,
      },
      // Bingbot: preserve canonical SK /firma/ & localized landing pages, but block non-sitemap
      // localized /{lang}/firma/ explosion (78.5% of bingbot's ISR MISSes = 13,254/34h) + gentle crawl delay.
      {
        userAgent: "bingbot",
        allow: [
          "/",
          "/firma/",
          "/firmy",
          "/screener",
          "/pricing",
          "/terms",
          "/privacy",
          "/refund",
          "/dpa",
          "/documents",
          "/slovnik",
        ],
        disallow: [...defaultDisallow, ...LOCALIZED_FIRMA_PATHS],
        crawlDelay: 2,
      },
      // Applebot: preserve canonical SK /firma/, block non-sitemap localized /{lang}/firma/ (97.8% of its MISSes).
      {
        userAgent: "Applebot",
        allow: [...PUBLIC_ALLOW, "/firmy", "/screener"],
        disallow: [...defaultDisallow, ...LOCALIZED_FIRMA_PATHS],
      },
      // AI crawlers: allow canonical SK content for GEO, block localized paths, /objednat, /firmy, /screener & ?_rsc=
      ...AI_GEO_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: [...PUBLIC_ALLOW],
        disallow: aiDisallow,
      })),
      // Zero-value high-cost crawlers & SEO scrapers: full disallow
      ...BLOCKED_CRAWLERS.map((userAgent) => ({
        userAgent,
        disallow: "/",
      })),
    ],
    sitemap: "https://verifa.sk/sitemap.xml",
  };
}

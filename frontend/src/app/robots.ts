import type { MetadataRoute } from "next";

// Prefix match: "/dashboard" blocks /dashboard, /dashboard/, /dashboard?ico=…
// (a "/dashboard/" rule alone would NOT match bare /dashboard?ico= — observed 69k/day 307 storm)
const PRIVATE_PATHS = [
  "/api/",
  "/admin",
  "/dashboard",
  "/reports",
  "/history",
  "/credits",
  "/settings",
  "/messages",
];
// Private paths exist under every locale too — e.g. /de/dashboard?ico=…
const LOCALES = ["en", "de", "cs", "hu", "pl"];
const LOCALIZED_PRIVATE = LOCALES.flatMap((l) => [`/${l}/dashboard`]);
const PUBLIC_ALLOW = ["/", "/firma/", "/pricing", "/slovnik", "/documents"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/firma/", "/firmy", "/screener", "/pricing", "/register", "/terms", "/privacy", "/refund", "/dpa", "/documents", "/slovnik"],
        disallow: [
          ...PRIVATE_PATHS,
          ...LOCALIZED_PRIVATE,
          "/login",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
        ],
      },
      // Allow AI crawlers to access public content for GEO
      // Localized paths are not in sitemap; block to preserve crawl budget for canonical SK URLs
      {
        userAgent: "GPTBot",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALES.map((l) => `/${l}/`)],
      },
      {
        userAgent: "ChatGPT-User",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALIZED_PRIVATE],
      },
      {
        userAgent: "ClaudeBot",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALIZED_PRIVATE],
      },
      {
        userAgent: "PerplexityBot",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALIZED_PRIVATE],
      },
      {
        userAgent: "Google-Extended",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALIZED_PRIVATE],
      },
      {
        userAgent: "Applebot-Extended",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALIZED_PRIVATE],
      },
      // Meta-ExternalAgent: block localized paths (79% of its MISS budget was wasted on non-sitemap localized renders)
      {
        userAgent: "meta-externalagent",
        allow: PUBLIC_ALLOW,
        disallow: [...PRIVATE_PATHS, ...LOCALES.map((l) => `/${l}/`)],
      },
    ],
    sitemap: "https://verifa.sk/sitemap.xml",
  };
}

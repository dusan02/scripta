import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/firma/", "/firmy", "/screener", "/pricing", "/register", "/terms", "/privacy", "/refund", "/dpa", "/documents", "/slovnik"],
        disallow: [
          "/api/",
          "/admin/",
          "/admin/*",
          "/dashboard/",
          "/dashboard/*",
          "/reports/",
          "/reports/*",
          "/history/",
          "/history/*",
          "/credits/",
          "/credits/*",
          "/settings/",
          "/settings/*",
          "/messages/",
          "/messages/*",
          "/login",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
        ],
      },
      // Allow AI crawlers to access public content for GEO
      {
        userAgent: "GPTBot",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: [
          "/api/",
          "/admin/",
          "/dashboard/",
          "/reports/",
          "/settings/",
          "/messages/",
          // Localized paths are not in sitemap; block to preserve crawl budget for canonical SK URLs
          "/en/",
          "/de/",
          "/cs/",
          "/hu/",
          "/pl/",
        ],
      },
      {
        userAgent: "ChatGPT-User",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
      {
        userAgent: "ClaudeBot",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
      {
        userAgent: "PerplexityBot",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
      {
        userAgent: "Google-Extended",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
      {
        userAgent: "Applebot-Extended",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
      // Meta-ExternalAgent: block localized paths (79% of its MISS budget was wasted on non-sitemap localized renders)
      {
        userAgent: "meta-externalagent",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: [
          "/api/",
          "/admin/",
          "/dashboard/",
          "/reports/",
          "/settings/",
          "/messages/",
          "/en/",
          "/de/",
          "/cs/",
          "/hu/",
          "/pl/",
        ],
      },
    ],
    sitemap: "https://verifa.sk/sitemap.xml",
  };
}

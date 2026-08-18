import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/firma/", "/firmy", "/screener", "/pricing", "/register", "/terms", "/privacy", "/dpa", "/documents", "/slovnik"],
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
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
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
    ],
    sitemap: "https://verifa.sk/sitemap.xml",
  };
}

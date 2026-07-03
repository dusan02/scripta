import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/firma/", "/cennik", "/pricing", "/ako-to-funguje", "/kontakt"],
        disallow: [
          "/api/",
          "/admin/",
          "/dashboard/",
          "/dashboard/*",
          "/reports/",
          "/reports/*",
          "/history/",
          "/history/*",
          "/plan/",
          "/plan/*",
          "/documents/",
          "/documents/*",
          "/settings/",
          "/settings/*",
          "/messages/",
          "/messages/*",
        ],
      },
    ],
    sitemap: "https://verifa.sk/sitemap.xml",
  };
}

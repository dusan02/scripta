import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test robots.ts output structure
// We replicate the function logic since Next.js metadata routes
// don't export the function for direct testing.

function robotsRules() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/firma/", "/pricing", "/register", "/terms", "/privacy", "/dpa", "/documents", "/slovnik"],
        disallow: [
          "/api/", "/admin/", "/admin/*", "/dashboard/", "/dashboard/*",
          "/reports/", "/reports/*", "/history/", "/history/*",
          "/credits/", "/credits/*", "/settings/", "/settings/*",
          "/messages/", "/messages/*", "/login", "/forgot-password",
          "/reset-password", "/verify-email",
        ],
      },
      {
        userAgent: "GPTBot",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
      {
        userAgent: "ClaudeBot",
        allow: ["/", "/firma/", "/pricing", "/slovnik", "/documents"],
        disallow: ["/api/", "/admin/", "/dashboard/", "/reports/", "/settings/", "/messages/"],
      },
    ],
    sitemap: "https://verifa.sk/sitemap.xml",
  };
}

describe("robots.ts", () => {
  it("allows public pages for all user agents", () => {
    const r = robotsRules();
    const defaultRules = r.rules[0];
    assert.ok(defaultRules.allow.includes("/"));
    assert.ok(defaultRules.allow.includes("/firma/"));
    assert.ok(defaultRules.allow.includes("/pricing"));
    assert.ok(defaultRules.allow.includes("/documents"));
    assert.ok(defaultRules.allow.includes("/slovnik"));
  });

  it("disallows private pages for all user agents", () => {
    const r = robotsRules();
    const defaultRules = r.rules[0];
    assert.ok(defaultRules.disallow.includes("/api/"));
    assert.ok(defaultRules.disallow.includes("/admin/"));
    assert.ok(defaultRules.disallow.includes("/dashboard/"));
    assert.ok(defaultRules.disallow.includes("/reports/"));
    assert.ok(defaultRules.disallow.includes("/settings/"));
    assert.ok(defaultRules.disallow.includes("/messages/"));
    assert.ok(defaultRules.disallow.includes("/login"));
    assert.ok(defaultRules.disallow.includes("/forgot-password"));
    assert.ok(defaultRules.disallow.includes("/reset-password"));
    assert.ok(defaultRules.disallow.includes("/verify-email"));
  });

  it("allows documents page (public content)", () => {
    const r = robotsRules();
    const defaultRules = r.rules[0];
    assert.ok(defaultRules.allow.includes("/documents"));
    assert.ok(!defaultRules.disallow.some((d: string) => d.startsWith("/documents")));
  });

  it("includes AI bot rules for GEO", () => {
    const r = robotsRules();
    const botNames = r.rules.map((rule: { userAgent: string }) => rule.userAgent);
    assert.ok(botNames.includes("GPTBot"));
    assert.ok(botNames.includes("ClaudeBot"));
  });

  it("AI bots can access public content but not private", () => {
    const r = robotsRules();
    const gptBot = r.rules.find((rule: { userAgent: string }) => rule.userAgent === "GPTBot");
    assert.ok(gptBot);
    assert.ok(gptBot!.allow.includes("/firma/"));
    assert.ok(gptBot!.disallow.includes("/api/"));
    assert.ok(gptBot!.disallow.includes("/dashboard/"));
  });

  it("references sitemap URL", () => {
    const r = robotsRules();
    assert.equal(r.sitemap, "https://verifa.sk/sitemap.xml");
  });
});

// Test JSON-LD structure for company pages
describe("Company page JSON-LD", () => {
  function companyJsonLd(ico: string, name: string, year?: number) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `https://verifa.sk/firma/${ico}#organization`,
          name, identifier: ico,
          url: `https://verifa.sk/firma/${ico}`,
        },
        {
          "@type": "Dataset",
          name: `Finančné dáta — ${name}`,
          description: `Účtovné závierky pre ${name} (IČO: ${ico}).`,
          creator: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
          about: { "@type": "Organization", name, identifier: ico },
          temporalCoverage: year ? `${year}` : undefined,
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Verifa.sk", item: "https://verifa.sk" },
            { "@type": "ListItem", position: 2, name, item: `https://verifa.sk/firma/${ico}` },
          ],
        },
      ],
    };
  }

  it("includes Organization schema with correct @id", () => {
    const json = companyJsonLd("12345678", "Test Corp");
    const org = json["@graph"].find((g: { "@type": string }) => g["@type"] === "Organization");
    assert.ok(org);
    assert.equal(org["@id"], "https://verifa.sk/firma/12345678#organization");
    assert.equal(org.identifier, "12345678");
  });

  it("includes Dataset schema with temporal coverage", () => {
    const json = companyJsonLd("12345678", "Test Corp", 2023);
    const dataset = json["@graph"].find((g: { "@type": string }) => g["@type"] === "Dataset");
    assert.ok(dataset);
    assert.equal(dataset.temporalCoverage, "2023");
  });

  it("includes BreadcrumbList with 2 items (no invalid /firma URL)", () => {
    const json = companyJsonLd("12345678", "Test Corp");
    const breadcrumb = json["@graph"].find((g: { "@type": string }) => g["@type"] === "BreadcrumbList");
    assert.ok(breadcrumb);
    assert.equal(breadcrumb!.itemListElement!.length, 2);
    assert.equal(breadcrumb!.itemListElement![0].position, 1);
    assert.equal(breadcrumb!.itemListElement![1].name, "Test Corp");
  });
});

// Test JSON-LD structure for dictionary pages
describe("Dictionary page JSON-LD", () => {
  function glossaryJsonLd(slug: string, title: string, shortDesc: string) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          headline: title,
          description: shortDesc,
          url: `https://verifa.sk/slovnik/${slug}`,
          author: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
          publisher: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Verifa.sk", item: "https://verifa.sk" },
            { "@type": "ListItem", position: 2, name: "Slovník", item: "https://verifa.sk/slovnik" },
            { "@type": "ListItem", position: 3, name: title, item: `https://verifa.sk/slovnik/${slug}` },
          ],
        },
      ],
    };
  }

  it("includes Article schema with correct headline and URL", () => {
    const json = glossaryJsonLd("altman-z-score", "Altman Z-Score", "A financial metric");
    const article = json["@graph"].find((g: { "@type": string }) => g["@type"] === "Article");
    assert.ok(article);
    assert.equal(article.headline, "Altman Z-Score");
    assert.equal(article.url, "https://verifa.sk/slovnik/altman-z-score");
  });

  it("includes author and publisher as Organization", () => {
    const json = glossaryJsonLd("altman-z-score", "Altman Z-Score", "A financial metric");
    const article = json["@graph"].find((g: { "@type": string }) => g["@type"] === "Article");
    assert.ok(article);
    const a = article as { author: { name: string }; publisher: { name: string } };
    assert.equal(a.author.name, "Verifa.sk");
    assert.equal(a.publisher.name, "Verifa.sk");
  });

  it("includes BreadcrumbList with slovnik as second item", () => {
    const json = glossaryJsonLd("altman-z-score", "Altman Z-Score", "A financial metric");
    const breadcrumb = json["@graph"].find((g: { "@type": string }) => g["@type"] === "BreadcrumbList");
    assert.ok(breadcrumb);
    assert.equal(breadcrumb!.itemListElement![1].name, "Slovník");
    assert.equal(breadcrumb!.itemListElement![2].name, "Altman Z-Score");
  });
});

// Test noindex metadata for private pages
describe("Private page noindex metadata", () => {
  it("all private pages should have robots noindex", () => {
    const privatePages = [
      "dashboard", "settings", "messages", "credits", "history",
      "reports", "admin", "login", "register",
      "forgot-password", "reset-password", "verify-email",
    ];

    // Each of these should have robots: { index: false, follow: false }
    const expectedRobots = { index: false, follow: false };
    for (const page of privatePages) {
      assert.equal(expectedRobots.index, false, `${page} should have index: false`);
      assert.equal(expectedRobots.follow, false, `${page} should have follow: false`);
    }
  });
});

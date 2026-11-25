import { describe, it } from "node:test";
import assert from "node:assert/strict";
import robots, {
  AI_GEO_CRAWLERS,
  BLOCKED_CRAWLERS,
  LOCALES,
} from "../../app/robots";

type RuleEntry = {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
  crawlDelay?: number;
};

function toArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function getRules(): RuleEntry[] {
  const cfg = robots();
  return Array.isArray(cfg.rules) ? cfg.rules : [cfg.rules];
}

function findRule(ua: string): RuleEntry | undefined {
  return getRules().find((r) => {
    const agents = toArray(r.userAgent);
    return agents.includes(ua);
  });
}

describe("frontend/src/app/robots.ts", () => {
  it("declares the canonical Verifa XML sitemap", () => {
    const cfg = robots();
    assert.equal(cfg.sitemap, "https://verifa.sk/sitemap.xml");
  });

  it("preserves Googlebot and default (*) access to canonical SK & localized SEO pages", () => {
    // Googlebot must NOT have a restrictive rule blocking canonical or localized /firma/ hreflang targets
    assert.equal(findRule("Googlebot"), undefined, "Googlebot should inherit unrestricted * rule");

    const wildcard = findRule("*");
    assert.ok(wildcard, "Wildcard (*) rule must exist");

    const allowed = toArray(wildcard!.allow);
    const disallowed = toArray(wildcard!.disallow);

    for (const path of ["/", "/firma/", "/firmy", "/screener", "/pricing", "/slovnik", "/documents"]) {
      assert.ok(allowed.includes(path), `Wildcard rule must allow ${path}`);
    }

    // Localized /{lang}/firma/ must NOT be disallowed under * so Googlebot can validate hreflang alternates
    for (const locale of LOCALES) {
      assert.ok(
        !disallowed.includes(`/${locale}/`),
        `Wildcard rule must not block /${locale}/ for Googlebot`
      );
      assert.ok(
        !disallowed.includes(`/${locale}/firma/`),
        `Wildcard rule must not block /${locale}/firma/ for Googlebot`
      );
    }
  });

  it("disallows private routes, /objednat checkout funnel, and ?_rsc= prefetch queries globally", () => {
    const wildcard = findRule("*");
    assert.ok(wildcard);
    const disallowed = toArray(wildcard!.disallow);

    for (const path of [
      "/api/",
      "/admin",
      "/dashboard",
      "/objednat",
      "/reports",
      "/history",
      "/credits",
      "/settings",
      "/messages",
      "/login",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/*?_rsc=",
      "/*&_rsc=",
    ]) {
      assert.ok(disallowed.includes(path), `Wildcard rule must disallow ${path}`);
    }

    for (const locale of LOCALES) {
      assert.ok(
        disallowed.includes(`/${locale}/dashboard`),
        `Wildcard rule must disallow /${locale}/dashboard`
      );
      assert.ok(
        disallowed.includes(`/${locale}/objednat`),
        `Wildcard rule must disallow /${locale}/objednat`
      );
    }
  });

  it("allows canonical SK /firma/ for bingbot and Applebot while blocking localized /{lang}/firma/ explosion", () => {
    const bing = findRule("bingbot");
    assert.ok(bing, "bingbot rule must exist");
    assert.ok(toArray(bing!.allow).includes("/firma/"));
    assert.equal(bing!.crawlDelay, 2, "bingbot should have a gentle crawlDelay");
    for (const locale of LOCALES) {
      assert.ok(
        toArray(bing!.disallow).includes(`/${locale}/firma/`),
        `bingbot must disallow /${locale}/firma/`
      );
    }

    const apple = findRule("Applebot");
    assert.ok(apple, "Applebot rule must exist");
    assert.ok(toArray(apple!.allow).includes("/firma/"));
    for (const locale of LOCALES) {
      assert.ok(
        toArray(apple!.disallow).includes(`/${locale}/firma/`),
        `Applebot must disallow /${locale}/firma/`
      );
    }
  });

  it("allows AI/GEO crawlers on canonical SK pages while blocking localized paths, /objednat, /firmy, /screener, and ?_rsc=", () => {
    for (const bot of AI_GEO_CRAWLERS) {
      const rule = findRule(bot);
      assert.ok(rule, `AI crawler rule must exist for ${bot}`);
      const allowed = toArray(rule!.allow);
      const disallowed = toArray(rule!.disallow);

      assert.ok(allowed.includes("/"), `${bot} must allow /`);
      assert.ok(allowed.includes("/firma/"), `${bot} must allow /firma/`);
      assert.ok(disallowed.includes("/objednat"), `${bot} must disallow /objednat`);
      assert.ok(disallowed.includes("/api/"), `${bot} must disallow /api/`);
      assert.ok(disallowed.includes("/firmy"), `${bot} must disallow /firmy`);
      assert.ok(disallowed.includes("/screener"), `${bot} must disallow /screener`);
      assert.ok(disallowed.includes("/*?_rsc="), `${bot} must disallow /*?_rsc=`);

      for (const locale of LOCALES) {
        assert.ok(
          disallowed.includes(`/${locale}/`),
          `${bot} must disallow /${locale}/`
        );
      }
    }
  });

  it("completely disallows zero-value high-cost crawlers (YandexBot, Baiduspider, SEO scrapers)", () => {
    for (const bot of BLOCKED_CRAWLERS) {
      const rule = findRule(bot);
      assert.ok(rule, `Blocked crawler rule must exist for ${bot}`);
      assert.deepEqual(
        toArray(rule!.disallow),
        ["/"],
        `${bot} must have disallow: "/"`
      );
    }
    assert.ok(BLOCKED_CRAWLERS.includes("YandexBot"));
    assert.ok(BLOCKED_CRAWLERS.includes("Baiduspider"));
    assert.ok(BLOCKED_CRAWLERS.includes("SemrushBot"));
    assert.ok(BLOCKED_CRAWLERS.includes("AhrefsBot"));
  });
});

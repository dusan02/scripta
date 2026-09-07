import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ─── Slug validation for company pages ─────────────────────
// Matches /firma/{ico} or /firma/{ico}-{slug}
const FIRMA_RE = /^\/(?:cs|en|de|hu|pl)?\/?firma\/(\d{8,10})(?:-([^/]+))?$/;

// Minimal slugify — must match lib/slug.ts exactly
function slugify(name: string | null | undefined): string {
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

const VALID_LANGS = ["sk", "en", "de", "cz", "hu", "pl"];
// SK is default (no URL prefix). Other langs get /cs/, /en/, /de/, /hu/, /pl/
// Note: cz uses /cs/ URL prefix (ISO 639-1), but internal Lang is "cz"
const URL_PREFIXES: Record<string, string> = {
  en: "en",
  de: "de",
  cs: "cz", // URL /cs/ → lang cz
  hu: "hu",
  pl: "pl",
};

// Edge-safe NACE section → slug mapping (must match src/lib/seo-url.ts)
const NACE_SLUG_MAP: Record<string, string> = {
  A: "polnohospodarstvo-a-lesnictvo",
  B: "tazba-a-dobyanie",
  C: "priemyselna-vyroba",
  D: "energetika",
  E: "vodne-hospodarstvo",
  F: "stavebnictvo",
  G: "obchod",
  H: "doprava-a-skladovanie",
  I: "ubytovanie-a-stravovanie",
  J: "informacie-a-komunikacia",
  K: "financie-a-poisovnictvo",
  L: "nehnutelnosti",
  M: "profesionalne-sluzby",
  N: "administrativne-sluzby",
  O: "verejna-sprava",
  P: "vzdelavanie",
  Q: "zdravotnictvo",
  R: "kultura-a-zabava",
  S: "ostatne-sluzby",
  T: "domacnosti",
  U: "extrateritorialne-cinnosti",
};

// Edge-safe kraj → slug mapping (must match src/lib/seo-url.ts)
const KRAJ_SLUG_MAP: Record<string, string> = {
  SK010: "bratislavsky-kraj",
  SK021: "trnavsky-kraj",
  SK022: "nitriansky-kraj",
  SK023: "trenciansky-kraj",
  SK031: "zilinsky-kraj",
  SK032: "banskobystricky-kraj",
  SK041: "presovsky-kraj",
  SK042: "kosicky-kraj",
};

// ─── In-process slug cache ─────────────────────────────────────────
// The Next.js fetch Data Cache is NOT available in middleware runtime —
// every request re-fetched /api/internal/company-slug (3-5s under load),
// tripping the 3s AbortSignal timeout and adding +3s to every /firma/ hit.
// A module-level Map persists per middleware isolate and removes the
// HTTP round-trip entirely for repeat IČO lookups.
const slugCache = new Map<string, { name: string | null; ts: number }>();
const SLUG_TTL_MS = 60 * 60 * 1000; // 1h — company names change only via cron reseed
const SLUG_CACHE_MAX = 20_000;

async function getCompanyName(ico: string): Promise<string | null | undefined> {
  const hit = slugCache.get(ico);
  if (hit && Date.now() - hit.ts < SLUG_TTL_MS) return hit.name;

  try {
    const res = await fetch(`http://localhost:3000/api/internal/company-slug/${ico}`, {
      headers: { "x-middleware-internal": "1" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (res.status === 404) {
      cacheSlug(ico, null); // known-nonexistent — negative cache
      return null;
    }
    if (res.ok) {
      const data = await res.json();
      if (data?.name !== undefined) {
        cacheSlug(ico, data.name as string | null);
        return data.name as string | null;
      }
    }
    return undefined; // fetch failed — don't cache, let page handle
  } catch {
    return undefined;
  }
}

function cacheSlug(ico: string, name: string | null) {
  if (slugCache.size >= SLUG_CACHE_MAX) {
    // Evict expired first; if still full, clear (slugs are stable per reseed window)
    const cutoff = Date.now() - SLUG_TTL_MS;
    for (const [k, v] of Array.from(slugCache)) {
      if (v.ts < cutoff) slugCache.delete(k);
      if (slugCache.size < SLUG_CACHE_MAX * 0.9) break;
    }
    if (slugCache.size >= SLUG_CACHE_MAX) slugCache.clear();
  }
  slugCache.set(ico, { name, ts: Date.now() });
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // --- Step 1: Extract language from URL prefix ---
  // /cs/pricing → rewrite to /pricing with x-verifa-lang: cz
  // /cs → rewrite to / with x-verifa-lang: cz
  let detectedLang: string | null = null;
  let realPath = pathname;

  for (const [urlPrefix, lang] of Object.entries(URL_PREFIXES)) {
    if (pathname === `/${urlPrefix}`) {
      detectedLang = lang;
      realPath = "/";
      break;
    }
    if (pathname.startsWith(`/${urlPrefix}/`)) {
      detectedLang = lang;
      realPath = pathname.slice(`/${urlPrefix}`.length); // strip prefix
      break;
    }
  }

  // --- Step 2: Also check ?lang=xx for backwards compatibility ---
  const langParam = searchParams.get("lang");
  if (!detectedLang && langParam && VALID_LANGS.includes(langParam)) {
    detectedLang = langParam;
  }

  // --- Step 2b: Screener is Slovak-only — redirect prefixed URLs to the
  // canonical Slovak version (avoids SK content indexed under /en, /de, ...) ---
  const isScreenerPath = realPath === "/screener" || realPath.startsWith("/screener/");
  if (isScreenerPath && pathname !== realPath) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = realPath;
    redirectUrl.searchParams.delete("lang");
    return NextResponse.redirect(redirectUrl, 308);
  }

  // --- Step 2c: Legacy /odvetvie/ → clean /firmy/ redirect (308 permanent) ---
  // permanentRedirect() in page.tsx is swallowed by Sentry wrapper → returns 200.
  // Middleware NextResponse.redirect(308) bypasses Sentry and returns correct HTTP 308.
  // Edge-safe inline mapping (no Prisma/screener imports allowed in middleware).
  const odvetvieMatch = realPath.match(/^\/odvetvie\/([A-U])(?:\/(SK\d{3}))?$/);
  if (odvetvieMatch) {
    const naceSlug = NACE_SLUG_MAP[odvetvieMatch[1]];
    if (naceSlug) {
      const krajSlug = odvetvieMatch[2] ? KRAJ_SLUG_MAP[odvetvieMatch[2]] : null;
      const targetPath = krajSlug
        ? `/firmy/${naceSlug}/${krajSlug}`
        : `/firmy/${naceSlug}`;
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = targetPath;
      redirectUrl.searchParams.delete("lang");
      return NextResponse.redirect(redirectUrl, 308);
    }
  }

  // --- Step 3a: Bare-IČO URLs (/36204731) → canonical /firma/ path ---
  // The /[ico] page tried redirect() but Sentry's server-component wrapper
  // swallows it → returned 200 with full indexable content and NO canonical —
  // a duplicate URL family per company. Middleware redirect bypasses Sentry.
  // Two-hop is fine: /{ico} → /firma/{ico} → slug-resolved /firma/{ico}-{slug}.
  const icoOnlyMatch = realPath.match(/^\/(\d{8,10})$/);
  if (icoOnlyMatch) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = `/firma/${icoOnlyMatch[1]}`;
    return NextResponse.redirect(redirectUrl, 308);
  }

  // --- Step 3+4: Company pages — static routes per language, no rewrite ---
  // Firma pages have real URL routes for each language (app/(pub-{lang})/{prefix}/firma/...),
  // so they must NOT be rewritten — the lang prefix stays in the URL and the page
  // gets its language from the route, making it static + ISR-cacheable.
  const firmaMatch = realPath.match(FIRMA_RE);
  if (firmaMatch) {
    const ico = firmaMatch[1];
    const currentSlug = firmaMatch[2] || "";
    const urlLangPrefix = pathname !== realPath ? pathname.slice(0, pathname.length - realPath.length) : "";

    // ?lang=xx on a firma page → normalize to the prefixed URL
    if (!urlLangPrefix && langParam && VALID_LANGS.includes(langParam) && langParam !== "sk") {
      const prefix = langParam === "cz" ? "cs" : langParam;
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = `/${prefix}${realPath}`;
      redirectUrl.searchParams.delete("lang");
      const r = NextResponse.redirect(redirectUrl, 308);
      r.cookies.set("verifa-lang", langParam, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
      return r;
    }

    // Slug validation via in-process cache (falls back to internal API fetch).
    // undefined = lookup failed → pass through, page renders normally.
    const companyName = await getCompanyName(ico);
    if (companyName) {
      const correctSlug = slugify(companyName);
      if (currentSlug !== correctSlug) {
        const redirectUrl = req.nextUrl.clone();
        redirectUrl.pathname = `${urlLangPrefix}/firma/${ico}-${correctSlug}`;
        return NextResponse.redirect(redirectUrl, 308);
      }
    }

    // Unprefixed firma URL + remembered non-SK language → redirect to the
    // language-prefixed URL so every URL serves exactly one language variant
    // (required for CDN caching; content must not vary by cookie).
    if (!urlLangPrefix) {
      const cookieLang = req.cookies.get("verifa-lang")?.value;
      if (cookieLang && cookieLang !== "sk" && VALID_LANGS.includes(cookieLang)) {
        const prefix = cookieLang === "cz" ? "cs" : cookieLang;
        const redirectUrl = req.nextUrl.clone();
        redirectUrl.pathname = `/${prefix}${pathname}`;
        return NextResponse.redirect(redirectUrl, 308);
      }
    }

    // Pass through unchanged (prefixed routes hit their own static route group)
    const pass = NextResponse.next();
    if (detectedLang) {
      pass.cookies.set("verifa-lang", detectedLang, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
    }
    return pass;
  }

  // --- Step 3b: Non-firma pages — build response with lang header + cookie ---
  let langResponse: NextResponse | null = null;
  if (detectedLang) {
    if (realPath !== pathname) {
      // URL prefix detected → rewrite to real path
      const url = req.nextUrl.clone();
      url.pathname = realPath;
      // Remove ?lang= from query if present (avoid duplicate)
      url.searchParams.delete("lang");
      langResponse = NextResponse.rewrite(url);
    } else {
      // ?lang= detected → no rewrite needed, just pass through
      langResponse = NextResponse.next();
    }
    langResponse.headers.set("x-verifa-lang", detectedLang);
    langResponse.cookies.set("verifa-lang", detectedLang, {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
      sameSite: "lax",
    });
  }

  // --- Step 5: Auth checks (on realPath, not the prefixed path) ---
  // Root: authenticated users → /dashboard, unauthenticated → landing page
  if (realPath === "/") {
    if (token?.id) {
      const dashUrl = new URL("/dashboard", req.url);
      if (langResponse) {
        // Preserve lang header in redirect
        const redirect = NextResponse.redirect(dashUrl);
        redirect.headers.set("x-verifa-lang", detectedLang || "sk");
        return redirect;
      }
      return NextResponse.redirect(dashUrl);
    }
    return langResponse || NextResponse.next();
  }

  // Protected routes: unauthenticated → /login
  const protectedRoutes = [
    "/dashboard",
    "/reports",
    "/history",
    "/settings",
    "/messages",
    "/admin",
    "/credits",
  ];
  const isProtected = protectedRoutes.some(
    (route) => realPath === route || realPath.startsWith(route + "/")
  );

  if (isProtected && !token?.id) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", realPath);
    return NextResponse.redirect(loginUrl);
  }

  return langResponse || NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, icon.svg, logo-verifa.png (favicon files)
     * - robots.txt, sitemap.xml
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|logo-verifa.png|robots.txt|sitemap.xml).*)",
  ],
};

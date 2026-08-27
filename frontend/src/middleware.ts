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

  // --- Step 3: Build response with lang header + cookie ---
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

  // --- Step 4: Company page slug validation ---
  // Redirect /firma/{ico} and /firma/{ico}-stale-slug to /firma/{ico}-correct-slug
  // Done in middleware (not page.tsx) because Sentry swallows permanentRedirect() errors.
  const firmaMatch = realPath.match(FIRMA_RE);
  if (firmaMatch) {
    const ico = firmaMatch[1];
    const currentSlug = firmaMatch[2] || "";
    // Fetch company name from DB — lightweight query, no relations
    // We use a direct fetch to the internal API to avoid Prisma in middleware
    // (Prisma client isn't available in middleware edge runtime)
    try {
      const res = await fetch(`${req.nextUrl.origin}/api/internal/company-slug/${ico}`, {
        headers: { "x-middleware-internal": "1" },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const correctSlug = slugify(data.name);
        if (currentSlug !== correctSlug) {
          const redirectUrl = req.nextUrl.clone();
          // Preserve language prefix
          const langPrefix = pathname !== realPath ? pathname.slice(0, pathname.length - realPath.length) : "";
          redirectUrl.pathname = `${langPrefix}/firma/${ico}-${correctSlug}`;
          return NextResponse.redirect(redirectUrl, 308);
        }
      }
    } catch {
      // If DB lookup fails, let the page render normally
    }
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

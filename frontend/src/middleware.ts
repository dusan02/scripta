import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

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

  // --- Step 4: Auth checks (on realPath, not the prefixed path) ---
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

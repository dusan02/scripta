import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const VALID_LANGS = ["sk", "en", "de", "cz", "hu", "pl"];

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Language detection: ?lang=xx → set cookie, strip query param
  const langParam = searchParams.get("lang");
  let response: NextResponse | null = null;

  if (langParam && VALID_LANGS.includes(langParam)) {
    // Set cookie for SSR language detection
    const res = NextResponse.next();
    res.cookies.set("verifa-lang", langParam, {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
      sameSite: "lax",
    });
    response = res;
  }

  // Root: authenticated users → /dashboard, unauthenticated → landing page
  if (pathname === "/") {
    if (token?.id) {
      const dashUrl = new URL("/dashboard", req.url);
      if (response) {
        return NextResponse.redirect(dashUrl, { headers: response.headers });
      }
      return NextResponse.redirect(dashUrl);
    }
    return response || NextResponse.next();
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
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (isProtected && !token?.id) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response || NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, icon.svg, logo-verifa.png (favicon files)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|logo-verifa.png|robots.txt|sitemap.xml).*)",
  ],
};

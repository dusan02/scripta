import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Root: authenticated users → /dashboard, unauthenticated → landing page
  if (pathname === "/") {
    if (token?.id) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard",
    "/reports/:path+",
    "/history/:path*",
    "/settings/:path*",
    "/messages/:path*",
    "/admin/:path*",
    "/credits",
  ],
};

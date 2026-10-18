"use client";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import NavBar from "./NavBar";
import LandingNav from "./landing/LandingNav";
import { delocalizePath } from "@/lib/i18n";

// Pages with their own full nav (LandingNav) — never show a second nav
const SELF_NAV_PATHS = ["/", "/landing"];

// Pages that render their own standalone header or auth card when anonymous
const STANDALONE_ANON_PATHS = [
  "/screener",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

export default function NavWrapper() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { path: realPath } = delocalizePath(pathname);

  // Landing/marketing pages have their own nav — never show app NavBar
  if (SELF_NAV_PATHS.includes(realPath)) {
    return null;
  }

  // Authenticated users get the internal app NavBar everywhere
  if (session?.user) {
    return <NavBar />;
  }

  // Anonymous users on /firma/* (any language) or standalone auth/screener pages
  // already have FirmaStickyHeader or their own header — render nothing here.
  if (
    STANDALONE_ANON_PATHS.includes(realPath) ||
    realPath.startsWith("/firma/")
  ) {
    return null;
  }

  // Anonymous users on public content pages (/slovnik/*, /mesto/*, /kraj/*,
  // /okres/*, /firmy/*, /pricing, /documents, etc.) get the public LandingNav
  // instead of the authenticated NavBar (prevents prefetching /dashboard,
  // /settings, /credits, /history, /messages which 307-redirect to /login).
  return <LandingNav />;
}

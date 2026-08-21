"use client";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import NavBar from "./NavBar";

// Pages with their own full nav (LandingNav) — never show app NavBar
const SELF_NAV_PATHS = ["/", "/landing"];

// Public pages — show app NavBar only for authenticated users
const PUBLIC_PATHS = [
  "/screener",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/documents",
];

export default function NavWrapper() {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Landing/marketing pages have their own nav — never show app NavBar
  if (SELF_NAV_PATHS.includes(pathname)) {
    return null;
  }

  const isPublicPath =
    PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/firma/");

  // Public app pages: NavBar only for authenticated users
  if (isPublicPath && !session?.user) {
    return null;
  }

  return <NavBar />;
}

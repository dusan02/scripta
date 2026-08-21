"use client";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import NavBar from "./NavBar";

const PUBLIC_PATHS = [
  "/",
  "/landing",
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

  const isPublicPath =
    PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/firma/");

  // Hide NavBar only for anonymous users on public pages
  if (isPublicPath && !session?.user) {
    return null;
  }

  return <NavBar />;
}

"use client";
import { usePathname } from "next/navigation";
import NavBar from "./NavBar";

export default function NavWrapper() {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname.startsWith("/firma/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/documents"
  ) {
    return null;
  }
  return <NavBar />;
}

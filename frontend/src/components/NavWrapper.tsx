"use client";
import { usePathname } from "next/navigation";
import NavBar from "./NavBar";

export default function NavWrapper() {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
  ) {
    return null;
  }
  return <NavBar />;
}

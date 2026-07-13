"use client";

import { useT } from "@/components/LanguageProvider";
import { usePathname } from "next/navigation";

export default function Footer() {

  const pathname = usePathname();
  const t = useT();
  
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
  ) {
    return null;
  }

  return (
    <footer style={{ borderTop: "1px solid var(--border)", marginTop: "64px" }}>
      <div className="max-w-[1200px] mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          © {new Date().getFullYear()} Verifa.sk
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("footer.urcene")}
        </span>
      </div>
    </footer>
  );
}

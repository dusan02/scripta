"use client";

import Link from "next/link";
import { useT, useLang } from "@/components/LanguageProvider";
import { usePathname } from "next/navigation";
import { localizePath } from "@/lib/i18n";

export default function Footer() {

  const pathname = usePathname();
  const t = useT();
  const { lang } = useLang();
  const lhref = (p: string) => localizePath(p, lang);
  
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
    <footer style={{ borderTop: "1px solid var(--border)", marginTop: "64px" }} className="no-print">
      <div className="max-w-[1200px] mx-auto px-6 py-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Link href={lhref("/slovnik/orsr")} className="hover:underline font-medium" style={{ color: "var(--text)" }}>
              ORSR vyhľadávanie
            </Link>
            <Link href={lhref("/screener")} className="hover:underline">
              Screener firiem
            </Link>
            <Link href={lhref("/firmy")} className="hover:underline">
              Firmy na Slovensku
            </Link>
            <Link href={lhref("/slovnik")} className="hover:underline">
              Slovník pojmov
            </Link>
            <Link href={lhref("/pricing")} className="hover:underline">
              Cenník
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" style={{ color: "var(--text-muted)" }}>
            <Link href={lhref("/terms")} className="hover:underline">
              {t("home.terms")}
            </Link>
            <Link href={lhref("/privacy")} className="hover:underline">
              {t("home.footerPrivacy")}
            </Link>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            © {new Date().getFullYear()} Verifa.sk
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("footer.urcene")}
          </span>
        </div>
      </div>
    </footer>
  );
}

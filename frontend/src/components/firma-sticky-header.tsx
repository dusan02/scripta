"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { PrintButton } from "@/components/PrintButton";
import { CompactReportCTA } from "@/components/report-cta";
import { useT, useLang } from "@/components/LanguageProvider";
import { localizePath } from "@/lib/i18n";

/**
 * Sticky header for public firma pages.
 * Server-rendered for anonymous visitors (full content in ISR HTML).
 * Logged-in users already see the app NavBar — header hides client-side
 * after session resolves to avoid a double header.
 */
export function FirmaStickyHeader({ ico }: { ico: string }) {
  const t = useT();
  const { lang } = useLang();
  const { status } = useSession();

  if (status === "authenticated") return null;

  return (
    <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10 }}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link href={localizePath("/", lang)} className="flex items-center gap-2">
          <Logo size="sm" />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2 no-print">
          <CompactReportCTA ico={ico} source="sticky_header" />
          <PrintButton />
          <ThemeToggle size="sm" />
          <Link
            href={localizePath("/login", lang)}
            className="text-[11px] sm:text-xs font-medium px-3 sm:px-3 py-2.5 sm:py-2 rounded-lg transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {t("firma.prihlasitSa")}
          </Link>
        </div>
      </div>
    </header>
  );
}

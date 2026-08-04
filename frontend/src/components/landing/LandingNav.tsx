"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { useScrollLock, useScrolled, useHideOnScroll } from "@/components/useNav";
import { HamburgerButton, MobileMenuBackdrop } from "@/components/NavShared";
import { useState } from "react";

const NAV_ITEMS = [
  { hash: "#funkcie", key: "home.navFeatures" },
  { hash: "#registre", key: "home.navRegistries" },
  { hash: "#ukazka", key: "nav.reporty" },
  { hash: "#pricing", key: "home.navPricing" },
];

export default function LandingNav() {
  const t = useT();
  const pathname = usePathname();
  const scrolled = useScrolled(20);
  const authBarVisible = useHideOnScroll(100);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useScrollLock(mobileMenuOpen);

  // On the landing page, hash links scroll to sections.
  // On other pages (e.g. /reports), link to landing page sections or /reports directly.
  const isLanding = pathname === "/";
  const navHref = (hash: string) => {
    if (isLanding) return hash;
    return `/${hash}`;
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "glass-nav" : "border-b border-transparent"
      }`}
      style={!scrolled ? { background: "var(--bg)" } : undefined}
    >
      {/* Top bar */}
      <div className="max-w-[1200px] mx-auto px-4 flex items-center justify-between h-16">
        {/* Left: Logo + desktop nav links */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center no-underline">
            <Logo size="sm" />
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-5">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.hash}
                href={navHref(item.hash)}
                className="text-sm font-medium leading-9 transition-colors hover:text-[var(--accent)]"
                style={{ color: "var(--text-secondary)" }}
              >
                {t(item.key)}
              </a>
            ))}
          </div>
        </div>

        {/* Right: controls + auth buttons */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle size="md" />
            <LanguageSwitcher />
            <Link
              href="/register"
              className="inline-flex items-center h-9 px-4 rounded-lg text-sm font-medium border transition-all hover:opacity-80"
              style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
            >
              {t("home.navRegister")}
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center h-9 px-5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
            >
              {t("home.navLogin")}
            </Link>
          </div>

          {/* Mobile: theme + language + hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle size="sm" />
            <LanguageSwitcher />
            <HamburgerButton
              open={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
            />
          </div>
        </div>
      </div>

      {/* Mobile: Register + Login below top bar */}
      <div
        className="md:hidden max-w-[1200px] mx-auto px-4 flex gap-2 overflow-hidden transition-all duration-250"
        style={{
          opacity: authBarVisible ? 1 : 0,
          transform: authBarVisible ? "translateY(0)" : "translateY(-100%)",
          maxHeight: authBarVisible ? 60 : 0,
        }}
      >
        <Link
          href="/register"
          className="flex-1 text-center text-sm font-semibold leading-10 h-10 rounded-lg border transition-all hover:opacity-80"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          {t("home.navRegister")}
        </Link>
        <Link
          href="/login"
          className="flex-1 text-center text-sm font-semibold leading-10 h-10 rounded-lg transition-all hover:opacity-90"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
        >
          {t("home.navLogin")}
        </Link>
      </div>

      {/* Mobile dropdown menu */}
      <MobileMenuBackdrop open={mobileMenuOpen} onClick={() => setMobileMenuOpen(false)} />
      {mobileMenuOpen && (
        <div
          className="md:hidden relative z-50 px-4 pb-4 pt-2 flex flex-col rounded-b-lg shadow-lg slide-down"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.hash}
              href={navHref(item.hash)}
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center text-sm font-medium py-4 min-h-[48px] border-b transition-colors hover:text-[var(--accent)]"
              style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
            >
              {t(item.key)}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}

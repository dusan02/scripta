"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import Logo from "@/components/Logo";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { HamburgerIcon, CloseIcon } from "@/components/icons";

const NAV_ITEMS = [
  { href: "#funkcie", key: "home.navFeatures" },
  { href: "#registre", key: "home.navRegistries" },
  { href: "#ukazka", key: "nav.dokumenty" },
  { href: "#pricing", key: "home.navPricing" },
];

export default function LandingNav() {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authBarVisible, setAuthBarVisible] = useState(true);

  useEffect(() => {
    let lastScrollY = 0;
    const onScroll = () => {
      const currentY = window.scrollY;
      setScrolled(currentY > 20);
      if (currentY > 100 && currentY > lastScrollY) {
        setAuthBarVisible(false);
      } else {
        setAuthBarVisible(true);
      }
      lastScrollY = currentY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [mobileMenuOpen]);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "glass-nav" : "border-b border-transparent"
      }`}
      style={!scrolled ? { background: "var(--bg)" } : undefined}
    >
      {/* Top bar */}
      <div className="max-w-[1200px] mx-auto px-4 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center no-underline">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-5">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium leading-9 transition-colors hover:text-[var(--accent)]"
              style={{ color: "var(--text-secondary)" }}
            >
              {t(item.key)}
            </a>
          ))}
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
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Menu"
            className="w-10 h-10 flex items-center justify-center rounded-lg transition-all hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            style={{
              background: "var(--bg-muted)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            {mobileMenuOpen ? <CloseIcon size={20} /> : <HamburgerIcon size={20} />}
          </button>
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
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 top-0 z-40"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className="md:hidden relative z-50 px-4 pb-4 pt-2 flex flex-col rounded-b-lg shadow-lg"
            style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
          >
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center text-sm font-medium py-4 min-h-[48px] border-b transition-colors hover:text-[var(--accent)]"
                style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
              >
                {t(item.key)}
              </a>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}

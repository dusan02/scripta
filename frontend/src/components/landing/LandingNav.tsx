"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import Logo from "@/components/Logo";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

const MOBILE_NAV_ITEMS = [
  { href: "#funkcie", key: "home.navFeatures" },
  { href: "#registre", key: "home.navRegistries" },
  { href: "#ukazka", key: "nav.dokumenty" },
  { href: "#pricing", key: "home.navPricing" },
];

export default function LandingNav() {
  const { theme, toggle } = useTheme();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authBarVisible, setAuthBarVisible] = useState(true);
  const darkMode = theme === "dark";

  useEffect(() => {
    let lastScrollY = 0;
    const onScroll = () => {
      const currentY = window.scrollY;
      setScrolled(currentY > 20);
      // Hide auth bar when scrolling down, show when scrolling up
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

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [mobileMenuOpen]);

  const navStyle: React.CSSProperties = {
    position: "fixed",
    top: 0, left: 0, right: 0,
    zIndex: 100,
    background: scrolled ? "var(--surface)" : "var(--bg)",
    borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
    transition: "all 0.3s ease",
    backdropFilter: scrolled ? "blur(12px)" : "none",
  };

  const topBarStyle: React.CSSProperties = {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const iconBtnStyle: React.CSSProperties = {
    background: "var(--bg-muted)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    height: 40,
    width: 40,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
  };

  return (
    <nav style={navStyle}>
      {/* Top bar */}
      <div style={topBarStyle}>
        <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <Logo size="sm" />
        </Link>

        {/* Desktop nav links + actions */}
        <div className="desktop-nav" style={{ alignItems: "center", gap: 20 }}>
          <a href="#funkcie" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500, lineHeight: "36px" }}>{t("home.navFeatures")}</a>
          <a href="#registre" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500, lineHeight: "36px" }}>{t("home.navRegistries")}</a>
          <a href="#ukazka" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500, lineHeight: "36px" }}>{t("nav.dokumenty")}</a>
          <a href="#pricing" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500, lineHeight: "36px" }}>{t("home.navPricing")}</a>
          <button
            onClick={toggle}
            style={iconBtnStyle}
            aria-label="Toggle theme"
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          <LanguageSwitcher />
          <Link
            href="/register"
            style={{
              color: "var(--text-secondary)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
              height: 36,
              padding: "0 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {t("home.navRegister")}
          </Link>
          <Link
            href="/login"
            style={{
              background: "var(--accent)",
              color: "var(--accent-button-text)",
              height: 36,
              padding: "0 20px",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {t("home.navLogin")}
          </Link>
        </div>

        {/* Mobile: theme + language + hamburger */}
        <div className="mobile-nav" style={{ alignItems: "center", gap: 8 }}>
          <button
            onClick={toggle}
            style={iconBtnStyle}
            aria-label="Toggle theme"
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          <LanguageSwitcher />
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            style={iconBtnStyle}
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileMenuOpen
                ? <path d="M6 18L18 6M6 6l12 12" />
                : <><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" /></>
              }
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile: Register + Login below top bar — hides on scroll down */}
      <div className="mobile-auth-bar" style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 16px 10px",
        display: "flex",
        gap: 8,
        transition: "opacity 0.25s ease, transform 0.25s ease, max-height 0.25s ease",
        opacity: authBarVisible ? 1 : 0,
        transform: authBarVisible ? "translateY(0)" : "translateY(-100%)",
        maxHeight: authBarVisible ? 60 : 0,
        overflow: "hidden",
      }}>
        <Link
          href="/register"
          style={{
            flex: 1,
            textAlign: "center",
            color: "var(--text-secondary)",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
            height: 40,
            lineHeight: "40px",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          {t("home.navRegister")}
        </Link>
        <Link
          href="/login"
          style={{
            flex: 1,
            textAlign: "center",
            background: "var(--accent)",
            color: "var(--accent-button-text)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
            height: 40,
            lineHeight: "40px",
            borderRadius: 8,
          }}
        >
          {t("home.navLogin")}
        </Link>
      </div>

      {/* Mobile dropdown menu — only anchor links */}
      {mobileMenuOpen && (
        <>
          <div
            className="mobile-nav"
            style={{
              position: "fixed",
              inset: 0,
              top: 0,
              zIndex: 90,
              background: "rgba(0,0,0,0.4)",
            }}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className="mobile-nav"
            style={{
              position: "relative",
              zIndex: 95,
              background: "var(--surface)",
              borderBottom: "1px solid var(--border)",
              padding: "8px 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          >
            {MOBILE_NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                  fontSize: 15,
                  fontWeight: 500,
                  padding: "16px 8px",
                  minHeight: 48,
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                }}
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

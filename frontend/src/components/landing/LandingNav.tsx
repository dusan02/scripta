"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import Logo from "@/components/Logo";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function LandingNav() {
  const { theme, toggle } = useTheme();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const darkMode = theme === "dark";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0,
        zIndex: 100,
        background: scrolled ? "var(--surface)" : "var(--bg)",
        borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
        transition: "all 0.3s ease",
        backdropFilter: scrolled ? "blur(12px)" : "none",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <Logo size="md" />
        </Link>

        {/* Desktop nav */}
        <div className="desktop-nav" style={{ alignItems: "center", gap: 24 }}>
          <a href="#funkcie" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>{t("home.navFeatures")}</a>
          <a href="#registre" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>{t("home.navRegistries")}</a>
          <a href="#ukazka" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>{t("nav.dokumenty")}</a>
          <a href="#cennik" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>{t("home.navPricing")}</a>
          <button
            onClick={toggle}
            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontSize: 16 }}
            aria-label="Toggle theme"
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <LanguageSwitcher />
          <Link
            href="/register"
            style={{
              color: "var(--text-secondary)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            {t("home.navRegister")}
          </Link>
          <Link
            href="/login"
            style={{
              background: "var(--accent)",
              color: "var(--accent-button-text)",
              padding: "10px 20px",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {t("home.navLogin")}
          </Link>
        </div>

        {/* Mobile nav controls */}
        <div className="mobile-nav" style={{ alignItems: "center", gap: 8 }}>
          <button
            onClick={toggle}
            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontSize: 16 }}
            aria-label="Toggle theme"
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <LanguageSwitcher />
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 18, color: "var(--text)" }}
            aria-label="Menu"
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding: "16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          <a href="#funkcie" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>{t("home.navFeatures")}</a>
          <a href="#registre" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>{t("home.navRegistries")}</a>
          <a href="#ukazka" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>{t("nav.dokumenty")}</a>
          <a href="#cennik" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>{t("home.navPricing")}</a>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <Link href="/register" onClick={() => setMobileMenuOpen(false)} style={{ display: "block", textAlign: "center", color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 600, padding: "10px", borderRadius: 8, border: "1px solid var(--border)" }}>{t("home.navRegister")}</Link>
          <Link href="/login" onClick={() => setMobileMenuOpen(false)} style={{ display: "block", textAlign: "center", background: "var(--accent)", color: "var(--accent-button-text)", textDecoration: "none", fontSize: 15, fontWeight: 600, padding: "10px", borderRadius: 8 }}>{t("home.navLogin")}</Link>
        </div>
      )}
    </nav>
  );
}

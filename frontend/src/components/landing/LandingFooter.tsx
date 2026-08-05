"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { useT } from "@/components/LanguageProvider";

export default function LandingFooter() {
  const t = useT();
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const navHref = (hash: string) => {
    if (isLanding) return hash;
    return `/${hash}`;
  };

  return (
    <footer style={{ borderTop: "1px solid var(--border)", padding: "40px 24px" }} className="section-pad">
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 32 }} className="footer-cols">
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ marginBottom: 12 }}>
            <Logo size="md" />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 300, marginBottom: 16 }}>{t("landing.footerTagline")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>{t("home.footerContact")}</span>
            <a href="mailto:info@verifa.sk" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none", marginTop: 4 }}>info@verifa.sk</a>
          </div>
        </div>

        <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }} className="footer-links">
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{t("home.footerProduct")}</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a href={navHref("#obsah")} style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navFeatures")}</a>
              <a href={navHref("#registre")} style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navRegistries")}</a>
              <a href={navHref("#ukazka")} style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("nav.reporty")}</a>
              <a href={navHref("#pricing")} style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navPricing")}</a>
              <Link href="/slovnik" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.footerGlossary")}</Link>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{t("home.footerLegal")}</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a href="/terms" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.terms")}</a>
              <a href="/privacy" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.footerPrivacy")}</a>
              <a href="/dpa" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>DPA</a>
              <a href="/documents" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("nav.dokumenty")}</a>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "32px auto 0", paddingTop: 24, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12 }} className="footer-bottom">
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>© {new Date().getFullYear()} Verifa.sk — {t("home.rights")}</p>
      </div>
    </footer>
  );
}

"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import { useT } from "@/components/LanguageProvider";

export default function LandingFooter() {
  const t = useT();

  return (
    <footer style={{ borderTop: "1px solid var(--border)", padding: "40px 24px" }} className="section-pad">
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 32 }} className="footer-cols">
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ marginBottom: 12 }}>
            <Logo size="md" />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 300, marginBottom: 16 }}>Komplexný due diligence report zo štátnych registrov SR. Automatizované, rýchle, presné.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>{t("home.footerOperator")}</span>
            {/* TODO: Pred launchom nahradiť reálnym IČO a názvom firmy */}
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Verifa s.r.o.</span>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>IČO: 12345678</span>
            <a href="mailto:info@verifa.sk" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none", marginTop: 4 }}>info@verifa.sk</a>
          </div>
        </div>

        <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }} className="footer-links">
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{t("home.footerProduct")}</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a href="#funkcie" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navFeatures")}</a>
              <a href="#registre" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navRegistries")}</a>
              <a href="#ukazka" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("nav.dokumenty")}</a>
              <a href="#pricing" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navPricing")}</a>
              <Link href="/slovnik" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.footerGlossary")}</Link>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{t("home.footerLegal")}</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a href="/terms" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.terms")}</a>
              <a href="/privacy" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.footerPrivacy")}</a>
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

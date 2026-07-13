"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import Logo from "@/components/Logo";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LandingJsonLd from "@/components/LandingJsonLd";

export default function LandingPage() {
  const { theme, toggle } = useTheme();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const darkMode = theme === "dark";

  const [showRegistries, setShowRegistries] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const reportIncludes = [
    // Row 1: Col1, Col2, Col3, Col4
    { main: "Komplexná lustrácia registrov", sub: "ORSR, RPVS, RÚZ a ďalšie" },
    { main: "Exekúcie a insolvencia", sub: "Poverenia, Register úpadcov" },
    { main: "5-ročná finančná história", sub: "Súvaha, Výkaz ziskov, Cash flow" },
    { main: "Automatizovaný manažérsky posudok", sub: "Slovný posudok stavu firmy" },
    // Row 2: Col1, Col2, Col3, Col4
    { main: "Daňové a odvodové dlhy", sub: "DPH, Fin. správa, poisťovne" },
    { main: "Záložné práva a dražby", sub: "Kontrola zaťaženia majetku" },
    { main: "Predikcia úpadku a zdravia", sub: "Altman Z-Score, Piotroski" },
    { main: "Originálne výpisy v prílohe", sub: "Audit Trail pre právnu istotu" },
    // Row 3: Col1, Col2, Col3, Col4
    { main: "Štátne zákazky a zmluvy", sub: "Lustrácia v CRZ a ÚVO" },
    { main: "Súdne sankcie a zákazy", sub: "Diskvalifikácie štatutárov" },
    { main: "Detekcia podvodov (Red Flags)", sub: "Forenzná analýza a mapa rizík" },
    { main: "Vizualizovaný PDF report", sub: "Prehľadné grafy a diagramy" },
  ];

  const pricingPlans = [
    {
      name: "1× Report",
      subtitle: "Komplexné preverenie firmy",
      credits: "1 report",
      price: "14 €",
      perCredit: "14,00 € / report",
      features: [
        "Pokrytie 20+ verejných a privátnych registrov",
        "Finančná a právna analýza s Verifa Score",
        "Profesionálny PDF report pripravený na zdieľanie",
        "Podpora: E-mail (SLA odozva do 24 hod.)",
      ],
      highlighted: false,
    },
    {
      name: "5× Report",
      subtitle: "5 reportov bez záväzku",
      credits: "5 reportov",
      price: "59 €",
      perCredit: "11,80 € / report",
      features: [
        "Všetko z balíka 1× Report",
        "Množstevná zľava",
        "História reportov a PDF archivácia",
        "Bez mesačného záväzku",
      ],
      highlighted: false,
    },
    {
      name: "20× Report",
      subtitle: "20 reportov so zľavou",
      credits: "20 reportov",
      price: "199 €",
      perCredit: "9,95 € / report",
      features: [
        "Všetko z balíka 1× Report",
        "Množstevná zľava",
        "História reportov a PDF archivácia",
        "Export reportu",
      ],
      highlighted: false,
    },
    {
      name: "Freelance",
      subtitle: "Pre účtovníkov a malé firmy",
      credits: "5 reportov / mesiac",
      price: "49 € / mesiac",
      perCredit: "9,80 € / report",
      features: [
        "Všetko z balíka 1× Report",
        "História reportov a PDF archivácia",
        "Rýchlejšie spracovanie analytickým jadrom",
        "Podpora: Chat (SLA odozva do 4 hod.)",
      ],
      highlighted: false,
    },
    {
      name: "Firma",
      subtitle: "Pre firmy s pravidelným Due Diligence",
      credits: "20 reportov / mesiac",
      price: "159 € / mesiac",
      perCredit: "7,95 € / report",
      features: [
        "Všetko z balíka Freelance",
        "Vhodné pre obchodné a nákupné tímy",
        "Prednostné spracovanie reportov bez čakania",
        "Podpora: Telefón (SLA odozva do 1 hod.)",
      ],
      highlighted: true,
    },
    {
      name: "Korporát",
      subtitle: "Pre profesionálov",
      credits: "40 reportov / mesiac",
      price: "289 € / mesiac",
      perCredit: "7,23 € / report",
      features: [
        "Všetko z balíka Firma",
        "Osobný account manager s okamžitou dostupnosťou",
        "API prístup pre interné systémy (Pripravujeme)",
        "Najnižšia cena za 1 komplexný report",
      ],
      highlighted: false,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <LandingJsonLd />
      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-nav { display: flex !important; }
          .how-steps { flex-direction: column !important; align-items: center !important; gap: 16px !important; }
          .how-step-card { width: 100% !important; max-width: 400px !important; }
          .how-arrow { display: none !important; }
          .footer-cols { flex-direction: column !important; gap: 32px !important; }
          .footer-links { gap: 24px !important; }
          .hero-stats { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 24px 16px !important; }
          .pricing-guarantee { flex-direction: column !important; gap: 16px !important; text-align: center !important; }
          .cta-card { padding: 40px 24px !important; }
          .section-pad { padding-top: 60px !important; padding-bottom: 60px !important; padding-left: 16px !important; padding-right: 16px !important; }
          .hero-pad { padding-top: 110px !important; padding-bottom: 60px !important; }
          .hero-cta { flex-direction: column !important; gap: 12px !important; }
          .hero-cta a { width: 100% !important; text-align: center !important; }
          .report-includes-grid { grid-template-columns: 1fr 1fr !important; gap: 20px 16px !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .registries-grid { grid-template-columns: 1fr !important; }
          .target-grid { grid-template-columns: 1fr !important; }
          .footer-bottom { justify-content: center !important; text-align: center !important; }
        }
        @media (min-width: 769px) {
          .desktop-nav { display: flex !important; }
          .mobile-nav { display: none !important; }
        }
      `}</style>
      {/* NAV */}
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
            <a href="#cennik" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>{t("home.navPricing")}</a>
            <a href="#registre" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>Registre</a>
            <Link href="/documents" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>{t("nav.dokumenty")}</Link>
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
              Registrácia
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
              Prihlásiť sa
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
            <a href="#cennik" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>{t("home.navPricing")}</a>
            <a href="#registre" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>Registre</a>
            <Link href="/documents" onClick={() => setMobileMenuOpen(false)} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 500, padding: "8px 0" }}>{t("nav.dokumenty")}</Link>
            <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
            <Link href="/register" onClick={() => setMobileMenuOpen(false)} style={{ display: "block", textAlign: "center", color: "var(--text-secondary)", textDecoration: "none", fontSize: 15, fontWeight: 600, padding: "10px", borderRadius: 8, border: "1px solid var(--border)" }}>Registrácia</Link>
            <Link href="/login" onClick={() => setMobileMenuOpen(false)} style={{ display: "block", textAlign: "center", background: "var(--accent)", color: "var(--accent-button-text)", textDecoration: "none", fontSize: 15, fontWeight: 600, padding: "10px", borderRadius: 8 }}>Prihlásiť sa</Link>
          </div>
        )}
      </nav>

      {/* HERO */}
      <section style={{ paddingTop: 140, paddingBottom: 80, position: "relative", overflow: "hidden" }} className="hero-pad">
        <div style={{ position: "absolute", top: -200, right: -100, width: 500, height: 500, borderRadius: "50%", background: "var(--accent)", opacity: 0.06, filter: "blur(80px)" }} />
        <div style={{ position: "absolute", top: 100, left: -150, width: 400, height: 400, borderRadius: "50%", background: "var(--accent)", opacity: 0.04, filter: "blur(60px)" }} />

        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center", padding: "0 24px", position: "relative" }}>
          <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: 999, background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)", fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
            ⚡ {t("home.badge")}
          </div>

          <h1 style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.03em", marginBottom: 24 }}>
            {t("home.heroTitle1")}<br /><span style={{ color: "var(--accent)" }}>{t("home.heroTitle2")}</span>
          </h1>

          <p style={{ fontSize: "clamp(16px, 2.5vw, 20px)", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 680, margin: "0 auto 40px" }}>
            {t("home.heroSubtitle")}
          </p>

          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }} className="hero-cta">
            <Link href="/register" style={{ background: "var(--accent)", color: "var(--accent-button-text)", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-lg)" }}>
              {t("home.ctaStart")}
            </Link>
            <a href="#how" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
              {t("home.howItWorks")}
            </a>
          </div>

          <div style={{ marginTop: 48, display: "flex", gap: 32, justifyContent: "center", flexWrap: "wrap" }} className="hero-stats">
            {[
              { num: "20+", label: t("home.statRegisters") },
              { num: "~5 min", label: t("home.statAvgTime") },
              { num: "0-100", label: t("home.statScoreRange") },
              { num: "1 PDF", label: t("home.statReport") },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "var(--accent)" }}>{s.num}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="funkcie" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }} className="section-pad">
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>Čo správa obsahuje</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Konkrétne overenia a výstupy v jednom dokumente.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }} className="features-grid">
          {[
            {
              icon: "🔎",
              title: "Zlúčené dáta z 20+ registrov",
              desc: "ORSR, RPVS, RÚZ, insolvenčné registre, DPH, exekúcie, záložné práva a ďalšie — všetko v jednom PDF.",
            },
            {
              icon: "📊",
              title: "Automatizovaná finančná analýza",
              desc: "5-ročná história, Altman Z-Score, Piotroski F-Score, predikcia úpadku a forenzná detekcia rizík.",
            },
            {
              icon: "📋",
              title: "Predikcia rizika a Verifa Score",
              desc: "Záverečný posudok s Verifa Score (0-100), kategóriou rizika a odporúčaniami pre ďalšie kroky.",
            },
          ].map((col) => (
            <div key={col.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                  {col.icon}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>{col.title}</h3>
              </div>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{col.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding: "80px 24px", background: "var(--bg-subtle)", scrollMarginTop: 80 }} className="section-pad">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.howItWorks")}</h2>
          </div>

          <div style={{ display: "flex", alignItems: "stretch", justifyContent: "center", gap: 0, flexWrap: "wrap" }} className="how-steps">
            {[
              { step: "1", icon: "search", title: "Zadáte IČO", desc: "Zadajte identifikačné číslo firmy, ktorú chcete preveriť." },
              { step: "2", icon: "check", title: "Overenie a posudok", desc: "Systém overí dáta vo všetkých verejných registroch a vypracuje hlavný posudok so subjektívnym Verifa Score." },
              { step: "3", icon: "download", title: "Stiahnete Správu", desc: "Stiahnete si komplexnú Správu vo formáte PDF so všetkými výpismi a posudkom v jednom dokumente." },
            ].map((s, i, arr) => (
              <div key={s.step} style={{ display: "flex", alignItems: "stretch" }}>
                <div className="how-step-card" style={{
                  width: 220,
                  height: "100%",
                  textAlign: "center",
                  padding: "24px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-start",
                }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "var(--accent)" }}>
                    {s.icon === "search" && (
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    )}
                    {s.icon === "check" && (
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                    )}
                    {s.icon === "download" && (
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                    )}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Krok {s.step}</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{s.desc}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="how-arrow" style={{
                    display: "flex",
                    alignItems: "center",
                    flexShrink: 0,
                    width: 40,
                    justifyContent: "center",
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REGISTRIES — Accordion */}
      <section id="registre" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }} className="section-pad">
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>Pokryté registre</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Všetky zdroje v jednom reporte, zoskupené podľa oblasti.</p>
        </div>

        <div style={{ textAlign: "center", marginBottom: showRegistries ? 40 : 0 }}>
          <button
            onClick={() => setShowRegistries((v) => !v)}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "14px 28px",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              transition: "border-color 0.2s",
            }}
          >
            {showRegistries ? "Skryť zoznam registrov" : "Pozrite si zoznam všetkých 20+ prehľadávaných registrov"}
            <span style={{ color: "var(--accent)", fontSize: 18, transition: "transform 0.2s", display: "inline-block", transform: showRegistries ? "rotate(180deg)" : "none" }}>⌄</span>
          </button>
        </div>

        {showRegistries && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "stretch" }} className="registries-grid">
            {[
              {
                icon: "🏢",
                category: "Základné firemné a právne registre",
                items: ["Obchodný register SR (ORSR)", "Živnostenský register (ŽRSR)", "Register právnických osôb (RPO)", "Register partnerov ver. sektora (RPVS)", "Obchodný vestník"],
              },
              {
                icon: "⚠️",
                category: "Insolvencia, exekúcie a dlhy",
                items: ["Register úpadcov", "Poverenia na exekúcie", "Daňoví dlžníci", "Sociálna poisťovňa", "VšZP", "Dôvera", "Union"],
              },
              {
                icon: "💰",
                category: "Finančná správa a DPH",
                items: ["Index daň. spoľahlivosti", "Platitelia DPH", "Zrušenie DPH", "Vymazaní z DPH", "Nadmerný odpočet", "Daň z príjmov PO", "Reg. k dani z príjmov"],
              },
              {
                icon: "⚖️",
                category: "Súdy a sankcie",
                items: ["Register diskvalifikácií"],
              },
              {
                icon: "🏛️",
                category: "Financie a štátne zákazky",
                items: ["Účtovné závierky (RÚZ)", "Register zmlúv (CRZ)", "Verejné obstarávanie (ÚVO)"],
              },
              {
                icon: "🛡️",
                category: "Majetok a práva",
                items: ["Záložné práva", "Register dražieb"],
              },
            ].map((group) => (
              <div key={group.category} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 16 }}>
                  {group.icon}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{group.category}</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.items.map((r) => (
                    <li key={r} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, marginTop: 1 }}>✓</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* PRE KOHO */}
      <section style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto" }} className="section-pad">
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.whoIsItFor")}</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Nástroj pre profesionálov, ktorí potrebujú rýchly a spoľahlivý due diligence.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }} className="target-grid">
          {[
            {
              icon: "🏢",
              title: "Pre firmy a obchodníkov",
              desc: "Previerka obchodných partnerov, dodávateľov a protistrán pred uzavretím zmlúv, fúziou alebo nadobudnutím podielov.",
            },
            {
              icon: "⚖️",
              title: "Pre právnikov a účtovníkov",
              desc: "Komplexný due diligence report pre klientov — finančný a právny prehľad z 20+ registrov v jednom PDF.",
            },
            {
              icon: "💼",
              title: "Pre investorov a finančný sektor",
              desc: "Hĺbková analýza bonity, predikcia úpadku a rizikový profil pred investíciou, úverom alebo poistnou zmluvou.",
            },
          ].map((item) => (
            <div key={item.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, transition: "transform 0.2s ease, box-shadow 0.2s ease" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 16 }}>
                {item.icon}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{item.title}</h3>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* UKÁŽKA REPORTU — CTA */}
      <section style={{ padding: "80px 24px", background: "var(--bg-subtle)" }} className="section-pad">
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>Ukážka reportu</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto 32px" }}>Pozrite si vzor vygenerovaného PDF reportu — titulná stránka, finančná analýza, právny posudok a Verifa Score.</p>
          <Link href="/documents" style={{ display: "inline-block", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "14px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 15 }}>
            {t("nav.dokumenty")} →
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }} className="section-pad">
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.faqTitle")}</h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { q: t("home.faq1q"), a: t("home.faq1a") },
            { q: t("home.faq2q"), a: t("home.faq2a") },
            { q: t("home.faq3q"), a: t("home.faq3a") },
            { q: t("home.faq4q"), a: t("home.faq4a") },
            { q: t("home.faq5q"), a: t("home.faq5a") },
          ].map((item, i) => (
            <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{item.q}</h3>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="cennik" style={{ padding: "80px 24px", background: "var(--bg-subtle)", scrollMarginTop: 80 }} className="section-pad">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.navPricing")}</h2>
          </div>

          {/* Čo obsahuje každý report */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "40px 32px", marginBottom: 48 }}>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 32, textAlign: "center" }}>Čo obsahuje každý report?</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 report-includes-grid" style={{ gap: "28px 20px" }}>
              {reportIncludes.map((item) => (
                <div key={item.main} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, marginTop: 2 }}>✓</span>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.4, marginBottom: 2 }}>{item.main}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{item.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pricing-grid" style={{ alignItems: "stretch" }}>
            {pricingPlans.map((plan) => (
              <div key={plan.name} style={{ background: "var(--surface)", border: plan.highlighted ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 16, padding: 28, position: "relative", boxShadow: plan.highlighted ? "var(--shadow-lg)" : "var(--shadow-sm)" }}>
                {plan.highlighted && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--accent-button-text)", padding: "4px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                    Najobľúbenejšie
                  </div>
                )}
                <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{plan.name}</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{plan.subtitle}</p>
                <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 4 }}>{plan.price}</div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{plan.perCredit}</p>
                <Link href="/register" style={{ display: "block", textAlign: "center", background: plan.highlighted ? "var(--accent)" : "var(--surface-hover)", color: plan.highlighted ? "var(--accent-button-text)" : "var(--text)", border: plan.highlighted ? "none" : "1px solid var(--border)", padding: "10px", borderRadius: 10, textDecoration: "none", fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
                  Začať overovať
                </Link>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {plan.features.map((feat) => (
                    <li key={feat} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0 }}>✓</span>
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 32, marginTop: 40, flexWrap: "wrap", fontSize: 14, color: "var(--text-secondary)" }} className="pricing-guarantee">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--accent)", fontSize: 18 }}>🛡️</span>
              <b>Garancia:</b> Ak report nemožno vygenerovať z dôvodu výpadku registrov, vrátime vám plnú sumu alebo pripíšeme kredit.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--accent)", fontSize: 18 }}>⏱️</span>
              Kredity sú platné <b>12 mesiacov</b> od zakúpenia.
            </div>
          </div>

          <p style={{ textAlign: "center", marginTop: 40, fontSize: 13, color: "var(--text-muted)" }}>
            {t("home.needMore")} <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "80px 24px" }} className="section-pad">
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 24, padding: "60px 40px", position: "relative", overflow: "hidden" }} className="cta-card">
          <div style={{ position: "absolute", top: -100, right: -50, width: 300, height: 300, borderRadius: "50%", background: "var(--accent)", opacity: 0.05, filter: "blur(60px)" }} />
          <h2 style={{ fontSize: "clamp(28px, 4vw, 36px)", fontWeight: 800, marginBottom: 16 }}>Pripravený preveriť svojho partnera?</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", marginBottom: 32 }}>Zaregistrujte sa a začnite s komplexným due diligence reportom.</p>
          <Link href="/register" style={{ display: "inline-block", background: "var(--accent)", color: "var(--accent-button-text)", padding: "16px 40px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-lg)" }}>
            {t("home.ctaStartNow")}
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "40px 24px" }} className="section-pad">
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 32 }} className="footer-cols">
          <div style={{ flex: "1 1 300px" }}>
            <div style={{ marginBottom: 12 }}>
              <Logo size="md" />
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 300, marginBottom: 16 }}>Komplexný due diligence report zo štátnych registrov SR. Automatizované, rýchle, presné.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>Prevádzkovateľ:</span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Verifa s.r.o.</span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>IČO: 12345678</span>
              <a href="mailto:info@verifa.sk" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none", marginTop: 4 }}>info@verifa.sk</a>
            </div>
          </div>

          <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }} className="footer-links">
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Produkt</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <a href="#funkcie" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navFeatures")}</a>
                <a href="#cennik" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navPricing")}</a>
                <a href="#registre" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Registre</a>
                <Link href="/documents" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("nav.dokumenty")}</Link>
              </div>
            </div>
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Právne</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <a href="/terms" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.terms")}</a>
                <a href="/privacy" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Ochrana osobných údajov</a>
              </div>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1200, margin: "32px auto 0", paddingTop: 24, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12 }} className="footer-bottom">
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>© {new Date().getFullYear()} Verifa.sk — {t("home.rights")}</p>
        </div>
      </footer>
    </div>
  );
}

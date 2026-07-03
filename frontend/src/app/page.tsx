"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import Logo from "@/components/Logo";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";

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

  const reportIncludes = [
    "Kontrola viac ako 30 verejných registrov",
    "AI finančná analýza",
    "Altman Z-Score",
    "Hodnotenie rizík",
    "Insolvenčné konania",
    "Exekúcie",
    "Diskvalifikácie",
    "Záložné práva",
    "DPH registre",
    "Majetkové ukazovatele",
    "AI odporúčania",
    "PDF report pripravený na zdieľanie",
  ];

  const pricingPlans = [
    {
      name: "Jednorazový report",
      subtitle: "Komplexné preverenie firmy",
      credits: "1 report",
      price: "19 €",
      perCredit: "Vhodné pre jednorazové overenie obchodného partnera.",
      features: [
        "Viac ako 30 verejných registrov",
        "Finančné zdravie spoločnosti",
        "AI odborný posudok",
        "Rizikové upozornenia",
        "Insolvenčné registre",
        "DPH a právne registre",
        "Záverečné skóre dôveryhodnosti",
        "Profesionálny PDF report",
      ],
      highlighted: false,
    },
    {
      name: "Basic",
      subtitle: "Pre účtovníkov a malé firmy",
      credits: "10 reportov",
      price: "99 €",
      perCredit: "9,90 € / report",
      features: [
        "Všetko z Jednorazového reportu",
        "10 kreditov",
        "História reportov",
        "Prioritné spracovanie",
        "PDF archivácia",
      ],
      highlighted: false,
    },
    {
      name: "Business",
      subtitle: "Pre firmy s pravidelným Due Diligence",
      credits: "30 reportov",
      price: "199 €",
      perCredit: "6,63 € / report",
      features: [
        "Všetko z Basic",
        "30 kreditov",
        "Prioritná podpora",
        "Rýchlejšie spracovanie",
        "Export reportov",
        "Vhodné pre obchodné tímy",
        "Vhodné pre účtovné kancelárie",
      ],
      highlighted: true,
    },
    {
      name: "Pro",
      subtitle: "Pre profesionálov",
      credits: "100 reportov",
      price: "399 €",
      perCredit: "3,99 € / report",
      features: [
        "Všetko z Business",
        "100 kreditov",
        "Prioritná podpora",
        "Osobný account manager",
        "Najnižšia cena za report",
        "Vhodné pre banky, advokátov a väčšie spoločnosti",
      ],
      highlighted: false,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {/* NAV */}
      <nav
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          zIndex: 100,
          background: scrolled ? "var(--surface)" : "transparent",
          borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
          transition: "all 0.3s ease",
          backdropFilter: scrolled ? "blur(12px)" : "none",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <Logo size="md" />
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
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
        </div>
      </nav>

      {/* HERO */}
      <section style={{ paddingTop: 140, paddingBottom: 80, position: "relative", overflow: "hidden" }}>
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

          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login" style={{ background: "var(--accent)", color: "var(--accent-button-text)", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-lg)" }}>
              {t("home.ctaStart")}
            </Link>
            <a href="#funkcie" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
              {t("home.howItWorks")}
            </a>
          </div>

          <div style={{ marginTop: 48, display: "flex", gap: 32, justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { num: "20 +", label: t("home.statRegisters") },
              { num: "~ 3 min", label: t("home.statAvgTime") },
              { num: "100", label: t("home.statScoreRange") },
              { num: "PDF", label: t("home.statReport") },
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
      <section id="funkcie" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>Čo správa obsahuje</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Konkrétne overenia a výstupy v jednom dokumente.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}>
          {[
            {
              icon: "🔎",
              title: "Overenie v registroch",
              items: [
                "Má firma nedoplatky na daniach — daňový dlžník",
                "Platí sociálne a zdravotné poistné (Dôvera, VŠZP, Union)",
                "Vedú sa voči nej exekúcie alebo konkurzné konanie",
                "Eviduje sa v registri partnerov verejného sektora",
                "Je v registri diskvalifikovaných osôb",
                "Záložné práva a dražby nehnuteľností",
                "Záznamy v Obchodnom vestníku (konkurzy, zmeny štatutárov)",
              ],
            },
            {
              icon: "📊",
              title: "Finančná analýza",
              items: [
                "Extrakcia dát z účtovných závierok",
                "Výpočet Altman Z-Score (finančný stres)",
                "Výpočet likvidity, zadlženosti a rentability",
                "Medziročný rast/pokles (CAGR)",
                "Trendy a kľúčové finančné ukazovatele",
              ],
            },
            {
              icon: "📋",
              title: "Posudok a Verifa Score",
              items: [
                "Zhodnotenie silných a slabých stránok firmy",
                "Identifikácia právnych a finančných rizík",
                "Správy audítorov a poznámky pod čiarou vstupujú do posudku",
                "Subjektívne Verifa Score (0-100) podľa vlastných algoritmov",
                "Kategória rizika: AAA / A / B / C",
                "Zhrnutie odporúčaní pre ďalšie kroky",
              ],
            },
          ].map((col) => (
            <div key={col.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                  {col.icon}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>{col.title}</h3>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {col.items.map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, marginTop: 1 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "80px 24px", background: "var(--bg-subtle)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.howItWorks")}</h2>
          </div>

          <div style={{ display: "flex", alignItems: "stretch", justifyContent: "center", gap: 0, flexWrap: "wrap" }}>
            {[
              { step: "1", icon: "search", title: "Zadáte IČO", desc: "Zadajte identifikačné číslo firmy, ktorú chcete preveriť." },
              { step: "2", icon: "check", title: "Overenie a posudok", desc: "Systém overí dáta vo všetkých verejných registroch a vypracuje hlavný posudok so subjektívnym Verifa Score." },
              { step: "3", icon: "download", title: "Stiahnete Správu", desc: "Stiahnete si komplexnú Správu vo formáte PDF so všetkými výpismi a posudkom v jednom dokumente." },
            ].map((s, i, arr) => (
              <div key={s.step} style={{ display: "flex", alignItems: "stretch" }}>
                <div style={{
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
                  <div style={{
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

      {/* REGISTRIES */}
      <section id="registre" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>Pokryté registre</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Všetky zdroje v jednom reporte, zoskupené podľa oblasti.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, alignItems: "stretch" }}>
          {[
            {
              icon: "🏢",
              category: "Obchodné registre",
              items: ["Obchodný register SR", "Živnostenský register", "Obchodný vestník"],
            },
            {
              icon: "⚠️",
              category: "Insolvenčné a sankčné",
              items: ["Register úpadcov", "Register diskvalifikovaných osôb"],
            },
            {
              icon: "💰",
              category: "Finančné a daňové",
              items: ["Register účtovných závierok", "Daňoví dlžníci (Dôvera)", "Daňoví dlžníci (VŠZP)", "Daňoví dlžníci (Union)"],
            },
            {
              icon: "🏛️",
              category: "Verejný sektor",
              items: ["Register partnerov verejného sektora", "Úrad verejných obstarávaní", "Centrálny register žiadostí", "Register politických strán"],
            },
            {
              icon: "🏥",
              category: "Zdravotnícke",
              items: ["Register zdravotníckych zariadení", "Národný register poskytovateľov zdravotnej starostlivosti", "Národný register zdravotníckych pomôcok"],
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
      </section>

      {/* PRE KOHO */}
      <section style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.whoIsItFor")}</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Nástroj pre profesionálov, ktorí potrebujú rýchly a spoľahlivý due diligence.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {[
            {
              icon: "⚖️",
              title: "Právnici a advokáti",
              desc: "Rýchla analýza protistrany pred uzatvorením zmlúv, previerka dodávateľov a klientov.",
            },
            {
              icon: "📊",
              title: "Audítori a účtovníci",
              desc: "Komplexný prehľad o finančnom stave klienta z viacerých zdrojov v jednom reporte.",
            },
            {
              icon: "💼",
              title: "Investori a venture capital",
              desc: "Hĺbková analýza potenciálnych investícií s Verifa Score a rizikovým profilom.",
            },
            {
              icon: "🏠",
              title: "Realitní makléri",
              desc: "Preverenie bonity kupujúcich a predávajúcich pri realitných transakciách.",
            },
            {
              icon: "🏢",
              title: "Obchodné spoločnosti",
              desc: "Due diligence obchodných partnerov pred nadobudnutím podielov, fúziou alebo zlúčením.",
            },
            {
              icon: "🤝",
              title: "Odberatelia a dodávatelia",
              desc: "Overenie bonity protistrany pred uzavretím dlhodobých zmlúv a dodávateľských vzťahov.",
            },
            {
              icon: "🏦",
              title: "Banky a finančné inštitúcie",
              desc: "Rýchle posúdenie úverového rizika klienta z verejných zdrojov pred schválením financovania.",
            },
            {
              icon: "🏛️",
              title: "Verejný sektor",
              desc: "Previerka dodávateľov pri verejných obstarávaniach a kontrola partnerov verejného sektora.",
            },
            {
              icon: "🛡️",
              title: "Poisťovne",
              desc: "Posúdenie rizikovosti klienta pred uzavretím poistnej zmluvy a likvidáciou škôd.",
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

      {/* UKÁŽKY REPORTU */}
      <section style={{ padding: "80px 24px", background: "var(--bg-subtle)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>Ukážky reportov</h2>
            <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>Pozrite si, ako vyzerá výstupný PDF report.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
            {[
              { title: "Cover page", desc: "Titulná stránka so zhrnutím a semaformi." },
              { title: "Finančná analýza", desc: "Grafy a tabuľky z účtovných závierok." },
              { title: "Právny posudok", desc: "Vyhodnotenie rizík a Verifa Score." },
            ].map((item) => (
              <div key={item.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, textAlign: "center" }}>
                <div style={{ width: "100%", aspectRatio: "16/11", background: "var(--bg-muted)", borderRadius: 12, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14 }}>
                  PDF náhľad
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{item.title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }}>
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
      <section id="cennik" style={{ padding: "80px 24px", background: "var(--bg-subtle)", scrollMarginTop: 80 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.navPricing")}</h2>
          </div>

          {/* Čo obsahuje každý report */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 32, marginBottom: 48 }}>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, textAlign: "center" }}>Čo obsahuje každý report?</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {reportIncludes.map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0 }}>✓</span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, alignItems: "stretch" }}>
            {pricingPlans.map((plan) => (
              <div key={plan.name} style={{ background: "var(--surface)", border: plan.highlighted ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 16, padding: 28, position: "relative", boxShadow: plan.highlighted ? "var(--shadow-lg)" : "var(--shadow-sm)" }}>
                {plan.highlighted && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--accent-button-text)", padding: "4px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                    Najobľúbenejšie
                  </div>
                )}
                <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{plan.name}</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{plan.subtitle}</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{plan.credits}</p>
                <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 4 }}>{plan.price}</div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{plan.perCredit}</p>
                <Link href="/login" style={{ display: "block", textAlign: "center", background: plan.highlighted ? "var(--accent)" : "var(--surface-hover)", color: plan.highlighted ? "var(--accent-button-text)" : "var(--text)", border: plan.highlighted ? "none" : "1px solid var(--border)", padding: "10px", borderRadius: 10, textDecoration: "none", fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
                  {t("home.buy")}
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

          <p style={{ textAlign: "center", marginTop: 32, fontSize: 13, color: "var(--text-muted)" }}>
            {t("home.needMore")} <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 24, padding: 60, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -100, right: -50, width: 300, height: 300, borderRadius: "50%", background: "var(--accent)", opacity: 0.05, filter: "blur(60px)" }} />
          <h2 style={{ fontSize: "clamp(28px, 4vw, 36px)", fontWeight: 800, marginBottom: 16 }}>Pripravený preveriť svojho partnera?</h2>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", marginBottom: 32 }}>Zaregistrujte sa a začnite s komplexným due diligence reportom.</p>
          <Link href="/login" style={{ display: "inline-block", background: "var(--accent)", color: "var(--accent-button-text)", padding: "16px 40px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-lg)" }}>
            {t("home.ctaStartNow")}
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "40px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 32 }}>
          <div>
            <div style={{ marginBottom: 12 }}>
              <Logo size="md" />
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 300 }}>Komplexný due diligence report zo štátnych registrov SR. Automatizované, rýchle, presné.</p>
          </div>

          <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }}>
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Produkt</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <a href="#funkcie" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navFeatures")}</a>
                <a href="#cennik" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.navPricing")}</a>
                <a href="#registre" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Registre</a>
                <Link href="/login" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Prihlásiť sa</Link>
                <a href="/terms" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>{t("home.terms")}</a>
              </div>
            </div>
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{t("home.contact")}</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <a href="mailto:info@verifa.sk" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>info@verifa.sk</a>
                <span style={{ fontSize: 14, color: "var(--text-muted)" }}>Slovenská republika</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1200, margin: "32px auto 0", paddingTop: 24, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>© {new Date().getFullYear()} Verifa.sk — {t("home.rights")}</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Dôverný dokument pre vnútornú potrebu. Nenahrádza právne a daňové poradenstvo.</p>
        </div>
      </footer>
    </div>
  );
}

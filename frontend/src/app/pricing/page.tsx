"use client";

import { useState, useCallback } from "react";
import { useT, useLang } from "@/components/LanguageProvider";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const FEATURE_TOOLTIPS: Record<string, { sk: string; en: string; de: string }> = {
  registre: {
    sk: "ORSR, ZRSR, RPO, RPVS a ďalšie štátne registre",
    en: "ORSR, ZRSR, RPO, RPVS and other state registries",
    de: "ORSR, ZRSR, RPO, RPVS und weitere staatliche Register",
  },
  insolventny: {
    sk: "Register úpadcov a Centrálny register exekúcií",
    en: "Insolvency Register and Central Register of Executions",
    de: "Insolvenzregister und zentrales Vollstreckungsregister",
  },
  financna: {
    sk: "Finančná správa a registre DPH",
    en: "Financial Administration and VAT registers",
    de: "Finanzverwaltung und USt-Register",
  },
  diskvalifikacii: {
    sk: "Register diskvalifikovaných osôb",
    en: "Register of disqualified persons",
    de: "Register disqualifizierter Personen",
  },
  zalozne: {
    sk: "Záložné práva a elektronické dražby",
    en: "Liens and electronic auctions",
    de: "Pfandrechte und elektronische Versteigerungen",
  },
  posudok: {
    sk: "Automatický právny posudok s návrhom opatrení",
    en: "Automatic legal assessment with recommended actions",
    de: "Automatische Rechtsbewertung mit empfohlenen Maßnahmen",
  },
  skore: {
    sk: "Záverečné rizikové skóre subjektu",
    en: "Final risk score of the entity",
    de: "Abschließendes Risikoscore der Entität",
  },
  pdf: {
    sk: "Profesionálny PDF export s návodom na použitie",
    en: "Professional PDF export with usage guide",
    de: "Professioneller PDF-Export mit Bedienungsanleitung",
  },
};

const REPORT_INCLUDES = [
  "pricing.inc30Registre",
  "pricing.incAiFinancna",
  "pricing.incAltman",
  "pricing.incRizika",
  "pricing.incInsolvencie",
  "pricing.incExekucie",
  "pricing.incDiskvalifikacie",
  "pricing.incZalozne",
  "pricing.incDph",
  "pricing.incMajetok",
  "pricing.incAiOdporucania",
  "pricing.incPdfShare",
];

const PACKAGES = [
  {
    id: "start",
    nameKey: "pricing.start",
    subtitleKey: "pricing.startSubtitle",
    reports: 1,
    price: "14",
    pricePerReport: "14,00",
    isSubscription: false,
    featureKeys: ["pricing.feat30Registre", "pricing.featAnalyzaFinancnychVykazov", "pricing.featRizikoveUpozornenia", "pricing.featInsolvencne", "pricing.featDphPravne", "pricing.featZaverneSkore", "pricing.featPdfReport", "pricing.featExportReportu"],
    featureTooltipKeys: ["registre", null, null, "insolventny", "financna", "skore", "pdf", null],
    highlight: false,
  },
  {
    id: "freelance",
    nameKey: "pricing.freelance",
    subtitleKey: "pricing.freelanceSubtitle",
    reports: 10,
    price: "49",
    pricePerReport: "4,90",
    isSubscription: true,
    featureKeys: ["pricing.featAllFromStart", "pricing.feat15Kreditov", "pricing.featHistoria", "pricing.featPrioritneSpracovanie", "pricing.featPdfArchivacia", "pricing.featRollOver"],
    featureTooltipKeys: [null, null, null, null, null, null],
    highlight: false,
  },
  {
    id: "firma",
    nameKey: "pricing.firma",
    subtitleKey: "pricing.firmaSubtitle",
    reports: 20,
    price: "99",
    pricePerReport: "4,95",
    isSubscription: true,
    featureKeys: ["pricing.featAllFromFreelance", "pricing.feat40Kreditov", "pricing.featPrioritnaPodpora", "pricing.featRychlejsieSpracovanie", "pricing.featObchodneTimy", "pricing.featUctovneKancelarie", "pricing.featRollOver"],
    featureTooltipKeys: [null, null, null, null, null, null, null],
    highlight: true,
  },
  {
    id: "korporat",
    nameKey: "pricing.korporat",
    subtitleKey: "pricing.korporatSubtitle",
    reports: 50,
    price: "249",
    pricePerReport: "4,98",
    isSubscription: true,
    featureKeys: ["pricing.featAllFromFirma", "pricing.feat100Kreditov", "pricing.featPrioritnaPodpora", "pricing.featOsobnyAccount", "pricing.featNajnejsiaCena", "pricing.featBankyAdvokati", "pricing.featRollOver"],
    featureTooltipKeys: [null, null, null, null, null, null, null],
    highlight: false,
  },
];

export default function PricingPage() {
  const t = useT();
  const { lang } = useLang();
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = useCallback(async (planId: string) => {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        router.push(data.url);
      } else {
        toast.error(t("pricing.checkoutChyba"));
      }
    } catch {
      toast.error(t("pricing.checkoutChyba"));
    } finally {
      setCheckoutLoading(false);
    }
  }, [router, t]);

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
      <div className="text-center mb-10">
        <h1
          className="text-2xl font-bold tracking-tight mb-1"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          {t("pricing.cennik")}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("pricing.vyberteBalik")}
        </p>
      </div>

      {/* Čo obsahuje každý report */}
      <div className="card p-6 mb-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-bold text-center mb-5" style={{ color: "var(--text)" }}>
          {t("pricing.coObsahuje")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {REPORT_INCLUDES.map((key) => (
            <div key={key} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
                <path d="M2 6l3 3 5-5" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t(key)}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {PACKAGES.map((pkg) => {
          const isSelected = selectedPlan === pkg.id;
          return (
            <div
              key={pkg.id}
              className="card p-6 flex flex-col transition-all"
              style={{
                border: isSelected
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
                background: "var(--surface)",
                position: "relative",
              }}
            >
              {pkg.highlight && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    background: "var(--accent)",
                    color: "white",
                  }}
                >
                  {t("pricing.najoblubenejsi")}
                </div>
              )}

              <div className="text-center mb-5">
                <h2
                  className="text-lg font-bold mb-1"
                  style={{ color: "var(--text)" }}
                >
                  {t(pkg.nameKey)}
                </h2>
                <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                  {t(pkg.subtitleKey)}
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span
                    className="text-3xl font-bold"
                    style={{ color: "var(--text)" }}
                  >
                    {pkg.price}
                  </span>
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    €
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {pkg.isSubscription ? t("pricing.mesiacne", { n: pkg.reports, price: pkg.pricePerReport }) : t("pricing.jednorazove")}
                </p>
              </div>

              <ul className="flex-1 flex flex-col gap-2 mb-6">
                {pkg.featureKeys.map((featureKey, i) => {
                  const tooltipKey = pkg.featureTooltipKeys[i];
                  const tooltip = tooltipKey ? FEATURE_TOOLTIPS[tooltipKey] : null;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs"
                      style={{ color: "var(--text-secondary)" }}
                      title={tooltip ? (lang === "en" ? tooltip.en : lang === "de" ? tooltip.de : tooltip.sk) : undefined}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 12 12"
                        fill="none"
                        className="flex-shrink-0 mt-0.5"
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="var(--accent)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {t(featureKey)}
                      {tooltip && (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="flex-shrink-0 mt-0.5 opacity-30 hover:opacity-100 transition-opacity cursor-help"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                        </svg>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => {
                  setSelectedPlan(pkg.id);
                  handleCheckout(pkg.id);
                }}
                disabled={checkoutLoading}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: isSelected ? "var(--accent)" : "transparent",
                  color: isSelected ? "white" : "var(--text)",
                  border: isSelected ? "none" : "1px solid var(--border)",
                  cursor: checkoutLoading ? "not-allowed" : "pointer",
                  opacity: checkoutLoading ? 0.6 : 1,
                }}
              >
                {checkoutLoading ? t("pricing.presmerovanie") : t("pricing.kupit")}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-center mt-8">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("pricing.potrebujeteViac")}{" "}
          <a
            href="mailto:info@verifa.sk"
            className="font-medium"
            style={{ color: "var(--accent)" }}
          >
            info@verifa.sk
          </a>
        </p>
      </div>
    </div>
  );
}

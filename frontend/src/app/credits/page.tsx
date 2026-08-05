"use client";

import { useEffect, useState, useCallback } from "react";
import { useT, useLang } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { PRICING_PLANS } from "@/lib/pricing-plans";
import toast from "react-hot-toast";

interface CreditsData {
  totalReports: number;
  usedThisMonth: number;
  successfulReports: number;
  failedReports: number;
  remaining: number;
  totalCredits: number;
  rolloverCredits?: number;
  planName: string | null;
  daysRemaining: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export default function CreditsPage() {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const router = useRouter();
  const [data, setData] = useState<CreditsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = useCallback(async (planId: string) => {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const d = await res.json();
      if (res.ok && d.url) {
        router.push(d.url);
      } else {
        toast.error(t("pricing.checkoutChyba"));
      }
    } catch {
      toast.error(t("pricing.checkoutChyba"));
    } finally {
      setCheckoutLoading(false);
    }
  }, [router, t]);

  const handlePortal = useCallback(async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const d = await res.json();
      if (res.ok && d.url) {
        window.location.href = d.url;
      } else {
        toast.error(d.error || "Failed to open portal");
      }
    } catch {
      toast.error("Failed to open portal");
    } finally {
      setPortalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/credits/plan")
      .then((r) => {
        if (!r.ok) {
          r.json().then(err => setError(err.error || err.details || `HTTP ${r.status}`));
          return null;
        }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch((err) => {
        console.error("Fetch error:", err);
        setError(err.message || "Network error");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-[700px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
        <div className="text-center mb-8">
          <div className="h-8 w-32 rounded-lg animate-pulse mx-auto mb-3" style={{ background: "var(--bg-muted)" }} />
          <div className="h-4 w-64 rounded animate-pulse mx-auto" style={{ background: "var(--bg-muted)" }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-6 h-32 animate-pulse" style={{ background: "var(--bg-muted)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-[700px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
        <div className="card p-8 text-center">
          <p className="text-sm mb-2" style={{ color: "var(--text-muted)" }}>
            {t("plan.chybaNacitania")}
          </p>
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            {t("plan.skusteObnovit")}
          </p>
          {error && (
            <div className="mt-4 p-3 rounded-lg text-xs" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
              <strong>Chyba:</strong> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  const periodStart = formatDate(data.periodStart, locale);
  const periodEnd = formatDate(data.periodEnd, locale);
  const planLabel = data.planName
    ? data.planName.charAt(0).toUpperCase() + data.planName.slice(1)
    : null;

  return (
    <div className="max-w-[700px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
      {/* Header */}
      <div className="text-center mb-8">
        <h1
          className="text-2xl font-bold tracking-tight mb-1"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          {t("plan.titul")}{planLabel ? ` - ${planLabel}` : ""}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("plan.prehlad")}
        </p>
      </div>

      {/* Progress bar */}
      {data.totalCredits > 0 && (
        <div className="mb-8">
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {t("plan.zostava")}: {data.remaining} / {data.totalCredits}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {Math.round((data.successfulReports / data.totalCredits) * 100)}% {t("plan.vyuzite")}
            </span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--bg-muted)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(data.remaining / data.totalCredits) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {/* Remaining — most prominent */}
        <div className="card p-5 flex flex-col items-center text-center" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
          <div className="flex-1 flex flex-col justify-end mb-3 w-full">
            <div className="flex flex-wrap gap-[2px] justify-center max-w-[120px] mx-auto">
              {Array.from({ length: Math.min(data.remaining, 40) }).map((_, i) => (
                <div key={i} className="w-[6px] h-[6px] rounded-[1px]" style={{ background: "var(--accent)" }} />
              ))}
            </div>
          </div>
          <span className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            {data.remaining}
          </span>
          <span className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("plan.zostava")}
          </span>
          {data.rolloverCredits && data.rolloverCredits > 0 && (
            <span className="text-[10px] mt-0.5" style={{ color: "var(--info)" }}>
              ({data.rolloverCredits} prenesených)
            </span>
          )}
        </div>

        {/* Used (successful) */}
        <div className="card p-5 flex flex-col items-center text-center">
          <div className="flex-1 flex flex-col justify-end mb-3 w-full items-center">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "var(--success-bg)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--success)" }}>
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </div>
          </div>
          <span className="text-3xl font-bold" style={{ color: "var(--success)" }}>
            {data.successfulReports}
          </span>
          <span className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("plan.uspesne")}
          </span>
        </div>

        {/* Failed (refunded) */}
        <div className="card p-5 flex flex-col items-center text-center">
          <div className="flex-1 flex flex-col justify-end mb-3 w-full items-center">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "var(--danger-bg)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--danger)" }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            </div>
          </div>
          <span className="text-3xl font-bold" style={{ color: "var(--danger)" }}>
            {data.failedReports}
          </span>
          <span className="text-xs mt-1 leading-tight" style={{ color: "var(--text-muted)" }}>
            {t("plan.neuspesne")}
          </span>
        </div>

        {/* Total purchased */}
        <div className="card p-5 flex flex-col items-center text-center">
          <div className="flex-1 flex flex-col justify-end mb-3 w-full">
            <div className="flex flex-wrap gap-[2px] justify-center max-w-[120px] mx-auto">
              {Array.from({ length: Math.min(data.totalCredits, 40) }).map((_, i) => (
                <div key={i} className="w-[6px] h-[6px] rounded-[1px]" style={{ background: "var(--info)" }} />
              ))}
            </div>
          </div>
          <span className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {data.totalCredits}
          </span>
          <span className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("plan.celkovyPausal")}
          </span>
        </div>
      </div>

      {/* Days remaining info */}
      {data.daysRemaining !== null && (
        <div className="text-center mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("plan.dniDoObnovenia", { days: data.daysRemaining })}
        </div>
      )}

      {/* Period info — only for subscription users */}
      {data.periodStart && data.periodEnd && (
        <div className="text-center mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("plan.obdobie")}: {periodStart} — {periodEnd}
        </div>
      )}

      {/* Credit expiry info */}
      <div className="card p-6 mb-6">
        <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--text)" }}>
          {t("plan.expiraciaTitul")}
        </h2>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 w-[80px] text-center" style={{ background: "var(--info-bg)", color: "var(--info)" }}>trial</span>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("plan.expiraciaTrial")}</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 w-[80px] text-center" style={{ background: "var(--accent-bg, var(--bg-muted))", color: "var(--accent)" }}>paušál</span>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("plan.expiraciaSubscription")}</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 w-[80px] text-center" style={{ background: "var(--success-bg)", color: "var(--success)" }}>jednoraz.</span>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("plan.expiraciaAddon")}</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 w-[80px] text-center" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}>prenos</span>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("plan.expiraciaRollover")}</p>
          </div>
        </div>
      </div>

      {/* Manage subscription button */}
      {data.planName && data.planName !== "start" && (
        <div className="text-center mb-6">
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--border)",
              cursor: portalLoading ? "not-allowed" : "pointer",
              opacity: portalLoading ? 0.6 : 1,
            }}
          >
            {portalLoading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : null}
            {t("plan.spravovatPredplatne")}
          </button>
        </div>
      )}

      {/* One-time packages */}
      <div className="card p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold text-center mb-5" style={{ color: "var(--text)" }}>
          {t("plan.jednorazoveBaliky")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PRICING_PLANS.filter((p) => !p.isSubscription).map((pkg) => (
            <div
              key={pkg.id}
              className="rounded-xl p-5 flex flex-col items-center text-center"
              style={{
                border: pkg.highlight ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: "var(--bg-subtle, var(--bg))",
              }}
            >
              <h3 className="text-base font-bold mb-1" style={{ color: "var(--text)" }}>{t(pkg.nameKey)}</h3>
              <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>{t(pkg.subtitleKey)}</p>
              <div className="flex items-baseline justify-center gap-1 mb-1">
                <span className="text-2xl font-bold" style={{ color: "var(--text)" }}>{pkg.price}</span>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>€</span>
              </div>
              <p className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
                {pkg.reports === 1
                  ? t("pricing.reportZaReport", { price: pkg.pricePerReport })
                  : t("pricing.reportovZaReport", { n: pkg.reports, price: pkg.pricePerReport })}
              </p>
              <button
                onClick={() => handleCheckout(pkg.id)}
                disabled={checkoutLoading}
                className="w-full py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: pkg.highlight ? "var(--accent)" : "transparent",
                  color: pkg.highlight ? "var(--accent-button-text)" : "var(--text)",
                  border: pkg.highlight ? "none" : "1px solid var(--border)",
                  cursor: checkoutLoading ? "not-allowed" : "pointer",
                  opacity: checkoutLoading ? 0.6 : 1,
                }}
              >
                {checkoutLoading ? t("pricing.presmerovanie") : t("plan.kupitKredity")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useT } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import { useLang } from "@/components/LanguageProvider";
import Link from "next/link";
import toast from "react-hot-toast";

interface PlanData {
  totalReports: number;
  usedThisMonth: number;
  successfulReports: number;
  failedReports: number;
  remaining: number;
  totalCredits: number;
  planName: string | null;
  daysRemaining: number | null;
  recentReports: {
    id: string;
    ico: string | null;
    companyName: string | null;
    status: string;
    createdAt: string;
  }[];
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

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function PlanPage() {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

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
    fetch("/api/plan")
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {/* Total credits (paušál) */}
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

        {/* Successful */}
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

        {/* Failed */}
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
          <span className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("plan.neuspesne")}
          </span>
        </div>

        {/* Remaining */}
        <div className="card p-5 flex flex-col items-center text-center">
          <div className="flex-1 flex flex-col justify-end mb-3 w-full">
            <div className="flex flex-wrap gap-[2px] justify-center max-w-[120px] mx-auto">
              {Array.from({ length: Math.min(data.remaining, 40) }).map((_, i) => (
                <div key={i} className="w-[6px] h-[6px] rounded-[1px]" style={{ background: "var(--success)" }} />
              ))}
            </div>
          </div>
          <span className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            {data.remaining}
          </span>
          <span className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("plan.zostava")}
          </span>
        </div>
      </div>

      {/* Days remaining info */}
      {data.daysRemaining !== null && (
        <div className="text-center mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("plan.dniDoObnovenia", { days: data.daysRemaining })}
        </div>
      )}

      {/* Period info */}
      <div className="text-center mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("plan.obdobie")}: {periodStart} — {periodEnd}
      </div>

      {/* Recent reports */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("plan.posledne")}
          </h2>
          <Link
            href="/history"
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            {t("plan.zobrazitVsetky")}
          </Link>
        </div>

        {data.recentReports.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>
            {t("plan.ziadneReporty")}
          </p>
        ) : (
          <div className="space-y-2">
            {data.recentReports.map((r) => (
              <Link
                key={r.id}
                href={`/reports/${r.id}`}
                className="flex items-center justify-between p-3 rounded-lg transition-all hover:bg-opacity-50"
                style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                    {r.companyName || r.ico || t("plan.neznamySubjekt")}
                  </span>
                  {r.ico && (
                    <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      {r.ico}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {formatDateTime(r.createdAt, locale)}
                  </span>
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: r.status === "COMPLETED" ? "var(--success-bg)" : r.status === "FAILED" ? "var(--danger-bg)" : "var(--warning-bg)",
                      color: r.status === "COMPLETED" ? "var(--success)" : r.status === "FAILED" ? "var(--danger)" : "var(--warning)",
                    }}
                  >
                    {r.status === "COMPLETED" ? t("plan.dokonceny") : r.status === "FAILED" ? t("plan.zlyhany") : r.status === "PARTIAL" ? t("plan.ciastocny") : t("plan.prebieha")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Upgrade CTA + Manage Subscription */}
      <div
        className="rounded-xl p-6 text-center"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        {data.planName && data.planName !== "start" && (
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110 mb-4"
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
        )}

        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("plan.potrebujeteViac")}
        </p>
        <a
          href="mailto:info@verifa.sk"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
          style={{
            background: "var(--accent)",
            color: "var(--accent-button-text)",
          }}
        >
          {t("plan.kontaktujte")}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </a>
      </div>
    </div>
  );
}

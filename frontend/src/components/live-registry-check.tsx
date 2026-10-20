"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  type LiveCheckSummary,
  type LiveCheckItem,
  LOCK_DEBT_DETAILS,
} from "@/lib/liveRegistryCheck";
import { useT, useLang } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import {
  trackLiveCheckClick,
  trackLiveCheckStarted,
  trackLiveCheckLimitHit,
  trackLiveCheckCompleted,
  trackReportCtaClick,
} from "@/lib/analytics";

interface Props {
  ico: string;
  companyName: string;
  initialSummary: LiveCheckSummary;
}

function StatusBadgePill({ state, t }: { state: LiveCheckItem["state"]; t: (key: string) => string }) {
  if (state === "RUNNING") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
        style={{
          background: "var(--info-bg, rgba(59,130,246,0.12))",
          color: "var(--info-text, #2563eb)",
          border: "1px solid rgba(59,130,246,0.3)",
        }}
      >
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        {t("liveCheck.state.running")}
      </span>
    );
  }
  if (state === "CLEAN") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
        style={{
          background: "var(--success-bg, rgba(16,185,129,0.12))",
          color: "var(--success-text, #059669)",
          border: "1px solid rgba(16,185,129,0.35)",
        }}
      >
        {t("liveCheck.state.clean")}
      </span>
    );
  }
  if (state === "DEBT") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
        style={{
          background: "var(--danger-bg, rgba(239,68,68,0.12))",
          color: "var(--danger, #dc2626)",
          border: "1px solid rgba(239,68,68,0.35)",
        }}
      >
        {t("liveCheck.state.debt")}
      </span>
    );
  }
  if (state === "UNAVAILABLE") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap"
        style={{
          background: "var(--warning-bg, rgba(245,158,11,0.12))",
          color: "var(--warning, #d97706)",
          border: "1px solid rgba(245,158,11,0.3)",
        }}
      >
        {t("liveCheck.state.unavailable")}
      </span>
    );
  }
  if (state === "AMBIGUOUS") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
        style={{
          background: "var(--warning-bg, rgba(245,158,11,0.12))",
          color: "var(--warning, #d97706)",
          border: "1px solid rgba(245,158,11,0.35)",
        }}
      >
        {t("liveCheck.state.ambiguous")}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{
        background: "var(--bg-muted)",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
      }}
    >
      {t("liveCheck.state.idle")}
    </span>
  );
}

export function LiveRegistryCheck({ ico, companyName, initialSummary }: Props) {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang] ?? "sk-SK";
  const [summary, setSummary] = useState<LiveCheckSummary>(initialSummary);
  const [modalOpen, setModalOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dailyLimitHit, setDailyLimitHit] = useState<"anon" | "user" | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${ico}/live-check`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: LiveCheckSummary = await res.json();
      setSummary((prev) => {
        // Detect running→finished transition for funnel tracking
        if (prev.isRunning && !data.isRunning && data.hasCheck) {
          trackLiveCheckCompleted(ico, data.cleanCount, data.debtCount, data.totalDebtEur);
        }
        return data;
      });
    } catch {
      // ignore transient network error during poll
    }
  }, [ico]);

  useEffect(() => {
    if (!summary.isRunning) return;
    const interval = setInterval(pollStatus, 1500);
    return () => clearInterval(interval);
  }, [summary.isRunning, pollStatus]);

  const handleStartCheck = async (force = false, source: "cta_button" | "registry_pill" | "recheck_button" = "cta_button") => {
    trackLiveCheckClick(ico, source);
    setErrorMsg(null);
    setDailyLimitHit(null);
    setStarting(true);
    setModalOpen(true);
    try {
      const url = `/api/companies/${ico}/live-check${force ? "?force=1" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (res.status === 429 && data?.code === "DAILY_LIMIT") {
        trackLiveCheckLimitHit(ico, data.registered ? "user" : "anon");
        setDailyLimitHit(data.registered ? "user" : "anon");
        return;
      }
      if (!res.ok) {
        setErrorMsg(data?.error || t("liveCheck.errorStart"));
        setStarting(false);
        return;
      }
      setSummary(data);
      trackLiveCheckStarted(ico);
    } catch {
      setErrorMsg(t("liveCheck.errorNetwork"));
    } finally {
      setStarting(false);
    }
  };

  const completedCount = summary.items.filter(
    (i) => i.state === "CLEAN" || i.state === "DEBT" || i.state === "UNAVAILABLE" || i.state === "AMBIGUOUS"
  ).length;
  const totalCount = summary.items.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const formattedCheckedAt = summary.lastCheckedAt
    ? new Date(summary.lastCheckedAt).toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const eur = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section
      id="live-registry-check"
      className="mb-6 sm:mb-8 rounded-2xl p-4 sm:p-6"
      style={{
        background: "var(--surface)",
        border: summary.debtCount > 0 ? "2px solid var(--danger, #dc2626)" : "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
              style={{
                background: "var(--accent-light)",
                color: "var(--accent)",
                border: "1px solid var(--accent-border)",
              }}
            >
              {t("liveCheck.badge")}
            </span>
            {formattedCheckedAt && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("liveCheck.lastChecked")} <strong>{formattedCheckedAt}</strong>
              </span>
            )}
          </div>
          <h2 className="text-lg sm:text-xl font-bold mt-1.5" style={{ color: "var(--text)" }}>
            {t("liveCheck.heading", { name: companyName })}
          </h2>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("liveCheck.subheading", { ico })}
          </p>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2 flex-shrink-0 no-print">
          {!summary.hasCheck || !summary.isFresh ? (
            <button
              type="button"
              onClick={() => handleStartCheck(false)}
              disabled={starting || summary.isRunning}
              className="px-5 py-3 rounded-xl text-sm font-bold transition-all hover:opacity-90 cursor-pointer whitespace-nowrap"
              style={{
                background: "var(--accent)",
                color: "var(--accent-button-text)",
                boxShadow: "var(--shadow-md)",
                opacity: starting || summary.isRunning ? 0.75 : 1,
              }}
            >
              {summary.isRunning
                ? t("liveCheck.ctaRunning", { done: completedCount, total: totalCount })
                : t("liveCheck.ctaStart")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                trackLiveCheckClick(ico, "detail_button");
                setModalOpen(true);
              }}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              {t("liveCheck.ctaDetail", { done: completedCount, total: totalCount })}
            </button>
          )}
        </div>
      </div>

      {/* Summary Verdict Banner when checked */}
      {summary.hasCheck && !summary.isRunning && (
        <div
          className="rounded-xl p-3.5 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{
            background:
              summary.debtCount > 0
                ? "var(--danger-bg, rgba(239,68,68,0.08))"
                : "var(--success-bg, rgba(16,185,129,0.08))",
            border:
              summary.debtCount > 0
                ? "1px solid var(--danger-border, rgba(239,68,68,0.3))"
                : "1px solid rgba(16,185,129,0.3)",
          }}
        >
          <div className="flex items-start sm:items-center gap-2.5">
            <span className="text-lg leading-none">
              {summary.debtCount > 0 ? "🔴" : "✅"}
            </span>
            <div>
              <div
                className="text-sm font-bold"
                style={{
                  color:
                    summary.debtCount > 0
                      ? "var(--danger, #dc2626)"
                      : "var(--success-text, #059669)",
                }}
              >
                {summary.debtCount > 0
                  ? t("liveCheck.verdictDebt", { n: summary.debtCount, total: totalCount })
                  : t("liveCheck.verdictClean", { n: summary.cleanCount })}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {summary.debtCount > 0 && summary.totalDebtEur > 0 && !LOCK_DEBT_DETAILS
                  ? t("liveCheck.verdictTotal", { sum: eur(summary.totalDebtEur) })
                  : t("liveCheck.verdictNote")}
              </div>
            </div>
          </div>

          <Link
            href={`/objednat?ico=${ico}`}
            onClick={() => trackReportCtaClick(ico, "live_check_banner")}
            className="text-xs font-bold px-3.5 py-2 rounded-lg whitespace-nowrap no-underline no-print"
            style={{
              background: "var(--accent)",
              color: "var(--accent-button-text)",
            }}
          >
            {t("liveCheck.pdfCta")}
          </Link>
        </div>
      )}

      {/* Compact 6-pill grid when not yet checked (saves ~260px above the fold);
          expands to full verification table once checked or while running */}
      {!summary.hasCheck && !summary.isRunning ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {summary.items.map((item) => (
            <button
              key={item.source}
              type="button"
              onClick={() => handleStartCheck(false, "registry_pill")}
              title={t("liveCheck.pillTitle", { label: item.fullLabel })}
              className="flex flex-col justify-between p-2.5 rounded-xl border text-left transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--surface-hover)] cursor-pointer"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
              }}
            >
              <div className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>
                {item.label}
              </div>
              <div className="flex items-center justify-between gap-1 mt-1.5">
                <span className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                  {item.authority}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: "var(--bg-muted)",
                    color: "var(--text-muted)",
                  }}
                >
                  {t("liveCheck.state.idle")}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--bg-muted)" }}>
                <th className="text-left px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {t("liveCheck.colRegistry")}
                </th>
                <th className="text-left px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider hidden sm:table-cell" style={{ color: "var(--text-muted)" }}>
                  {t("liveCheck.colSource")}
                </th>
                <th className="text-left px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {t("liveCheck.colState")}
                </th>
                <th className="text-left px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {t("liveCheck.colFinding")}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map((item) => {
                const isLockedDebt = LOCK_DEBT_DETAILS && item.state === "DEBT";
                return (
                  <tr
                    key={item.source}
                    className="border-t transition-colors"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-3.5 py-3 font-semibold" style={{ color: "var(--text)" }}>
                      {item.label}
                    </td>
                    <td className="px-3.5 py-3 text-xs hidden sm:table-cell" style={{ color: "var(--text-muted)" }}>
                      {item.authority}
                    </td>
                    <td className="px-3.5 py-3">
                      <StatusBadgePill state={item.state} t={t} />
                    </td>
                    <td className="px-3.5 py-3 text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
                      {isLockedDebt ? (
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="select-none blur-[4px]">
                            {t("liveCheck.lockedDebt")}
                          </span>
                          <Link
                            href={`/objednat?ico=${ico}`}
                            className="text-xs font-bold px-2.5 py-1 rounded bg-[var(--danger)] text-white no-underline"
                          >
                            {t("liveCheck.unlock")}
                          </Link>
                        </div>
                      ) : (
                        <div>
                          <span>{item.state === "UNAVAILABLE" ? "—" : item.description}</span>
                          {item.amount != null && item.amount > 0 && (
                            <span
                              className="ml-2 font-bold px-2 py-0.5 rounded text-xs"
                              style={{
                                background: "var(--danger-bg, rgba(239,68,68,0.12))",
                                color: "var(--danger, #dc2626)",
                              }}
                            >
                              {t("liveCheck.debtAmount", { sum: eur(item.amount) })}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Live Progress Modal (like PDF report generation progress) */}
      {modalOpen && !dailyLimitHit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
        >
          <div
            className="w-full max-w-xl rounded-2xl p-6 shadow-2xl"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <span
                  className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
                  style={{
                    background: "var(--accent-light)",
                    color: "var(--accent)",
                  }}
                >
                  {summary.isRunning ? t("liveCheck.modalRunning") : t("liveCheck.modalDone")}
                </span>
                <h3 className="text-lg font-bold mt-1">
                  {companyName} (IČO {ico})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-sm px-2.5 py-1 rounded-lg hover:bg-[var(--surface-hover)] cursor-pointer"
                style={{ color: "var(--text-muted)" }}
                aria-label={t("liveCheck.close")}
              >
                ✕
              </button>
            </div>

            {/* 3-step timeline */}
            <div className="grid grid-cols-3 gap-2 mb-4 text-center text-xs">
              <div
                className="p-2 rounded-lg font-semibold"
                style={{
                  background: "var(--success-bg, rgba(16,185,129,0.12))",
                  color: "var(--success-text, #059669)",
                }}
              >
                {t("liveCheck.step1")}
              </div>
              <div
                className="p-2 rounded-lg font-semibold"
                style={{
                  background: summary.isRunning
                    ? "var(--info-bg, rgba(59,130,246,0.12))"
                    : "var(--success-bg, rgba(16,185,129,0.12))",
                  color: summary.isRunning
                    ? "var(--info-text, #2563eb)"
                    : "var(--success-text, #059669)",
                }}
              >
                {t("liveCheck.step2", { done: completedCount, total: totalCount })}
              </div>
              <div
                className="p-2 rounded-lg font-semibold"
                style={{
                  background: !summary.isRunning && summary.hasCheck
                    ? "var(--success-bg, rgba(16,185,129,0.12))"
                    : "var(--bg-muted)",
                  color: !summary.isRunning && summary.hasCheck
                    ? "var(--success-text, #059669)"
                    : "var(--text-muted)",
                }}
              >
                {t("liveCheck.step3")} {!summary.isRunning && summary.hasCheck ? "✓" : ""}
              </div>
            </div>

            {/* Progress bar */}
            <div
              className="w-full h-2.5 rounded-full overflow-hidden mb-5"
              style={{ background: "var(--bg-muted)" }}
            >
              <div
                className="h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${Math.max(10, progressPct)}%`,
                  background: "var(--accent)",
                }}
              />
            </div>

            {errorMsg && (
              <div
                className="p-3 rounded-lg mb-4 text-xs font-medium"
                style={{
                  background: "var(--danger-bg, #fef2f2)",
                  color: "var(--danger, #dc2626)",
                  border: "1px solid var(--danger-border, #fecaca)",
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* 7 Registry Live Rows */}
            <div className="space-y-2.5 mb-5">
              {summary.items.map((item) => (
                <div
                  key={item.source}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--bg)",
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                      {item.fullLabel}
                    </div>
                    <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      {item.state === "RUNNING"
                        ? t("liveCheck.rowChecking")
                        : item.state === "UNAVAILABLE"
                          ? "—"
                          : item.description}
                    </div>
                  </div>
                  <StatusBadgePill state={item.state} t={t} />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("liveCheck.modalNote")}
              </p>
              <div className="flex items-center gap-2">
                {!summary.isRunning && summary.hasCheck && (
                  <button
                    type="button"
                    onClick={() => handleStartCheck(true, "recheck_button")}
                    className="px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer hover:bg-[var(--surface-hover)]"
                    style={{
                      border: "1px solid var(--border)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {t("liveCheck.recheck")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-button-text)",
                  }}
                >
                  {summary.isRunning ? t("liveCheck.hide") : t("liveCheck.showResults")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daily limit modal — registration upsell */}
      {modalOpen && dailyLimitHit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 shadow-2xl text-center"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            <div className="text-3xl mb-2">🔒</div>
            <h3 className="text-lg font-bold">
              {dailyLimitHit === "anon"
                ? t("liveCheck.limitAnonTitle")
                : t("liveCheck.limitUserTitle")}
            </h3>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              {dailyLimitHit === "anon"
                ? t("liveCheck.limitAnonBody")
                : t("liveCheck.limitUserBody")}
            </p>
            {dailyLimitHit === "anon" && (
              <div className="flex flex-col sm:flex-row gap-2 mt-5 justify-center">
                <a
                  href="/register"
                  className="px-5 py-2.5 rounded-xl text-sm font-bold"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-button-text)",
                  }}
                >
                  {t("liveCheck.register")}
                </a>
                <a
                  href="/login"
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {t("liveCheck.login")}
                </a>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setDailyLimitHit(null);
              }}
              className="mt-4 text-xs cursor-pointer hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              {t("liveCheck.close")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

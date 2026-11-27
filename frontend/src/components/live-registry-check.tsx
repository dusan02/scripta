"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

function StatusBadgePill({
  state,
  t,
  compact = false,
}: {
  state: LiveCheckItem["state"];
  t: (key: string) => string;
  compact?: boolean;
}) {
  const sizeCls = compact
    ? "px-2 py-0.5 text-[11px]"
    : "px-2.5 py-1 text-xs";

  if (state === "RUNNING") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${sizeCls} rounded-full font-semibold whitespace-nowrap`}
        style={{
          background: "var(--info-bg, rgba(59,130,246,0.12))",
          color: "var(--info-text, #2563eb)",
          border: "1px solid rgba(59,130,246,0.3)",
        }}
      >
        <svg className={`animate-spin ${compact ? "w-3 h-3" : "w-3.5 h-3.5"}`} viewBox="0 0 24 24" fill="none">
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
        className={`inline-flex items-center gap-1 ${sizeCls} rounded-full font-bold whitespace-nowrap`}
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
        className={`inline-flex items-center gap-1 ${sizeCls} rounded-full font-bold whitespace-nowrap`}
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
        className={`inline-flex items-center gap-1 ${sizeCls} rounded-full font-medium whitespace-nowrap`}
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
        className={`inline-flex items-center gap-1 ${sizeCls} rounded-full font-bold whitespace-nowrap`}
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
      className={`inline-flex items-center gap-1 ${sizeCls} rounded-full font-medium whitespace-nowrap`}
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
  const [minimizedMonitor, setMinimizedMonitor] = useState(initialSummary.isRunning);
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dailyLimitHit, setDailyLimitHit] = useState<"anon" | "user" | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const startedByUserRef = useRef(false);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setDragOffsetY(0);
    setIsDragging(false);
    touchStartYRef.current = null;
    if (summary.isRunning) {
      setMinimizedMonitor(true);
    }
  }, [summary.isRunning]);

  const pollStatus = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const res = await fetch(`/api/companies/${ico}/live-check`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: LiveCheckSummary = await res.json();
      setSummary((prev) => {
        // Detect running→finished transition for funnel tracking (only when initiated in this session)
        if (startedByUserRef.current && prev.isRunning && !data.isRunning && data.hasCheck) {
          startedByUserRef.current = false;
          trackLiveCheckCompleted(ico, data.cleanCount, data.debtCount, data.totalDebtEur);
        }
        return data;
      });
    } catch {
      // ignore transient network error during poll
    }
  }, [ico]);

  // Refresh stale ISR snapshot once on mount so visitors see recent checks immediately
  useEffect(() => {
    if (initialSummary.isFresh && !initialSummary.isRunning) return;
    let cancelled = false;
    fetch(`/api/companies/${ico}/live-check`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LiveCheckSummary | null) => {
        if (!cancelled && data) {
          setSummary(data);
          if (!data.isRunning && initialSummary.isRunning) {
            setMinimizedMonitor(false);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ico, initialSummary.isFresh, initialSummary.isRunning]);

  useEffect(() => {
    if (!summary.isRunning) return;
    const interval = setInterval(pollStatus, 1500);
    return () => clearInterval(interval);
  }, [summary.isRunning, pollStatus]);

  useEffect(() => {
    if (!modalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
        setDailyLimitHit(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modalOpen, closeModal]);

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const deltaY = e.touches[0].clientY - touchStartYRef.current;
    setDragOffsetY(Math.max(0, deltaY));
  };

  const handleSheetTouchEnd = () => {
    if (dragOffsetY > 75) {
      closeModal();
      setDailyLimitHit(null);
    } else {
      setDragOffsetY(0);
      setIsDragging(false);
      touchStartYRef.current = null;
    }
  };

  const handleStartCheck = async (force = false, source: "cta_button" | "registry_pill" | "recheck_button" = "cta_button") => {
    trackLiveCheckClick(ico, source);
    setErrorMsg(null);
    setDailyLimitHit(null);
    setDragOffsetY(0);
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
      startedByUserRef.current = true;
      setMinimizedMonitor(true);
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
  const hasUnavailableItem = summary.items.some((i) => i.state === "UNAVAILABLE");
  const totalCount = summary.items.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const formattedCheckedAt = summary.lastCheckedAt
    ? new Date(summary.lastCheckedAt).toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Bratislava",
      })
    : null;

  const eur = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section
      id="live-registry-check"
      className="mb-6 sm:mb-8 rounded-2xl p-4 sm:p-6 scroll-mt-20"
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
        <div className="flex items-center gap-2 w-full sm:w-auto flex-shrink-0 no-print">
          {!summary.hasCheck || !summary.isFresh ? (
            <button
              type="button"
              onClick={() => handleStartCheck(false)}
              disabled={starting || summary.isRunning}
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-5 py-3 rounded-xl text-sm font-bold transition-all hover:opacity-90 cursor-pointer text-center"
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
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center px-4 py-2.5 sm:py-2 rounded-xl sm:rounded-lg text-xs font-semibold transition-colors hover:bg-[var(--surface-hover)] cursor-pointer text-center"
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
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center text-xs font-bold px-3.5 py-2.5 sm:py-2 rounded-xl sm:rounded-lg whitespace-nowrap no-underline no-print text-center"
            style={{
              background: "var(--accent)",
              color: "var(--accent-button-text)",
            }}
          >
            {t("liveCheck.pdfCta")}
          </Link>
        </div>
      )}

      {/* Compact 7-pill grid when not yet checked (saves ~260px above the fold);
          expands to mobile cards / desktop verification table once checked or while running */}
      {!summary.hasCheck && !summary.isRunning ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {summary.items.map((item) => (
            <button
              key={item.source}
              type="button"
              onClick={() => handleStartCheck(false, "registry_pill")}
              title={t("liveCheck.pillTitle", { label: item.fullLabel })}
              className="last:col-span-2 sm:last:col-span-1 flex flex-col justify-between p-2.5 rounded-xl border text-left transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--surface-hover)] cursor-pointer"
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
        <>
          {/* Mobile card list (zero horizontal scroll) */}
          <div className="sm:hidden space-y-2">
            {summary.items.map((item) => {
              const isLockedDebt = LOCK_DEBT_DETAILS && item.state === "DEBT";
              return (
                <div
                  key={item.source}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor:
                      item.state === "DEBT"
                        ? "var(--danger-border, rgba(239,68,68,0.35))"
                        : "var(--border)",
                    background: "var(--bg)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
                        {item.label}
                      </div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {item.authority}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusBadgePill state={item.state} t={t} compact />
                    </div>
                  </div>

                  <div className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {isLockedDebt ? (
                      <div className="flex flex-col gap-2">
                        <span className="select-none blur-[4px]">
                          {t("liveCheck.lockedDebt")}
                        </span>
                        <Link
                          href={`/objednat?ico=${ico}`}
                          className="w-full inline-flex items-center justify-center min-h-[40px] text-xs font-bold px-3 py-2 rounded-lg bg-[var(--danger)] text-white no-underline text-center"
                        >
                          {t("liveCheck.unlock")}
                        </Link>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{item.state === "UNAVAILABLE" ? "—" : item.description}</span>
                        {item.amount != null && item.amount > 0 && (
                          <span
                            className="font-bold px-2 py-0.5 rounded text-xs"
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
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop 4-column table */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--bg-muted)" }}>
                  <th className="text-left px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    {t("liveCheck.colRegistry")}
                  </th>
                  <th className="text-left px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
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
                      <td className="px-3.5 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                        {item.authority}
                      </td>
                      <td className="px-3.5 py-3">
                        <StatusBadgePill state={item.state} t={t} />
                      </td>
                      <td className="px-3.5 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
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
        </>
      )}

      {/* Floating background progress / completion pill when modal is minimized */}
      {!modalOpen && !dailyLimitHit && minimizedMonitor && (summary.isRunning || summary.hasCheck) && (
        <div
          className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:right-6 z-40 sm:max-w-sm rounded-2xl shadow-2xl overflow-hidden sheet-enter no-print"
          style={{
            background: "var(--surface)",
            border:
              !summary.isRunning && summary.debtCount > 0
                ? "1.5px solid var(--danger, #dc2626)"
                : "1.5px solid var(--accent-border, var(--border))",
            color: "var(--text)",
            marginBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => {
                if (summary.isRunning) {
                  setModalOpen(true);
                } else {
                  setMinimizedMonitor(false);
                  document
                    .getElementById("live-registry-check")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
            >
              {summary.isRunning ? (
                <svg
                  className="animate-spin w-4 h-4 shrink-0"
                  style={{ color: "var(--accent)" }}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="text-base leading-none shrink-0">
                  {summary.debtCount > 0 ? "⚠️" : "✅"}
                </span>
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">
                  {summary.isRunning
                    ? t("liveCheck.ctaRunning", { done: completedCount, total: totalCount })
                    : t("liveCheck.modalDone")}
                </div>
                {!summary.isRunning && (
                  <div
                    className="text-[11px] font-semibold truncate"
                    style={{
                      color:
                        summary.debtCount > 0
                          ? "var(--danger, #dc2626)"
                          : "var(--accent)",
                    }}
                  >
                    {t("liveCheck.showResults")}
                  </div>
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMinimizedMonitor(false)}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-xs hover:bg-[var(--surface-hover)] cursor-pointer"
              style={{ color: "var(--text-muted)" }}
              aria-label={t("liveCheck.close")}
            >
              ✕
            </button>
          </div>
          {summary.isRunning && (
            <div className="w-full h-1" style={{ background: "var(--bg-muted)" }}>
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.max(12, progressPct)}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Live Progress Modal (like PDF report generation progress) */}
      {modalOpen && !dailyLimitHit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="live-check-modal-title"
          onClick={closeModal}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-xl max-h-[92dvh] sm:max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden sheet-enter"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
              transition: isDragging ? "none" : "transform 0.2s ease-out",
            }}
          >
            {/* Swipeable top region (handle + header) */}
            <div
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              className="shrink-0 touch-pan-x"
            >
              {/* Mobile sheet handle */}
              <div className="sm:hidden flex justify-center pt-2.5 pb-0.5">
                <div
                  className="w-10 h-1 rounded-full"
                  style={{ background: "var(--border-strong, var(--border))" }}
                />
              </div>

              {/* Sticky header + steps + progress */}
              <div className="px-4 pt-2.5 pb-2.5 sm:px-6 sm:pt-6 sm:pb-4">
                <div className="flex items-start justify-between gap-2.5 mb-2.5 sm:mb-4">
                  <div className="min-w-0 flex-1">
                    <span
                      className="inline-block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full leading-snug"
                      style={{
                        background: "var(--accent-light)",
                        color: "var(--accent)",
                      }}
                    >
                      {summary.isRunning ? t("liveCheck.modalRunning") : t("liveCheck.modalDone")}
                    </span>
                    <h3
                      id="live-check-modal-title"
                      className="text-[15px] sm:text-lg font-bold mt-1 sm:mt-1.5 leading-snug break-words"
                    >
                      {companyName} (IČO {ico})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="shrink-0 w-10 h-10 -mr-2 -mt-1 flex items-center justify-center rounded-lg text-base hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    aria-label={t("liveCheck.close")}
                  >
                    ✕
                  </button>
                </div>

                {/* Mobile compact 1-line status above progress bar */}
                <div className="sm:hidden flex items-center justify-between gap-2 mb-2 text-xs">
                  <span
                    className="font-semibold truncate"
                    style={{
                      color: summary.isRunning
                        ? "var(--info-text, #2563eb)"
                        : "var(--success-text, #059669)",
                    }}
                  >
                    {summary.isRunning
                      ? t("liveCheck.step2", { done: completedCount, total: totalCount })
                      : `${t("liveCheck.step3")} ✓`}
                  </span>
                  <span
                    className="font-bold tabular-nums px-2 py-0.5 rounded-md text-[11px] shrink-0"
                    style={{
                      background: "var(--bg-muted)",
                      color: "var(--text)",
                    }}
                  >
                    {completedCount}/{totalCount}
                  </span>
                </div>

                {/* Desktop 3-step timeline */}
                <div className="hidden sm:grid grid-cols-3 gap-2 mb-4 text-center text-xs leading-tight">
                  <div
                    className="flex items-center justify-center p-2 rounded-lg font-semibold"
                    style={{
                      background: "var(--success-bg, rgba(16,185,129,0.12))",
                      color: "var(--success-text, #059669)",
                    }}
                  >
                    {t("liveCheck.step1")}
                  </div>
                  <div
                    className="flex items-center justify-center p-2 rounded-lg font-semibold"
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
                    className="flex items-center justify-center p-2 rounded-lg font-semibold"
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
                  className="w-full h-2 sm:h-2.5 rounded-full overflow-hidden"
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
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-4 pb-3 sm:px-6 sm:pb-5">
              {errorMsg && (
                <div
                  className="p-3 rounded-lg mb-3 sm:mb-4 text-xs font-medium"
                  style={{
                    background: "var(--danger-bg, #fef2f2)",
                    color: "var(--danger, #dc2626)",
                    border: "1px solid var(--danger-border, #fecaca)",
                  }}
                >
                  {errorMsg}
                </div>
              )}

              {/* 7 Registry Live Rows — compact 2-line layout on mobile so 6–7 fit without scrolling */}
              <div className="space-y-1.5 sm:space-y-2.5">
                {summary.items.map((item) => (
                  <div
                    key={item.source}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 px-3 py-2 sm:p-3 rounded-xl border"
                    style={{
                      borderColor:
                        item.state === "DEBT"
                          ? "var(--danger-border, rgba(239,68,68,0.35))"
                          : "var(--border)",
                      background: "var(--bg)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className="text-[13px] sm:text-sm font-semibold leading-snug truncate"
                          style={{ color: "var(--text)" }}
                        >
                          <span className="sm:hidden">{item.label}</span>
                          <span className="hidden sm:inline">{item.fullLabel}</span>
                        </div>
                        <div className="sm:hidden shrink-0">
                          <StatusBadgePill state={item.state} t={t} compact />
                        </div>
                      </div>
                      <div
                        className="text-[11px] sm:text-xs leading-snug mt-0.5 line-clamp-2 sm:line-clamp-none sm:truncate"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {item.state === "RUNNING"
                          ? t("liveCheck.rowChecking")
                          : item.state === "UNAVAILABLE"
                            ? "—"
                            : item.description}
                      </div>
                    </div>
                    <div className="hidden sm:block shrink-0">
                      <StatusBadgePill state={item.state} t={t} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sticky footer */}
            <div
              className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-4 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 border-t"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
              }}
            >
              <p
                className="text-[11px] sm:text-xs leading-snug sm:leading-relaxed text-center sm:text-left"
                style={{ color: "var(--text-muted)" }}
              >
                {t("liveCheck.modalNote")}
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                {!summary.isRunning && summary.hasCheck && (hasUnavailableItem || !summary.isFresh) && (
                  <button
                    type="button"
                    onClick={() => handleStartCheck(true, "recheck_button")}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer hover:bg-[var(--surface-hover)] text-center"
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
                  onClick={closeModal}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-2 rounded-xl text-sm sm:text-xs font-bold whitespace-nowrap cursor-pointer text-center"
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
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setModalOpen(false);
            setDailyLimitHit(null);
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6 shadow-2xl text-center sheet-enter"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
              transition: isDragging ? "none" : "transform 0.2s ease-out",
            }}
          >
            <div className="sm:hidden flex justify-center -mt-2 mb-3">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: "var(--border-strong, var(--border))" }}
              />
            </div>
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
                  className="min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-bold"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-button-text)",
                  }}
                >
                  {t("liveCheck.register")}
                </a>
                <a
                  href="/login"
                  className="min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-semibold"
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
              className="mt-4 min-h-[40px] px-4 py-2 text-xs cursor-pointer hover:underline"
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

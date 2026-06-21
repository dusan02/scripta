"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import SourceTable from "@/components/SourceTable";

interface ReportSource {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
  pageCount?: number | null;
  findings?: string | null;
  costCredits: number;
}

interface Report {
  id: string;
  status: string;
  targetType: string;
  ico?: string | null;
  name?: string | null;
  surname?: string | null;
  birthDate?: string | null;
  totalCost: number;
  createdAt: string;
  completedAt?: string | null;
  resultUrl?: string | null;
  sources: ReportSource[];
}

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "PARTIAL"];
const POLL_INTERVAL_MS = 3000;

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function ProgressTimeline({ status }: { status: string }) {
  const steps = [
    { key: "PENDING", label: "Prijatý" },
    { key: "PROCESSING", label: "Sťahujem" },
    { key: "COMPLETED", label: "Hotovo" },
  ];
  const statusOrder: Record<string, number> = {
    PENDING: 0,
    PROCESSING: 1,
    COMPLETED: 2,
    PARTIAL: 2,
    FAILED: 2,
  };
  const current = statusOrder[status] ?? 0;

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done = current > i || (status === "COMPLETED" && i === steps.length - 1);
        const active = current === i && status !== "COMPLETED";
        const isFailed = status === "FAILED" && i === 2;
        const isPartial = status === "PARTIAL" && i === 2;

        return (
          <div key={step.key} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  isFailed
                    ? "bg-red-500/20 text-red-400 border border-red-500/40"
                    : isPartial
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    : done
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : active
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/40 animate-pulse"
                    : "bg-slate-800 text-slate-600 border border-slate-700"
                }`}
              >
                {done && !isFailed ? "✓" : active && !isFailed ? (
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                    <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" />
                  </svg>
                ) : isFailed ? "✗" : isPartial ? "~" : i + 1}
              </div>
              <span
                className={`text-[10px] mt-1 font-medium ${
                  isFailed ? "text-red-400" : isPartial ? "text-amber-400" : done || active ? "text-slate-300" : "text-slate-600"
                }`}
              >
                {isFailed ? "Zlyhalo" : isPartial ? "Čiastočné" : step.label}
              </span>
            </div>

            {/* Connector */}
            {i < steps.length - 1 && (
              <div
                className={`h-0.5 w-16 sm:w-24 mb-4 mx-1 transition-all duration-700 ${
                  current > i ? "bg-emerald-500/40" : "bg-slate-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex gap-4 p-4">
      <div className="skeleton w-12 h-12 rounded-lg" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 w-1/3 rounded" />
        <div className="skeleton h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [lastPollAt, setLastPollAt] = useState<Date | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${params.id}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) setError("Report nebol nájdený.");
        else if (res.status === 403) setError("Nemáte prístup k tomuto reportu.");
        else setError("Chyba pri načítaní reportu.");
        return;
      }
      const data = await res.json();
      setReport(data);
      setLastPollAt(new Date());
    } catch {
      setError("Sieťová chyba.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Polling — stop when terminal status
  useEffect(() => {
    if (!report) return;
    if (TERMINAL_STATUSES.includes(report.status)) return;

    const timer = setInterval(fetchReport, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [report, fetchReport]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/reports/${params.id}/download`);
      if (!res.ok) {
        alert("PDF nie je dostupné.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidence-binder-${params.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container max-w-4xl">
        <div className="glass-card animate-pulse">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container max-w-4xl">
        <div className="glass-card p-8 text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <div className="text-red-400 font-medium">{error}</div>
          <Link href="/" className="btn-secondary mt-4 inline-flex">← Späť na Dashboard</Link>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const identifier =
    report.targetType === "COMPANY"
      ? `IČO ${report.ico}`
      : `${report.name} ${report.surname}`;

  const isFinished = TERMINAL_STATUSES.includes(report.status);
  const canDownload = report.status === "COMPLETED" || report.status === "PARTIAL";

  return (
    <div className="page-container max-w-4xl animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/" className="text-slate-500 hover:text-slate-300 transition-colors">Dashboard</Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400">Report</span>
        <span className="text-slate-700">/</span>
        <span className="text-slate-500 font-mono text-xs">{params.id.slice(0, 8)}…</span>
      </div>

      {/* Header card */}
      <div className="glass-card p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-2xl">{report.targetType === "COMPANY" ? "🏢" : "👤"}</span>
              <h1 className="text-xl font-bold text-white">{identifier}</h1>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
              <span>Vytvorené: {formatDate(report.createdAt)}</span>
              {report.completedAt && <span>Dokončené: {formatDate(report.completedAt)}</span>}
              <span>Cena: <span className={report.totalCost === 0 ? "text-emerald-400" : "text-amber-400"}>{report.totalCost === 0 ? "Zadarmo" : `${report.totalCost} kreditov`}</span></span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <StatusBadge status={report.status} />
            {canDownload && (
              <button
                id="download-pdf-btn"
                onClick={handleDownload}
                disabled={downloading}
                className="btn-primary"
              >
                {downloading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    Sťahujem…
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    Stiahnuť Evidence Binder
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-6 pt-6 border-t flex justify-center" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <ProgressTimeline status={report.status} />
        </div>

        {/* Polling indicator */}
        {!isFinished && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Automaticky sa obnovuje každé 3 sekundy…
            {lastPollAt && <span>Posledná kontrola: {lastPollAt.toLocaleTimeString("sk-SK")}</span>}
          </div>
        )}
      </div>

      {/* Sources table */}
      <div className="glass-card p-6 animate-slide-up">
        <h2 className="section-title mb-4">Prehľad zdrojov</h2>
        {report.sources.length === 0 ? (
          <div className="text-center py-8 text-slate-600">Zdroje sa pripravujú…</div>
        ) : (
          <SourceTable sources={report.sources} />
        )}
      </div>

      {/* Raw info for debug (dev only) */}
      <details className="mt-4">
        <summary className="text-xs text-slate-700 cursor-pointer hover:text-slate-500 transition-colors">
          Technické informácie (Report ID)
        </summary>
        <div
          className="mt-2 p-3 rounded-lg font-mono text-xs text-slate-600"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          {params.id}
        </div>
      </details>
    </div>
  );
}

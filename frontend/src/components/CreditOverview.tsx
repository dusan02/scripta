"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";

interface CreditOverviewData {
  totalAvailable: number;
  rolloverCredits: number;
  expiringSoon: number;
}

export default function CreditOverview() {
  const t = useT();
  const [data, setData] = useState<CreditOverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/credits/batches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        className="rounded-xl p-4 mb-6 animate-pulse"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="h-4 w-48 rounded" style={{ background: "var(--bg-muted)" }} />
      </div>
    );
  }

  if (!data || data.totalAvailable === 0) return null;

  return (
    <div
      className="rounded-xl p-4 mb-6"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("creditOverview.nadpis")}
        </h3>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Total available */}
        <div
          className="rounded-lg p-3"
          style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
        >
          <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
            {t("creditOverview.celkom")}
          </div>
          <div className="text-lg font-bold" style={{ color: "var(--text)" }}>
            {data.totalAvailable}
          </div>
        </div>

        {/* Rollover credits */}
        <div
          className="rounded-lg p-3"
          style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
        >
          <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
            {t("creditOverview.prenesene")}
          </div>
          <div className="text-lg font-bold" style={{ color: "var(--text-secondary)" }}>
            {data.rolloverCredits}
          </div>
        </div>

        {/* Expiring soon */}
        <div
          className="rounded-lg p-3"
          style={{
            background: "var(--bg-muted)",
            border: data.expiringSoon > 0 ? "1px solid var(--warning)" : "1px solid var(--border)",
          }}
        >
          <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
            {t("creditOverview.expirujuce")}
          </div>
          <div
            className="text-lg font-bold"
            style={{ color: data.expiringSoon > 0 ? "var(--warning)" : "var(--text-secondary)" }}
          >
            {data.expiringSoon}
          </div>
        </div>
      </div>

      {data.expiringSoon > 0 && (
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          {t("creditOverview.expirujuceHint")}
        </p>
      )}
    </div>
  );
}

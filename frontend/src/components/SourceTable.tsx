"use client";

import { SOURCE_MAP, SOURCE_CATEGORIES } from "@/lib/sources";

interface Source {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
  pageCount?: number | null;
  findings?: string | null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "PENDING" || status === "PROCESSING") {
    return (
      <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "#3b82f6" }}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "SUCCESS") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--success)" }}>
        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "FAILED") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--danger)" }}>
        <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "UNAVAILABLE") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: "var(--warning)" }}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
        <path d="M12 8v4M12 15.5v.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--border-strong)" }} />
  );
}

export default function SourceTable({ sources }: { sources: Source[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {SOURCE_CATEGORIES.map((cat) => {
        const catSources = sources.filter(s => {
          const meta = SOURCE_MAP[s.sourceType];
          return meta && meta.category === cat.id;
        });
        if (catSources.length === 0) return null;

        const allSuccess = catSources.length > 0 && catSources.every(s => s.status === "SUCCESS");
        const allFailed = catSources.length > 0 && catSources.every(s => s.status === "FAILED");
        const allUnavailable = catSources.length > 0 && catSources.every(s => s.status === "UNAVAILABLE");

        const catBorder = allSuccess ? "var(--success)" : allFailed ? "var(--danger)" : allUnavailable ? "var(--warning)" : "var(--border-strong)";
        const catHeaderBg = allSuccess ? "var(--success-bg)" : allFailed ? "var(--danger-bg)" : allUnavailable ? "var(--warning-bg)" : "var(--bg-muted)";
        const catHeaderColor = allSuccess ? "var(--success-text)" : allFailed ? "var(--danger-text)" : allUnavailable ? "var(--warning-text)" : "var(--text-secondary)";

        return (
          <div
            key={cat.id}
            className="rounded-xl overflow-hidden transition-all duration-300"
            style={{
              border: `1.5px solid ${catBorder}`,
              background: "var(--surface)",
            }}
          >
            <div
              className="px-3 py-2 transition-all duration-300 flex items-center"
              style={{
                background: catHeaderBg,
                borderBottom: `1px solid ${catBorder}`,
                minHeight: "44px",
              }}
            >
              <span
                className="text-[11px] font-semibold transition-colors duration-300"
                style={{ color: catHeaderColor }}
              >
                {cat.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
              {catSources.map(s => {
                const meta = SOURCE_MAP[s.sourceType] ?? { name: s.sourceType, short: s.sourceType };
                const isSuccess = s.status === "SUCCESS";
                const isFailed = s.status === "FAILED";
                const isUnavailable = s.status === "UNAVAILABLE";
                return (
                  <div
                    key={s.sourceType}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-300"
                    style={{
                      background: isSuccess ? "var(--success-bg)" : isFailed ? "var(--danger-bg)" : isUnavailable ? "var(--warning-bg)" : "var(--bg-muted)",
                      border: `1px solid ${isSuccess ? "var(--success)" : isFailed ? "var(--danger)" : isUnavailable ? "var(--warning)" : "var(--border)"}`,
                      color: isSuccess ? "var(--success-text)" : isFailed ? "var(--danger-text)" : isUnavailable ? "var(--warning-text)" : "var(--text-secondary)",
                    }}
                    title={SOURCE_MAP[s.sourceType]?.description ?? s.statusMessage ?? undefined}
                  >
                    {meta.short}
                    <StatusIcon status={s.status} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

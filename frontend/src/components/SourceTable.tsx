"use client";

import { useState } from "react";
import { SOURCE_MAP, SOURCE_CATEGORIES } from "@/lib/sources";

interface Source {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
  pageCount?: number | null;
  findings?: string | null;
  costCredits: number | string;
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    SUCCESS:     "#10b981",
    UNAVAILABLE: "#f59e0b",
    FAILED:      "#ef4444",
    PENDING:     "#3b82f6",
    PROCESSING:  "#3b82f6",
  };
  const color = colorMap[status] ?? "var(--border-strong)";
  const isAnimated = status === "PENDING" || status === "PROCESSING";

  if (isAnimated) {
    return (
      <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color }}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  if (status === "SUCCESS") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color }}>
        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (status === "FAILED") {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color }}>
        <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: color }}
    />
  );
}

export default function SourceTable({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {SOURCE_CATEGORIES.map((cat) => {
        const catSources = sources.filter(s => {
          const meta = SOURCE_MAP[s.sourceType];
          return meta && meta.category === cat.id;
        });
        if (catSources.length === 0) return null;

        return (
          <div
            key={cat.id}
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            {/* Category header */}
            <div
              className="px-4 py-2"
              style={{ background: "var(--bg-muted)" }}
            >
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                {cat.label}
              </span>
            </div>

            {/* Table header — desktop only */}
            <div
              className="hidden sm:grid px-4 py-2"
              style={{
                gridTemplateColumns: "28px 1fr 60px 80px 70px",
                background: "var(--bg-subtle)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {["", "Register", "Strany", "Nálezy", "Cena"].map((h) => (
                <span
                  key={h}
                  className="text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {catSources.map((source) => {
                const meta = SOURCE_MAP[source.sourceType] ?? {
                  name: source.sourceType,
                  description: source.sourceType,
                  cost: 0,
                };
                const hasFindings = !!source.findings?.trim();
                const isExpanded = expanded === source.sourceType;

                return (
                  <div key={source.sourceType}>
                    {/* Desktop row */}
                    <div
                      className="hidden sm:grid items-center px-4 py-3 transition-colors duration-100"
                      style={{
                        gridTemplateColumns: "28px 1fr 60px 80px 70px",
                        background: isExpanded ? "var(--bg-subtle)" : "var(--surface)",
                        cursor: hasFindings ? "pointer" : "default",
                      }}
                      onClick={() =>
                        hasFindings && setExpanded(isExpanded ? null : source.sourceType)
                      }
                      onMouseEnter={(e) => {
                        if (!isExpanded)
                          (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded)
                          (e.currentTarget as HTMLElement).style.background = "var(--surface)";
                      }}
                    >
                      {/* Status dot */}
                      <div className="flex items-center">
                        <StatusDot status={source.status} />
                      </div>

                      {/* Name */}
                      <div className="min-w-0">
                        <span
                          className="text-xs font-medium"
                          style={{ color: "var(--text)" }}
                        >
                          {meta.name}
                        </span>
                        <span
                          className="hidden lg:inline text-xs ml-2"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {meta.description}
                        </span>
                        {source.status === "UNAVAILABLE" && (
                          <p className="text-[10px] mt-0.5" style={{ color: "#f59e0b" }}>
                            Nedostupné
                          </p>
                        )}
                        {source.status === "FAILED" && source.statusMessage && (
                          <p
                            className="text-[10px] mt-0.5 truncate max-w-[200px]"
                            style={{ color: "#ef4444" }}
                            title={source.statusMessage}
                          >
                            {source.statusMessage}
                          </p>
                        )}
                      </div>

                      {/* Pages */}
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {source.pageCount ?? "—"}
                      </span>

                      {/* Findings */}
                      <div className="flex items-center gap-1 min-w-0">
                        {hasFindings ? (
                          <>
                            <span
                              className="text-[10px] truncate"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {source.findings}
                            </span>
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              className={`flex-shrink-0 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              style={{ color: "var(--text-muted)" }}
                            >
                              <path
                                d="M6 9l6 6 6-6"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </div>

                      {/* Cost */}
                      <span
                        className="text-xs font-medium"
                        style={{ color: meta.cost === 0 ? "var(--accent)" : "#d97706" }}
                      >
                        {meta.cost === 0 ? "Free" : `${source.costCredits} kr.`}
                      </span>
                    </div>

                    {/* Mobile card */}
                    <div
                      className="sm:hidden px-4 py-3"
                      style={{
                        background: isExpanded ? "var(--bg-subtle)" : "var(--surface)",
                        cursor: hasFindings ? "pointer" : "default",
                      }}
                      onClick={() =>
                        hasFindings && setExpanded(isExpanded ? null : source.sourceType)
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <StatusDot status={source.status} />
                          <span className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>
                            {meta.name}
                          </span>
                        </div>
                        <span
                          className="text-xs font-medium flex-shrink-0"
                          style={{ color: meta.cost === 0 ? "var(--accent)" : "#d97706" }}
                        >
                          {meta.cost === 0 ? "Free" : `${source.costCredits} kr.`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {source.pageCount ? `${source.pageCount} str.` : "—"}
                        </span>
                        {hasFindings && (
                          <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
                            <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                              {source.findings}
                            </span>
                            <svg
                              width="10" height="10" viewBox="0 0 24 24" fill="none"
                              className={`flex-shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                              style={{ color: "var(--text-muted)" }}
                            >
                              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </div>
                        )}
                      </div>
                      {source.status === "UNAVAILABLE" && (
                        <p className="text-[10px] mt-1" style={{ color: "#f59e0b" }}>Nedostupné</p>
                      )}
                      {source.status === "FAILED" && source.statusMessage && (
                        <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>
                          {source.statusMessage}
                        </p>
                      )}
                    </div>

                    {/* Expanded findings */}
                    {isExpanded && hasFindings && (
                      <div
                        className="px-4 py-3 text-xs leading-relaxed fade-in"
                        style={{
                          background: "var(--accent-light)",
                          borderTop: "1px solid var(--accent-border)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <p
                          className="font-medium mb-1 text-[10px] uppercase tracking-wider"
                          style={{ color: "var(--accent)" }}
                        >
                          Podrobnosti
                        </p>
                        {source.findings}
                      </div>
                    )}
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

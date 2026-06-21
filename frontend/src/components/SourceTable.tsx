"use client";

import { useState } from "react";

interface Source {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
  pageCount?: number | null;
  findings?: string | null;
  costCredits: number | string;
}

const SOURCE_META: Record<string, { name: string; description: string; free: boolean }> = {
  ORSR:       { name: "ORSR",              description: "Obchodný register SR",     free: true  },
  ZRSR:       { name: "ŽRSR",              description: "Živnostenský register SR", free: true  },
  INSOLVENCY: { name: "Register úpadcov",  description: "Insolvenčný register",     free: true  },
  CRE:        { name: "CRE",               description: "Centrálny register exekúcií", free: false },
};

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    SUCCESS:     "#10b981",
    UNAVAILABLE: "#f59e0b",
    FAILED:      "#ef4444",
    PENDING:     "var(--border-strong)",
    PROCESSING:  "#3b82f6",
  };
  const color = colorMap[status] ?? "var(--border-strong)";
  const isAnimated = status === "PENDING" || status === "PROCESSING";

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${isAnimated ? "animate-pulse" : ""}`}
      style={{ background: color }}
    />
  );
}

export default function SourceTable({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div
        className="grid px-4 py-2.5"
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
        {sources.map((source) => {
          const meta = SOURCE_META[source.sourceType] ?? {
            name: source.sourceType,
            description: source.sourceType,
            free: true,
          };
          const hasFindings = !!source.findings?.trim();
          const isExpanded = expanded === source.sourceType;

          return (
            <div key={source.sourceType}>
              <div
                className="grid items-center px-4 py-3 transition-colors duration-100"
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
                    className="hidden sm:inline text-xs ml-2"
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
                  style={{ color: meta.free ? "var(--accent)" : "#d97706" }}
                >
                  {meta.free ? "Free" : `${source.costCredits} kr.`}
                </span>
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
}

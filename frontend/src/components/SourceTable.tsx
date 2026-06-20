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

const SOURCE_LABELS: Record<string, { name: string; description: string; free: boolean }> = {
  ORSR: { name: "ORSR", description: "Obchodný register SR", free: true },
  ZRSR: { name: "ŽRSR", description: "Živnostenský register SR", free: true },
  INSOLVENCY: { name: "Register úpadcov", description: "Insolvenčný register", free: true },
  CRE: { name: "CRE", description: "Centrálny register exekúcií", free: false },
};

function SemaphoreIcon({ status }: { status: string }) {
  if (status === "SUCCESS") {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-3 h-3 rounded-full bg-slate-700" />
        <div className="w-3 h-3 rounded-full bg-slate-700" />
        <div className="w-3 h-3 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px rgba(52,211,153,0.6)" }} />
      </div>
    );
  }
  if (status === "UNAVAILABLE") {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-3 h-3 rounded-full bg-slate-700" />
        <div className="w-3 h-3 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(251,191,36,0.6)" }} />
        <div className="w-3 h-3 rounded-full bg-slate-700" />
      </div>
    );
  }
  if (status === "FAILED") {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-3 h-3 rounded-full bg-red-400" style={{ boxShadow: "0 0 8px rgba(248,113,113,0.6)" }} />
        <div className="w-3 h-3 rounded-full bg-slate-700" />
        <div className="w-3 h-3 rounded-full bg-slate-700" />
      </div>
    );
  }
  // PENDING / default
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="w-3 h-3 rounded-full bg-slate-700 animate-pulse" />
      <div className="w-3 h-3 rounded-full bg-slate-700 animate-pulse" />
      <div className="w-3 h-3 rounded-full bg-slate-700 animate-pulse" />
    </div>
  );
}

export default function SourceTable({ sources }: { sources: Source[] }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Stav</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Register</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hidden sm:table-cell">Strany</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hidden md:table-cell">Nálezy</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Cena</th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
          {sources.map((source) => {
            const meta = SOURCE_LABELS[source.sourceType] ?? {
              name: source.sourceType,
              description: source.sourceType,
              free: true,
            };
            const isExpanded = expandedRow === source.sourceType;
            const hasFindings = source.findings && source.findings.trim();

            return (
              <>
                <tr
                  key={source.sourceType}
                  className={`transition-colors duration-150 ${hasFindings ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
                  onClick={() => hasFindings && setExpandedRow(isExpanded ? null : source.sourceType)}
                >
                  <td className="px-4 py-3">
                    <SemaphoreIcon status={source.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-semibold text-slate-200">{meta.name}</span>
                      <span className="ml-2 text-xs text-slate-500 hidden sm:inline">{meta.description}</span>
                    </div>
                    {source.status === "UNAVAILABLE" && (
                      <div className="text-xs text-amber-400 mt-0.5">⚠ Nedostupné</div>
                    )}
                    {source.status === "FAILED" && source.statusMessage && (
                      <div className="text-xs text-red-400 mt-0.5 truncate max-w-[200px]" title={source.statusMessage}>
                        {source.statusMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 hidden sm:table-cell">
                    {source.pageCount ?? "—"}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {hasFindings ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 truncate max-w-[240px] text-xs">{source.findings}</span>
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none"
                          className={`flex-shrink-0 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        >
                          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {meta.free ? (
                      <span className="text-xs text-emerald-400 font-medium">Zadarmo</span>
                    ) : (
                      <span className="text-xs text-amber-400 font-medium">{source.costCredits} kr.</span>
                    )}
                  </td>
                </tr>
                {isExpanded && hasFindings && (
                  <tr key={`${source.sourceType}-expanded`} className="animate-fade-in">
                    <td colSpan={5} className="px-4 py-3" style={{ background: "rgba(16,185,129,0.04)", borderTop: "none" }}>
                      <div className="text-xs text-slate-300 leading-relaxed pl-8">
                        <span className="font-semibold text-slate-400 block mb-1">Podrobnosti:</span>
                        {source.findings}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

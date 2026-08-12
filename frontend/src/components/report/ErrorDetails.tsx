"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";
import { MANUAL_LOOKUP_URLS } from "@/lib/sources";
import type { ReportSource } from "@/lib/reportConstants";

export default function ErrorDetails({ sources }: { sources: ReportSource[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const failedSources = sources.filter(s => s.status === "FAILED" || s.status === "UNAVAILABLE");

  if (failedSources.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center justify-between w-full px-4 py-3 text-left transition-colors hover:bg-opacity-50"
        style={{ background: "var(--danger-bg)" }}
      >
        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--danger-text)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          {failedSources.length} {t("report.zdrojeZlyhali")}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="transition-transform"
          style={{ color: "var(--danger-text)", transform: expanded ? "rotate(180deg)" : "none" }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 py-3 space-y-2 fade-in">
          {failedSources.map(s => {
            const url = MANUAL_LOOKUP_URLS[s.sourceType];
            return (
              <div key={s.sourceType} className="flex flex-col gap-0.5 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{s.sourceType}</span>
                {s.statusMessage && (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.statusMessage}</span>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] inline-flex items-center gap-1 hover:underline" style={{ color: "var(--info)" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("report.manualLookup")}: {url.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";
import { MANUAL_LOOKUP_URLS, SOURCE_MAP } from "@/lib/sources";
import type { ReportSource } from "@/lib/reportConstants";

function sanitizeStatusMessage(msg: string | null | undefined, t: (key: string) => string): string | null {
  if (!msg) return null;
  let raw = msg;
  // Map known Slovak worker status messages to i18n keys
  if (/^Závislosť \w+ neposkytla potrebné údaje\./.test(raw)) {
    return t("report.orsrDependencyMissing");
  }
  raw = raw.replace(/Scraper čakal príliš dlho na semafor \(\d+s\)\.?/g, "Register dočasne nedostupný — prekročený časový limit.");
  raw = raw.replace(/Page\.goto:\s*Navigation.*timeout.*/g, "Register nedostupný — prekročený časový limit načítania.");
  raw = raw.replace(/Execution context was destroyed.*/g, "Register dočasne nedostupný.");
  raw = raw.replace(/Target page.*has been closed.*/g, "Register dočasne nedostupný.");
  raw = raw.replace(/^Chyba pri generovaní PDF[^:]*:\s*Page\.\w+:\s*/g, "Register dočasne nedostupný — ");
  raw = raw.replace(/^Nepodarilo sa nájsť link\s*["„].*["„]\./g, "Register nedostupný — štátny portál zmenil layout.");
  raw = raw.replace(/\bScraperUnavailableError:\s*/g, "");
  raw = raw.replace(/\bPlaywrightTimeoutError:\s*/g, "");
  raw = raw.replace(/\bPlaywrightError:\s*/g, "");
  raw = raw.replace(/^Interná chyba scrapera:\s*\w*Error:\s*/g, "Interná chyba — ");
  raw = raw.replace(/^Interná chyba:\s*\w*Error:\s*/g, "Interná chyba — ");
  raw = raw.replace(/^Neznáma chyba[^:]*:\s*\w*Error:\s*/g, "Interná chyba — ");
  raw = raw.replace(/^Chyba pri spracovaní[^:]*:\s*\w*Error:\s*/g, "Chyba pri spracovaní — ");
  raw = raw.replace(/Unhandled exception:\s*\w*Error:\s*/g, "");
  return raw.trim() || null;
}

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
          {failedSources.length} {t("report.zdrojeNedostupne")}
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
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{t(`source.${s.sourceType}`) !== `source.${s.sourceType}` ? t(`source.${s.sourceType}`) : (SOURCE_MAP[s.sourceType]?.label || s.sourceType)}</span>
                {(() => {
                  const clean = sanitizeStatusMessage(s.statusMessage, t);
                  return clean ? (
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{clean}</span>
                  ) : null;
                })()}
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

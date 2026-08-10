"use client";

import { ChartCard } from "@/components/firma-ui";
import { useT } from "@/components/LanguageProvider";

type CompanyEvent = {
  id: string;
  source: string;
  eventType: string;
  severity: string;
  title: string;
  description: string;
  eventDate: Date | null;
  amount: number | null;
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: "var(--danger)", bg: "var(--danger-bg)", label: "Kritické" },
  HIGH: { color: "var(--danger)", bg: "var(--danger-bg)", label: "Vysoké" },
  MEDIUM: { color: "var(--warning)", bg: "var(--warning-bg)", label: "Stredné" },
  LOW: { color: "var(--text-muted)", bg: "var(--surface)", label: "Nízke" },
  INFO: { color: "var(--text-muted)", bg: "var(--surface)", label: "Info" },
};

const SOURCE_LABELS: Record<string, string> = {
  ROZHODNUTIA: "Súdne rozhodnutia",
  INSOLVENCY: "Insolvenčný register",
  DISKVALIFIKACIE: "Diskvalifikácie",
  DOVERA: "Dôvera (zdravotné poistenie)",
  VSZP: "VšZP",
  SP: "Sociálna poisťovňa",
  UNION: "Únia zdravotná poisťovňa",
  FS_DAN: "Finančná správa (daň)",
  FS_DPH: "Finančná správa (DPH)",
  CRZ: "Centrálny register zmlúv",
  UVO: "ÚVO (verejné obstarávanie)",
  VESTNIK: "Obchodný vestník",
  ORSR: "Obchodný register SR",
};

export function CompanyEvents({ events }: { events: CompanyEvent[] }) {
  const t = useT();
  if (events.length === 0) return null;

  return (
    <div className="mb-6 sm:mb-8">
      <h2 className="text-sm sm:text-base font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.orsrUdalosti") || "Registrujúce udalosti"}
      </h2>
      <div className="space-y-2">
        {events.map((ev) => {
          const style = SEVERITY_STYLES[ev.severity] || SEVERITY_STYLES.INFO;
          const sourceLabel = SOURCE_LABELS[ev.source] || ev.source;
          return (
            <div
              key={ev.id}
              className="rounded-lg p-3 sm:p-4"
              style={{ background: style.bg, border: `1px solid var(--border)` }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                    {sourceLabel}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: style.color }}>
                    {ev.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                    style={{ background: style.color, color: "white" }}
                  >
                    {style.label}
                  </span>
                  {ev.eventDate && (
                    <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {new Date(ev.eventDate).toLocaleDateString("sk-SK")}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {ev.description}
              </p>
              {ev.amount != null && ev.amount > 0 && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Suma: {ev.amount.toLocaleString("sk-SK", { style: "currency", currency: "EUR" })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

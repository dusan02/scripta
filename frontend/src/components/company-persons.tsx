"use client";

import { useState } from "react";
import { ChartCard } from "@/components/firma-ui";
import { useT } from "@/components/LanguageProvider";

type Person = {
  id: string;
  rawName: string;
  cleanName?: string | null;
  role: string;
  city: string | null;
  zipCode: string | null;
  functionStart: Date | null;
  functionEnd: Date | null;
  isActive: boolean;
};

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("sk-SK", { year: "numeric", month: "numeric" });
}

function fmtFunctionPeriod(p: { functionStart: Date | null; functionEnd: Date | null }): string {
  const start = fmtDate(p.functionStart);
  const end = p.functionEnd ? fmtDate(p.functionEnd) : null;
  if (!start && !end) return "";
  if (!end) return `od ${start}`;
  if (!start) return `do ${end}`;
  return `${start} – ${end}`;
}

export function CompanyPersons({ persons }: { persons: Person[] }) {
  const t = useT();
  const [showFormer, setShowFormer] = useState(false);

  if (persons.length === 0) return null;

  const ROLE_LABELS: Record<string, string> = {
    statutar: t("company.statutari"),
    spolocnik: t("company.spolocnici"),
    dozorna_rada: t("company.dozornaRada") || "Dozorná rada",
  };

  const activePersons = persons.filter(p => p.isActive);
  const formerPersons = persons.filter(p => !p.isActive);
  const formerCount = formerPersons.length;

  const renderPersonList = (list: Person[]) => (
    <ul className="space-y-2">
      {list.map(p => {
        const period = fmtFunctionPeriod(p);
        return (
          <li key={p.id} className="text-sm">
            <span style={{ color: "var(--text)" }}>{p.cleanName || p.rawName.replace(/\s+/g, " ").trim()}</span>
            {p.city && (
              <span style={{ color: "var(--text-muted)" }}>{`, ${p.city}${p.zipCode ? ` ${p.zipCode}` : ""}`}</span>
            )}
            {period && (
              <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>({period})</span>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-4">
      {/* Active persons — all roles */}
      {Object.entries(ROLE_LABELS).map(([role, label]) => {
        const rolePersons = activePersons.filter(p => p.role === role);
        if (rolePersons.length === 0) return null;
        return (
          <ChartCard key={role} title={label}>
            {renderPersonList(rolePersons)}
          </ChartCard>
        );
      })}

      {/* Former persons — collapsed */}
      {formerCount > 0 && (
        <div>
          <button
            onClick={() => setShowFormer(v => !v)}
            className="text-xs font-medium mb-2 no-print"
            style={{ color: "var(--accent)" }}
          >
            {showFormer
              ? t("firma.skrytBývalé") || "Skryť bývalé osoby"
              : t("firma.zobrazitBývalé", { count: formerCount }) || `Zobraziť bývalé osoby (${formerCount})`}
          </button>
          {showFormer && (
            <div className="space-y-3">
              {Object.entries(ROLE_LABELS).map(([role, label]) => {
                const rolePersons = formerPersons.filter(p => p.role === role);
                if (rolePersons.length === 0) return null;
                return (
                  <ChartCard key={`former-${role}`} title={`${label} (${t("firma.bývalé") || "bývalé"})`}>
                    {renderPersonList(rolePersons)}
                  </ChartCard>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

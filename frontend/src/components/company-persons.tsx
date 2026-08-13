"use client";

import { ChartCard } from "@/components/firma-ui";
import { useT } from "@/components/LanguageProvider";

type Person = {
  id: string;
  rawName: string;
  cleanName?: string | null;
  role: string;
  city: string | null;
  zipCode: string | null;
};

export function CompanyPersons({ persons }: { persons: Person[] }) {
  const t = useT();
  const ROLE_LABELS: Record<string, string> = {
    statutar: t("company.statutari"),
    spolocnik: t("company.spolocnici"),
  };

  if (persons.length === 0) return null;

  return (
    <div className="space-y-4">
      {Object.entries(ROLE_LABELS).map(([role, label]) => {
        const rolePersons = persons.filter(p => p.role === role);
        if (rolePersons.length === 0) return null;
        return (
          <ChartCard key={role} title={label}>
            <ul className="space-y-2">
              {rolePersons.map(p => (
                <li key={p.id} className="text-sm">
                  <span style={{ color: "var(--text)" }}>{p.cleanName || p.rawName.replace(/\s+/g, " ").trim()}</span>
                  {p.city && (
                    <span style={{ color: "var(--text-muted)" }}>{`, ${p.city}${p.zipCode ? ` ${p.zipCode}` : ""}`}</span>
                  )}
                </li>
              ))}
            </ul>
          </ChartCard>
        );
      })}
    </div>
  );
}

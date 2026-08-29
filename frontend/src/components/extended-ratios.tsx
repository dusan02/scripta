"use client";

import { ChartCard } from "@/components/firma-ui";
import { useT } from "@/components/LanguageProvider";
import { computeExtendedIndicators, fmtPct, fmtRatio } from "@/lib/financial-indicators";
import { fmtEUR } from "@/lib/format";

export function ExtendedRatios({ stmts }: { stmts: any[] }) {
  const t = useT();
  const indicators = computeExtendedIndicators(stmts);
  const byYear = new Map(indicators.map((r) => [r.year, r]));

  const hasAny = indicators.some(r =>
    r.quickRatio != null || r.workingCapital != null ||
    r.debtToEquity != null || r.interestCoverage != null
  );
  if (!hasAny) return null;

  const sorted = [...stmts].sort((a, b) => a.year - b.year);

  const rows: { label: string; render: (s: any) => React.ReactNode }[] = [
    {
      label: t("firma.quickRatio") || "Quick ratio",
      render: (s) => fmtRatio(byYear.get(s.year)?.quickRatio ?? null),
    },
    {
      label: t("firma.workingCapital") || "Pracovný kapitál",
      render: (s) => {
        const wc = byYear.get(s.year)?.workingCapital ?? null;
        return wc != null ? fmtEUR(wc) : "—";
      },
    },
    {
      label: t("firma.debtToEquity") || "Zadlženosť vs. imanie (D/E)",
      render: (s) => fmtRatio(byYear.get(s.year)?.debtToEquity ?? null),
    },
    {
      label: t("firma.interestCoverage") || "Krytie úrokov",
      render: (s) => fmtRatio(byYear.get(s.year)?.interestCoverage ?? null),
    },
  ];

  return (
    <ChartCard title={t("firma.dalsieUkazovatele") || "Ďalšie finančné ukazovatele"}>
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full border-collapse" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th className="text-left py-1.5 px-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                {t("firma.ukazovatel")}
              </th>
              {sorted.map(s => (
                <th key={s.year} className="text-right py-1.5 px-1.5 font-semibold" style={{ color: "var(--text-muted)" }}>
                  {s.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="text-left py-1.5 px-2" style={{ color: "var(--text-secondary)" }}>
                  {row.label}
                </td>
                {sorted.map(s => (
                  <td
                    key={s.year}
                    className="text-right py-1.5 px-1.5 whitespace-nowrap tabular-nums font-mono"
                    style={{ color: "var(--text)" }}
                  >
                    {row.render(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

export function EmployeeTrend({ stmts }: { stmts: any[] }) {
  const t = useT();
  const sorted = [...stmts].sort((a, b) => a.year - b.year);
  const withEmployees = sorted.filter(s => s.employeeCount != null);

  if (withEmployees.length < 2) return null;

  return (
    <ChartCard title={t("firma.vyvojZamestnancov") || "Vývoj počtu zamestnancov"}>
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full border-collapse" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              {withEmployees.map(s => (
                <th key={s.year} className="text-right py-1.5 px-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                  {s.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {withEmployees.map(s => (
                <td
                  key={s.year}
                  className="text-right py-1.5 px-2 whitespace-nowrap tabular-nums font-mono font-bold"
                  style={{ color: "var(--text)" }}
                >
                  {s.employeeCount?.toLocaleString("sk-SK") ?? "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

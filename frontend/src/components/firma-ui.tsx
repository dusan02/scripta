"use client";

import { fmtNum } from "@/lib/format";
import { useT } from "@/components/LanguageProvider";

export function BalanceSheetTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const BS_ASSETS_ROWS = [
    { label: t("firma.celkoveAktiva"), key: "totalAssets" },
    { label: t("firma.obeznyMajetok"), key: "currentAssets" },
    { label: t("firma.zasoby"), key: "inventory" },
    { label: t("firma.pohladavky"), key: "tradeReceivables" },
    { label: t("firma.cashEkvivalenty"), key: "cashAndEquivalents" },
  ];
  const BS_LIABILITIES_ROWS = [
    { label: t("firma.vlastneImanie"), key: "equity" },
    { label: t("firma.kratkodobeZavazky"), key: "shortTermLiabilities" },
    { label: t("firma.dlhodobeZavazky"), key: "longTermLiabilities" },
  ];
  return (
    <div>
      <GenericTable stmts={stmts} rows={BS_ASSETS_ROWS} sectionTitle={t("firma.aktiva")} />
      <div className="mt-3" />
      <GenericTable stmts={stmts} rows={BS_LIABILITIES_ROWS} sectionTitle={t("firma.pasiva")} />
    </div>
  );
}

export function ProfitLossTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const PL_ROWS = [
    { label: t("firma.trzby"), key: "mainActivityRevenue" },
    { label: t("firma.hrubaMarza"), key: "grossProfit" },
    { label: t("firma.osobneNaklady"), key: "staffCosts" },
    { label: t("firma.odpisy"), key: "depreciation" },
    { label: t("firma.uroky"), key: "interestExpense" },
    { label: t("firma.danZPrjimu"), key: "incomeTax" },
    { label: t("firma.ziskStrata"), key: "netProfitLoss" },
    { label: t("firma.cashFlowPrevadzky"), key: "operatingCashFlow" },
  ];
  return <GenericTable stmts={stmts} rows={PL_ROWS} />;
}

function GenericTable({ stmts, rows, sectionTitle }: { stmts: any[], rows: any[], sectionTitle?: string }) {
  const t = useT();
  const sorted = [...stmts].sort((a, b) => a.year - b.year);

  return (
    <div>
      {sectionTitle && (
        <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1.5 mt-2" style={{ color: "var(--accent)" }}>{sectionTitle}</div>
      )}
      <table className="w-full" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{t("firma.ukazovatel")}</th>
            {sorted.map(s => (
              <th key={s.year} className="text-right py-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{s.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
              <td className="py-2 px-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.label}</td>
              {sorted.map(s => (
                <td key={s.year} className="text-right py-2 px-3 whitespace-nowrap" style={{ color: "var(--text)", fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace", fontVariantNumeric: "tabular-nums" }}>
                  {fmtNum(s[row.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricCard({ label, value, sub, color, trend }: { label: string; value: string; sub: string; color: string; trend?: { direction: "up" | "down" | "flat"; pct: number } }) {
  const trendColor = trend?.direction === "up" ? "#10b981" : trend?.direction === "down" ? "#ef4444" : "var(--text-muted)";
  const trendIcon = trend?.direction === "up" ? "↑" : trend?.direction === "down" ? "↓" : "→";
  const trendText = trend ? `${trendIcon} ${trend.pct > 0 ? trend.pct.toFixed(0) : "0"}%` : null;
  return (
    <div className="rounded-xl p-3 sm:p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>{label}</p>
      <div className="text-lg sm:text-xl font-black" style={{ color }}>{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-[10px] sm:text-xs" style={{ color: "var(--text-muted)" }}>{sub}</p>}
        {trendText && <p className="text-[10px] sm:text-xs font-bold" style={{ color: trendColor }}>{trendText}</p>}
      </div>
    </div>
  );
}

export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-sm font-bold mb-3 sm:mb-4" style={{ color: "var(--text)" }}>{title}</h3>
      {children}
    </div>
  );
}

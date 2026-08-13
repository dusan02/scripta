"use client";

import { fmtNum } from "@/lib/format";
import { useT } from "@/components/LanguageProvider";

// ═══════════════════════════════════════════════════════════════
// Shared table renderer
// ═══════════════════════════════════════════════════════════════

interface TableRow {
  label: string;
  key: string;
  bold?: boolean;
}

function FinancialTable({ stmts, rows, sectionTitle }: { stmts: any[]; rows: TableRow[]; sectionTitle?: string }) {
  const t = useT();
  const sorted = [...stmts].sort((a, b) => a.year - b.year);

  return (
    <div>
      {sectionTitle && (
        <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1.5 mt-2" style={{ color: "var(--accent)" }}>{sectionTitle}</div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", borderCollapse: "collapse", width: "100%", minWidth: sorted.length > 4 ? 500 : "auto" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th className="text-left py-1.5 px-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{t("firma.ukazovatel")}</th>
              {sorted.map(s => (
                <th key={s.year} className="text-right py-1.5 px-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{s.year}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-1.5 px-2 whitespace-nowrap" style={{ color: row.bold ? "var(--text)" : "var(--text-secondary)", fontWeight: row.bold ? 700 : 400 }}>{row.label}</td>
                {sorted.map(s => (
                  <td key={s.year} className="text-right py-1.5 px-2.5 whitespace-nowrap" style={{
                    color: "var(--text)",
                    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: row.bold ? 700 : 400,
                  }}>
                    {fmtNum(s[row.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Balance Sheet — Aktíva + Pasíva in one aligned table
// ═══════════════════════════════════════════════════════════════

export function BalanceSheetTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const ASSETS_ROWS: TableRow[] = [
    { label: t("firma.celkoveAktiva"), key: "totalAssets", bold: true },
    { label: t("firma.neobeznyMajetok"), key: "nonCurrentAssets" },
    { label: t("firma.obeznyMajetok"), key: "currentAssets" },
    { label: t("firma.zasoby"), key: "inventory" },
    { label: t("firma.pohladavky"), key: "tradeReceivables" },
    { label: t("firma.cashEkvivalenty"), key: "cashAndEquivalents" },
  ];
  const LIABILITIES_ROWS: TableRow[] = [
    { label: t("firma.vlastneImanie"), key: "equity", bold: true },
    { label: t("firma.zakladneImanie"), key: "shareCapital" },
    { label: t("firma.kratkodobeZavazky"), key: "shortTermLiabilities" },
    { label: t("firma.zavazkyZObchod"), key: "tradePayables" },
    { label: t("firma.dlhodobeZavazky"), key: "longTermLiabilities" },
  ];

  return (
    <div>
      <FinancialTable stmts={stmts} rows={ASSETS_ROWS} sectionTitle={t("firma.aktiva")} />
      <div className="mt-2" />
      <FinancialTable stmts={stmts} rows={LIABILITIES_ROWS} sectionTitle={t("firma.pasiva")} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Profit & Loss table
// ═══════════════════════════════════════════════════════════════

export function ProfitLossTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const PL_ROWS: TableRow[] = [
    { label: t("firma.trzby"), key: "mainActivityRevenue", bold: true },
    { label: t("firma.prevadzkoveNaklady"), key: "operatingCosts" },
    { label: t("firma.hrubaMarza"), key: "grossProfit" },
    { label: t("firma.osobneNaklady"), key: "staffCosts" },
    { label: t("firma.odpisy"), key: "depreciation" },
    { label: t("firma.ziskPredZdanenim"), key: "profitBeforeTax" },
    { label: t("firma.uroky"), key: "interestExpense" },
    { label: t("firma.danZPrjimu"), key: "incomeTax" },
    { label: t("firma.ziskStrata"), key: "netProfitLoss", bold: true },
    { label: t("firma.cashFlowPrevadzky"), key: "operatingCashFlow" },
  ];
  return <FinancialTable stmts={stmts} rows={PL_ROWS} />;
}

// ═══════════════════════════════════════════════════════════════
// Metric cards & chart containers
// ═══════════════════════════════════════════════════════════════

export function MetricCard({ label, value, sub, color, trend }: { label: string; value: string; sub: string; color: string; trend?: { direction: "up" | "down" | "flat"; pct: number } }) {
  const trendColor = "var(--text-muted)";
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

export function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-4 sm:p-5 ${className ?? ""}`} style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>{title}</h3>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Financial Ratios — indebtedness & current liquidity
// ═══════════════════════════════════════════════════════════════

function safeDiv(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function toNum(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtRatio(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

export function FinancialRatios({ stmts }: { stmts: any[] }) {
  const t = useT();
  const sorted = [...stmts].sort((a, b) => a.year - b.year);

  const ratioRows: { label: string; tooltip: string; compute: (s: any) => number | null; fmt: (v: number | null) => string }[] = [
    {
      label: t("firma.zadlzenost"),
      tooltip: t("firma.zadlzenostFormula"),
      compute: (s) => {
        const stl = toNum(s.shortTermLiabilities);
        const ltl = toNum(s.longTermLiabilities);
        const ta = toNum(s.totalAssets);
        if (stl == null || ltl == null || ta == null) return null;
        return safeDiv(stl + ltl, ta);
      },
      fmt: fmtPct,
    },
    {
      label: t("firma.beznaLikvidita"),
      tooltip: t("firma.beznaLikviditaFormula"),
      compute: (s) => safeDiv(toNum(s.currentAssets), toNum(s.shortTermLiabilities)),
      fmt: fmtRatio,
    },
  ];

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", borderCollapse: "collapse", width: "100%", minWidth: sorted.length > 4 ? 500 : "auto" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th className="text-left py-1.5 px-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{t("firma.ukazovatel")}</th>
              {sorted.map(s => (
                <th key={s.year} className="text-right py-1.5 px-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{s.year}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ratioRows.map((row) => (
              <tr key={row.label} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-1.5 px-2 whitespace-nowrap" style={{ color: "var(--text-secondary)", cursor: "help", textDecoration: "underline", textDecorationColor: "var(--border)", textDecorationStyle: "dotted", textUnderlineOffset: "3px" }} title={row.tooltip}>{row.label}</td>
                {sorted.map(s => (
                  <td key={s.year} className="text-right py-1.5 px-2.5 whitespace-nowrap" style={{
                    color: "var(--text)",
                    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {row.fmt(row.compute(s))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

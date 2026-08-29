"use client";

import { fmtNum } from "@/lib/format";
import { useT } from "@/components/LanguageProvider";

// ═══════════════════════════════════════════════════════════════
// Unified base table — shared by all financial tables (DRY)
// ═══════════════════════════════════════════════════════════════

interface BaseTableRow {
  label: string;
  tooltip?: string;
  bold?: boolean;
  renderValue: (stmt: any) => React.ReactNode;
}

const TABLE_BASE = "w-full border-collapse";
const TH_LABEL = "text-left py-1.5 px-2 font-semibold whitespace-nowrap";
const TH_VALUE = "text-right py-1.5 px-1.5 font-semibold whitespace-nowrap";
const TD_LABEL = "text-left py-1.5 px-2";
const TD_VALUE = "text-right py-1.5 px-1.5 whitespace-nowrap tabular-nums font-mono";

// Tooltip styles for rows with formula hints
const TOOLTIP_STYLE: React.CSSProperties = {
  cursor: "help",
  textDecoration: "underline",
  textDecorationColor: "var(--border)",
  textDecorationStyle: "dotted",
  textUnderlineOffset: "3px",
  position: "relative" as const,
};

function FormulaTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span
      className="formula-tooltip"
      style={TOOLTIP_STYLE}
      title={text}
    >
      {children}
      <span className="formula-tooltip-text">{text}</span>
    </span>
  );
}

function BaseFinancialTable({ stmts, rows, sectionTitle }: { stmts: any[]; rows: BaseTableRow[]; sectionTitle?: string }) {
  const t = useT();
  const sorted = [...stmts].sort((a, b) => a.year - b.year);
  const colWidth = `${70 / sorted.length}%`;

  return (
    <div>
      {sectionTitle && (
        <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1.5 mt-2" style={{ color: "var(--accent)" }}>{sectionTitle}</div>
      )}
      <div className="overflow-x-auto -mx-2 px-2 pb-1">
      <table className={TABLE_BASE} style={{ fontSize: 13, minWidth: sorted.length > 3 ? 420 : "auto" }}>
        <colgroup>
          <col style={{ width: "30%" }} />
          {sorted.map((s) => (
            <col key={s.year} style={{ width: colWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th className={TH_LABEL} style={{ color: "var(--text-muted)", position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>{t("firma.ukazovatel")}</th>
            {sorted.map(s => (
              <th key={s.year} className={TH_VALUE} style={{ color: "var(--text-muted)" }}>{s.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              <td
                className={TD_LABEL}
                style={{
                  color: row.bold ? "var(--text)" : "var(--text-secondary)",
                  fontWeight: row.bold ? 700 : 400,
                  position: "sticky",
                  left: 0,
                  background: "var(--surface)",
                  zIndex: 1,
                  ...(row.tooltip ? TOOLTIP_STYLE : {}),
                }}
              >
                {row.tooltip ? <FormulaTooltip text={row.tooltip}>{row.label}</FormulaTooltip> : row.label}
              </td>
              {sorted.map(s => (
                <td
                  key={s.year}
                  className={TD_VALUE}
                  style={{
                    color: "var(--text)",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: row.bold ? 700 : 400,
                  }}
                >
                  {row.renderValue(s)}
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

// Helper: create a simple row that reads a key and formats with fmtNum
function dataRow(label: string, key: string, bold?: boolean): BaseTableRow & { _key?: string } {
  return { label, bold, _key: key, renderValue: (s) => fmtNum(s[key]) };
}

// Filter out rows where ALL values are null/undefined across all statements
function filterEmptyRows(rows: (BaseTableRow & { _key?: string })[], stmts: any[]): BaseTableRow[] {
  return rows.filter(row => {
    if (row.bold) return true; // Always keep bold (summary) rows
    if (!row._key) return true;
    return stmts.some(s => s[row._key!] != null);
  });
}

// ═══════════════════════════════════════════════════════════════
// Balance Sheet — Aktíva + Pasíva in one aligned table
// ═══════════════════════════════════════════════════════════════

export function BalanceSheetTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const ASSETS_ROWS = [
    dataRow(t("firma.celkoveAktiva"), "totalAssets", true),
    dataRow(t("firma.neobeznyMajetok"), "nonCurrentAssets"),
    dataRow(t("firma.obeznyMajetok"), "currentAssets"),
    dataRow(t("firma.zasoby"), "inventory"),
    dataRow(t("firma.pohladavky"), "tradeReceivables"),
    dataRow(t("firma.cashEkvivalenty"), "cashAndEquivalents"),
  ];
  const LIABILITIES_ROWS = [
    dataRow(t("firma.vlastneImanie"), "equity", true),
    dataRow(t("firma.zakladneImanie"), "shareCapital"),
    dataRow(t("firma.kratkodobeZavazky"), "shortTermLiabilities"),
    dataRow(t("firma.zavazkyZObchod"), "tradePayables"),
    dataRow(t("firma.dlhodobeZavazky"), "longTermLiabilities"),
  ];

  const assetsFiltered = filterEmptyRows(ASSETS_ROWS, stmts);
  const liabilitiesFiltered = filterEmptyRows(LIABILITIES_ROWS, stmts);

  return (
    <div>
      <BaseFinancialTable stmts={stmts} rows={assetsFiltered} sectionTitle={t("firma.aktiva")} />
      <div className="mt-2" />
      <BaseFinancialTable stmts={stmts} rows={liabilitiesFiltered} sectionTitle={t("firma.pasiva")} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Profit & Loss table
// ═══════════════════════════════════════════════════════════════

export function ProfitLossTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const PL_ROWS = [
    dataRow(t("firma.trzby"), "mainActivityRevenue", true),
    dataRow(t("firma.prevadzkoveNaklady"), "operatingCosts"),
    dataRow(t("firma.hrubaMarza"), "grossProfit"),
    dataRow(t("firma.osobneNaklady"), "staffCosts"),
    dataRow(t("firma.odpisy"), "depreciation"),
    dataRow(t("firma.ziskPredZdanenim"), "profitBeforeTax"),
    dataRow(t("firma.uroky"), "interestExpense"),
    dataRow(t("firma.danZPrjimu"), "incomeTax"),
    dataRow(t("firma.ziskStrata"), "netProfitLoss", true),
    dataRow(t("firma.cashFlowPrevadzky"), "operatingCashFlow"),
  ];
  const filtered = filterEmptyRows(PL_ROWS, stmts);
  return <BaseFinancialTable stmts={stmts} rows={filtered} />;
}

// ═══════════════════════════════════════════════════════════════
// Cash Flow table
// ═══════════════════════════════════════════════════════════════

export function CashFlowTable({ stmts }: { stmts: any[] }) {
  const t = useT();
  const CF_ROWS = [
    dataRow(t("firma.cashFlowPrevadzky"), "operatingCashFlow", true),
    dataRow(t("firma.cashFlowInvesticny") || "Investičný cash flow", "investingCashFlow"),
    dataRow(t("firma.cashFlowFinancny") || "Finančný cash flow", "financingCashFlow"),
  ];
  const filtered = filterEmptyRows(CF_ROWS, stmts);
  if (filtered.length === 0) return null;
  return <BaseFinancialTable stmts={stmts} rows={filtered} />;
}

// ═══════════════════════════════════════════════════════════════
// Metric cards & chart containers
// ═══════════════════════════════════════════════════════════════

export function MetricCard({ label, value, sub, color, trend }: { label: string; value: string; sub: string; color: string; trend?: { direction: "up" | "down" | "flat"; pct: number } }) {
  const t = useT();
  const trendColor = trend?.direction === "up" ? "#10b981" : trend?.direction === "down" ? "#ef4444" : "var(--text-muted)";
  const trendIcon = trend?.direction === "up" ? "↑" : trend?.direction === "down" ? "↓" : "→";
  const trendText = trend ? `${trendIcon} ${trend.pct > 0 ? trend.pct.toFixed(0) : "0"}%` : null;
  const isEmpty = value === "—" || value === "N/A";
  return (
    <div className="rounded-xl p-3 sm:p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>{label}</p>
      {isEmpty ? (
        <div className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>{t("firma.udajeNedostupneShort")}</div>
      ) : (
        <div className="text-lg sm:text-xl font-black" style={{ color }}>{value}</div>
      )}
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-[10px] sm:text-xs" style={{ color: "var(--text-muted)" }}>{sub}</p>}
        {trendText && !isEmpty && <p className="text-[10px] sm:text-xs font-bold" style={{ color: trendColor }}>{trendText}</p>}
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

import {
  computeFinancialIndicators,
  fmtPct,
  fmtRatio,
} from "@/lib/financial-indicators";

export function FinancialRatios({ stmts }: { stmts: any[] }) {
  const t = useT();

  // Single source of truth: compute all ratios via shared helper.
  // The chart component uses the same function — chart and table are guaranteed identical.
  const indicators = computeFinancialIndicators(stmts);

  // Build a lookup so renderValue can find the precomputed row by year
  const byYear = new Map(indicators.map((r) => [r.year, r]));

  const ratioRows: BaseTableRow[] = [
    {
      label: t("firma.zadlzenost"),
      tooltip: t("firma.zadlzenostFormula"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.debt ?? null),
    },
    {
      label: t("firma.beznaLikvidita"),
      tooltip: t("firma.beznaLikviditaFormula"),
      renderValue: (s) => fmtRatio(byYear.get(s.year)?.currentRatio ?? null),
    },
    {
      label: "ROE",
      tooltip: t("firma.tooltipRoe"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.roe ?? null),
    },
    {
      label: "ROA",
      tooltip: t("firma.tooltipRoa"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.roa ?? null),
    },
    {
      label: t("firma.ziskovaMarza") || "Zisková marža",
      tooltip: t("firma.tooltipMarza"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.margin ?? null),
    },
  ];

  return <BaseFinancialTable stmts={stmts} rows={ratioRows} />;
}

/** Rentability ratios — ROE, ROA, Zisková marža (matches RentabilityChart) */
export function RentabilityRatios({ stmts }: { stmts: any[] }) {
  const t = useT();
  const indicators = computeFinancialIndicators(stmts);
  const byYear = new Map(indicators.map((r) => [r.year, r]));

  const rows: BaseTableRow[] = [
    {
      label: "ROE",
      tooltip: t("firma.tooltipRoe"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.roe ?? null),
    },
    {
      label: "ROA",
      tooltip: t("firma.tooltipRoa"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.roa ?? null),
    },
    {
      label: t("firma.ziskovaMarza") || "Zisková marža",
      tooltip: t("firma.tooltipMarza"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.margin ?? null),
    },
  ];

  return <BaseFinancialTable stmts={stmts} rows={rows} />;
}

/** Stability ratios — Zadlženosť, ST%, LT%, Bežná likvidita (matches StabilityChart + extra) */
export function StabilityRatios({ stmts }: { stmts: any[] }) {
  const t = useT();
  const indicators = computeFinancialIndicators(stmts);
  const byYear = new Map(indicators.map((r) => [r.year, r]));

  const rows: BaseTableRow[] = [
    {
      label: t("firma.zadlzenost"),
      tooltip: t("firma.zadlzenostFormula"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.debt ?? null),
    },
    {
      label: t("firma.podielKratkodobych"),
      tooltip: t("firma.tooltipStDebt"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.shortTermDebt ?? null),
    },
    {
      label: t("firma.podielDlhodobych"),
      tooltip: t("firma.tooltipLtDebt"),
      renderValue: (s) => fmtPct(byYear.get(s.year)?.longTermDebt ?? null),
    },
    {
      label: t("firma.beznaLikvidita"),
      tooltip: t("firma.beznaLikviditaFormula"),
      renderValue: (s) => fmtRatio(byYear.get(s.year)?.currentRatio ?? null),
    },
  ];

  return <BaseFinancialTable stmts={stmts} rows={rows} />;
}

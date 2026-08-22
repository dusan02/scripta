/**
 * Financial indicators — single source of truth for ratio calculations.
 *
 * Used by both the FinancialRatios table and the FinancialIndicatorsCharts
 * component so that chart and table always display identical values.
 *
 * Calculations match the original inline logic in firma-ui.tsx:
 *   - Zadlženosť: (shortTermLiabilities + longTermLiabilities) / totalAssets
 *     (at least one liability source must be present; null treated as 0)
 *   - Bežná likvidita: currentAssets / shortTermLiabilities
 *   - ROE: netProfitLoss / equity
 *   - ROA: netProfitLoss / totalAssets
 *   - Zisková marža: netProfitLoss / mainActivityRevenue
 *
 * All values are returned as fractions (e.g. 0.392 = 39.2%).
 * Missing data is preserved as `null` — NEVER converted to 0.
 */

/** Convert any value (Prisma Decimal, string, number) to number | null. */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  // Prisma Decimal-like object with toNumber()
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as any).toNumber === "function") {
    return (v as any).toNumber();
  }
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** Safe division — returns null if either operand is null or divisor is 0. */
export function safeDiv(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

export type FinancialIndicatorRow = {
  year: number;
  /** Zadlženosť — fraction (0.392 = 39.2%) or null */
  debt: number | null;
  /** Bežná likvidita — decimal (1.72) or null */
  currentRatio: number | null;
  /** ROE — fraction or null */
  roe: number | null;
  /** ROA — fraction or null */
  roa: number | null;
  /** Zisková marža — fraction or null */
  margin: number | null;
};

type StatementLike = {
  year: number;
  shortTermLiabilities?: unknown;
  longTermLiabilities?: unknown;
  totalAssets?: unknown;
  currentAssets?: unknown;
  netProfitLoss?: unknown;
  equity?: unknown;
  mainActivityRevenue?: unknown;
};

/**
 * Compute the 5 financial indicators for each statement.
 * Statements are sorted ascending by year.
 * Missing values are preserved as null — never coerced to 0.
 */
export function computeFinancialIndicators(
  stmts: StatementLike[],
): FinancialIndicatorRow[] {
  return [...stmts]
    .sort((a, b) => a.year - b.year)
    .map((s) => {
      const stl = toNum(s.shortTermLiabilities);
      const ltl = toNum(s.longTermLiabilities);
      const ta = toNum(s.totalAssets);
      const ca = toNum(s.currentAssets);
      const np = toNum(s.netProfitLoss);
      const eq = toNum(s.equity);
      const rev = toNum(s.mainActivityRevenue);

      // Zadlženosť: at least one liability source must be present; null → 0
      let debt: number | null = null;
      if (stl != null || ltl != null) {
        if (ta != null) {
          debt = safeDiv((stl ?? 0) + (ltl ?? 0), ta);
        }
      }

      return {
        year: s.year,
        debt,
        currentRatio: safeDiv(ca, stl),
        roe: safeDiv(np, eq),
        roa: safeDiv(np, ta),
        margin: safeDiv(np, rev),
      };
    });
}

/** Format a fraction as percentage string with 1 decimal (e.g. 0.392 → "39.2%"). */
export function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Format a ratio as decimal string with 2 decimals (e.g. 1.723 → "1.72"). */
export function fmtRatio(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

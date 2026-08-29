/**
 * Financial indicators — single source of truth for ratio calculations.
 *
 * Used by both the FinancialRatios table and the FinancialIndicatorsCharts
 * component so that chart and table always display identical values.
 *
 * Calculations match the original inline logic in firma-ui.tsx:
 *   - Zadlženosť: (shortTermLiabilities + longTermLiabilities) / totalAssets
 *     (at least one liability source must be present; null treated as 0)
 *   - Podiel krátkodobých záväzkov: shortTermLiabilities / totalAssets
 *   - Podiel dlhodobých záväzkov: longTermLiabilities / totalAssets
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
  /** Podiel krátkodobých záväzkov — fraction or null */
  shortTermDebt: number | null;
  /** Podiel dlhodobých záväzkov — fraction or null */
  longTermDebt: number | null;
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

      // Podiel krátkodobých záväzkov: shortTermLiabilities / totalAssets
      const shortTermDebt = safeDiv(stl, ta);

      // Podiel dlhodobých záväzkov: longTermLiabilities / totalAssets
      const longTermDebt = safeDiv(ltl, ta);

      return {
        year: s.year,
        debt,
        shortTermDebt,
        longTermDebt,
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

// ── Extended indicators ──────────────────────────────────────────────────────

export type ExtendedIndicatorRow = {
  year: number;
  /** Quick ratio = (currentAssets - inventory) / shortTermLiabilities */
  quickRatio: number | null;
  /** Working capital = currentAssets - shortTermLiabilities (EUR) */
  workingCapital: number | null;
  /** Debt-to-equity = (STL + LTL) / equity */
  debtToEquity: number | null;
  /** Interest coverage = (profitBeforeTax + interestExpense) / interestExpense */
  interestCoverage: number | null;
};

type ExtendedStatementLike = StatementLike & {
  inventory?: unknown;
  profitBeforeTax?: unknown;
  interestExpense?: unknown;
};

export function computeExtendedIndicators(
  stmts: ExtendedStatementLike[],
): ExtendedIndicatorRow[] {
  return [...stmts]
    .sort((a, b) => a.year - b.year)
    .map((s) => {
      const ca = toNum(s.currentAssets);
      const inv = toNum(s.inventory);
      const stl = toNum(s.shortTermLiabilities);
      const ltl = toNum(s.longTermLiabilities);
      const eq = toNum(s.equity);
      const pbt = toNum(s.profitBeforeTax);
      const interest = toNum(s.interestExpense);

      const quickRatio = safeDiv(
        ca != null && inv != null ? ca - inv : ca,
        stl,
      );

      const workingCapital = ca != null && stl != null ? ca - stl : null;

      const totalDebt = (stl ?? 0) + (ltl ?? 0);
      const debtToEquity = eq != null && eq !== 0 ? totalDebt / eq : null;

      const interestCoverage = interest != null && interest !== 0
        ? ((pbt ?? 0) + interest) / interest
        : null;

      return {
        year: s.year,
        quickRatio,
        workingCapital,
        debtToEquity,
        interestCoverage,
      };
    });
}


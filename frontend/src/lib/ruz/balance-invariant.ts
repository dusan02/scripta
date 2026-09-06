/**
 * Balance-sheet invariant check — shared by every RÚZ parse path.
 *
 * Accounting identity (SK GAAP, šablóna 699):
 *   Celkové aktíva = Celkové pasíva = Vlastné imanie + Záväzky
 *
 * Rezervy are NOT added separately: in the RÚZ template-699 pipeline they
 * are already part of the ST/LT liability totals (verified against 1.2M
 * production statements — adding them breaks the identity for years that
 * otherwise balance exactly).
 *
 * Tolerance 5% mirrors worker/src/pipeline.py::_check_balance_sheet_integrity
 * so both pipelines classify the same statement the same way.
 *
 * Purpose: catch positional-parsing corruption (column shift, template
 * change 699↔687) BEFORE the numbers reach scoring — a shifted column must
 * never be silently persisted as a valid financial value.
 */

export const BALANCE_TOLERANCE = 0.05;

export type BalanceCheckStatus = "balanced" | "unbalanced" | "insufficient";

export interface BalanceCheckResult {
  status: BalanceCheckStatus;
  /** |assets - pasíva| / assets, when both sides are computable. */
  diffPct: number | null;
  /** Components used for the passive side (for diagnostics). */
  assets: number | null;
  pasiva: number | null;
}

export interface BalanceSheetSides {
  totalAssets: number | null;
  equity: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
}

export function checkBalanceSheet(stmt: BalanceSheetSides): BalanceCheckResult {
  const { totalAssets, equity, shortTermLiabilities, longTermLiabilities } = stmt;

  if (totalAssets === null || totalAssets <= 0 || equity === null) {
    return { status: "insufficient", diffPct: null, assets: totalAssets, pasiva: null };
  }
  if (shortTermLiabilities === null && longTermLiabilities === null) {
    return { status: "insufficient", diffPct: null, assets: totalAssets, pasiva: null };
  }

  const pasiva = equity + (shortTermLiabilities ?? 0) + (longTermLiabilities ?? 0);
  const diffPct = Math.abs(totalAssets - pasiva) / totalAssets;

  return {
    status: diffPct <= 0.05 ? "balanced" : "unbalanced",
    diffPct,
    assets: totalAssets,
    pasiva,
  };
}

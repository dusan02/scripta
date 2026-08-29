/**
 * Piotroski F-Score — 9 binárnych kritérií z účtovnej závierky.
 *
 * Každé kritérium hodnotí 1 (splnené) alebo 0 (nesplnené).
 * Skóre 0–9: vyššie = lepšie. Piotroski považuje skóre ≥7 za silné,
 * ≤3 za slabé.
 *
 * Vyžaduje aspoň 2 roky dát (aktuálny + predchádzajúci).
 *
 * Metodika prispôsobená pre SK GAAP:
 * - ROA: netProfitLoss / totalAssets
 * - CFO: operatingCashFlow > 0
 * - ΔROA: ROA aktuálne > ROA predchádzajúce
 * - Accrual: CFO > netProfitLoss (kvalita zisku)
 * - ΔLiquidity: currentRatio aktuálne > predchádzajúce
 * - ΔDebt: debt ratio (longTermLiabilities / totalAssets) aktuálne ≤ predchádzajúce
 * - ΔShares: shareCapital aktuálne ≤ predchádzajúce (žiadne riedenie)
 * - ΔMargin: grossMargin (grossProfit / mainActivityRevenue) aktuálne > predchádzajúce
 * - ΔAssetTurnover: mainActivityRevenue / totalAssets aktuálne > predchádzajúce
 */

import { toNum, safeDiv } from "@/lib/financial-indicators";

export type PiotroskiCriterion = {
  key: string;
  label: string;
  passed: boolean | null; // null = nedá sa vypočítať
};

export type PiotroskiResult = {
  score: number;
  maxScore: number;
  criteria: PiotroskiCriterion[];
  year: number;
  prevYear: number | null;
};

type StatementLike = {
  year: number;
  netProfitLoss?: unknown;
  totalAssets?: unknown;
  operatingCashFlow?: unknown;
  currentAssets?: unknown;
  shortTermLiabilities?: unknown;
  longTermLiabilities?: unknown;
  shareCapital?: unknown;
  grossProfit?: unknown;
  mainActivityRevenue?: unknown;
};

function roa(s: StatementLike): number | null {
  return safeDiv(toNum(s.netProfitLoss), toNum(s.totalAssets));
}

function grossMargin(s: StatementLike): number | null {
  return safeDiv(toNum(s.grossProfit), toNum(s.mainActivityRevenue));
}

function currentRatio(s: StatementLike): number | null {
  return safeDiv(toNum(s.currentAssets), toNum(s.shortTermLiabilities));
}

function debtRatio(s: StatementLike): number | null {
  const ltl = toNum(s.longTermLiabilities);
  const ta = toNum(s.totalAssets);
  if (ta == null || ta === 0) return null;
  return (ltl ?? 0) / ta;
}

function assetTurnover(s: StatementLike): number | null {
  return safeDiv(toNum(s.mainActivityRevenue), toNum(s.totalAssets));
}

export function computePiotroski(stmts: StatementLike[]): PiotroskiResult | null {
  if (stmts.length < 2) return null;

  const sorted = [...stmts].sort((a, b) => a.year - b.year);
  const curr = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];

  const criteria: PiotroskiCriterion[] = [];

  // 1. Profitability: ROA > 0
  const currRoa = roa(curr);
  criteria.push({
    key: "roa_positive",
    label: "ROA kladné (ziskovosť aktív)",
    passed: currRoa != null ? currRoa > 0 : null,
  });

  // 2. CFO: operatingCashFlow > 0
  const currCfo = toNum(curr.operatingCashFlow);
  criteria.push({
    key: "cfo_positive",
    label: "Prevádzkový cash flow kladný",
    passed: currCfo != null ? currCfo > 0 : null,
  });

  // 3. ΔROA: current ROA > previous ROA
  const prevRoa = roa(prev);
  criteria.push({
    key: "roa_improving",
    label: "ROA sa zlepšuje oproti minulému roku",
    passed: currRoa != null && prevRoa != null ? currRoa > prevRoa : null,
  });

  // 4. Accrual: CFO > netProfit (kvalita zisku)
  const currNp = toNum(curr.netProfitLoss);
  criteria.push({
    key: "accrual_quality",
    label: "Cash flow prevyšuje účtovný zisk (kvalita zisku)",
    passed: currCfo != null && currNp != null ? currCfo > currNp : null,
  });

  // 5. ΔLiquidity: current ratio improving
  const currRatio = currentRatio(curr);
  const prevRatio = currentRatio(prev);
  criteria.push({
    key: "liquidity_improving",
    label: "Bežná likvidita sa zlepšuje",
    passed: currRatio != null && prevRatio != null ? currRatio > prevRatio : null,
  });

  // 6. ΔDebt: debt ratio stable or improving (≤)
  const currDebt = debtRatio(curr);
  const prevDebt = debtRatio(prev);
  criteria.push({
    key: "debt_stable",
    label: "Zadlženosť nestúpla",
    passed: currDebt != null && prevDebt != null ? currDebt <= prevDebt : null,
  });

  // 7. ΔShares: shareCapital not increased (no dilution)
  const currSc = toNum(curr.shareCapital);
  const prevSc = toNum(prev.shareCapital);
  criteria.push({
    key: "no_dilution",
    label: "Základné imanie nezvýšené (žiadne riedenie)",
    passed: currSc != null && prevSc != null ? currSc <= prevSc : null,
  });

  // 8. ΔMargin: gross margin improving
  const currMargin = grossMargin(curr);
  const prevMargin = grossMargin(prev);
  criteria.push({
    key: "margin_improving",
    label: "Hrubá marža sa zlepšuje",
    passed: currMargin != null && prevMargin != null ? currMargin > prevMargin : null,
  });

  // 9. ΔAssetTurnover: improving
  const currTurn = assetTurnover(curr);
  const prevTurn = assetTurnover(prev);
  criteria.push({
    key: "turnover_improving",
    label: "Obrat aktív sa zlepšuje",
    passed: currTurn != null && prevTurn != null ? currTurn > prevTurn : null,
  });

  const validCriteria = criteria.filter(c => c.passed !== null);
  const score = criteria.filter(c => c.passed === true).length;
  const maxScore = validCriteria.length;

  return {
    score,
    maxScore,
    criteria,
    year: curr.year,
    prevYear: prev.year,
  };
}

/**
 * Company Signals — deterministic, LLM-free risk/positive/diagnostic indicators.
 *
 * V1 Contract (approved Architect → Reviewer):
 *   - 16 signals (11 risk, 2 diagnostic, 3 positive)
 *   - Severity bands (🟢/🟡/🟠/🔴) — no cliff effect
 *   - Minimum history per signal — null ≠ false
 *   - Reuses financial-indicators.ts (safeDiv, toNum) — no duplicate ROE/ROA/debt
 *   - Vestník events via explicit string mapping (not contains())
 *   - i18n keys (signals.*) — no hardcoded Slovak text
 *   - No caching for V1 (~10ms computation)
 *   - No NACE-relative benchmarks (V2)
 *   - No LLM, no Verifa Score, no AI teaser
 *
 * Signal → Question → Analysis → Paid report (curiosity gap funnel)
 *
 * IMPORTANT: Signals must NOT make legal/financial conclusions.
 *   - NEGATIVE_EQUITY → "Liabilities exceed reported equity" (fact)
 *   - NOT → "Firma je insolventná" (legal conclusion)
 */

import { toNum, safeDiv, computeFinancialIndicators, type FinancialIndicatorRow } from "./financial-indicators";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type SignalSeverity = "green" | "yellow" | "orange" | "red";

export type SignalCategory = "risk" | "positive" | "diagnostic";

export type SignalId =
  // Risk — financial (8)
  | "NEGATIVE_CF_DESPITE_PROFIT"
  | "LOW_CF_QUALITY"
  | "HIGH_LEVERAGE"
  | "INVENTORY_CONCENTRATION"
  | "LIABILITIES_SURGE"
  | "REVENUE_DECLINE"
  | "NEGATIVE_EQUITY"
  | "NEGATIVE_CF_STREAK"
  // Risk — Vestník (3)
  | "VESTNIK_KONKURZ"
  | "VESTNIK_LIKVIDACIA"
  | "VESTNIK_EXECUTION"
  // Diagnostic (2)
  | "HIGH_ROE_DIAGNOSTIC"
  | "VESTNIK_DISSOLUTION"
  // Positive (3)
  | "REVENUE_GROWTH_STREAK"
  | "EQUITY_GROWTH_STREAK"
  | "PROFITABLE_STREAK";

export type Signal = {
  id: SignalId;
  severity: SignalSeverity;
  category: SignalCategory;
  /** i18n key root: `signals.{id}.title`, `signals.{id}.description` */
  i18nKey: string;
  /** Year the signal was detected (latest applicable year), or null for Vestník */
  year: number | null;
  /** Optional metric value that triggered the signal (for debugging/auditing) */
  metricValue: number | null;
};

export type DataAvailability = "HAS_FINANCIAL_DATA" | "NO_FINANCIAL_DATA";

export type CompanySignalsResult = {
  signals: Signal[];
  availability: DataAvailability;
  /** Count by severity — convenience for UI */
  counts: {
    red: number;
    orange: number;
    yellow: number;
    green: number;
  };
};

// ═══════════════════════════════════════════════════════════════
// Threshold configuration — single source of truth
// Change a number here → logic unchanged. Audit after 1-2K firms.
// ═══════════════════════════════════════════════════════════════

export const THRESHOLDS = {
  // Debt / Assets (Zadlženosť)
  highLeverage: {
    yellow: 0.60,   // 60%
    orange: 0.70,   // 70%
    red: 0.85,      // 85%
  },
  // Inventory / Current Assets
  inventoryConcentration: {
    yellow: 0.50,
    orange: 0.60,
    red: 0.70,
  },
  // Liabilities YoY growth
  liabilitiesSurge: {
    yellow: 0.30,   // 30%
    orange: 0.60,   // 60%
    red: 1.00,      // 100%
  },
  // Revenue YoY decline (negative growth)
  revenueDecline: {
    yellow: 0.00,   // 0% (any decline)
    orange: -0.10,  // -10%
    red: -0.30,     // -30%
  },
  // ROE — diagnostic, not risk
  highRoe: {
    yellow: 0.50,   // 50%
    orange: 1.00,   // 100%
  },
  // CF quality: operatingCF / netProfit (only when both > 0)
  lowCfQuality: 0.30,  // CF < 30% of profit → 🟠
} as const;

// ═══════════════════════════════════════════════════════════════
// Minimum history per signal (in years of financial statements)
// If not enough data → signal is NOT created (null ≠ false)
// ═══════════════════════════════════════════════════════════════

export const MIN_HISTORY: Record<SignalId, number> = {
  NEGATIVE_CF_DESPITE_PROFIT: 1,
  LOW_CF_QUALITY: 1,
  HIGH_LEVERAGE: 1,
  INVENTORY_CONCENTRATION: 1,
  LIABILITIES_SURGE: 2,
  REVENUE_DECLINE: 2,
  NEGATIVE_EQUITY: 1,
  NEGATIVE_CF_STREAK: 3,
  VESTNIK_KONKURZ: 0,
  VESTNIK_LIKVIDACIA: 0,
  VESTNIK_EXECUTION: 0,
  HIGH_ROE_DIAGNOSTIC: 1,
  VESTNIK_DISSOLUTION: 0,
  REVENUE_GROWTH_STREAK: 3,
  EQUITY_GROWTH_STREAK: 2,
  PROFITABLE_STREAK: 2,
};

// ═══════════════════════════════════════════════════════════════
// Vestník event type mapping — explicit, not contains()
// Source: SELECT DISTINCT eventType FROM "VestnikEvent" (production)
// ═══════════════════════════════════════════════════════════════

const VESTNIK_EVENT_MAP: Record<string, { id: SignalId; severity: SignalSeverity }> = {
  "Konkurz / Reštrukturalizácia": { id: "VESTNIK_KONKURZ", severity: "red" },
  "Likvidácia": { id: "VESTNIK_LIKVIDACIA", severity: "orange" },
  "Exekúcia": { id: "VESTNIK_EXECUTION", severity: "orange" },
  "Zrušenie / Vymazanie": { id: "VESTNIK_DISSOLUTION", severity: "yellow" },
};

// ═══════════════════════════════════════════════════════════════
// Input types — reuse FinancialStatement fields, no new DB queries
// ═══════════════════════════════════════════════════════════════

type StatementLike = {
  year: number;
  totalAssets?: unknown;
  currentAssets?: unknown;
  equity?: unknown;
  shortTermLiabilities?: unknown;
  longTermLiabilities?: unknown;
  mainActivityRevenue?: unknown;
  netProfitLoss?: unknown;
  operatingCashFlow?: unknown;
  inventory?: unknown;
};

type VestnikEventLike = {
  eventType: string;
  publishedAt?: Date | null;
};

export type CompanySignalsInput = {
  financialStatements: StatementLike[];
  vestnikEvents: VestnikEventLike[];
};

// ═══════════════════════════════════════════════════════════════
// Helper: severity band lookup
// ═══════════════════════════════════════════════════════════════

function bandForValue(
  value: number,
  thresholds: { yellow: number; orange: number; red: number },
): SignalSeverity | null {
  // Thresholds are ascending: yellow < orange < red
  if (value >= thresholds.red) return "red";
  if (value >= thresholds.orange) return "orange";
  if (value >= thresholds.yellow) return "yellow";
  return null;
}

function bandForDecline(
  value: number,
  thresholds: { yellow: number; orange: number; red: number },
): SignalSeverity | null {
  // For decline, thresholds are descending: yellow(0) > orange(-0.10) > red(-0.30)
  // Yellow uses strict < (0% growth = no decline, not yellow)
  if (value <= thresholds.red) return "red";
  if (value <= thresholds.orange) return "orange";
  if (value < thresholds.yellow) return "yellow";
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Signal detectors — pure functions, testable in isolation
// ═══════════════════════════════════════════════════════════════

type NormalizedStatement = {
  year: number;
  totalAssets: number | null;
  currentAssets: number | null;
  equity: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
  mainActivityRevenue: number | null;
  netProfitLoss: number | null;
  operatingCashFlow: number | null;
  inventory: number | null;
};

function normalizeStatements(stmts: StatementLike[]): NormalizedStatement[] {
  return [...stmts]
    .sort((a, b) => a.year - b.year)
    .map((s) => ({
      year: s.year,
      totalAssets: toNum(s.totalAssets),
      currentAssets: toNum(s.currentAssets),
      equity: toNum(s.equity),
      shortTermLiabilities: toNum(s.shortTermLiabilities),
      longTermLiabilities: toNum(s.longTermLiabilities),
      mainActivityRevenue: toNum(s.mainActivityRevenue),
      netProfitLoss: toNum(s.netProfitLoss),
      operatingCashFlow: toNum(s.operatingCashFlow),
      inventory: toNum(s.inventory),
    }));
}

// ── Helper: take N consecutive years from the end (no gaps) ─────
// Returns null if there aren't N statements with year[i] - year[i-1] === 1
function takeConsecutive(stmts: NormalizedStatement[], n: number): NormalizedStatement[] | null {
  if (stmts.length < n) return null;
  const candidate = stmts.slice(-n);
  for (let i = 1; i < candidate.length; i++) {
    if (candidate[i].year - candidate[i - 1].year !== 1) return null;
  }
  return candidate;
}

// ── Risk detectors ──────────────────────────────────────────────

function detectNegativeCfDespiteProfit(stmts: NormalizedStatement[]): Signal[] {
  // netProfit > 0 AND operatingCF < 0 → 🔴
  return stmts
    .filter((s) => s.netProfitLoss != null && s.netProfitLoss > 0 && s.operatingCashFlow != null && s.operatingCashFlow < 0)
    .map((s) => ({
      id: "NEGATIVE_CF_DESPITE_PROFIT" as const,
      severity: "red" as const,
      category: "risk" as const,
      i18nKey: "signals.negativeCfDespiteProfit",
      year: s.year,
      metricValue: s.operatingCashFlow,
    }));
}

function detectLowCfQuality(stmts: NormalizedStatement[]): Signal[] {
  // netProfit > 0 AND operatingCF > 0 AND operatingCF < netProfit * 0.3 → 🟠
  const threshold = THRESHOLDS.lowCfQuality;
  return stmts
    .filter(
      (s) =>
        s.netProfitLoss != null && s.netProfitLoss > 0 &&
        s.operatingCashFlow != null && s.operatingCashFlow > 0 &&
        s.operatingCashFlow < s.netProfitLoss * threshold,
    )
    .map((s) => ({
      id: "LOW_CF_QUALITY" as const,
      severity: "orange" as const,
      category: "risk" as const,
      i18nKey: "signals.lowCfQuality",
      year: s.year,
      metricValue: safeDiv(s.operatingCashFlow, s.netProfitLoss),
    }));
}

function detectHighLeverage(stmts: NormalizedStatement[]): Signal[] {
  // debt / totalAssets — uses safeDiv (null if assets=0)
  return stmts
    .map((s): Signal | null => {
      const stl = s.shortTermLiabilities;
      const ltl = s.longTermLiabilities;
      const ta = s.totalAssets;
      if (ta == null || ta === 0) return null;
      // At least one liability source must be present
      if (stl == null && ltl == null) return null;
      const debt = safeDiv((stl ?? 0) + (ltl ?? 0), ta);
      if (debt == null) return null;
      const severity = bandForValue(debt, THRESHOLDS.highLeverage);
      if (!severity) return null;
      return {
        id: "HIGH_LEVERAGE",
        severity,
        category: "risk",
        i18nKey: "signals.highLeverage",
        year: s.year,
        metricValue: debt,
      };
    })
    .filter((s): s is Signal => s !== null);
}

function detectInventoryConcentration(stmts: NormalizedStatement[]): Signal[] {
  // inventory / currentAssets
  return stmts
    .map((s): Signal | null => {
      const ratio = safeDiv(s.inventory, s.currentAssets);
      if (ratio == null) return null;
      const severity = bandForValue(ratio, THRESHOLDS.inventoryConcentration);
      if (!severity) return null;
      return {
        id: "INVENTORY_CONCENTRATION",
        severity,
        category: "risk",
        i18nKey: "signals.inventoryConcentration",
        year: s.year,
        metricValue: ratio,
      };
    })
    .filter((s): s is Signal => s !== null);
}

function detectLiabilitiesSurge(stmts: NormalizedStatement[]): Signal[] {
  // YoY growth of (shortTermLiabilities + longTermLiabilities) — min 2 years
  if (stmts.length < 2) return [];
  const signals: Signal[] = [];
  for (let i = 1; i < stmts.length; i++) {
    const prev = stmts[i - 1];
    const curr = stmts[i];
    const prevDebt = (prev.shortTermLiabilities ?? 0) + (prev.longTermLiabilities ?? 0);
    const currDebt = (curr.shortTermLiabilities ?? 0) + (curr.longTermLiabilities ?? 0);
    // Need both years to have at least one liability source
    if (prev.shortTermLiabilities == null && prev.longTermLiabilities == null) continue;
    if (curr.shortTermLiabilities == null && curr.longTermLiabilities == null) continue;
    if (prevDebt === 0) continue; // can't compute growth from 0
    const growth = (currDebt - prevDebt) / prevDebt;
    const severity = bandForValue(growth, THRESHOLDS.liabilitiesSurge);
    if (!severity) continue;
    signals.push({
      id: "LIABILITIES_SURGE",
      severity,
      category: "risk",
      i18nKey: "signals.liabilitiesSurge",
      year: curr.year,
      metricValue: growth,
    });
  }
  return signals;
}

function detectRevenueDecline(stmts: NormalizedStatement[]): Signal[] {
  // YoY revenue growth — min 2 years
  if (stmts.length < 2) return [];
  const signals: Signal[] = [];
  for (let i = 1; i < stmts.length; i++) {
    const prev = stmts[i - 1];
    const curr = stmts[i];
    if (prev.mainActivityRevenue == null || prev.mainActivityRevenue === 0) continue;
    if (curr.mainActivityRevenue == null) continue;
    const growth = (curr.mainActivityRevenue - prev.mainActivityRevenue) / prev.mainActivityRevenue;
    const severity = bandForDecline(growth, THRESHOLDS.revenueDecline);
    if (!severity) continue;
    signals.push({
      id: "REVENUE_DECLINE",
      severity,
      category: "risk",
      i18nKey: "signals.revenueDecline",
      year: curr.year,
      metricValue: growth,
    });
  }
  return signals;
}

function detectNegativeEquity(stmts: NormalizedStatement[]): Signal[] {
  // equity < 0 → 🔴
  return stmts
    .filter((s) => s.equity != null && s.equity < 0)
    .map((s) => ({
      id: "NEGATIVE_EQUITY" as const,
      severity: "red" as const,
      category: "risk" as const,
      i18nKey: "signals.negativeEquity",
      year: s.year,
      metricValue: s.equity,
    }));
}

function detectNegativeCfStreak(stmts: NormalizedStatement[]): Signal[] {
  // operatingCF < 0 for 3 consecutive years → 🔴
  // "Consecutive" means year[i] - year[i-1] === 1 (no gaps)
  const latest3 = takeConsecutive(stmts, 3);
  if (!latest3) return [];
  const allNegative = latest3.every((s) => s.operatingCashFlow != null && s.operatingCashFlow < 0);
  if (!allNegative) return [];
  return [{
    id: "NEGATIVE_CF_STREAK",
    severity: "red",
    category: "risk",
    i18nKey: "signals.negativeCfStreak",
    year: latest3[2].year,
    metricValue: latest3[2].operatingCashFlow,
  }];
}

// ── Vestník detectors ───────────────────────────────────────────

function detectVestnikSignals(events: VestnikEventLike[]): Signal[] {
  const signals: Signal[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const mapping = VESTNIK_EVENT_MAP[e.eventType];
    if (!mapping) continue;
    // Deduplicate by signal id — one signal per event type
    if (seen.has(mapping.id)) continue;
    seen.add(mapping.id);
    signals.push({
      id: mapping.id,
      severity: mapping.severity,
      category: mapping.id === "VESTNIK_DISSOLUTION" ? "diagnostic" : "risk",
      i18nKey: `signals.${mapping.id.toLowerCase().replace(/_(.)/g, (_, c) => c.toUpperCase())}`,
      year: e.publishedAt ? new Date(e.publishedAt).getFullYear() : null,
      metricValue: null,
    });
  }
  return signals;
}

// ── Diagnostic detectors ────────────────────────────────────────

function detectHighRoeDiagnostic(indicators: FinancialIndicatorRow[]): Signal[] {
  // ROE > 100% → 🟠 diagnostic, > 50% → 🟡 diagnostic
  return indicators
    .map((row): Signal | null => {
      if (row.roe == null) return null;
      if (row.roe >= THRESHOLDS.highRoe.orange) {
        return {
          id: "HIGH_ROE_DIAGNOSTIC",
          severity: "orange",
          category: "diagnostic",
          i18nKey: "signals.highRoeDiagnostic",
          year: row.year,
          metricValue: row.roe,
        };
      }
      if (row.roe >= THRESHOLDS.highRoe.yellow) {
        return {
          id: "HIGH_ROE_DIAGNOSTIC",
          severity: "yellow",
          category: "diagnostic",
          i18nKey: "signals.highRoeDiagnostic",
          year: row.year,
          metricValue: row.roe,
        };
      }
      return null;
    })
    .filter((s): s is Signal => s !== null);
}

// ── Positive detectors ──────────────────────────────────────────

function detectRevenueGrowthStreak(stmts: NormalizedStatement[]): Signal[] {
  // Revenue YoY > 0% for 3 consecutive years → 🟢
  // "Consecutive" means year[i] - year[i-1] === 1 (no gaps)
  const latest3 = takeConsecutive(stmts, 3);
  if (!latest3) return [];
  // Need all 3 years to have revenue
  if (latest3.some((s) => s.mainActivityRevenue == null)) return [];
  // Check 2 YoY growth periods (year 2 vs 1, year 3 vs 2)
  const growth1 = latest3[1].mainActivityRevenue! > latest3[0].mainActivityRevenue!;
  const growth2 = latest3[2].mainActivityRevenue! > latest3[1].mainActivityRevenue!;
  if (!growth1 || !growth2) return [];
  return [{
    id: "REVENUE_GROWTH_STREAK",
    severity: "green",
    category: "positive",
    i18nKey: "signals.revenueGrowthStreak",
    year: latest3[2].year,
    metricValue: null,
  }];
}

function detectEquityGrowthStreak(stmts: NormalizedStatement[]): Signal[] {
  // Equity YoY > 0 for 2+ consecutive years → 🟢
  // "Consecutive" means year[i] - year[i-1] === 1 (no gaps)
  const latest2 = takeConsecutive(stmts, 2);
  if (!latest2) return [];
  if (latest2.some((s) => s.equity == null)) return [];
  if (latest2[1].equity! <= latest2[0].equity!) return [];
  return [{
    id: "EQUITY_GROWTH_STREAK",
    severity: "green",
    category: "positive",
    i18nKey: "signals.equityGrowthStreak",
    year: latest2[1].year,
    metricValue: null,
  }];
}

function detectProfitableStreak(stmts: NormalizedStatement[]): Signal[] {
  // netProfit > 0 for 2+ consecutive years → 🟢
  // "Consecutive" means year[i] - year[i-1] === 1 (no gaps)
  const latest2 = takeConsecutive(stmts, 2);
  if (!latest2) return [];
  if (latest2.some((s) => s.netProfitLoss == null)) return [];
  if (latest2.some((s) => s.netProfitLoss! <= 0)) return [];
  return [{
    id: "PROFITABLE_STREAK",
    severity: "green",
    category: "positive",
    i18nKey: "signals.profitableStreak",
    year: latest2[1].year,
    metricValue: null,
  }];
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

/**
 * Compute deterministic company signals from financial statements + Vestník events.
 *
 * Reuses financial-indicators.ts for ROE/ROA/debt/margin calculations.
 * No LLM, no NACE benchmarks, no caching.
 *
 * @returns signals sorted by severity (red first, then orange, yellow, green)
 *          and counts for UI convenience.
 */
export function computeCompanySignals(input: CompanySignalsInput): CompanySignalsResult {
  const stmts = normalizeStatements(input.financialStatements);
  const indicators = computeFinancialIndicators(input.financialStatements);

  const availability: DataAvailability =
    stmts.length > 0 ? "HAS_FINANCIAL_DATA" : "NO_FINANCIAL_DATA";

  // Run all detectors
  const allSignals: Signal[] = [
    ...detectNegativeCfDespiteProfit(stmts),
    ...detectLowCfQuality(stmts),
    ...detectHighLeverage(stmts),
    ...detectInventoryConcentration(stmts),
    ...detectLiabilitiesSurge(stmts),
    ...detectRevenueDecline(stmts),
    ...detectNegativeEquity(stmts),
    ...detectNegativeCfStreak(stmts),
    ...detectVestnikSignals(input.vestnikEvents),
    ...detectHighRoeDiagnostic(indicators),
    ...detectRevenueGrowthStreak(stmts),
    ...detectEquityGrowthStreak(stmts),
    ...detectProfitableStreak(stmts),
  ];

  // Deduplicate: keep only the most severe signal per SignalId
  // (e.g., HIGH_LEVERAGE may trigger for multiple years — keep the worst)
  const severityOrder: Record<SignalSeverity, number> = { red: 0, orange: 1, yellow: 2, green: 3 };
  const byId = new Map<SignalId, Signal>();
  for (const sig of allSignals) {
    const existing = byId.get(sig.id);
    if (!existing || severityOrder[sig.severity] < severityOrder[existing.severity]) {
      byId.set(sig.id, sig);
    }
  }

  const signals = Array.from(byId.values()).sort((a, b) => {
    // Sort by severity (red first), then by category (risk first)
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const catOrder: Record<SignalCategory, number> = { risk: 0, diagnostic: 1, positive: 2 };
    return catOrder[a.category] - catOrder[b.category];
  });

  const counts = {
    red: signals.filter((s) => s.severity === "red").length,
    orange: signals.filter((s) => s.severity === "orange").length,
    yellow: signals.filter((s) => s.severity === "yellow").length,
    green: signals.filter((s) => s.severity === "green").length,
  };

  return { signals, availability, counts };
}

import { translate, type Lang } from "@/lib/i18n";
import { num } from "@/lib/format";
import { calcTrend } from "@/lib/trend";
import type { Decimal } from "@prisma/client/runtime/library";

type NumLike = Decimal | number | string | null | undefined;

export type SummaryStatement = {
  year: number;
  mainActivityRevenue?: NumLike;
  netProfitLoss?: NumLike;
};

/**
 * Generate a 1–2 sentence financial summary narrative for a company page.
 * Fully i18n'd via `lang` — previously hardcoded Slovak even on EN/DE/CZ/HU/PL pages.
 */
export function generateFinancialSummary(
  name: string,
  latest: SummaryStatement | null | undefined,
  prev: SummaryStatement | null | undefined,
  lang: Lang
): string | null {
  if (!latest) return null;
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);
  const parts: string[] = [];

  // Revenue trend
  const revTrend = calcTrend(num(latest.mainActivityRevenue), num(prev?.mainActivityRevenue));
  if (revTrend?.direction === "up") {
    parts.push(t("firma.summaryRevUp", { name, pct: revTrend.pct.toFixed(0) }));
  } else if (revTrend?.direction === "down") {
    parts.push(t("firma.summaryRevDown", { name, pct: Math.abs(revTrend.pct).toFixed(0) }));
  } else if (revTrend?.direction === "flat") {
    parts.push(t("firma.summaryRevFlat", { name }));
  }

  // Profit trend
  const profTrend = calcTrend(num(latest.netProfitLoss), num(prev?.netProfitLoss));
  if (profTrend?.direction === "up") {
    parts.push(t("firma.summaryProfitUp", { pct: profTrend.pct.toFixed(0) }));
  } else if (profTrend?.direction === "down") {
    parts.push(t("firma.summaryProfitDown", { pct: Math.abs(profTrend.pct).toFixed(0) }));
  }

  // Margin
  const rev = num(latest.mainActivityRevenue);
  const profit = num(latest.netProfitLoss);
  if (rev != null && rev !== 0 && profit != null) {
    const margin = (profit / rev * 100).toFixed(1);
    parts.push(t("firma.summaryMargin", { margin }));
  }

  if (parts.length === 0) return null;
  return parts.join(", ") + ".";
}

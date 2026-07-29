import { fmtEUR } from "@/lib/format";

type Stmt = {
  year: number;
  mainActivityRevenue: number | null;
  netProfitLoss: number | null;
  totalAssets: number | null;
  equity: number | null;
  grossProfit: number | null;
  staffCosts: number | null;
  depreciation: number | null;
  incomeTax: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
  currentAssets: number | null;
  cashAndEquivalents: number | null;
};

export type Insight = {
  category: "positive" | "negative" | "neutral" | "warning";
  text: string;
};

function pctChange(curr: number, prev: number): number {
  if (prev === 0) return 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function absFmt(val: number | null | undefined): string {
  if (val == null) return "—";
  return fmtEUR(val);
}

/**
 * Generuje faktické insight vety z finančných dát.
 * Žiadne halucinácie — všetko je čisto aritmetika z DB.
 */
export function generateCompanyInsights(
  stmts: Stmt[],
  opts?: {
    orsrFindings?: string | null;
    forensicRedFlags?: string[] | null;
    vestnikEvents?: Array<{ title?: string | null; publishedAt?: Date | null }> | null;
  }
): Insight[] {
  if (stmts.length === 0) return [];

  const insights: Insight[] = [];
  const sorted = [...stmts].sort((a, b) => a.year - b.year);
  const latest = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  // ── Tržby trend ──
  if (prev && latest.mainActivityRevenue != null && prev.mainActivityRevenue != null) {
    const revPct = pctChange(latest.mainActivityRevenue, prev.mainActivityRevenue);
    if (Math.abs(revPct) >= 1) {
      const dir = revPct > 0 ? "stúpli" : "klesli";
      insights.push({
        category: revPct > 0 ? "positive" : "negative",
        text: `Tržby ${dir} o ${Math.abs(revPct).toFixed(1)} % z ${absFmt(prev.mainActivityRevenue)} na ${absFmt(latest.mainActivityRevenue)} medzi rokmi ${prev.year} a ${latest.year}.`,
      });
    }
  }

  // ── Zisk trend ──
  if (prev && latest.netProfitLoss != null && prev.netProfitLoss != null) {
    const profitPct = pctChange(latest.netProfitLoss, prev.netProfitLoss);
    if (Math.abs(profitPct) >= 1) {
      const dir = profitPct > 0 ? "stúpol" : "klesol";
      insights.push({
        category: profitPct > 0 ? "positive" : "negative",
        text: `Zisk ${dir} o ${Math.abs(profitPct).toFixed(1)} % z ${absFmt(prev.netProfitLoss)} na ${absFmt(latest.netProfitLoss)}.`,
      });
    }
  }

  // ── Tržby stúpajú, zisk klesá (margin squeeze) ──
  if (prev &&
    latest.mainActivityRevenue != null && prev.mainActivityRevenue != null &&
    latest.netProfitLoss != null && prev.netProfitLoss != null
  ) {
    const revUp = latest.mainActivityRevenue > prev.mainActivityRevenue;
    const profitDown = latest.netProfitLoss < prev.netProfitLoss;
    if (revUp && profitDown) {
      insights.push({
        category: "warning",
        text: `Napriek rastu tržieb zisk klesol — môže ísť o tlak na marže alebo rastúce náklady.`,
      });
    }
  }

  // ── Profit margin ──
  if (latest.mainActivityRevenue != null && latest.mainActivityRevenue > 0 && latest.netProfitLoss != null) {
    const margin = (latest.netProfitLoss / latest.mainActivityRevenue) * 100;
    if (margin < 0) {
      insights.push({
        category: "negative",
        text: `Firma vykázala stratu ${absFmt(latest.netProfitLoss)} pri tržbách ${absFmt(latest.mainActivityRevenue)} (marža ${margin.toFixed(1)} %).`,
      });
    } else if (margin > 15) {
      insights.push({
        category: "positive",
        text: `Zisková marža ${margin.toFixed(1)} % je nad priemerom priemyslu.`,
      });
    }
  }

  // ── Aktíva trend ──
  if (prev && latest.totalAssets != null && prev.totalAssets != null) {
    const assetsPct = pctChange(latest.totalAssets, prev.totalAssets);
    if (Math.abs(assetsPct) >= 5) {
      const dir = assetsPct > 0 ? "stúpli" : "klesli";
      insights.push({
        category: assetsPct > 0 ? "neutral" : "warning",
        text: `Celkové aktíva ${dir} o ${Math.abs(assetsPct).toFixed(1)} % na ${absFmt(latest.totalAssets)}.`,
      });
    }
  }

  // ── Zamestnanecké náklady vs tržby ──
  if (latest.staffCosts != null && latest.mainActivityRevenue != null && latest.mainActivityRevenue > 0) {
    const staffRatio = (latest.staffCosts / latest.mainActivityRevenue) * 100;
    if (staffRatio > 40) {
      insights.push({
        category: "warning",
        text: `Osobné náklady tvoria ${staffRatio.toFixed(1)} % tržieb (${absFmt(latest.staffCosts)}), čo je vysoký podiel.`,
      });
    }
  }

  // ── Likvidita (krátkodobé záväzky vs obežný majetok) ──
  if (latest.currentAssets != null && latest.shortTermLiabilities != null && latest.shortTermLiabilities > 0) {
    const liquidity = latest.currentAssets / latest.shortTermLiabilities;
    if (liquidity < 1) {
      insights.push({
        category: "negative",
        text: `Krátkodobá likvidita (${liquidity.toFixed(2)}) je pod 1.0 — firma môže mať problém splácať krátkodobé záväzky.`,
      });
    } else if (liquidity > 3) {
      insights.push({
        category: "neutral",
        text: `Krátkodobá likvidita (${liquidity.toFixed(2)}) je vysoká — firma drží nadmerné zásoby obežného majetku.`,
      });
    }
  }

  // ── Zadlženosť (záväzky / aktíva) ──
  if (latest.totalAssets != null && latest.totalAssets > 0 &&
      latest.shortTermLiabilities != null && latest.longTermLiabilities != null) {
    const totalLiab = latest.shortTermLiabilities + latest.longTermLiabilities;
    const debtRatio = (totalLiab / latest.totalAssets) * 100;
    if (debtRatio > 70) {
      insights.push({
        category: "warning",
        text: `Zadlženosť firmy (${debtRatio.toFixed(1)} % aktív) je vysoká — riziko finančnej nestability.`,
      });
    }
  }

  // ── Vlastné imanie trend ──
  if (prev && latest.equity != null && prev.equity != null) {
    const eqPct = pctChange(latest.equity, prev.equity);
    if (Math.abs(eqPct) >= 5) {
      const dir = eqPct > 0 ? "stúplo" : "kleslo";
      insights.push({
        category: eqPct > 0 ? "positive" : "negative",
        text: `Vlastné imanie ${dir} o ${Math.abs(eqPct).toFixed(1)} % na ${absFmt(latest.equity)}.`,
      });
    }
  }

  // ── Negatívne vlastné imanie ──
  if (latest.equity != null && latest.equity < 0) {
    insights.push({
      category: "negative",
      text: `Firma má negatívne vlastné imanie (${absFmt(latest.equity)}) — prevádzkové straty prekročili kapitálové rezervy.`,
    });
  }

  // ── Daň z príjmu ──
  if (latest.incomeTax != null && latest.incomeTax > 0 && latest.netProfitLoss != null && latest.netProfitLoss > 0) {
    const effectiveTaxRate = (latest.incomeTax / latest.netProfitLoss) * 100;
    insights.push({
      category: "neutral",
      text: `Efektívna daňová sadzba ${effectiveTaxRate.toFixed(1)} % (daň ${absFmt(latest.incomeTax)} zo zisku ${absFmt(latest.netProfitLoss)}).`,
    });
  }

  // ── 3-ročný trend tržieb ──
  if (sorted.length >= 3) {
    const y3 = sorted[sorted.length - 1];
    const y1 = sorted[sorted.length - 3];
    if (y3.mainActivityRevenue != null && y1.mainActivityRevenue != null && y1.mainActivityRevenue > 0) {
      const cagr = (Math.pow(y3.mainActivityRevenue / y1.mainActivityRevenue, 1 / 2) - 1) * 100;
      if (Math.abs(cagr) >= 2) {
        const dir = cagr > 0 ? "rast" : "pokles";
        insights.push({
          category: cagr > 0 ? "positive" : "negative",
          text: `Tržby vykazujú ${dir} s priemerným ročným tempom ${Math.abs(cagr).toFixed(1)} % za posledné ${sorted.length >= 3 ? "3" : "2"} roky.`,
        });
      }
    }
  }

  // ── ORSR findings (likvidácia, vymazaná) ──
  if (opts?.orsrFindings) {
    const f = opts.orsrFindings.toLowerCase();
    if (f.includes("likvid")) {
      insights.push({ category: "negative", text: "Spoločnosť je v likvidácii (ORSR)." });
    } else if (f.includes("vymazan")) {
      insights.push({ category: "negative", text: "Spoločnosť bola vymazaná z Obchodného registra SR." });
    }
  }

  // ── Forensic red flags z AuditVerdict ──
  if (opts?.forensicRedFlags && opts.forensicRedFlags.length > 0) {
    for (const flag of opts.forensicRedFlags.slice(0, 3)) {
      insights.push({ category: "warning", text: flag });
    }
  }

  // ── Vestnik events (nedávne publikácie) ──
  if (opts?.vestnikEvents && opts.vestnikEvents.length > 0) {
    const recent = opts.vestnikEvents.slice(0, 2);
    for (const ev of recent) {
      if (ev.title) {
        insights.push({ category: "neutral", text: `Obchodný vestník: ${ev.title}.` });
      }
    }
  }

  return insights;
}

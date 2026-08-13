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

function fmtPct(val: number): string {
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(1)} %`;
}

/**
 * Generuje čisto faktické insight vety z finančných dát.
 * Žiadna interpretácia, žiadne hodnotenie, žiadne farebné verdikty.
 * Len aritmetické transformácie verejných dát z RÚZ.
 */
export function generateCompanyInsights(
  stmts: Stmt[],
  opts?: {
    orsrFindings?: string | null;
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
      const dir = revPct > 0 ? "vzrástli" : "klesli";
      insights.push({
        text: `Tržby ${dir} o ${fmtPct(revPct)} medzi rokmi ${prev.year} a ${latest.year}, z ${absFmt(prev.mainActivityRevenue)} na ${absFmt(latest.mainActivityRevenue)}.`,
      });
    }
  }

  // ── Zisk trend ──
  if (prev && latest.netProfitLoss != null && prev.netProfitLoss != null) {
    const profitPct = pctChange(latest.netProfitLoss, prev.netProfitLoss);
    if (Math.abs(profitPct) >= 1) {
      const dir = profitPct > 0 ? "vzrástol" : "klesol";
      const label = latest.netProfitLoss < 0 ? "Strata" : "Zisk";
      insights.push({
        text: `${label} ${dir} o ${fmtPct(profitPct)} v porovnaní s predchádzajúcim rokom, z ${absFmt(prev.netProfitLoss)} na ${absFmt(latest.netProfitLoss)}.`,
      });
    }
  }

  // ── Aktíva trend ──
  if (prev && latest.totalAssets != null && prev.totalAssets != null) {
    const assetsPct = pctChange(latest.totalAssets, prev.totalAssets);
    if (Math.abs(assetsPct) >= 5) {
      const dir = assetsPct > 0 ? "vzrástli" : "klesli";
      insights.push({
        text: `Celkové aktíva ${dir} o ${fmtPct(assetsPct)} a dosiahli hodnotu ${absFmt(latest.totalAssets)}.`,
      });
    }
  }

  // ── Vlastné imanie trend ──
  if (prev && latest.equity != null && prev.equity != null) {
    const eqPct = pctChange(latest.equity, prev.equity);
    if (Math.abs(eqPct) >= 5) {
      const dir = eqPct > 0 ? "vzrástlo" : "kleslo";
      insights.push({
        text: `Vlastné imanie ${dir} o ${fmtPct(eqPct)} na úroveň ${absFmt(latest.equity)}.`,
      });
    }
  }

  // ── Profit margin (fakt, nie hodnotenie) ──
  if (latest.mainActivityRevenue != null && latest.mainActivityRevenue > 0 && latest.netProfitLoss != null) {
    const margin = (latest.netProfitLoss / latest.mainActivityRevenue) * 100;
    insights.push({
      text: `Zisková marža dosiahla ${margin.toFixed(1)} % z celkových tržieb za rok ${latest.year}.`,
    });
  }

  // ── Negatívne vlastné imanie (fakt) ──
  if (latest.equity != null && latest.equity < 0) {
    insights.push({
      text: `Vlastné imanie firmy je záporné (${absFmt(latest.equity)}), čo znamená, že záväzky prevyšujú aktíva.`,
    });
  }

  // ── 3-ročný trend tržieb (CAGR) ──
  if (sorted.length >= 3) {
    const y3 = sorted[sorted.length - 1];
    const y1 = sorted[sorted.length - 3];
    if (y3.mainActivityRevenue != null && y1.mainActivityRevenue != null && y1.mainActivityRevenue > 0) {
      const cagr = (Math.pow(y3.mainActivityRevenue / y1.mainActivityRevenue, 1 / 2) - 1) * 100;
      if (Math.abs(cagr) >= 2) {
        const dir = cagr > 0 ? "rast" : "pokles";
        insights.push({
          text: `Priemerný ročný ${dir} tržieb za posledné 3 roky činí ${fmtPct(cagr)}.`,
        });
      }
    }
  }

  // ── ORSR findings (fakt zo zdroja) ──
  if (opts?.orsrFindings) {
    const f = opts.orsrFindings.toLowerCase();
    if (f.includes("likvid")) {
      insights.push({ text: "Spoločnosť je v likvidácii, ako vyplýva z Obchodného registra SR." });
    } else if (f.includes("vymazan")) {
      insights.push({ text: "Spoločnosť bola vymazaná z Obchodného registra SR." });
    }
  }

  // ── Vestnik events (fakt zo zdroja) ──
  if (opts?.vestnikEvents && opts.vestnikEvents.length > 0) {
    const recent = opts.vestnikEvents.slice(0, 2);
    for (const ev of recent) {
      if (ev.title) {
        insights.push({ text: `V Obchodnom vestníku bola uverejnená informácia: ${ev.title}.` });
      }
    }
  }

  return insights;
}

import { translate, LOCALE_MAP, type Lang } from "@/lib/i18n";
import { fmtEUR, num } from "@/lib/format";
import type { Decimal } from "@prisma/client/runtime/library";

export type RiskSignal = {
  id: string;
  type: "legal_status" | "vestnik" | "forensic" | "financial";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  source: string;
  date?: string | null;
};

type NumLike = Decimal | number | string | null | undefined;

export type SignalCompany = {
  legalStatus: string | null;
  legalStatusSource: string | null;
  vestnikEvents?: Array<{
    id: string;
    eventType: string;
    summary: string;
    severityLevel: string | null;
    publishedAt: Date | string;
  }> | null;
};

export type SignalStatement = {
  year: number;
  socialInsuranceLiabilities?: NumLike;
  taxLiabilities?: NumLike;
  employeeLiabilities?: NumLike;
  equity?: NumLike;
};

/**
 * Compute risk signals for a company page — fully i18n'd via `lang`.
 * Extracted from firma-page.tsx so the logic is unit-testable and
 * non-SK pages no longer render hardcoded Slovak text.
 */
export function computeRiskSignals(
  company: SignalCompany,
  latest: SignalStatement | null | undefined,
  lang: Lang
): RiskSignal[] {
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);
  const signals: RiskSignal[] = [];

  // Legal status signals
  if (company.legalStatus === "BANKRUPT") {
    signals.push({
      id: "legal-bankrupt",
      type: "legal_status",
      severity: "critical",
      title: t("firma.statusBankrupt"),
      description: t("firma.riskBankruptDesc"),
      source: company.legalStatusSource || "ORSR",
    });
  }
  if (company.legalStatus === "RESTRUCTURING") {
    signals.push({
      id: "legal-restructuring",
      type: "legal_status",
      severity: "critical",
      title: t("firma.statusRestructuring"),
      description: t("firma.riskRestructuringDesc"),
      source: company.legalStatusSource || "ORSR",
    });
  }
  if (company.legalStatus === "LIQUIDATION") {
    signals.push({
      id: "legal-liquidation",
      type: "legal_status",
      severity: "high",
      title: t("firma.statusLiquidation"),
      description: t("firma.riskLiquidationDesc"),
      source: company.legalStatusSource || "ORSR",
    });
  }

  // Vestnik events as risk signals (title/summary are DB data in Slovak — not UI chrome)
  if (company.vestnikEvents) {
    for (const ev of company.vestnikEvents.slice(0, 5)) {
      const sev = ev.severityLevel === "CRITICAL" ? "critical" :
                 ev.severityLevel === "HIGH" ? "high" :
                 ev.severityLevel === "MEDIUM" ? "medium" : "low";
      signals.push({
        id: `vestnik-${ev.id}`,
        type: "vestnik",
        severity: sev,
        title: ev.eventType,
        description: ev.summary,
        source: "Obchodný vestník",
        date: new Date(ev.publishedAt).toLocaleDateString(LOCALE_MAP[lang]),
      });
    }
  }

  // Forensic signals from latest FS
  if (latest) {
    const socIns = num(latest.socialInsuranceLiabilities);
    const taxLiab = num(latest.taxLiabilities);
    const empLiab = num(latest.employeeLiabilities);

    if (socIns != null && socIns > 0) {
      signals.push({
        id: "forensic-soc-ins",
        type: "forensic",
        severity: "high",
        title: t("firma.riskSocInsTitle"),
        description: t("firma.riskSocInsDesc", { amount: fmtEUR(socIns), year: latest.year }),
        source: "RÚZ",
        date: String(latest.year),
      });
    }
    if (taxLiab != null && taxLiab > 0) {
      signals.push({
        id: "forensic-tax",
        type: "forensic",
        severity: "high",
        title: t("firma.riskTaxTitle"),
        description: t("firma.riskTaxDesc", { amount: fmtEUR(taxLiab), year: latest.year }),
        source: "RÚZ",
        date: String(latest.year),
      });
    }
    if (empLiab != null && empLiab > 0) {
      signals.push({
        id: "forensic-emp",
        type: "forensic",
        severity: "medium",
        title: t("firma.riskEmpTitle"),
        description: t("firma.riskEmpDesc", { amount: fmtEUR(empLiab), year: latest.year }),
        source: "RÚZ",
        date: String(latest.year),
      });
    }
  }

  // Negative equity
  const equity = num(latest?.equity);
  if (latest && equity != null && equity < 0) {
    signals.push({
      id: "financial-neg-equity",
      type: "financial",
      severity: "high",
      title: t("firma.riskNegEquityTitle"),
      description: t("firma.riskNegEquityDesc", { amount: fmtEUR(equity), year: latest.year }),
      source: "RÚZ",
      date: String(latest.year),
    });
  }

  return signals;
}

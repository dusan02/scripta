import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import dynamic from "next/dynamic";
import { num } from "@/lib/format";
import type { Decimal } from "@prisma/client/runtime/library";
import { translate, type Lang } from "@/lib/i18n";
import { getLangFromHeaders } from "@/lib/seo";

// Lazy-load FinancialChart (pulls in Recharts ~380kB) — only needed when
// the chart section is visible, not on initial dashboard paint.
const FinancialChart = dynamic(() => import("@/components/FinancialChart"), {
  loading: () => (
    <div className="h-80 rounded-2xl animate-pulse" style={{ background: "var(--bg-muted)" }} />
  ),
  ssr: true,
});

function formatCurrency(value: Decimal | number | null) {
  const n = num(value);
  if (n === null) return "N/A";
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// ── MetricCard (extracted — no longer re-created on every render) ──────

function MetricCard({ title, value, isNegative = false }: { title: string; value: string; isNegative?: boolean }) {
  return (
    <div
      className="p-6 rounded-2xl transition-all duration-300 group"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <h3
        className="text-sm font-medium mb-2 uppercase tracking-wider transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </h3>
      <p
        className="text-3xl font-semibold tracking-tight"
        style={{ color: isNegative ? "var(--danger)" : "var(--text)" }}
      >
        {value}
      </p>
    </div>
  );
}

// ── Risk category styling helpers ──────────────────────────────────────

function riskCategoryBg(cat: string): { bg: string; border: string } {
  switch (cat) {
    case "AAA":
    case "A":
      return { bg: "var(--success-bg)", border: "var(--success)" };
    case "B":
      return { bg: "var(--warning-bg)", border: "var(--warning)" };
    case "C":
      return { bg: "var(--danger-bg)", border: "var(--danger)" };
    default:
      return { bg: "var(--bg-muted)", border: "var(--border)" };
  }
}

function riskCategoryBadge(cat: string): { bg: string; color: string; border: string } {
  switch (cat) {
    case "AAA":
    case "A":
      return { bg: "var(--success-bg)", color: "var(--success)", border: "var(--success)" };
    case "B":
      return { bg: "var(--warning-bg)", color: "var(--warning-text)", border: "var(--warning)" };
    case "C":
      return { bg: "var(--danger-bg)", color: "var(--danger)", border: "var(--danger)" };
    default:
      return { bg: "var(--bg-muted)", color: "var(--text-muted)", border: "var(--border)" };
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning-text)";
  return "var(--danger)";
}

function findingStyle(cat: string): { bg: string; border: string; color: string; label: string } {
  switch (cat) {
    case "RISK":
      return { bg: "var(--danger-bg)", border: "var(--danger)", color: "var(--danger)", label: "dashboard.risk" };
    case "STRENGTH":
      return { bg: "var(--success-bg)", border: "var(--success)", color: "var(--success)", label: "dashboard.strength" };
    case "ANOMALY":
      return { bg: "var(--warning-bg)", border: "var(--warning)", color: "var(--warning-text)", label: "dashboard.anomaly" };
    default:
      return { bg: "var(--bg-muted)", border: "var(--border)", color: "var(--text-muted)", label: "dashboard.insufficientEvidence" };
  }
}

function evidenceStyle(impact: string): { bg: string; border: string; color: string } {
  switch (impact) {
    case "CRITICAL":
      return { bg: "var(--danger-bg)", border: "var(--danger)", color: "var(--danger)" };
    case "WARNING":
      return { bg: "var(--warning-bg)", border: "var(--warning)", color: "var(--warning-text)" };
    case "POSITIVE":
      return { bg: "var(--success-bg)", border: "var(--success)", color: "var(--success)" };
    default:
      return { bg: "var(--bg-muted)", border: "var(--border)", color: "var(--text-secondary)" };
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default async function DashboardPage({
  params,
}: {
  params: { ico: string };
}) {
  const ico = params.ico;
  const h = await headers();
  const lang: Lang = getLangFromHeaders(h);
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);

  // We can fetch data directly in Server Components!
  // Limit financial statements to recent 10 years and vestnik events to 50 most recent
  // to avoid loading unbounded relation data for large companies.
  const company = await prisma.company.findUnique({
    where: { ico },
    include: {
      auditVerdict: true,
      financialStatements: {
        orderBy: { year: "desc" },
        take: 10,
        include: { auditorOpinion: true, narrativeRisk: true, notesRisk: true },
      },
      vestnikEvents: {
        orderBy: { publishedAt: "desc" },
        take: 50,
      },
    },
  });

  if (!company || company.financialStatements.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text)" }}>
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-light" style={{ color: "var(--danger)" }}>{t("dashboard.dataNotFound")}</h1>
          <p style={{ color: "var(--text-muted)" }}>{t("dashboard.noStatements", { ico })}</p>
          <Link
            href="/"
            className="inline-block mt-4 px-6 py-3 rounded-lg transition-colors"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {t("dashboard.back")}
          </Link>
        </div>
      </div>
    );
  }

  const latestStatement = company.financialStatements[0];
  const opinion = latestStatement.auditorOpinion;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-16 relative z-10">
        <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase"
                style={{ background: "var(--accent-light)", color: "var(--accent)", border: "1px solid var(--accent-border)" }}
              >
                {t("dashboard.verifaIntelligence")}
              </span>
              <span
                className="px-3 py-1 rounded-full text-xs font-mono"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                IČO: {ico}
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter" style={{ color: "var(--text)" }}>
              {company.name || t("dashboard.unknownCompany")}
            </h1>
            <p className="mt-3 text-lg font-light" style={{ color: "var(--text-muted)" }}>
              {t("dashboard.ifrsOverview", { year: latestStatement.year })}
            </p>
          </div>

          {opinion && (
            <div
              className="px-5 py-4 rounded-xl flex flex-col gap-1 max-w-sm"
              style={{
                background: opinion.opinionType.toLowerCase().includes("bez výhrad") ? "var(--success-bg)" : "var(--warning-bg)",
                border: `1px solid ${opinion.opinionType.toLowerCase().includes("bez výhrad") ? "var(--success)" : "var(--warning)"}`,
              }}
            >
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {t("dashboard.auditorOpinion")}
              </div>
              <div className="text-lg font-medium" style={{ color: "var(--text)" }}>{opinion.opinionType}</div>
              {opinion.goingConcernRisk && (
                <div
                  className="text-xs mt-1 font-medium inline-block px-2 py-0.5 rounded"
                  style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
                >
                  {t("dashboard.goingConcernRisk")}
                </div>
              )}
            </div>
          )}
        </header>

        {/* Verifa Scorer / Chief Auditor Verdict */}
        {company.auditVerdict && (
          <section className="mb-12">
            {(() => {
              const catStyle = riskCategoryBg(company.auditVerdict.riskCategory);
              return (
                <div
                  className="p-8 rounded-3xl flex flex-col md:flex-row gap-8 items-center relative overflow-hidden"
                  style={{ background: catStyle.bg, border: `1px solid ${catStyle.border}` }}
                >
                  {company.auditVerdict.riskCategory === "C" && (
                    <div className="absolute inset-0 animate-pulse pointer-events-none" style={{ background: "var(--danger-bg)", opacity: 0.05 }} />
                  )}
                  <div
                    className="relative z-10 flex-shrink-0 flex flex-col items-center justify-center rounded-full w-40 h-40"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                  >
                    <span className="text-sm uppercase tracking-widest mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>
                      {t("dashboard.score")}
                    </span>
                    <span
                      className="text-6xl font-black"
                      style={{ color: scoreColor(company.auditVerdict.verifaScore) }}
                    >
                      {company.auditVerdict.verifaScore}
                    </span>
                    <span className="text-xs uppercase tracking-widest mt-1" style={{ color: "var(--text-muted)" }}>/ 100</span>
                  </div>

                  <div className="relative z-10 flex-grow space-y-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h2 className="text-sm uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
                          {t("dashboard.finalVerdict")}
                        </h2>
                        {(() => {
                          const badge = riskCategoryBadge(company.auditVerdict.riskCategory);
                          return (
                            <span
                              className="px-2.5 py-0.5 rounded text-xs font-bold tracking-wider"
                              style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
                            >
                              {t("dashboard.class")} {company.auditVerdict.riskCategory}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
                        {company.auditVerdict.finalVerdict}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-6 mt-4">
                      {company.auditVerdict.keyRisk && company.auditVerdict.keyRisk !== "Žiadne" && company.auditVerdict.keyRisk !== "N/A" && (
                        <div
                          className="p-4 rounded-xl"
                          style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)" }}
                        >
                          <h3 className="text-xs uppercase tracking-wider font-bold mb-1" style={{ color: "var(--danger)" }}>
                            {t("dashboard.keyRisk")}
                          </h3>
                          <p className="text-sm" style={{ color: "var(--danger-text)" }}>{company.auditVerdict.keyRisk}</p>
                        </div>
                      )}

                      {/* 5 Pilierov - Scorecard Breakdown */}
                      {company.auditVerdict.scorecardBreakdown && Array.isArray(company.auditVerdict.scorecardBreakdown) && (
                        <div className="mt-6 mb-4">
                          <h3 className="text-xs uppercase tracking-wider font-semibold mb-4" style={{ color: "var(--text-muted)" }}>
                            {t("dashboard.pillarsScore")}
                          </h3>
                          <div className="space-y-4">
                            {(company.auditVerdict.scorecardBreakdown as any[]).map((pillar, idx) => {
                              const percentage = pillar.max_score > 0 ? (pillar.score / pillar.max_score) * 100 : 0;
                              let barColor = "var(--text-muted)";
                              if (pillar.score < 0) barColor = "var(--danger)";
                              else if (percentage >= 80) barColor = "var(--success)";
                              else if (percentage >= 50) barColor = "var(--warning-text)";
                              else barColor = "var(--danger)";

                              return (
                                <div key={idx} className="flex flex-col gap-1">
                                  <div className="flex justify-between items-center text-sm">
                                    <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{pillar.name}</span>
                                    <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                                      {pillar.score} / {pillar.max_score} {t("dashboard.points")}
                                    </span>
                                  </div>
                                  <div className="w-full rounded-full h-1.5 overflow-hidden flex" style={{ background: "var(--bg-muted)" }}>
                                    {pillar.score < 0 ? (
                                      <div className="h-1.5 w-full animate-pulse" style={{ background: "var(--danger)" }} />
                                    ) : (
                                      <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, Math.max(0, percentage))}%`, background: barColor }} />
                                    )}
                                  </div>
                                  {pillar.flags && pillar.flags.length > 0 && (
                                    <ul className="mt-1 space-y-0.5">
                                      {pillar.flags.map((flag: string, i: number) => (
                                        <li key={i} className="text-[10px] flex items-start gap-1" style={{ color: "var(--text-muted)" }}>
                                          <span className="mt-0.5">•</span> <span>{flag}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div>
                        <h3 className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--text-muted)" }}>
                          {t("dashboard.evidenceTrail")}
                        </h3>
                        {(() => {
                          try {
                            let rawJson = company.auditVerdict.justification;
                            const startIndex = rawJson.indexOf("[");
                            const endIndex = rawJson.lastIndexOf("]");

                            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                              rawJson = rawJson.substring(startIndex, endIndex + 1);
                            }

                            const evidenceList = JSON.parse(rawJson);
                            if (Array.isArray(evidenceList)) {
                              return (
                                <div className="space-y-3">
                                  {evidenceList.map((item: any, i: number) => {
                                    const impact = item.impact || "NEUTRAL";
                                    const evStyle = evidenceStyle(impact);
                                    return (
                                      <div
                                        key={i}
                                        className="p-4 rounded-xl flex gap-4 transition-all"
                                        style={{ background: evStyle.bg, border: `1px solid ${evStyle.border}` }}
                                      >
                                        <div className="flex-1">
                                          <h4 className="text-sm mb-1 font-bold" style={{ color: evStyle.color }}>{item.tvrdenie}</h4>
                                          <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>{item.dokaz}</p>
                                          <div className="flex items-center gap-2">
                                            <span
                                              className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider"
                                              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                                            >
                                              {t("dashboard.source")}: {item.zdroj}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            }
                          } catch {
                            return (
                              <p
                                className="text-sm leading-relaxed p-4 rounded-xl"
                                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                              >
                                {company.auditVerdict.justification}
                              </p>
                            );
                          }
                          return (
                            <p
                              className="text-sm leading-relaxed p-4 rounded-xl"
                              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                            >
                              {company.auditVerdict.justification}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* Findings — Risk / Strength / Anomaly / Unknown */}
        {company.auditVerdict?.findings && Array.isArray(company.auditVerdict.findings) && (company.auditVerdict.findings as any[]).length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-6" style={{ color: "var(--text)" }}>{t("dashboard.analysisFindings")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(company.auditVerdict.findings as any[]).map((f, i) => {
                const cat = f.category || "UNKNOWN";
                const style = findingStyle(cat);
                return (
                  <div key={i} className="p-5 rounded-xl" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold uppercase tracking-wider`} style={{ color: style.color }}>
                        {t(style.label)}
                      </span>
                      {f.financialMetric && (
                        <span className="ml-auto text-xs font-mono" style={{ color: "var(--text-muted)" }}>{f.financialMetric}</span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text)" }}>{f.title}</h3>
                    {f.evidence && f.evidence !== "Dostupné zdroje neobsahujú relevantný dôkaz" && f.evidence !== "Available sources contain no relevant evidence" && (
                      <div className="mb-2">
                        <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)" }}>{t("dashboard.evidence")}</p>
                        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{f.evidence}</p>
                      </div>
                    )}
                    <div className="mb-2">
                      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)" }}>{t("dashboard.explanation")}</p>
                      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{f.explanation}</p>
                    </div>
                    <div className="mb-3">
                      <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)" }}>{t("dashboard.implication")}</p>
                      <p className="text-sm" style={{ color: "var(--text)" }}>{f.implication}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className="px-2 py-0.5 rounded font-mono uppercase tracking-wider"
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                      >
                        {t("dashboard.source")}: {f.source}{f.sourcePages ? `, ${t("dashboard.page")} ${f.sourcePages}` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Debt Exposure Meter */}
        {company.auditVerdict && company.auditVerdict.debtExposureRating !== null && (
          <section className="mb-12">
            {(() => {
              const rating = company.auditVerdict!.debtExposureRating!;
              const isHigh = rating >= 8;
              const isMid = rating >= 4;
              const bgStyle = isHigh
                ? { bg: "var(--danger-bg)", border: "var(--danger)", color: "var(--danger)" }
                : isMid
                ? { bg: "var(--warning-bg)", border: "var(--warning)", color: "var(--warning-text)" }
                : { bg: "var(--success-bg)", border: "var(--success)", color: "var(--success)" };
              return (
                <div
                  className="p-6 rounded-2xl flex flex-col md:flex-row gap-6 items-center"
                  style={{ background: bgStyle.bg, border: `1px solid ${bgStyle.border}` }}
                >
                  <div className="flex-grow w-full">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
                        {t("dashboard.debtExposure")}
                      </h3>
                      <span className="text-lg font-bold" style={{ color: bgStyle.color }}>
                        {rating} / 10
                      </span>
                    </div>

                    {/* Visual Meter */}
                    <div className="h-3 w-full rounded-full overflow-hidden flex" style={{ background: "var(--bg-muted)" }}>
                      {[...Array(10)].map((_, i) => (
                        <div
                          key={i}
                          className="h-full flex-1"
                          style={{
                            borderRight: "1px solid var(--border)",
                            background: i < rating ? bgStyle.color : "transparent",
                          }}
                        />
                      ))}
                    </div>
                    {isHigh && (
                      <p className="mt-3 text-xs font-medium" style={{ color: bgStyle.color }}>
                        {t("dashboard.massiveDebtWarning")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* Metrics Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <MetricCard title={t("dashboard.totalAssets")} value={formatCurrency(latestStatement.totalAssets)} />
          <MetricCard
            title={t("dashboard.equity")}
            value={formatCurrency(latestStatement.equity)}
            isNegative={latestStatement.equity !== null && num(latestStatement.equity)! < 0}
          />
          <MetricCard title={t("dashboard.revenue")} value={formatCurrency(latestStatement.mainActivityRevenue)} />
          <MetricCard
            title={t("dashboard.profitLoss")}
            value={formatCurrency(latestStatement.netProfitLoss)}
            isNegative={latestStatement.netProfitLoss !== null && num(latestStatement.netProfitLoss)! < 0}
          />
          <MetricCard title={t("dashboard.shortTermLiabilities")} value={formatCurrency(latestStatement.shortTermLiabilities)} />
          <MetricCard title={t("dashboard.cashAndEquivalents")} value={formatCurrency(latestStatement.cashAndEquivalents)} />
          <MetricCard
            title={t("dashboard.operatingCashFlow")}
            value={formatCurrency(latestStatement.operatingCashFlow)}
            isNegative={latestStatement.operatingCashFlow !== null && num(latestStatement.operatingCashFlow)! < 0}
          />
        </section>

        {/* Strategický kontext */}
        {latestStatement.narrativeRisk && (
          <section className="mb-12 mt-12 rounded-2xl p-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2" style={{ color: "var(--text)" }}>
              {t("dashboard.strategicContext")} <span className="text-lg font-normal" style={{ color: "var(--text-muted)" }}>({t("dashboard.annualReport")})</span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h3 className="text-sm font-medium uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("dashboard.skepticSynthesis")}
                  </h3>
                  <p className="text-lg leading-relaxed font-light" style={{ color: "var(--text)" }}>
                    {latestStatement.narrativeRisk.synthesis}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                  {latestStatement.narrativeRisk.managementChanges && (
                    <div>
                      <h4 className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{t("dashboard.managementChanges")}</h4>
                      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.narrativeRisk.managementChanges}</p>
                    </div>
                  )}
                  {latestStatement.narrativeRisk.plannedInvestments && (
                    <div>
                      <h4 className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{t("dashboard.plannedInvestments")}</h4>
                      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.narrativeRisk.plannedInvestments}</p>
                    </div>
                  )}
                  {latestStatement.narrativeRisk.litigationRisks && (
                    <div className="md:col-span-2">
                      <h4 className="text-sm mb-1" style={{ color: "var(--danger)" }}>{t("dashboard.litigationRisks")}</h4>
                      <p className="text-sm" style={{ color: "var(--danger-text)" }}>{latestStatement.narrativeRisk.litigationRisks}</p>
                    </div>
                  )}
                  {latestStatement.narrativeRisk.businessDevelopments && (
                    <div className="md:col-span-2">
                      <h4 className="text-sm mb-1" style={{ color: "var(--success)" }}>{t("dashboard.businessDevelopments")}</h4>
                      <p className="text-sm" style={{ color: "var(--success-text)" }}>{latestStatement.narrativeRisk.businessDevelopments}</p>
                    </div>
                  )}
                  {latestStatement.narrativeRisk.strengthsAndOpportunities && (
                    <div className="md:col-span-2">
                      <h4 className="text-sm mb-1" style={{ color: "var(--success)" }}>{t("dashboard.strengthsOpportunities")}</h4>
                      <p className="text-sm" style={{ color: "var(--success-text)" }}>{latestStatement.narrativeRisk.strengthsAndOpportunities}</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="rounded-xl p-6 h-full" style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="font-semibold" style={{ color: "var(--text)" }}>{t("dashboard.redFlags")}</h3>
                    {latestStatement.narrativeRisk.goingConcernDoubts && (
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger)" }}
                      >
                        {t("dashboard.goingConcernRisk")}
                      </span>
                    )}
                  </div>

                  {latestStatement.narrativeRisk.forensicRedFlags && latestStatement.narrativeRisk.forensicRedFlags.length > 0 ? (
                    <ul className="space-y-3">
                      {latestStatement.narrativeRisk.forensicRedFlags.map((flag, idx) => (
                        <li key={idx} className="flex gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                          <span className="shrink-0 mt-0.5" style={{ color: "var(--danger)" }}>•</span>
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm flex items-center gap-2" style={{ color: "var(--success)" }}>
                      <span>✓</span> {t("dashboard.noSuspiciousIndicators")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Notes Forensic — Poznámky k účtovnej závierke */}
        {latestStatement.notesRisk && (
          <section className="mb-12 mt-12 rounded-2xl p-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2" style={{ color: "var(--text)" }}>
              {t("dashboard.notesForensic")} <span className="text-lg font-normal" style={{ color: "var(--text-muted)" }}>({t("dashboard.notes")})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {latestStatement.notesRisk.relatedPartyTransactions && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--warning-text)" }}>{t("dashboard.relatedPartyTransactions")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.relatedPartyTransactions}</p>
                </div>
              )}
              {latestStatement.notesRisk.offBalanceSheetLiabilities && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--warning-text)" }}>{t("dashboard.offBalanceSheetLiabilities")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.offBalanceSheetLiabilities}</p>
                </div>
              )}
              {latestStatement.notesRisk.contingentRisks && (
                <div className="md:col-span-2">
                  <h4 className="text-sm mb-1" style={{ color: "var(--danger)" }}>{t("dashboard.contingentRisks")}</h4>
                  <p className="text-sm" style={{ color: "var(--danger-text)" }}>{latestStatement.notesRisk.contingentRisks}</p>
                </div>
              )}
              {latestStatement.notesRisk.significantInvestments && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--info)" }}>{t("dashboard.significantInvestments")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.significantInvestments}</p>
                </div>
              )}
              {latestStatement.notesRisk.financingActivities && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--info)" }}>{t("dashboard.financingActivities")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.financingActivities}</p>
                </div>
              )}
              {latestStatement.notesRisk.acquisitionsAndDisposals && (
                <div className="md:col-span-2">
                  <h4 className="text-sm mb-1" style={{ color: "var(--info)" }}>{t("dashboard.acquisitionsAndDisposals")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.acquisitionsAndDisposals}</p>
                </div>
              )}
              {latestStatement.notesRisk.provisionsAndReserves && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--warning-text)" }}>{t("dashboard.provisionsAndReserves")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.provisionsAndReserves}</p>
                </div>
              )}
              {latestStatement.notesRisk.restructuringActivities && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--warning-text)" }}>{t("dashboard.restructuringActivities")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.restructuringActivities}</p>
                </div>
              )}
              {latestStatement.notesRisk.capitalChanges && (
                <div>
                  <h4 className="text-sm mb-1" style={{ color: "var(--info)" }}>{t("dashboard.capitalChanges")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.capitalChanges}</p>
                </div>
              )}
              {latestStatement.notesRisk.subsequentEvents && (
                <div className="md:col-span-2">
                  <h4 className="text-sm mb-1" style={{ color: "var(--warning-text)" }}>{t("dashboard.subsequentEvents")}</h4>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{latestStatement.notesRisk.subsequentEvents}</p>
                </div>
              )}
            </div>
            {latestStatement.notesRisk.sourcePages && (
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                >
                  {t("dashboard.source")}: {t("dashboard.notes")}, {t("dashboard.page")} {latestStatement.notesRisk.sourcePages}
                </span>
              </div>
            )}
          </section>
        )}

        {/* Recharts Vizuálny Trend */}
        {company.financialStatements.length > 0 && (
          <>
            {(() => {
              const isConsSet = new Set(company.financialStatements.map(s => s.isConsolidated));
              const hasMixedConsolidation = isConsSet.size > 1;
              const hasNonStandardMonths = company.financialStatements.some(s => s.monthsInPeriod !== null && s.monthsInPeriod !== 12);

              // Startup detekcia
              let isStartup = false;
              let equityStr = "0";
              let nYears = company.financialStatements.length;
              if (nYears > 0 && nYears <= 2) {
                const latest = company.financialStatements[nYears - 1];
                const rev = num(latest.mainActivityRevenue);
                const eq = num(latest.equity);
                const assets = num(latest.totalAssets);
                if (assets !== null && assets > 0 && eq !== null && eq >= 500000 && (rev === null || rev <= 100000)) {
                  isStartup = true;
                  equityStr = formatCurrency(eq);
                }
              }

              return (
                <>
                  {isStartup && (
                    <div className="mt-8 mb-4 p-4 rounded-xl" style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)" }}>
                      <p className="text-sm font-medium mb-2" style={{ color: "var(--warning-text)" }}>
                        {t("dashboard.startupDetected")}
                      </p>
                      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                        {t("dashboard.startupExplanation")}
                      </p>
                      <p className="text-sm mt-2 font-mono" style={{ color: "var(--warning-text)" }}>
                        {t("dashboard.equityLabel", { equity: equityStr, n: nYears })}
                      </p>
                    </div>
                  )}
                  {hasMixedConsolidation && (
                    <div className="mt-8 mb-[-1rem] p-4 rounded-xl" style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)" }}>
                      <p className="text-sm font-medium" style={{ color: "var(--warning-text)" }}>
                        {t("dashboard.mixedConsolidation")}
                      </p>
                    </div>
                  )}
                  {hasNonStandardMonths && (
                    <div className="mt-8 mb-[-1rem] p-4 rounded-xl" style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)" }}>
                      <p className="text-sm font-medium" style={{ color: "var(--warning-text)" }}>
                        {t("dashboard.nonStandardMonths")}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
            <FinancialChart data={company.financialStatements.map(s => ({
              year: s.year,
              netProfitLoss: num(s.netProfitLoss),
              operatingCashFlow: num(s.operatingCashFlow)
            }))} />
          </>
        )}

        {/* Forenzné Varovania */}
        <section className="mb-12 mt-16">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2" style={{ color: "var(--text)" }}>
            {t("dashboard.forensicWarnings")} <span className="text-lg font-normal" style={{ color: "var(--text-muted)" }}>({t("dashboard.officialGazette")})</span>
          </h2>

          {!company.vestnikEvents || company.vestnikEvents.length === 0 ? (
            <div className="rounded-2xl p-6 flex items-center gap-4" style={{ background: "var(--success-bg)", border: "1px solid var(--success)" }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--success-bg)", color: "var(--success)" }}>
                ✓
              </div>
              <div>
                <h3 className="font-medium" style={{ color: "var(--success)" }}>{t("dashboard.cleanShield")}</h3>
                <p className="text-sm" style={{ color: "var(--success-text)" }}>{t("dashboard.noForensicFindings")}</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {company.vestnikEvents.map((event) => {
                let borderColor = "var(--border)";
                let badgeColor = { bg: "var(--bg-muted)", color: "var(--text-muted)" };

                if (event.severityLevel === "CRITICAL") {
                  borderColor = "var(--danger)";
                  badgeColor = { bg: "var(--danger-bg)", color: "var(--danger)" };
                } else if (event.severityLevel === "HIGH") {
                  borderColor = "var(--warning)";
                  badgeColor = { bg: "var(--warning-bg)", color: "var(--warning-text)" };
                } else if (event.severityLevel === "MEDIUM") {
                  borderColor = "var(--info)";
                  badgeColor = { bg: "var(--info-bg)", color: "var(--info-text)" };
                }

                // Parse summary to separate text from Red Flags
                const parts = event.summary.split("\\nRed Flags: ");
                const summaryText = parts[0];
                const redFlags = parts.length > 1 ? parts[1].split(", ") : [];

                return (
                  <div
                    key={event.id}
                    className="rounded-xl p-6 relative overflow-hidden"
                    style={{ background: "var(--surface)", border: `1px solid var(--border)`, borderLeft: `4px solid ${borderColor}` }}
                  >
                    {event.severityLevel === "CRITICAL" && (
                      <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -mr-10 -mt-10 animate-pulse pointer-events-none" style={{ background: "var(--danger-bg)" }} />
                    )}

                    <div className="flex justify-between items-start mb-4 relative z-10">
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded text-xs font-bold tracking-wider" style={badgeColor}>
                          {event.severityLevel}
                        </span>
                        <h3 className="text-xl font-medium" style={{ color: "var(--text)" }}>{event.eventType}</h3>
                      </div>
                      <div className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
                        {event.publishedAt.toLocaleDateString("sk-SK")}
                      </div>
                    </div>

                    <p className="text-sm mb-4 relative z-10" style={{ color: "var(--text-secondary)" }}>
                      {summaryText}
                    </p>

                    {redFlags.length > 0 && (
                      <div className="rounded-lg p-4 relative z-10" style={{ background: "var(--bg-muted)" }}>
                        <h4 className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                          {t("dashboard.identifiedRedFlags")}
                        </h4>
                        <ul className="space-y-1">
                          {redFlags.map((flag, idx) => (
                            <li key={idx} className="text-sm flex items-start gap-2" style={{ color: "var(--danger-text)" }}>
                              <span className="mt-0.5" style={{ color: "var(--danger)" }}>•</span>
                              <span>{flag}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Historická tabuľka, ak existuje viac výkazov */}
        {company.financialStatements.length > 1 && (
          <section className="rounded-2xl overflow-hidden mt-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
              <h2 className="text-lg font-medium" style={{ color: "var(--text)" }}>{t("dashboard.historicalDevelopment")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead style={{ background: "var(--bg-muted)" }}>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.year")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.assets")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.revenue")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.profitLoss")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.personnelCosts")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.receivablesOS")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.payablesOS")}</th>
                    <th className="px-6 py-4 font-medium text-xs uppercase" style={{ color: "var(--text-muted)" }}>{t("dashboard.auditor")}</th>
                  </tr>
                </thead>
                <tbody>
                  {company.financialStatements.map((stmt) => (
                    <tr key={stmt.id} className="hover:bg-[var(--surface-hover)]" style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-6 py-4 font-medium flex items-center gap-1" style={{ color: "var(--text)" }}>
                        {stmt.year}
                        {stmt.monthsInPeriod !== null && stmt.monthsInPeriod !== 12 && (
                          <span className="cursor-help" style={{ color: "var(--warning-text)" }} title={t("dashboard.monthsPeriod", { n: stmt.monthsInPeriod })}>*</span>
                        )}
                      </td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>{formatCurrency(stmt.totalAssets)}</td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>{formatCurrency(stmt.mainActivityRevenue)}</td>
                      <td className="px-6 py-4 font-medium" style={{ color: stmt.netProfitLoss !== null && num(stmt.netProfitLoss)! < 0 ? "var(--danger)" : "var(--success)" }}>
                        {formatCurrency(stmt.netProfitLoss)}
                      </td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>{formatCurrency(stmt.staffCosts)}</td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>{formatCurrency(stmt.tradeReceivables)}</td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>{formatCurrency(stmt.tradePayables)}</td>
                      <td className="px-6 py-4" style={{ color: "var(--text-muted)" }}>
                        {stmt.auditorOpinion?.opinionType || "N/A"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

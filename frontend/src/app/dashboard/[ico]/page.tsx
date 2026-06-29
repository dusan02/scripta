import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FinancialChart from "@/components/FinancialChart";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function DashboardPage({
  params,
}: {
  params: { ico: string };
}) {
  const ico = params.ico;

  // We can fetch data directly in Server Components!
  const company = await prisma.company.findUnique({
    where: { ico },
    include: {
      auditVerdict: true,
      financialStatements: {
        orderBy: { year: "desc" },
        include: { auditorOpinion: true, narrativeRisk: true },
      },
      vestnikEvents: {
        orderBy: { publishedAt: "desc" },
      },
    },
  });

  if (!company || company.financialStatements.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-light text-rose-500">Dáta nenájdené</h1>
          <p className="text-neutral-400">Pre IČO {ico} nemáme v databáze žiadne výkazy.</p>
          <Link href="/" className="inline-block mt-4 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors">
            Späť
          </Link>
        </div>
      </div>
    );
  }

  const latestStatement = company.financialStatements[0];
  const opinion = latestStatement.auditorOpinion;

  // Glassmorphism Metric Card component
  const MetricCard = ({ title, value, isNegative = false }: { title: string, value: string, isNegative?: boolean }) => (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 rounded-2xl hover:bg-white/10 transition-all duration-300 group">
      <h3 className="text-sm font-medium text-neutral-400 mb-2 uppercase tracking-wider group-hover:text-neutral-300 transition-colors">
        {title}
      </h3>
      <p className={`text-3xl font-semibold tracking-tight ${isNegative ? "text-rose-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-emerald-500/30">
      {/* Sleek Gradient Background Accent */}
      <div className="absolute top-0 inset-x-0 h-[500px] bg-gradient-to-b from-emerald-900/20 to-transparent pointer-events-none" />
      
      <main className="max-w-6xl mx-auto px-6 py-16 relative z-10">
        <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-semibold tracking-wide uppercase">
                Verifa Intelligence
              </span>
              <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-mono text-neutral-400">
                IČO: {ico}
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter text-white">
              {company.name || "Neznáma Spoločnosť"}
            </h1>
            <p className="text-neutral-400 mt-3 text-lg font-light">
              Forenzný prehľad z IFRS závierok za rok {latestStatement.year}
            </p>
          </div>
          
          {opinion && (
            <div className={`px-5 py-4 rounded-xl border flex flex-col gap-1 max-w-sm ${
              opinion.opinionType.toLowerCase().includes("bez výhrad") 
                ? "bg-emerald-500/10 border-emerald-500/20" 
                : "bg-amber-500/10 border-amber-500/20"
            }`}>
              <div className="text-xs font-semibold uppercase tracking-wider opacity-60">Názor audítora</div>
              <div className="text-lg font-medium">{opinion.opinionType}</div>
              {opinion.goingConcernRisk && (
                <div className="text-xs text-rose-400 mt-1 font-medium bg-rose-400/10 inline-block px-2 py-0.5 rounded">
                  ⚠️ Going Concern Riziko!
                </div>
              )}
            </div>
          )}
        </header>

        {/* Verifa Scorer / Chief Auditor Verdict */}
        {company.auditVerdict && (
          <section className="mb-12">
            <div className={`p-8 rounded-3xl border flex flex-col md:flex-row gap-8 items-center ${
              company.auditVerdict.riskCategory === 'AAA' ? 'bg-emerald-500/10 border-emerald-500/20' :
              company.auditVerdict.riskCategory === 'A' ? 'bg-emerald-500/10 border-emerald-500/20' :
              company.auditVerdict.riskCategory === 'B' ? 'bg-amber-500/10 border-amber-500/20' :
              company.auditVerdict.riskCategory === 'C' ? 'bg-rose-500/10 border-rose-500/20 relative overflow-hidden' :
              'bg-neutral-500/10 border-neutral-500/20'
            }`}>
              {company.auditVerdict.riskCategory === 'C' && (
                <div className="absolute inset-0 bg-rose-600/5 animate-pulse pointer-events-none" />
              )}
              <div className="relative z-10 flex-shrink-0 flex flex-col items-center justify-center bg-black/40 rounded-full w-40 h-40 border border-white/10 shadow-2xl">
                <span className="text-sm uppercase tracking-widest text-neutral-400 mb-1 font-semibold">Skóre</span>
                <span className={`text-6xl font-black ${
                  company.auditVerdict.verifaScore >= 90 ? 'text-emerald-400' :
                  company.auditVerdict.verifaScore >= 70 ? 'text-emerald-400' :
                  company.auditVerdict.verifaScore >= 40 ? 'text-amber-400' :
                  'text-rose-500'
                }`}>{company.auditVerdict.verifaScore}</span>
                <span className="text-xs uppercase tracking-widest text-neutral-500 mt-1">/ 100</span>
              </div>
              
              <div className="relative z-10 flex-grow space-y-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-sm uppercase tracking-widest text-neutral-400 font-semibold">Záverečný verdikt (Chief Auditor)</h2>
                    <span className={`px-2.5 py-0.5 rounded text-xs font-bold tracking-wider border ${
                      company.auditVerdict.riskCategory === 'AAA' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                      company.auditVerdict.riskCategory === 'A' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                      company.auditVerdict.riskCategory === 'B' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                      company.auditVerdict.riskCategory === 'C' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
                      'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
                    }`}>Třída {company.auditVerdict.riskCategory}</span>
                  </div>
                  <p className="text-2xl font-bold text-white tracking-tight">{company.auditVerdict.finalVerdict}</p>
                </div>
                
                <div className="grid grid-cols-1 gap-6 mt-4">
                  {company.auditVerdict.keyRisk && company.auditVerdict.keyRisk !== "Žiadne" && company.auditVerdict.keyRisk !== "N/A" && (
                    <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl">
                      <h3 className="text-xs uppercase tracking-wider text-rose-400 font-bold mb-1 flex items-center gap-2">
                        <span>⚠️</span> Kľúčové riziko
                      </h3>
                      <p className="text-sm text-rose-200">{company.auditVerdict.keyRisk}</p>
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-3">Forenzná Dôkazová Stopa</h3>
                    {(() => {
                      try {
                        let rawJson = company.auditVerdict.justification;
                        // Pre istotu vyrežeme čokoľvek, čo je pred `[` a za `]`, ak by LLM vložil nejaký balast
                        const startIndex = rawJson.indexOf('[');
                        const endIndex = rawJson.lastIndexOf(']');
                        
                        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                          rawJson = rawJson.substring(startIndex, endIndex + 1);
                        }
                        
                        const evidenceList = JSON.parse(rawJson);
                        if (Array.isArray(evidenceList)) {
                          return (
                            <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/30">
                              <table className="w-full text-left border-collapse">
                                <thead className="bg-neutral-900 border-b border-neutral-800">
                                  <tr>
                                    <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider w-1/3">Tvrdenie</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider w-1/2">Dôkaz</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider w-1/6">Zdroj</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-800/50">
                                  {evidenceList.map((item: any, i: number) => (
                                    <tr key={i} className="hover:bg-neutral-800/30 transition-colors">
                                      <td className="px-4 py-3 text-sm text-neutral-200 align-top">{item.tvrdenie}</td>
                                      <td className="px-4 py-3 text-sm text-neutral-400 align-top">{item.dokaz}</td>
                                      <td className="px-4 py-3 text-sm text-emerald-400/80 align-top font-mono text-xs cursor-pointer hover:text-emerald-300 hover:underline">{item.zdroj}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        }
                      } catch (e) {
                        return <p className="text-sm text-neutral-300 leading-relaxed bg-neutral-900/30 p-4 rounded-xl border border-neutral-800">{company.auditVerdict.justification}</p>;
                      }
                      return <p className="text-sm text-neutral-300 leading-relaxed bg-neutral-900/30 p-4 rounded-xl border border-neutral-800">{company.auditVerdict.justification}</p>;
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Debt Exposure Meter */}
        {company.auditVerdict && company.auditVerdict.debtExposureRating !== null && (
          <section className="mb-12">
            <div className={`p-6 rounded-2xl border flex flex-col md:flex-row gap-6 items-center ${
              company.auditVerdict!.debtExposureRating >= 8 ? 'bg-rose-500/10 border-rose-500/20' :
              company.auditVerdict!.debtExposureRating >= 4 ? 'bg-amber-500/10 border-amber-500/20' :
              'bg-emerald-500/10 border-emerald-500/20'
            }`}>
              <div className="flex-grow w-full">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm uppercase tracking-widest text-neutral-400 font-semibold">Expozícia voči verejným dlhom</h3>
                  <span className={`text-lg font-bold ${
                    company.auditVerdict!.debtExposureRating >= 8 ? 'text-rose-400' :
                    company.auditVerdict!.debtExposureRating >= 4 ? 'text-amber-400' :
                    'text-emerald-400'
                  }`}>
                    {company.auditVerdict!.debtExposureRating} / 10
                  </span>
                </div>
                
                {/* Visual Meter */}
                <div className="h-3 w-full bg-black/40 rounded-full overflow-hidden flex">
                  {[...Array(10)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-full flex-1 border-r border-black/50 ${
                        i < company.auditVerdict!.debtExposureRating! 
                          ? (company.auditVerdict!.debtExposureRating! >= 8 ? 'bg-rose-500' : 
                             company.auditVerdict!.debtExposureRating! >= 4 ? 'bg-amber-500' : 'bg-emerald-500')
                          : 'bg-transparent'
                      }`}
                    />
                  ))}
                </div>
                {company.auditVerdict!.debtExposureRating >= 8 && (
                   <p className="mt-3 text-xs text-rose-300 font-medium">⚠️ Odhalené masívne verejné dlhy alebo prebiehajúce exekúcie.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Metrics Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <MetricCard 
            title="Aktíva Spolu" 
            value={formatCurrency(latestStatement.totalAssets)} 
          />
          <MetricCard 
            title="Vlastné Imanie" 
            value={formatCurrency(latestStatement.equity)} 
            isNegative={latestStatement.equity < 0}
          />
          <MetricCard 
            title="Tržby" 
            value={formatCurrency(latestStatement.mainActivityRevenue)} 
          />
          <MetricCard 
            title="Zisk / Strata" 
            value={formatCurrency(latestStatement.netProfitLoss)} 
            isNegative={latestStatement.netProfitLoss < 0}
          />
          <MetricCard 
            title="Krátkodobé záväzky" 
            value={formatCurrency(latestStatement.shortTermLiabilities)} 
          />
          <MetricCard 
            title="Peniaze a ekvivalenty" 
            value={formatCurrency(latestStatement.cashAndEquivalents)} 
          />
          <MetricCard 
            title="CF z prevádzky" 
            value={formatCurrency(latestStatement.operatingCashFlow)} 
            isNegative={latestStatement.operatingCashFlow < 0}
          />
        </section>

        {/* Strategický kontext */}
        {latestStatement.narrativeRisk && (
          <section className="mb-12 mt-12 bg-white/5 border border-white/10 rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
              Strategický kontext <span className="text-neutral-500 text-lg font-normal">(Výročná správa)</span>
            </h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-2">Syntéza od The Skeptic Analyst</h3>
                  <p className="text-lg text-white leading-relaxed font-light">
                    {latestStatement.narrativeRisk.synthesis}
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
                  {latestStatement.narrativeRisk.managementChanges && (
                    <div>
                      <h4 className="text-sm text-neutral-400 mb-1">Zmeny vo vedení</h4>
                      <p className="text-neutral-300 text-sm">{latestStatement.narrativeRisk.managementChanges}</p>
                    </div>
                  )}
                  {latestStatement.narrativeRisk.plannedInvestments && (
                    <div>
                      <h4 className="text-sm text-neutral-400 mb-1">Plánované investície</h4>
                      <p className="text-neutral-300 text-sm">{latestStatement.narrativeRisk.plannedInvestments}</p>
                    </div>
                  )}
                  {latestStatement.narrativeRisk.litigationRisks && (
                    <div className="md:col-span-2">
                      <h4 className="text-sm text-rose-400 mb-1">Súdne spory / Právne hrozby</h4>
                      <p className="text-rose-200/80 text-sm">{latestStatement.narrativeRisk.litigationRisks}</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <div className="bg-black/30 rounded-xl p-6 h-full border border-white/5">
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="font-semibold text-white">Forensic Red Flags</h3>
                    {latestStatement.narrativeRisk.goingConcernDoubts && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 uppercase tracking-wider border border-rose-500/20">
                        Going Concern Riziko
                      </span>
                    )}
                  </div>
                  
                  {latestStatement.narrativeRisk.forensicRedFlags && latestStatement.narrativeRisk.forensicRedFlags.length > 0 ? (
                    <ul className="space-y-3">
                      {latestStatement.narrativeRisk.forensicRedFlags.map((flag, idx) => (
                        <li key={idx} className="flex gap-3 text-sm text-neutral-300">
                          <span className="text-rose-500 shrink-0 mt-0.5">🚩</span>
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-emerald-500/80 text-sm flex items-center gap-2">
                      <span>✓</span> Žiadne podozrivé indikátory v texte.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Recharts Vizuálny Trend */}
        {company.financialStatements.length > 0 && (
          <FinancialChart data={company.financialStatements.map(s => ({
            year: s.year,
            netProfitLoss: s.netProfitLoss,
            operatingCashFlow: s.operatingCashFlow
          }))} />
        )}

        {/* Forenzné Varovania */}
        <section className="mb-12 mt-16">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            Forenzné Varovania <span className="text-neutral-500 text-lg font-normal">(Obchodný vestník)</span>
          </h2>
          
          {!company.vestnikEvents || company.vestnikEvents.length === 0 ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                ✓
              </div>
              <div>
                <h3 className="font-medium text-emerald-400">Čistý štít</h3>
                <p className="text-emerald-500/80 text-sm">Žiadne aktuálne forenzné nálezy ani varovania v Obchodnom vestníku.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {company.vestnikEvents.map((event) => {
                let borderColor = "border-neutral-500";
                let badgeColor = "bg-neutral-500/10 text-neutral-400";
                
                if (event.severityLevel === "CRITICAL") {
                  borderColor = "border-rose-600";
                  badgeColor = "bg-rose-600/10 text-rose-500";
                } else if (event.severityLevel === "HIGH") {
                  borderColor = "border-amber-500";
                  badgeColor = "bg-amber-500/10 text-amber-500";
                } else if (event.severityLevel === "MEDIUM") {
                  borderColor = "border-blue-500";
                  badgeColor = "bg-blue-500/10 text-blue-400";
                }

                // Parse summary to separate text from Red Flags
                const parts = event.summary.split("\\nRed Flags: ");
                const summaryText = parts[0];
                const redFlags = parts.length > 1 ? parts[1].split(", ") : [];

                return (
                  <div key={event.id} className={`bg-white/5 backdrop-blur-sm border-y border-r border-l-4 ${borderColor} rounded-xl p-6 relative overflow-hidden group`}>
                    {event.severityLevel === "CRITICAL" && (
                      <div className="absolute top-0 right-0 w-32 h-32 bg-rose-600/10 rounded-full blur-3xl -mr-10 -mt-10 animate-pulse pointer-events-none" />
                    )}
                    
                    <div className="flex justify-between items-start mb-4 relative z-10">
                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 rounded text-xs font-bold tracking-wider ${badgeColor}`}>
                          {event.severityLevel}
                        </span>
                        <h3 className="text-xl font-medium text-white">{event.eventType}</h3>
                      </div>
                      <div className="text-sm text-neutral-400 font-mono">
                        {event.publishedAt.toLocaleDateString('sk-SK')}
                      </div>
                    </div>
                    
                    <p className="text-neutral-300 text-sm mb-4 relative z-10">
                      {summaryText}
                    </p>
                    
                    {redFlags.length > 0 && (
                      <div className="bg-black/20 rounded-lg p-4 relative z-10">
                        <h4 className="text-xs uppercase tracking-wider text-neutral-500 mb-2 font-semibold">Identifikované Red Flags</h4>
                        <ul className="space-y-1">
                          {redFlags.map((flag, idx) => (
                            <li key={idx} className="text-sm text-rose-300 flex items-start gap-2">
                              <span className="text-rose-500 mt-0.5">•</span>
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
          <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-white/10 bg-white/[0.02]">
              <h2 className="text-lg font-medium">Historický vývoj</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-neutral-400 uppercase bg-white/[0.02] border-b border-white/10">
                  <tr>
                    <th className="px-6 py-4 font-medium">Rok</th>
                    <th className="px-6 py-4 font-medium">Aktíva</th>
                    <th className="px-6 py-4 font-medium">Tržby</th>
                    <th className="px-6 py-4 font-medium">Zisk/Strata</th>
                    <th className="px-6 py-4 font-medium">Audítor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {company.financialStatements.map((stmt) => (
                    <tr key={stmt.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{stmt.year}</td>
                      <td className="px-6 py-4 text-neutral-300">{formatCurrency(stmt.totalAssets)}</td>
                      <td className="px-6 py-4 text-neutral-300">{formatCurrency(stmt.mainActivityRevenue)}</td>
                      <td className={`px-6 py-4 font-medium ${stmt.netProfitLoss < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                        {formatCurrency(stmt.netProfitLoss)}
                      </td>
                      <td className="px-6 py-4 text-neutral-400">
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

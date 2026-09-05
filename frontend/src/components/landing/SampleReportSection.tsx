"use client";

import { useT } from "@/components/LanguageProvider";
import Logo from "@/components/Logo";

const SAMPLE_REPORTS = [
  { href: "/samples/us-steel-kosice.pdf", name: "U. S. Steel Košice, s.r.o.", ico: "36199222", score: 42 },
  { href: "/samples/mondi-scp.pdf", name: "Mondi SCP, a.s.", ico: "31637051", score: 68 },
  { href: "/samples/volvo-group-slovakia.pdf", name: "Volvo Group Slovakia, s.r.o.", ico: "35729066", score: 81 },
  { href: "/samples/arcelormittal-gonvarri.pdf", name: "ArcelorMittal Gonvarri SSC Slovakia, s.r.o.", ico: "35857749", score: 75 },
];

function getScoreColor(score: number): string {
  if (score < 40) return "var(--danger)";
  if (score < 70) return "var(--warning)";
  return "var(--success)";
}

function getScoreBgColor(score: number): string {
  if (score < 40) return "var(--danger-bg)";
  if (score < 70) return "var(--warning-bg)";
  return "var(--success-bg)";
}

export default function SampleReportSection() {
  const t = useT();

  return (
    <section id="ukazka" style={{ padding: "80px 24px", background: "var(--bg-subtle)" }} className="section-pad">
      <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>{t("home.sampleTitle")}</h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto 36px" }}>{t("home.sampleDesc")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-[860px] mx-auto">
          {SAMPLE_REPORTS.map((r) => {
            const scoreColor = getScoreColor(r.score);
            const scoreBgColor = getScoreBgColor(r.score);

            return (
              <a
                key={r.href}
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col rounded-2xl overflow-hidden text-left transition-all hover:shadow-xl hover:-translate-y-1"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  textDecoration: "none",
                  transition: "all 0.2s ease",
                }}
              >
                {/* PDF preview area — matches report completion page design */}
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
                    borderBottom: "1px solid var(--border)",
                    aspectRatio: "1 / 1.414",
                    maxHeight: "280px",
                  }}
                >
                  {/* PDF cover mock — white card with green border */}
                  <div
                    className="group relative flex flex-col items-center bg-white rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
                    style={{
                      width: "72%",
                      height: "88%",
                      border: `2px solid ${scoreColor}`,
                      boxShadow: `0 8px 24px -6px color-mix(in srgb, ${scoreColor} 30%, transparent), 0 2px 6px -1px color-mix(in srgb, ${scoreColor} 12%, transparent)`,
                    }}
                  >
                    {/* Inner content resembling the PDF cover page */}
                    <div className="w-full h-full p-3 flex flex-col items-center text-center relative z-0 bg-white">
                      {/* Logo */}
                      <div className="mb-2 opacity-90 transform scale-[0.55] origin-top">
                        <Logo size="md" forceLight />
                      </div>

                      {/* Business Risk Report label */}
                      <div className="text-[7px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1.5">
                        Business Risk Report
                      </div>

                      {/* Company name */}
                      <div className="text-[11px] font-black text-slate-800 leading-tight mb-2 px-2">
                        {r.name.split(",").slice(0, 2).join(",")}
                      </div>

                      {/* Mock Stamp — circular score badge */}
                      <div className="mt-auto mb-auto relative w-20 h-20 shrink-0 flex items-center justify-center transform rotate-[-8deg] opacity-90">
                        <div className="absolute inset-0 rounded-full border-[2.5px] border-dashed opacity-60" style={{ borderColor: scoreColor }} />
                        <div className="absolute inset-[4px] rounded-full border-[1.5px] opacity-90" style={{ borderColor: scoreColor, background: scoreBgColor }} />
                        <div className="absolute inset-[12px] rounded-full border border-dashed opacity-40" style={{ borderColor: scoreColor }} />

                        <div className="font-black text-[7px] tracking-widest absolute top-[14px]" style={{ color: scoreColor }}>★ VERIFA ★</div>
                        <div className="font-black text-xl mt-1" style={{ color: scoreColor }}>
                          {r.score}
                        </div>
                        <div className="w-7 h-[2px] absolute bottom-6 opacity-50" style={{ background: scoreColor }} />
                        <div className="font-bold text-[6px] tracking-widest absolute bottom-[13px]" style={{ color: scoreColor }}>SKÓRE</div>
                      </div>

                      {/* Mock Footer Area */}
                      <div className="w-full mt-auto">
                        <div className="flex justify-between items-end mb-2">
                          <div className="space-y-1">
                            <div className="w-10 h-[2px] bg-slate-200 rounded-full"></div>
                            <div className="w-14 h-[2px] bg-slate-200 rounded-full"></div>
                            <div className="w-8 h-[2px] bg-slate-200 rounded-full"></div>
                          </div>
                          <div className="w-12 h-3 rounded-sm flex items-center px-1 gap-0.5" style={{ background: scoreBgColor, border: `1px solid ${scoreColor}` }}>
                            <div className="w-1 h-1 rounded-full" style={{ background: scoreColor }}></div>
                            <div className="w-5 h-1 rounded-full" style={{ background: scoreBgColor, border: `1px solid ${scoreColor}` }}></div>
                          </div>
                        </div>
                        <div className="w-full border-t border-slate-200 pt-2">
                          <div className="w-20 h-[2px] bg-slate-200 rounded-full mx-auto mb-1"></div>
                          <div className="w-28 h-[2px] bg-slate-200 rounded-full mx-auto"></div>
                        </div>
                      </div>
                    </div>

                    {/* Hover overlay — download hint */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-[1.5px] transition-all duration-300 z-10 opacity-0 group-hover:opacity-100" style={{ background: `color-mix(in srgb, ${scoreColor} 8%, transparent)` }}>
                      <div className="p-3 rounded-full mb-2 shadow-xl" style={{ background: scoreColor, color: "#fff" }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="font-bold px-4 py-1.5 rounded-full text-[11px] shadow-md" style={{ background: "var(--surface)", color: scoreColor }}>
                        {t("docs.zobrazit")} PDF
                      </div>
                    </div>
                  </div>

                  {/* PDF badge */}
                  <span
                    className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{ background: "var(--accent)", color: "var(--accent-button-text, #fff)" }}
                  >
                    PDF
                  </span>
                </div>

                {/* Company name + CTA */}
                <div className="p-3 flex flex-col gap-1" style={{ borderTop: `2px solid ${scoreColor}` }}>
                  <span
                    className="text-sm font-semibold leading-tight"
                    style={{ color: "var(--text)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }}
                  >
                    {r.name}
                  </span>
                  <span className="text-xs flex items-center gap-1" style={{ color: scoreColor, fontWeight: 600 }}>
                    {t("docs.zobrazit")} PDF
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
                      <path d="M5 12h14" />
                      <path d="M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

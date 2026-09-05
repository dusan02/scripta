"use client";

import { useT } from "@/components/LanguageProvider";

const SAMPLE_REPORTS = [
  { href: "/samples/us-steel-kosice.pdf", name: "U. S. Steel Košice, s.r.o.", ico: "36199222" },
  { href: "/samples/mondi-scp.pdf", name: "Mondi SCP, a.s.", ico: "31637051" },
  { href: "/samples/volvo-group-slovakia.pdf", name: "Volvo Group Slovakia, s.r.o.", ico: "35729066" },
  { href: "/samples/arcelormittal-gonvarri.pdf", name: "ArcelorMittal Gonvarri SSC Slovakia, s.r.o.", ico: "35857749" },
];

export default function SampleReportSection() {
  const t = useT();

  return (
    <section id="ukazka" style={{ padding: "80px 24px", background: "var(--bg-subtle)" }} className="section-pad">
      <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>{t("home.sampleTitle")}</h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto 36px" }}>{t("home.sampleDesc")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-[860px] mx-auto">
          {SAMPLE_REPORTS.map((r) => (
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
              {/* PDF preview area — realistic cover mock */}
              <div
                className="relative flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
                  borderBottom: "1px solid var(--border)",
                  aspectRatio: "3 / 4",
                  maxHeight: "220px",
                }}
              >
                {/* Document shape */}
                <div
                  className="flex flex-col items-center justify-start pt-4 transition-transform group-hover:scale-105"
                  style={{
                    width: "64%",
                    height: "78%",
                    background: "#fff",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {/* Top green bar like real cover */}
                  <div
                    className="w-full h-2"
                    style={{ background: "var(--accent)" }}
                  />

                  {/* Logo: V mark + Verifa */}
                  <div className="mt-3 mb-2 flex items-center gap-1">
                    <div
                      className="flex items-center justify-center rounded"
                      style={{
                        width: 22,
                        height: 22,
                        background: "var(--accent)",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 800,
                      }}
                    >
                      V
                    </div>
                    <span style={{ fontSize: 10, color: "var(--text)", fontWeight: 700 }}>
                      erifa<span style={{ color: "var(--accent)" }}>.sk</span>
                    </span>
                  </div>

                  {/* BUSINESS RISK REPORT */}
                  <div
                    className="text-center mt-1"
                    style={{
                      fontSize: 6,
                      letterSpacing: "0.1em",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    BUSINESS RISK REPORT
                  </div>

                  {/* Company name */}
                  <div
                    className="mt-2 px-4 text-center"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--text)",
                      lineHeight: 1.2,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {r.name.split(",").slice(0, 2).join(",")}
                  </div>

                  {/* Score badge — circular */}
                  <div
                    className="mt-auto mb-6 flex flex-col items-center justify-center"
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: "50%",
                      border: "3px dashed var(--accent)",
                      borderStyle: "dashed",
                      background: "rgba(255,255,255,0.8)",
                    }}
                  >
                    <span style={{ fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.08em" }}>VERIFA</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent)", lineHeight: 1 }}>83</span>
                    <span style={{ fontSize: 6, color: "var(--text-muted)" }}>SKÓRE</span>
                  </div>

                  {/* Bottom colored status bar */}
                  <div
                    className="mt-auto w-full flex items-center justify-end gap-1 px-2 py-1"
                    style={{ background: "rgba(22,163,74,0.08)" }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 6,
                        background: "var(--accent)",
                        borderRadius: 3,
                      }}
                    />
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
              <div className="p-3 flex flex-col gap-1" style={{ borderTop: "2px solid var(--accent)" }}>
                <span
                  className="text-sm font-semibold leading-tight"
                  style={{ color: "var(--text)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }}
                >
                  {r.name}
                </span>
                <span className="text-xs flex items-center gap-1" style={{ color: "var(--accent)", fontWeight: 600 }}>
                  {t("docs.zobrazit")} PDF
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
                    <path d="M5 12h14" />
                    <path d="M12 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

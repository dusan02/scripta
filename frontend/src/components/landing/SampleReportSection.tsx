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
              {/* PDF preview area — green accent with document icon */}
              <div
                className="relative flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, var(--accent-bg, #ecfdf5) 0%, var(--bg-subtle, #f0fdf4) 100%)",
                  borderBottom: "1px solid var(--border)",
                  aspectRatio: "3 / 4",
                  maxHeight: "220px",
                }}
              >
                {/* Document shape */}
                <div
                  className="flex flex-col items-center justify-center gap-2 transition-transform group-hover:scale-105"
                  style={{
                    width: "60%",
                    height: "75%",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    padding: "12px 8px",
                  }}
                >
                  {/* Verifa logo mark */}
                  <div
                    className="flex items-center justify-center rounded-lg mb-1"
                    style={{
                      width: 32,
                      height: 32,
                      background: "var(--accent)",
                    }}
                  >
                    <span style={{ color: "var(--accent-button-text, #fff)", fontSize: 16, fontWeight: 800, letterSpacing: "-0.04em" }}>V</span>
                  </div>
                  {/* Mock lines representing text */}
                  <div className="w-full flex flex-col gap-1.5 items-center">
                    <div style={{ width: "80%", height: 4, background: "var(--accent)", borderRadius: 2, opacity: 0.7 }} />
                    <div style={{ width: "60%", height: 3, background: "var(--border)", borderRadius: 2 }} />
                    <div style={{ width: "70%", height: 3, background: "var(--border)", borderRadius: 2 }} />
                    <div style={{ width: "50%", height: 3, background: "var(--border)", borderRadius: 2 }} />
                    <div style={{ width: "65%", height: 3, background: "var(--border)", borderRadius: 2 }} />
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

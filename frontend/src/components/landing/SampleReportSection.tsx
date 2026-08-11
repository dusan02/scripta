"use client";

import { useT } from "@/components/LanguageProvider";
import { FileIcon } from "@/components/icons";

const SAMPLE_REPORTS = [
  { href: "/samples/mobis-slovakia.pdf", name: "Mobis Slovakia s.r.o." },
  { href: "/samples/kamax-fasteners.pdf", name: "KAMAX Fasteners s.r.o." },
  { href: "/samples/continental-tires.pdf", name: "Continental Tires Slovakia s.r.o." },
];

export default function SampleReportSection() {
  const t = useT();

  return (
    <section id="ukazka" style={{ padding: "80px 24px", background: "var(--bg-subtle)" }} className="section-pad">
      <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>{t("home.sampleTitle")}</h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto 28px" }}>{t("home.sampleDesc")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[620px] mx-auto">
          {SAMPLE_REPORTS.map((r) => (
            <a
              key={r.href}
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:shadow-md"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", textDecoration: "none" }}
            >
              <span className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                <FileIcon size={18} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="block text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{r.name}</span>
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{t("docs.zobrazit")} PDF →</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

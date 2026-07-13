"use client";

import { useT } from "@/components/LanguageProvider";

export default function HowItWorksSection() {
  const t = useT();

  return (
    <section id="how" style={{ padding: "80px 24px", background: "var(--bg-subtle)", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.howItWorks")}</h2>
        </div>

        <div style={{ display: "flex", alignItems: "stretch", justifyContent: "center", gap: 0, flexWrap: "wrap" }} className="how-steps">
          {[
            { step: "1", icon: "search", title: t("home.step1Title"), desc: t("home.step1Desc") },
            { step: "2", icon: "check", title: t("home.step2Title"), desc: t("home.step2Desc") },
            { step: "3", icon: "download", title: t("home.step3Title"), desc: t("home.step3Desc") },
          ].map((s, i, arr) => (
            <div key={s.step} style={{ display: "flex", alignItems: "stretch" }}>
              <div className="how-step-card" style={{
                width: 220,
                height: "100%",
                textAlign: "center",
                padding: "24px 16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-start",
              }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "var(--accent)" }}>
                  {s.icon === "search" && (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  )}
                  {s.icon === "check" && (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                  )}
                  {s.icon === "download" && (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                  )}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{t("home.stepLabel")} {s.step}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{s.desc}</p>
              </div>
              {i < arr.length - 1 && (
                <div className="how-arrow" style={{
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                  width: 40,
                  justifyContent: "center",
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

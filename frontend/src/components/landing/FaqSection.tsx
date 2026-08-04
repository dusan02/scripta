"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";

export default function FaqSection() {
  const t = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const items = [
    { q: t("home.faq1q"), a: t("home.faq1a") },
    { q: t("home.faq2q"), a: t("home.faq2a") },
    { q: t("home.faq8q"), a: t("home.faq8a") },
    { q: t("home.faq3q"), a: t("home.faq3a") },
    { q: t("home.faq6q"), a: t("home.faq6a") },
    { q: t("home.faq7q"), a: t("home.faq7a") },
    { q: t("home.faq5q"), a: t("home.faq5a") },
  ];

  return (
    <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>{t("home.faqTitle")}</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const isOpen = openIndex === i;
          return (
            <div
              key={i}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : i)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "18px 22px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{item.q}</span>
                <span
                  style={{
                    color: "var(--accent)",
                    fontSize: 18,
                    flexShrink: 0,
                    transition: "transform 0.2s ease",
                    display: "inline-block",
                    transform: isOpen ? "rotate(180deg)" : "none",
                  }}
                >
                  ⌄
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: "0 22px 18px" }}>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>{item.a}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

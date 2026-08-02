"use client";

import { useT } from "@/components/LanguageProvider";

export default function NewUserBanner() {
  const t = useT();
  return (
    <div style={{
      margin: "24px 0 8px",
      padding: "16px 20px",
      background: "var(--accent-subtle, #f0fdf4)",
      border: "1px solid var(--accent, #16a34a)",
      borderRadius: "12px",
      display: "flex",
      alignItems: "flex-start",
      gap: "12px",
    }}>
      <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">🎉</span>
      <div>
        <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 4 }}>
          {t("home.welcomeTitle")}
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {t("home.welcomeDesc")}
        </p>
      </div>
    </div>
  );
}

"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import { useTheme } from "@/components/ThemeProvider";

interface AuthPageShellProps {
  children: ReactNode;
  maxWidth?: number;
  variant?: "center" | "bottom";
}

export default function AuthPageShell({ children, maxWidth = 400, variant = "center" }: AuthPageShellProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { lang, setLang, t } = useLang();

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        flexDirection: variant === "bottom" ? "column" : "row",
        alignItems: "center",
        justifyContent: variant === "bottom" ? "flex-end" : "center",
        paddingBottom: variant === "bottom" ? "6vh" : undefined,
        background: "url('/landing-bg-v2.jpg') no-repeat center center",
        backgroundSize: "cover",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.15)" }} />

      {/* Language Switcher */}
      <div style={{ position: "absolute", top: 24, right: 24, zIndex: 20, display: "flex", gap: "8px" }}>
        {(["sk", "en", "de"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              background: lang === l ? "var(--accent)" : "rgba(255, 255, 255, 0.8)",
              color: lang === l ? "#fff" : "#374151",
              border: "1px solid",
              borderColor: lang === l ? "var(--accent)" : "#D1D5DB",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: `${maxWidth}px`, position: "relative", zIndex: 10, padding: "20px" }}>
        {/* Back button */}
        <div style={{ marginBottom: "16px" }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "14px",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 500,
              transition: "color 0.2s",
              padding: "6px 12px",
              borderRadius: "8px",
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(4px)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {t("nav.spat")}
          </Link>
        </div>

        {children}
      </div>
    </div>
  );
}

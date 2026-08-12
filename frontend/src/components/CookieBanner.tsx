"use client";

import { useState, useEffect } from "react";
import { useT } from "@/components/LanguageProvider";

const CONSENT_KEY = "verifa-cookie-consent";

export function getCookieConsent(): { analytics: boolean } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CONSENT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCookieConsent(accepted: boolean) {
  localStorage.setItem(
    CONSENT_KEY,
    JSON.stringify({
      necessary: true,
      analytics: accepted,
      accepted: new Date().toISOString(),
      ...(accepted ? {} : { declined: true }),
    }),
  );
  window.dispatchEvent(new Event("cookie-consent-change"));
}

export default function CookieBanner() {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    setCookieConsent(true);
    setVisible(false);
  };

  const handleDecline = () => {
    setCookieConsent(false);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.1)",
        padding: "16px 24px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, flex: "1 1 400px", margin: 0 }}>
          {t("cookie.text")}{" "}
          <a href="/privacy" style={{ color: "var(--accent)", textDecoration: "none" }}>
            {t("cookie.more")}
          </a>
          {" · "}
          <a href="/terms" style={{ color: "var(--accent)", textDecoration: "none" }}>
            {t("home.terms")}
          </a>
        </p>
        <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
          <button
            onClick={handleDecline}
            style={{
              background: "var(--surface-hover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {t("cookie.decline")}
          </button>
          <button
            onClick={handleAccept}
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--accent-button-text)",
              cursor: "pointer",
            }}
          >
            {t("cookie.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, CSSProperties } from "react";
import { signIn } from "next-auth/react";
import { useLang } from "@/components/LanguageProvider";

const buttonStyle: CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text-secondary)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  transition: "background 0.2s, border-color 0.2s",
};

function onHoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "var(--surface-hover)";
  e.currentTarget.style.borderColor = "var(--border-strong)";
}

function onHoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "var(--surface)";
  e.currentTarget.style.borderColor = "var(--border)";
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 0H0v10h10V0z" fill="#F25022" />
      <path d="M21 0H11v10h10V0z" fill="#7FBA00" />
      <path d="M10 11H0v10h10V11z" fill="#00A4EF" />
      <path d="M21 11H11v10h10V11z" fill="#FFB900" />
    </svg>
  );
}

export default function OAuthButtons({ callbackUrl = "/dashboard" }: { callbackUrl?: string }) {
  const { t } = useLang();
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setProviders(Object.keys(data));
      })
      .catch(() => {});
  }, []);

  const hasGoogle = providers.includes("google");
  const hasAzure = providers.includes("azure-ad");

  if (!hasGoogle && !hasAzure) return null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", margin: "24px 0" }}>
        <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        <span style={{ padding: "0 12px", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {t("login.alebo")}
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {hasGoogle && (
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
            style={buttonStyle}
            onMouseEnter={onHoverIn}
            onMouseLeave={onHoverOut}
          >
            <GoogleIcon />
            {t("login.pokracovatGoogle")}
          </button>
        )}

        {hasAzure && (
          <button
            type="button"
            onClick={() => signIn("azure-ad", { callbackUrl })}
            style={buttonStyle}
            onMouseEnter={onHoverIn}
            onMouseLeave={onHoverOut}
          >
            <MicrosoftIcon />
            {t("login.pokracovatMicrosoft")}
          </button>
        )}
      </div>
    </>
  );
}

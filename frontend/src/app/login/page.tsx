"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import Logo from "@/components/Logo";
import AuthPageShell from "@/components/auth/AuthPageShell";
import ErrorAlert from "@/components/auth/ErrorAlert";
import PasswordInput from "@/components/auth/PasswordInput";
import OAuthButtons from "@/components/auth/OAuthButtons";

function LoginForm() {
  const { t } = useLang();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");

  const error = searchParams.get("error");

  const errorMap: Record<string, string> = {
    CredentialsSignin: t("login.nespravne"),
    EMAIL_NOT_VERIFIED: t("login.emailNotVerified"),
    RATE_LIMIT_EXCEEDED: "Príliš veľa neúspešných pokusov. Skúste to znova o 15 minút.",
  };
  const errorMessage = error ? (errorMap[error] || t("login.neocakavana")) : "";

  useEffect(() => {
    fetch("/api/auth/csrf")
      .then((r) => r.json())
      .then((data) => setCsrfToken(data.csrfToken))
      .catch(() => {});

    const savedEmail = localStorage.getItem("verifa-remembered-email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    if (!csrfToken) {
      e.preventDefault();
      return;
    }
    if (rememberMe) {
      localStorage.setItem("verifa-remembered-email", email.trim().toLowerCase());
    } else {
      localStorage.removeItem("verifa-remembered-email");
    }
  }

  return (
    <AuthPageShell maxWidth={400} variant="center">
      <div
        className="scale-in"
        style={{
          padding: "40px 32px",
          width: "100%",
          boxSizing: "border-box",
          background: "var(--surface)",
          borderRadius: "16px",
          boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", width: "100%" }}>
          <Logo size="lg" />
        </div>
        <h1 style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 28px" }}>
          {t("login.prihlasenie")}
        </h1>

        {errorMessage && <ErrorAlert message={errorMessage} />}

        <form action="/api/auth/callback/credentials" method="POST" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value="/dashboard" />

          <div>
            <label htmlFor="login-email" className="label" style={{ display: "block", marginBottom: "8px" }}>{t("login.email")}</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              style={{ width: "100%", padding: "10px 12px", boxSizing: "border-box" }}
            />
          </div>

          <PasswordInput
            id="login-password"
            label={t("login.heslo")}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: "var(--accent)", width: "16px", height: "16px", cursor: "pointer" }}
              />
              {t("login.zapamatatSiMa")}
            </label>
            <Link
              href="/forgot-password"
              style={{ fontSize: "14px", color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
            >
              {t("login.zabudnuteHeslo")}
            </Link>
          </div>

          <button
            type="submit"
            disabled={!csrfToken}
            className="btn-primary"
            style={{
              width: "100%",
              marginTop: "4px",
              padding: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxSizing: "border-box",
              opacity: !csrfToken ? 0.6 : 1,
            }}
          >
            {!csrfToken ? t("login.overujem") : t("login.prihlasitSa")}
          </button>
        </form>

        <OAuthButtons callbackUrl="/dashboard" />
      </div>

      <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "#fff", padding: "10px 16px", borderRadius: "8px", background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}>
        {t("login.nemateUcet")} {" "}
        <Link
          href="/register"
          style={{ color: "#fff", textDecoration: "underline", fontWeight: 600 }}
        >
          {t("login.zaregistrovatSa")}
        </Link>
      </div>
    </AuthPageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

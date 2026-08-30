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
  const [csrfToken, setCsrfToken] = useState("");

  const error = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const errorMap: Record<string, string> = {
    CredentialsSignin: t("login.nespravne"),
    EMAIL_NOT_VERIFIED: t("login.emailNotVerified"),
    RATE_LIMIT_EXCEEDED: t("login.rateLimit"),
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
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    if (!csrfToken) {
      e.preventDefault();
      return;
    }
    localStorage.setItem("verifa-remembered-email", email.trim().toLowerCase());
  }

  return (
    <AuthPageShell maxWidth={400} variant="center">
      <div
        className="scale-in"
        style={{
          padding: "32px 20px",
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

        <form action="/api/auth/callback/credentials" method="POST" onSubmit={handleSubmit} autoComplete="on" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

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
              style={{ width: "100%", padding: "12px 14px", boxSizing: "border-box", minHeight: "44px" }}
            />
          </div>

          <PasswordInput
            id="login-password"
            label={t("login.heslo")}
            autoComplete="current-password"
          />

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
              padding: "12px",
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

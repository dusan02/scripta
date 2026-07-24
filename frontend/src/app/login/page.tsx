"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import { signIn } from "next-auth/react";
import Logo from "@/components/Logo";
import AuthPageShell from "@/components/auth/AuthPageShell";
import ErrorAlert from "@/components/auth/ErrorAlert";
import PasswordInput, { PasswordInputHandle } from "@/components/auth/PasswordInput";
import OAuthButtons from "@/components/auth/OAuthButtons";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const passwordRef = useRef<PasswordInputHandle>(null);

  useEffect(() => {
    const savedEmail = localStorage.getItem("verifa-remembered-email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    passwordRef.current?.hide(); // ensure field is type="password" so browser recognizes it for save prompt
    setLoading(true);
    setError("");

    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (res?.error) {
        if (res.error === "EMAIL_NOT_VERIFIED") {
          setError(t("login.emailNotVerified"));
        } else if (res.error === "RATE_LIMIT_EXCEEDED") {
          setError("Príliš veľa neúspešných pokusov. Skúste to znova o 15 minút.");
        } else {
          setError(t("login.nespravne"));
        }
      } else {
        if (rememberMe) {
          localStorage.setItem("verifa-remembered-email", email.trim().toLowerCase());
        } else {
          localStorage.removeItem("verifa-remembered-email");
        }
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError(t("login.neocakavana"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageShell maxWidth={400} variant="center">
      {/* Card */}
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
        {/* Logo */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", width: "100%" }}>
          <Logo size="lg" />
        </div>
        <h1 style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 28px" }}>
          {t("login.prihlasenie")}
        </h1>

        {error && <ErrorAlert message={error} />}

        <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Email */}
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
              disabled={loading}
              className="input"
              style={{ width: "100%", padding: "10px 12px", boxSizing: "border-box" }}
            />
          </div>

          {/* Password */}
          <PasswordInput
            ref={passwordRef}
            id="login-password"
            label={t("login.heslo")}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={loading}
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
            disabled={loading}
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
            }}
          >
            {loading ? t("login.overujem") : t("login.prihlasitSa")}
          </button>
        </form>

        {/* Divider + Social Logins — only if OAuth providers are configured */}
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

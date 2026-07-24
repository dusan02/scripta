"use client";

import { useState, FormEvent } from "react";
import Logo from "@/components/Logo";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import AuthPageShell from "@/components/auth/AuthPageShell";
import ErrorAlert from "@/components/auth/ErrorAlert";
import PasswordInput from "@/components/auth/PasswordInput";
import OAuthButtons from "@/components/auth/OAuthButtons";

function Spinner() {
  return (
    <svg 
      className="animate-spin" 
      style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }}
      viewBox="0 0 24 24" 
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export default function RegisterPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const passwordStrength = (() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(score, 4);
  })();

  const strengthLabels = [t("register.velmiSlabe"), t("register.slabe"), t("register.stredne"), t("register.silne"), t("register.velmiSilne")];
  const strengthColors = ["#EF4444", "#F59E0B", "#EAB308", "#22C55E", "#16A34A"];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || t("register.zlyhalo"));
        setLoading(false);
        return;
      }

      setEmailSent(true);
    } catch {
      setError(t("register.neocakavana"));
    } finally {
      setLoading(false);
    }
  }

  if (emailSent) {
    return (
      <AuthPageShell maxWidth={420} variant="center">
        <div
          className="scale-in"
          style={{
            padding: "40px 32px",
            background: "var(--surface)",
            borderRadius: "16px",
            boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.05)",
            textAlign: "center",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
            <Logo size="lg" />
          </div>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>Skontrolujte svoj e-mail</h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 8 }}>
            Poslali sme verifikačný odkaz na <strong>{email}</strong>.
          </p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
            Kliknite na odkaz v e-maile pre aktiváciu vášho účtu.
          </p>
          <Link
            href="/login"
            style={{
              display: "block",
              padding: "10px",
              background: "var(--surface-hover)",
              color: "var(--text)",
              fontWeight: 500,
              fontSize: 14,
              borderRadius: "8px",
              border: "1px solid var(--border)",
              textDecoration: "none",
            }}
          >
            Späť na prihlásenie
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell maxWidth={380} variant="bottom">
      {/* Card */}
      <div
        className="scale-in"
        style={{
          padding: "32px",
          width: "100%",
          boxSizing: "border-box",
          background: "var(--surface)",
          borderRadius: "16px",
          boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.05)",
          border: "1px solid",
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", width: "100%" }}>
          <Logo size="lg" />
        </div>
        <h1 style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 28px" }}>
          {t("register.registracia")}
        </h1>

        {error && <ErrorAlert message={error} />}

        <form onSubmit={handleSubmit} noValidate autoComplete="on" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Email */}
          <div>
            <label htmlFor="register-email" className="label" style={{ display: "block", marginBottom: "8px" }}>{t("register.email")}</label>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="jan@advokacia.sk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="input"
              style={{ width: "100%", padding: "10px 12px", boxSizing: "border-box" }}
            />
          </div>

          {/* Password */}
          <div>
            <PasswordInput
              id="register-password"
              label={t("register.hesloMin8")}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={loading}
            />
            {password && (
              <div className="mt-2 fade-in">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="h-1 flex-1 rounded-full transition-colors duration-200"
                      style={{ background: i < passwordStrength ? strengthColors[passwordStrength] : "var(--border)" }}
                    />
                  ))}
                </div>
                <span className="text-[11px] mt-1 block" style={{ color: strengthColors[passwordStrength] }}>
                  {strengthLabels[passwordStrength]}
                </span>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            id="register-submit-btn"
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: "100%", marginTop: "12px", padding: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box" }}
          >
            {loading ? (
              <><Spinner /> {t("register.spracuvam")}</>
            ) : (
              t("register.zaregistrovatSa")
            )}
          </button>
        </form>

        {/* Divider + Social Registrations — only if OAuth providers are configured */}
        <OAuthButtons callbackUrl="/dashboard" />

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "#fff", padding: "10px 16px", borderRadius: "8px", background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}>
          {t("register.uzMateUcet")}{" "}
          <Link
            href="/login"
            style={{ color: "#fff", textDecoration: "underline", fontWeight: 500 }}
          >
            {t("register.prihlasitSa")}
          </Link>
        </div>
      </div>

      {/* Footer */}
      <p
        style={{ textAlign: "center", fontSize: "13px", marginTop: "24px", color: "#fff", padding: "8px 14px", borderRadius: "8px", background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      >
        {t("register.urceneAdvokatom")}{" "}
        <a
          href="mailto:info@verifa.sk"
          style={{ color: "#10b981", textDecoration: "underline", fontWeight: 600 }}
        >
          {t("register.kontakt")}
        </a>
      </p>
    </AuthPageShell>
  );
}

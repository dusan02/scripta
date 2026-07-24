"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import { useLang } from "@/components/LanguageProvider";

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
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const t = useT();
  const { lang, setLang } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
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
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "url('/landing-bg-v2.jpg') no-repeat center center",
          backgroundSize: "cover",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.15)" }} />
        <div style={{ width: "100%", maxWidth: "420px", position: "relative", zIndex: 10, padding: "20px" }}>
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
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: "6vh",
        background: "url('/landing-bg-v2.jpg') no-repeat center center",
        backgroundSize: "cover",
        position: "relative"
      }}
    >
      {/* Overlay */}
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
              transition: "all 0.2s"
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "380px", position: "relative", zIndex: 10 }}>

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
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)"
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", width: "100%" }}>
            <Logo size="lg" />
          </div>
          <h1 style={{ textAlign: "center", fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 28px" }}>
            {t("register.registracia")}
          </h1>

          {/* Error */}
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "13px",
                marginBottom: "24px",
                background: "var(--danger-bg)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
              role="alert"
            >
              <svg style={{ width: "16px", height: "16px", flexShrink: 0, marginTop: "2px" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
              <span>{error}</span>
            </div>
          )}

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
              <label htmlFor="register-password" className="label" style={{ display: "block", marginBottom: "8px" }}>{t("register.hesloMin8")}</label>
              <div style={{ position: "relative" }}>
                <input
                  id="register-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="input"
                  style={{ width: "100%", padding: "10px 36px 10px 12px", boxSizing: "border-box" }}
                />
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setShowPassword((v) => !v);
                  }}
                  style={{ 
                    position: "absolute", 
                    right: "10px", 
                    top: "50%", 
                    transform: "translateY(-50%)", 
                    padding: "4px", 
                    background: "transparent", 
                    border: "none", 
                    cursor: "pointer", 
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 10
                  }}
                  aria-label={showPassword ? t("form.skryt") : t("form.zobrazit")}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
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

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", margin: "24px 0" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            <span style={{ padding: "0 12px", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("login.alebo")}</span>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          </div>

          {/* Social Registrations */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
              style={{
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
                transition: "background 0.2s, border-color 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-hover)";
                e.currentTarget.style.borderColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {t("login.pokracovatGoogle")}
            </button>

            <button
              type="button"
              onClick={() => signIn("azure-ad", { callbackUrl: "/dashboard" })}
              style={{
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
                transition: "background 0.2s, border-color 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-hover)";
                e.currentTarget.style.borderColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 0H0v10h10V0z" fill="#F25022"/>
                <path d="M21 0H11v10h10V0z" fill="#7FBA00"/>
                <path d="M10 11H0v10h10V11z" fill="#00A4EF"/>
                <path d="M21 11H11v10h10V11z" fill="#FFB900"/>
              </svg>
              {t("login.pokracovatMicrosoft")}
            </button>
          </div>

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
      </div>
    </div>
  );
}

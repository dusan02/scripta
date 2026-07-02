"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";

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
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
          name: name.trim(),
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

      // Automatically sign in after successful registration
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(t("register.uspechPrihlasenieZlyhalo"));
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError(t("register.neocakavana"));
    } finally {
      setLoading(false);
    }
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

      {/* Dark mode toggle */}
      <button
        onClick={toggle}
        title={isDark ? t("nav.svetly") : t("nav.tmavy")}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
        style={{
          position: "absolute",
          top: 24,
          right: 24,
          zIndex: 20,
          background: "var(--bg-muted)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          backdropFilter: "blur(4px)"
        }}
      >
        {isDark ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        )}
      </button>

      <div style={{ width: "100%", maxWidth: "380px", position: "relative", zIndex: 10 }}>

        {/* Card */}
        <div 
          className="scale-in" 
          style={{ 
            padding: "32px", 
            width: "100%", 
            boxSizing: "border-box", 
            background: "#FFFFFF", 
            borderRadius: "16px",
            boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.05)",
            border: "1px solid",
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)"
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px", width: "100%" }}>
            <Logo size="lg" />
          </div>

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
            {/* Name */}
            <div>
              <label htmlFor="register-name" className="label" style={{ display: "block", marginBottom: "8px" }}>{t("register.menoPriezvisko")}</label>
              <input
                id="register-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                placeholder="Jozef Mrkvička"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="input"
                style={{ width: "100%", padding: "10px 12px", boxSizing: "border-box" }}
              />
            </div>

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
          
          <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "var(--text-muted)" }}>
            {t("register.uzMateUcet")}{" "}
            <Link
              href="/login"
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
            >
              {t("register.prihlasitSa")}
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p
          style={{ textAlign: "center", fontSize: "13px", marginTop: "24px", color: "var(--text-muted)" }}
        >
          {t("register.urceneAdvokatom")}{" "}
          <a
            href="mailto:info@verifa.sk"
            style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 500 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          >
            {t("register.kontakt")}
          </a>
        </p>
      </div>
    </div>
  );
}

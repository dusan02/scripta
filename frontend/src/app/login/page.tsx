"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import { signIn } from "next-auth/react";
import Logo from "@/components/Logo";

import { useTheme } from "@/components/ThemeProvider";

export default function LoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { lang, setLang, t } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    const savedEmail = localStorage.getItem("verifa-remembered-email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "url('/landing-bg-v2.jpg') no-repeat center center",
        backgroundSize: "cover",
        position: "relative"
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
              transition: "all 0.2s"
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "400px", position: "relative", zIndex: 10, padding: "20px" }}>
        
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
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px", width: "100%" }}>
            <Logo size="lg" />
          </div>

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
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Email */}
            <div>
              <label htmlFor="login-email" style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)" }}>{t("login.email")}</label>
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
                style={{ 
                  width: "100%", 
                  padding: "10px 12px", 
                  boxSizing: "border-box",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: "14px",
                  outline: "none",
                  transition: "border-color 0.2s, box-shadow 0.2s"
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "var(--accent)";
                  e.target.style.boxShadow = "0 0 0 3px rgba(67, 160, 71, 0.1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "var(--border)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="login-password" style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)" }}>{t("login.heslo")}</label>
              <div style={{ position: "relative" }}>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  style={{ 
                    width: "100%", 
                    padding: "10px 12px", 
                    boxSizing: "border-box",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontSize: "14px",
                    outline: "none",
                    transition: "border-color 0.2s, box-shadow 0.2s"
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--accent)";
                    e.target.style.boxShadow = "0 0 0 3px rgba(67, 160, 71, 0.1)"; 
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--border)";
                    e.target.style.boxShadow = "none";
                  }}
                />
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setShowPassword((v) => !v);
                  }}
                  style={{ 
                    position: "absolute", 
                    right: "12px", 
                    top: "50%", 
                    transform: "translateY(-50%)", 
                    background: "transparent", 
                    border: "none", 
                    cursor: "pointer", 
                    color: "#9CA3AF",
                    fontSize: "13px",
                    fontWeight: 500
                  }}
                >
                  {showPassword ? t("form.skryt") : t("form.zobrazit")}
                </button>
              </div>
            </div>

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
              style={{
                width: "100%",
                padding: "10px",
                marginTop: "4px",
                background: "var(--text)",
                color: "var(--surface)",
                fontWeight: 500,
                fontSize: "14px",
                borderRadius: "8px",
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "transform 0.1s, opacity 0.2s, background 0.2s",
                opacity: loading ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
              onMouseEnter={(e) => { if(!loading) e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={(e) => { if(!loading) e.currentTarget.style.opacity = "1"; }}
            >
              {loading ? t("login.overujem") : t("login.prihlasitSa")}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", margin: "24px 0" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            <span style={{ padding: "0 12px", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("login.alebo")}</span>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          </div>

          {/* Social Logins */}
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

        </div>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "var(--text-secondary)" }}>
          {t("login.nemateUcet")} {" "}
          <Link 
            href="/register" 
            style={{ color: "var(--text)", textDecoration: "none", fontWeight: 600 }}
          >
            {t("login.zaregistrovatSa")}
          </Link>
        </div>
        
      </div>
    </div>
  );
}

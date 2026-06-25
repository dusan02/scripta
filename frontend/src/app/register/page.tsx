"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Link from "next/link";

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
        setError(data.message || "Registrácia zlyhala. Skúste znova.");
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
        setError("Registrácia prebehla, ale automatické prihlásenie zlyhalo.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Neočakávaná chyba komunikácie so serverom.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "var(--bg)",
        position: "relative"
      }}
    >
      {/* Subtle background grid */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.4,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px)," +
            "linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 60% 50% at 50% 0%, black 70%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 50% at 50% 0%, black 70%, transparent 100%)",
        }}
      />

      <div style={{ width: "100%", maxWidth: "380px", position: "relative", zIndex: 10 }}>

        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "36px", userSelect: "none" }}>
          <Logo size="lg" />
          <p style={{ fontSize: "15px", color: "var(--text-muted)", margin: "4px 0 0 0", fontWeight: 500 }}>
            Due Diligence System
          </p>
        </div>

        {/* Card */}
        <div className="card scale-in" style={{ padding: "32px", width: "100%", boxSizing: "border-box" }}>
          <h2
            style={{ fontSize: "20px", fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", margin: "0 0 6px 0" }}
          >
            Nová registrácia
          </h2>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 24px 0" }}>
            Vytvorte si účet pre prístup do platformy.
          </p>

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
              <label htmlFor="register-name" className="label" style={{ display: "block", marginBottom: "8px" }}>Meno a Priezvisko</label>
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
              <label htmlFor="register-email" className="label" style={{ display: "block", marginBottom: "8px" }}>E-mail</label>
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
              <label htmlFor="register-password" className="label" style={{ display: "block", marginBottom: "8px" }}>Heslo (min. 8 znakov)</label>
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
                  aria-label={showPassword ? "Skryť" : "Zobraziť"}
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
                <><Spinner /> Spracúvam…</>
              ) : (
                "Zaregistrovať sa"
              )}
            </button>
          </form>
          
          <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "var(--text-muted)" }}>
            Už máte účet?{" "}
            <Link 
              href="/login" 
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
            >
              Prihlásiť sa
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p
          style={{ textAlign: "center", fontSize: "13px", marginTop: "24px", color: "var(--text-muted)" }}
        >
          Systém je určený výhradne pre advokátov.{" "}
          <a
            href="mailto:info@registro.sk"
            style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 500 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          >
            Kontakt
          </a>
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState, FormEvent, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Neplatný alebo chýbajúci odkaz. Požiadajte o obnovu hesla znova.");
    }
  }, [token]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Nepodarilo sa obnoviť heslo.");
      } else {
        setSuccess(true);
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "36px", userSelect: "none" }}>
          <Logo size="lg" />
          <p style={{ fontSize: "15px", color: "var(--text-muted)", margin: "4px 0 0 0", fontWeight: 500 }}>
            Due Diligence System
          </p>
        </div>

        <div className="card scale-in" style={{ padding: "32px", width: "100%", boxSizing: "border-box" }}>
          <h2
            style={{ fontSize: "20px", fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", margin: "0 0 6px 0" }}
          >
            Nové heslo
          </h2>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 24px 0" }}>
            Zadajte svoje nové silné heslo.
          </p>

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
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.15)",
                color: "#ef4444",
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

          {success ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ 
                width: "48px", height: "48px", borderRadius: "50%", 
                background: "rgba(16,185,129,0.1)", color: "#10b981", 
                display: "flex", alignItems: "center", justifyContent: "center", 
                margin: "0 auto 16px auto" 
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <h3 style={{ fontSize: "16px", margin: "0 0 8px 0", color: "var(--text)" }}>Heslo bolo zmenené</h3>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 24px 0", lineHeight: 1.5 }}>
                Vaše heslo bolo úspešne aktualizované. Teraz sa môžete prihlásiť.
              </p>
              <Link 
                href="/login" 
                className="btn-primary"
                style={{ width: "100%", padding: "10px", display: "inline-block", textDecoration: "none", boxSizing: "border-box" }}
              >
                Prejsť na prihlásenie
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label htmlFor="reset-password" className="label" style={{ display: "block", marginBottom: "8px" }}>Nové heslo (min. 8 znakov)</label>
                <div style={{ position: "relative" }}>
                  <input
                    id="reset-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading || !token}
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

              <button
                type="submit"
                disabled={loading || !token}
                className="btn-primary"
                style={{ width: "100%", marginTop: "12px", padding: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box" }}
              >
                {loading ? (
                  <><Spinner /> Ukladám…</>
                ) : (
                  "Uložiť nové heslo"
                )}
              </button>
            </form>
          )}

          {!success && (
            <div style={{ textAlign: "center", marginTop: "24px", fontSize: "14px", color: "var(--text-muted)" }}>
              <Link 
                href="/login" 
                style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
              >
                Zrušiť a späť na prihlásenie
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg)" }} />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

"use client";

import { useState, FormEvent } from "react";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Nepodarilo sa odoslať žiadosť.");
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
            Zabudnuté heslo
          </h2>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 24px 0" }}>
            Zadajte e-mail pre obnovu hesla.
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

          {success ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ 
                width: "48px", height: "48px", borderRadius: "50%", 
                background: "var(--success-bg)", color: "var(--success)", 
                display: "flex", alignItems: "center", justifyContent: "center", 
                margin: "0 auto 16px auto" 
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <h3 style={{ fontSize: "16px", margin: "0 0 8px 0", color: "var(--text)" }}>E-mail odoslaný</h3>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 24px 0", lineHeight: 1.5 }}>
                Ak účet <strong>{email}</strong> existuje, zaslali sme Vám inštrukcie na obnovu hesla.
              </p>
              <Link 
                href="/login" 
                className="btn-primary"
                style={{ width: "100%", padding: "10px", display: "inline-block", textDecoration: "none", boxSizing: "border-box" }}
              >
                Späť na prihlásenie
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label htmlFor="forgot-email" className="label" style={{ display: "block", marginBottom: "8px" }}>Váš E-mail</label>
                <input
                  id="forgot-email"
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

              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
                style={{ width: "100%", marginTop: "12px", padding: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box" }}
              >
                {loading ? (
                  <><Spinner /> Odosielam…</>
                ) : (
                  "Zaslať odkaz na obnovu"
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
                Späť na prihlásenie
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

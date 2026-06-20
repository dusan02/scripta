"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Spinner ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

function ScriptaLogo() {
  return (
    <div className="flex flex-col items-center gap-3 mb-8">
      {/* Icon mark */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          boxShadow: "0 0 32px rgba(16,185,129,0.35), 0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        {/* Scale of justice / document icon */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      </div>

      {/* Wordmark */}
      <div className="text-center">
        <div className="text-2xl font-extrabold tracking-tight text-white">
          Scripta<span className="text-emerald-400">.sk</span>
        </div>
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.2em] mt-0.5"
          style={{ color: "#64748b" }}
        >
          Evidence Binder System
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const formEmail = formData.get("email") as string;
    const formPassword = formData.get("password") as string;

    try {
      const result = await signIn("credentials", {
        email: (formEmail || email).trim().toLowerCase(),
        password: formPassword || password,
        redirect: false,
      });

      if (result?.error) {
        // NextAuth vracia "CredentialsSignin" pre nesprávne údaje
        setError(
          result.error === "CredentialsSignin"
            ? "Nesprávny e-mail alebo heslo. Skontrolujte zadané údaje."
            : "Prihlásenie zlyhalo. Skúste to znova neskôr."
        );
        return;
      }

      if (result?.ok) {
        // Úspech — presmerujeme na Dashboard
        router.push("/");
        router.refresh(); // invaliduje Server Component cache (napr. NavBar wallet balance)
      }
    } catch {
      setError("Neočakávaná chyba. Skúste to znova neskôr.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: "#060b18",
        backgroundImage:
          "radial-gradient(ellipse at 30% 40%, rgba(16,185,129,0.06) 0%, transparent 55%), " +
          "radial-gradient(ellipse at 75% 15%, rgba(22,45,88,0.35) 0%, transparent 50%), " +
          "radial-gradient(ellipse at 50% 100%, rgba(6,11,24,0.8) 0%, transparent 60%)",
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), " +
            "linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md animate-fade-in">
        {/* ── Card ── */}
        <div
          className="rounded-2xl p-8 sm:p-10"
          style={{
            background: "rgba(10, 22, 40, 0.85)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow:
              "0 24px 80px rgba(0,0,0,0.6), " +
              "0 0 0 1px rgba(16,185,129,0.06) inset, " +
              "0 1px 0 rgba(255,255,255,0.06) inset",
            backdropFilter: "blur(20px)",
          }}
        >
          <ScriptaLogo />

          {/* ── Heading ── */}
          <div className="text-center mb-8">
            <h1 className="text-xl font-bold text-slate-100">
              Prihlásenie do systému
            </h1>
            <p className="text-sm text-slate-500 mt-1.5">
              Zadajte svoje prihlasovacie údaje
            </p>
          </div>

          {/* ── Error alert ── */}
          {error && (
            <div
              className="flex items-start gap-3 rounded-lg px-4 py-3 mb-6 text-sm animate-fade-in"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#fca5a5",
              }}
              role="alert"
              aria-live="polite"
            >
              <svg
                className="w-4 h-4 mt-0.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* ── Form ── */}
          <form
            onSubmit={handleSubmit}
            noValidate
            autoComplete="on"
            aria-label="Prihlasovací formulár"
          >
            <div className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="login-email" className="form-label">
                  E-mail
                </label>
                <div className="relative">
                  <span
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "#475569" }}
                    aria-hidden="true"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
                    </svg>
                  </span>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="jan.novak@advokacia.sk"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="input-field pl-10"
                    aria-required="true"
                    aria-describedby={error ? "login-error" : undefined}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="form-label mb-0">
                    Heslo
                  </label>
                  {/* Placeholder pre budúci "zabudol som heslo" link */}
                  <span
                    className="text-[11px]"
                    style={{ color: "#334155" }}
                    title="Resetovanie hesla nie je v tejto verzii dostupné. Kontaktujte podporu."
                  >
                    Zabudnuté heslo?
                  </span>
                </div>
                <div className="relative">
                  <span
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "#475569" }}
                    aria-hidden="true"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  </span>
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
                    className="input-field pl-10 pr-11"
                    aria-required="true"
                  />
                  {/* Show / hide password toggle */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
                    style={{ color: "#475569" }}
                    aria-label={showPassword ? "Skryť heslo" : "Zobraziť heslo"}
                    tabIndex={0}
                  >
                    {showPassword ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Submit ── */}
            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center mt-7 py-3 text-base"
            >
              {loading ? (
                <>
                  <Spinner />
                  Overujem prístup…
                </>
              ) : (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  Prihlásiť sa do systému
                </>
              )}
            </button>
          </form>

          {/* ── Divider ── */}
          <div className="flex items-center gap-3 my-6">
            <div className="divider flex-1" />
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "#1e293b" }}>
              Prístup
            </span>
            <div className="divider flex-1" />
          </div>

          {/* ── B2B access note ── */}
          <p className="text-center text-xs" style={{ color: "#334155" }}>
            Nemáte prístup do systému?{" "}
            <a
              href="mailto:info@scripta.sk"
              className="transition-colors duration-150"
              style={{ color: "#475569" }}
              onMouseEnter={(e) => ((e.target as HTMLAnchorElement).style.color = "#10b981")}
              onMouseLeave={(e) => ((e.target as HTMLAnchorElement).style.color = "#475569")}
            >
              Kontaktovať podporu
            </a>
          </p>
        </div>

        {/* ── Footer note ── */}
        <p className="text-center text-[11px] mt-5" style={{ color: "#1e293b" }}>
          Scripta.sk — Systém je určený výhradne pre advokátov a právnikov.
        </p>
      </div>
    </div>
  );
}

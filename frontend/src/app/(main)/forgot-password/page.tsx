"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useT } from "@/components/LanguageProvider";
import Logo from "@/components/Logo";
import AuthPageShell from "@/components/auth/AuthPageShell";
import ErrorAlert from "@/components/auth/ErrorAlert";
import Spinner from "@/components/auth/Spinner";
import SuccessAlert from "@/components/auth/SuccessAlert";

export default function ForgotPasswordPage() {
  const t = useT();
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
        setError(data.message || t("forgot.nepodarilo"));
      } else {
        setSuccess(true);
      }
    } catch {
      setError(t("forgot.neocakavana"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageShell maxWidth={380} variant="center">
      <div
        className="scale-in"
        style={{
          padding: "28px 20px",
          width: "100%",
          boxSizing: "border-box",
          background: "var(--surface)",
          borderRadius: "16px",
          boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px", width: "100%" }}>
          <Logo size="lg" />
        </div>

        {error && <ErrorAlert message={error} />}

        {success ? (
          <SuccessAlert
            title={t("forgot.emailOdoslany")}
            message={t("forgot.emailInstrukcie", { email })}
            actionLabel={t("forgot.spatPrihlasenie")}
            actionHref="/login"
          />
        ) : (
          <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label htmlFor="forgot-email" className="label" style={{ display: "block", marginBottom: "8px" }}>{t("forgot.vasEmail")}</label>
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
                style={{ width: "100%", padding: "12px 14px", boxSizing: "border-box" }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ width: "100%", marginTop: "12px", padding: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box" }}
            >
              {loading ? (
                <><Spinner /> {t("forgot.odosielam")}</>
              ) : (
                t("forgot.zaslatOdkaz")
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
              {t("forgot.spatPrihlasenie")}
            </Link>
          </div>
        )}
      </div>
    </AuthPageShell>
  );
}

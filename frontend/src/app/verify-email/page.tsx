"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { useLang } from "@/components/LanguageProvider";

export default function VerifyEmailPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useLang();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setMessage("Chýba verifikačný token.");
      return;
    }

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          setMessage(data.message || "Účet bol úspešne aktivovaný.");
        } else {
          setStatus("error");
          setMessage(data.message || "Aktivácia zlyhala.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Nastala chyba pri komunikácii so serverom.");
      });
  }, [params]);

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
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)" }} />

      <div style={{ width: "100%", maxWidth: "400px", position: "relative", zIndex: 10, padding: "20px" }}>
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
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px" }}>
            <Logo size="lg" />
          </div>

          {status === "loading" && (
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              <svg className="animate-spin mx-auto mb-4" style={{ width: 32, height: 32 }} viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Aktivujem váš účet...
            </div>
          )}

          {status === "success" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>Účet aktivovaný</h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>{message}</p>
              <button
                onClick={() => router.push("/login")}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "var(--accent)",
                  color: "var(--accent-button-text)",
                  fontWeight: 500,
                  fontSize: 14,
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Prihlásiť sa
              </button>
            </>
          )}

          {status === "error" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>Aktivácia zlyhala</h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>{message}</p>
              <Link
                href="/register"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px",
                  background: "var(--surface-hover)",
                  color: "var(--text)",
                  fontWeight: 500,
                  fontSize: 14,
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  textDecoration: "none",
                  boxSizing: "border-box",
                }}
              >
                Späť na registráciu
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

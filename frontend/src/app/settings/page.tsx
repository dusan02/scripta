"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function SettingsPage() {
  const [orsrExtractType, setOrsrExtractType] = useState<"CURRENT" | "FULL">("CURRENT");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.orsrExtractType) setOrsrExtractType(data.orsrExtractType);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orsrExtractType }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-[600px] mx-auto px-4 sm:px-6 py-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-6">
        <Link
          href="/"
          className="transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          Overenie subjektu
        </Link>
        <span style={{ color: "var(--border-strong)" }}>/</span>
        <span style={{ color: "var(--text)" }}>Nastavenia</span>
      </div>

      <h1
        className="text-2xl font-bold tracking-tight mb-1"
        style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
      >
        Nastavenia
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
        Prispôsobte si správanie aplikácie.
      </p>

      {/* ORSR Extract Type */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              Typ výpisu z ORSR
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Vyberte, aký typ výpisu sa stiahne z Obchodného registra SR.
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <label
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
              style={{
                background: orsrExtractType === "CURRENT" ? "var(--bg-muted)" : "transparent",
                border: `1px solid ${orsrExtractType === "CURRENT" ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              <input
                type="radio"
                name="orsrExtractType"
                value="CURRENT"
                checked={orsrExtractType === "CURRENT"}
                onChange={() => setOrsrExtractType("CURRENT")}
                className="accent-emerald-500"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  Aktuálny výpis
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Len aktuálne platné údaje o firme. Rýchlejšie, kratší dokument.
                </div>
              </div>
            </label>

            <label
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
              style={{
                background: orsrExtractType === "FULL" ? "var(--bg-muted)" : "transparent",
                border: `1px solid ${orsrExtractType === "FULL" ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              <input
                type="radio"
                name="orsrExtractType"
                value="FULL"
                checked={orsrExtractType === "FULL"}
                onChange={() => setOrsrExtractType("FULL")}
                className="accent-emerald-500"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  Úplný výpis
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Vrátane historickej zmeny (bývalé sídla, spoločníci, atď.). Rozsiahlejší dokument.
                </div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="btn-primary"
          style={{
            background: "var(--accent)",
            color: "white",
            border: "none",
            height: "40px",
            padding: "0 24px",
            fontSize: "13.5px",
            fontWeight: 600,
            borderRadius: "8px",
            cursor: saving || loading ? "not-allowed" : "pointer",
            opacity: saving || loading ? 0.6 : 1,
          }}
        >
          {saving ? "Ukladám…" : "Uložiť nastavenia"}
        </button>
        {saved && (
          <span
            className="text-xs font-medium fade-in"
            style={{ color: "var(--accent)" }}
          >
            ✓ Uložené
          </span>
        )}
      </div>
    </div>
  );
}

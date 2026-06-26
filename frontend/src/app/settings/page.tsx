"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [orsrExtractType, setOrsrExtractType] = useState<"CURRENT" | "FULL">("CURRENT");
  const [crzDateFrom, setCrzDateFrom] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("Not authorized");
        return r.json();
      })
      .then((data) => {
        if (data.orsrExtractType) setOrsrExtractType(data.orsrExtractType);
        if (data.crzDateFrom) setCrzDateFrom(data.crzDateFrom);
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
        body: JSON.stringify({ orsrExtractType, crzDateFrom: crzDateFrom || null }),
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
    <div className="max-w-[600px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
      <div className="text-center mb-8">
        <h1
          className="text-2xl font-bold tracking-tight mb-1"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          Nastavenia
        </h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
        Prispôsobte si správanie aplikácie.
      </p>
      </div>

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

      {/* CRZ Date From */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              CRZ — dátum "od"
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Nastavte počiatočný dátum pre vyhľadávanie v Centrálnom registri zmlúv.
              Ak ponecháte prázdne, použije sa default 1 rok dozadu.
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: "var(--bg-muted)" }}
          />
        ) : (
          <div>
            <input
              type="date"
              value={crzDateFrom}
              onChange={(e) => setCrzDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
            {crzDateFrom && (
              <button
                onClick={() => setCrzDateFrom("")}
                className="text-xs mt-2"
                style={{ color: "var(--text-muted)" }}
              >
                ↺ Zrušiť a použiť default (1 rok dozadu)
              </button>
            )}
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

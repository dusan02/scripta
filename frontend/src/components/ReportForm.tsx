"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const SOURCES = [
  { id: "ORSR",       label: "ORSR",            sublabel: "Obchodný register",    cost: 0 },
  { id: "ZRSR",       label: "ŽRSR",            sublabel: "Živnostenský register", cost: 0 },
  { id: "RPVS",       label: "RPVS",            sublabel: "Register part. ver. sektora", cost: 0 },
  { id: "INSOLVENCY", label: "Insolvenčný reg.", sublabel: "Register úpadcov",     cost: 0 },
  { id: "CRE",        label: "CRE",             sublabel: "Exekúcie",              cost: 5 },
];

function isValidIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(ico[i], 10) * (8 - i);
  return (11 - (sum % 11)) % 10 === parseInt(ico[7], 10);
}

type TargetType = "COMPANY" | "PERSON";

export default function SearchForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [targetType, setTargetType] = useState<TargetType>("COMPANY");
  const [ico, setIco] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [selected, setSelected] = useState<string[]>(["ORSR", "ZRSR", "RPVS", "INSOLVENCY"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icoError, setIcoError] = useState<string | null>(null);

  const toggleSource = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));

  const totalCost = SOURCES.filter((s) => selected.includes(s.id)).reduce(
    (sum, s) => sum + s.cost,
    0
  );

  const isValid =
    selected.length > 0 &&
    !icoError &&
    (targetType === "COMPANY"
      ? ico.length === 8
      : name.trim() && surname.trim() && birthDate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { targetType, sources: selected };
      if (targetType === "COMPANY") {
        body.ico = ico;
      } else {
        body.name = name;
        body.surname = surname;
        body.birthDate = new Date(birthDate).toISOString();
      }

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          res.status === 402
            ? `Nedostatok kreditov. Potrebujete ${data.required} kr., máte ${data.balance} kr.`
            : (data.error ?? "Nastala chyba.")
        );
        return;
      }

      router.push(`/reports/${data.reportRequestId}`);
    } catch {
      setError("Sieťová chyba. Skúste znova.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">

      {/* ── Type toggle ───────────────────────── */}
      <div className="flex justify-center mb-5">
        <div
          className="flex p-1 gap-1 rounded-lg"
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            width: "fit-content",
          }}
        >
          {(["COMPANY", "PERSON"] as TargetType[]).map((type) => {
            const active = targetType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setTargetType(type)}
                className="px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-150"
                style={{
                  background: active ? "var(--surface)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                  border: active ? "1px solid var(--border)" : "1px solid transparent",
                }}
              >
                {type === "COMPANY" ? "Firma (IČO)" : "Fyzická osoba"}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main search bar ───────────────────── */}
      {targetType === "COMPANY" ? (
        <div
          className="flex items-center rounded-2xl transition-all duration-200"
          style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
          onFocus={() => {
            const el = document.getElementById("search-wrap");
            if (el) el.style.borderColor = "var(--accent)";
          }}
          id="search-wrap"
        >
          {/* Search icon */}
          <div className="pl-5 pr-3 flex-shrink-0">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: "var(--text-muted)" }}
            >
              <path
                d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>

          {/* Input */}
          <input
            ref={inputRef}
            id="ico"
            type="text"
            inputMode="numeric"
            placeholder="Zadajte IČO..."
            value={ico}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 8);
              setIco(val);
              if (val.length === 8)
                setIcoError(isValidIco(val) ? null : "Neplatné IČO — nesprávna kontrolná číslica.");
              else setIcoError(null);
            }}
            className="flex-1 bg-transparent outline-none"
            style={{
              fontSize: "1.125rem",
              letterSpacing: "-0.01em",
              color: "var(--text)",
              padding: "16px 0",
              caretColor: "var(--accent)",
              fontFamily: "inherit",
            }}
            autoFocus
            required
          />

          {/* Counter */}
          {ico.length > 0 && (
            <span
              className="px-3 text-xs flex-shrink-0"
              style={{ color: ico.length === 8 && !icoError ? "var(--accent)" : "var(--text-muted)" }}
            >
              {ico.length}/8
            </span>
          )}

          {/* Submit button */}
          <div className="pr-2 flex-shrink-0">
            <button
              id="submit-report-btn"
              type="submit"
              disabled={loading || !isValid}
              className="flex items-center gap-2 px-5 rounded-xl font-medium text-sm transition-all duration-150"
              style={{
                height: "44px",
                background: isValid ? "var(--accent)" : "var(--bg-muted)",
                color: isValid ? "white" : "var(--text-muted)",
                cursor: isValid ? "pointer" : "default",
                border: "none",
                outline: "none",
              }}
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <>
                  Overiť
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Person form */
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="name">Meno *</label>
              <input id="name" type="text" className="input" placeholder="Ján" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="surname">Priezvisko *</label>
              <input id="surname" type="text" className="input" placeholder="Novák" value={surname} onChange={(e) => setSurname(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="birthDate">Dátum narodenia *</label>
            <input id="birthDate" type="date" className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
          </div>
          <div className="flex justify-end">
            <button
              id="submit-report-btn"
              type="submit"
              disabled={loading || !isValid}
              className="btn-primary"
            >
              {loading ? "Spúšťam…" : "Overiť osobu →"}
            </button>
          </div>
        </div>
      )}

      {/* ── IČO error ─────────────────────────── */}
      {icoError && (
        <p className="text-xs mt-2 text-center fade-in" style={{ color: "#ef4444" }}>
          {icoError}
        </p>
      )}

      {/* ── Source chips ──────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
        {SOURCES.map((source) => {
          const active = selected.includes(source.id);
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => toggleSource(source.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"
              style={{
                background: active ? "var(--accent-light)" : "var(--bg-muted)",
                color: active ? "var(--accent)" : "var(--text-muted)",
                border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
              }}
            >
              {active && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {source.label}
              {source.cost > 0 && (
                <span
                  className="ml-0.5 px-1 rounded text-[9px] font-semibold"
                  style={{ background: active ? "rgba(16,185,129,0.15)" : "var(--border)", color: active ? "var(--accent)" : "var(--text-muted)" }}
                >
                  {source.cost} kr
                </span>
              )}
            </button>
          );
        })}

        {totalCost > 0 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            · {totalCost} kreditov
          </span>
        )}
      </div>

      {/* ── Global error ──────────────────────── */}
      {error && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs mt-4 fade-in"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.15)",
            color: "#ef4444",
          }}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          {error}
        </div>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SOURCES = [
  { id: "ORSR", label: "ORSR", description: "Obchodný register SR", cost: 0, badge: "Zadarmo" },
  { id: "ZRSR", label: "ŽRSR", description: "Živnostenský register SR", cost: 0, badge: "Zadarmo" },
  { id: "INSOLVENCY", label: "Register úpadcov", description: "Insolvenčný register", cost: 0, badge: "Zadarmo" },
  { id: "CRE", label: "CRE", description: "Centrálny register exekúcií", cost: 5, badge: "5 kr." },
];

type TargetType = "COMPANY" | "PERSON";

export default function ReportForm() {
  const router = useRouter();
  const [targetType, setTargetType] = useState<TargetType>("COMPANY");
  const [ico, setIco] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>(["ORSR", "ZRSR", "INSOLVENCY"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCost = SOURCES.filter((s) => selectedSources.includes(s.id)).reduce((sum, s) => sum + s.cost, 0);

  const toggleSource = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSources.length === 0) {
      setError("Vyberte aspoň jeden register.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { targetType, sources: selectedSources };
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
        if (res.status === 402) {
          setError(`Nedostatok kreditov. Potrebujete ${data.required} kr., máte ${data.balance} kr.`);
        } else {
          setError(data.error ?? "Nastala chyba pri odosielaní žiadosti.");
        }
        return;
      }

      router.push(`/reports/${data.reportRequestId}`);
    } catch {
      setError("Sieťová chyba. Skúste znova.");
    } finally {
      setLoading(false);
    }
  };

  const isFormValid =
    selectedSources.length > 0 &&
    (targetType === "COMPANY"
      ? ico.length >= 6
      : name.trim() && surname.trim() && birthDate);

  return (
    <form onSubmit={handleSubmit} className="glass-card p-6 space-y-6 animate-slide-up">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-slate-100">Nový Evidence Binder</h2>
        <p className="text-sm text-slate-500 mt-0.5">Zadajte subjekt a vyberte registre na overenie</p>
      </div>

      {/* Target type toggle */}
      <div>
        <label className="form-label">Typ subjektu</label>
        <div className="flex rounded-lg p-1 gap-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {(["COMPANY", "PERSON"] as TargetType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTargetType(type)}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                targetType === type
                  ? "bg-emerald-500/20 text-emerald-300 shadow-sm"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              {type === "COMPANY" ? "🏢 Firma (IČO)" : "👤 Fyzická osoba"}
            </button>
          ))}
        </div>
      </div>

      {/* Identity fields */}
      {targetType === "COMPANY" ? (
        <div>
          <label className="form-label" htmlFor="ico">IČO *</label>
          <input
            id="ico"
            type="text"
            className="input-field"
            placeholder="napr. 12345678"
            value={ico}
            onChange={(e) => setIco(e.target.value.replace(/\D/g, "").slice(0, 8))}
            required
            maxLength={8}
          />
          <p className="text-xs text-slate-600 mt-1">8-miestne identifikačné číslo organizácie</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="name">Meno *</label>
              <input
                id="name"
                type="text"
                className="input-field"
                placeholder="Ján"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label" htmlFor="surname">Priezvisko *</label>
              <input
                id="surname"
                type="text"
                className="input-field"
                placeholder="Novák"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="birthDate">Dátum narodenia *</label>
            <input
              id="birthDate"
              type="date"
              className="input-field"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
              style={{ colorScheme: "dark" }}
            />
          </div>
        </div>
      )}

      {/* Source selection */}
      <div>
        <label className="form-label">Registre na overenie</label>
        <div className="space-y-2">
          {SOURCES.map((source) => {
            const selected = selectedSources.includes(source.id);
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => toggleSource(source.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-200 text-left ${
                  selected
                    ? "border-emerald-500/40 bg-emerald-500/8"
                    : "border-transparent hover:border-white/10"
                }`}
                style={{
                  background: selected
                    ? "rgba(16,185,129,0.06)"
                    : "rgba(255,255,255,0.03)",
                  borderColor: selected ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                      selected ? "bg-emerald-500" : "border border-slate-600"
                    }`}
                  >
                    {selected && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-200">{source.label}</span>
                    <span className="text-xs text-slate-500 ml-2">{source.description}</span>
                  </div>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    source.cost === 0
                      ? "text-emerald-400 bg-emerald-400/10"
                      : "text-amber-400 bg-amber-400/10"
                  }`}
                >
                  {source.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-lg text-sm animate-fade-in"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {error}
        </div>
      )}

      {/* Footer: cost + submit */}
      <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div>
          <span className="text-xs text-slate-500">Celková cena: </span>
          <span className={`text-sm font-bold ${totalCost === 0 ? "text-emerald-400" : "text-amber-400"}`}>
            {totalCost === 0 ? "Zadarmo" : `${totalCost} kreditov`}
          </span>
        </div>
        <button
          id="submit-report-btn"
          type="submit"
          disabled={loading || !isFormValid}
          className="btn-primary"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="2" />
              </svg>
              Odosielam…
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Spustiť overenie
            </>
          )}
        </button>
      </div>
    </form>
  );
}

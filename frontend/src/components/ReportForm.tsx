"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SOURCES, SOURCE_CATEGORIES, ENABLED_SOURCES, DEFAULT_SELECTED_SOURCES } from "@/lib/sources";

function isValidIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(ico[i], 10) * (8 - i);
  return (11 - (sum % 11)) % 10 === parseInt(ico[7], 10);
}

type TargetType = "COMPANY" | "PERSON";

export default function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [targetType, setTargetType] = useState<TargetType>("COMPANY");
  const [ico, setIco] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED_SOURCES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icoError, setIcoError] = useState<string | null>(null);

  useEffect(() => {
    const icoParam = searchParams.get("ico");
    if (icoParam) {
      const cleanIco = icoParam.replace(/\D/g, "").slice(0, 8);
      if (cleanIco.length === 8 && isValidIco(cleanIco)) {
        setIco(cleanIco);
        setTargetType("COMPANY");
      }
    }
    const nameParam = searchParams.get("name");
    const surnameParam = searchParams.get("surname");
    if (nameParam && surnameParam) {
      setName(nameParam);
      setSurname(surnameParam);
      setTargetType("PERSON");
    }
  }, [searchParams]);

  const toggleSource = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));

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
        const detail = data.details ? ` (${typeof data.details === 'string' ? data.details : JSON.stringify(data.details)})` : '';
        setError(
          (data.error ?? "Nastala chyba.") + detail
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

      {/* ── Type toggle — compact ──────────────── */}
      <div className="flex justify-center mb-3">
        <div
          className="flex p-0.5 gap-0.5 rounded-lg"
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
                className="px-3 py-1 rounded-md text-[11px] font-medium transition-all duration-150"
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

      {/* ── Main search bar — narrower, centered ── */}
      {targetType === "COMPANY" ? (
        <div className="mx-auto" style={{ maxWidth: 480 }}>
          <div
            className="flex items-center rounded-xl transition-all duration-200"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--accent)",
              boxShadow: "var(--shadow-md)",
              height: "44px",
            }}
            id="search-wrap"
          >
            {/* Icon — tick when valid IČO, magnifying glass otherwise */}
            <div className="pl-4 pr-2 flex-shrink-0">
              {ico.length === 8 && !icoError ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-muted)" }}>
                  <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
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
                fontSize: "0.95rem",
                letterSpacing: "-0.01em",
                color: "var(--text)",
                padding: "0",
                caretColor: "var(--accent)",
                fontFamily: "inherit",
              }}
              autoFocus
              required
            />

            {/* Clear (x) button */}
            {ico && (
              <button
                type="button"
                onClick={() => { setIco(""); setIcoError(null); inputRef.current?.focus(); }}
                className="flex-shrink-0 flex items-center justify-center mr-1 transition-opacity"
                style={{ width: "24px", height: "24px", color: "var(--text-muted)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            {/* Submit button — dominant tyrkysov */}
            <button
              id="submit-report-btn"
              type="submit"
              disabled={loading || !isValid}
              className="flex items-center justify-center gap-1.5 px-4 font-semibold text-sm transition-all duration-150 flex-shrink-0"
              style={{
                height: "100%",
                background: isValid ? "var(--accent)" : "var(--bg-muted)",
                color: isValid ? "var(--accent-button-text)" : "var(--text-muted)",
                cursor: isValid ? "pointer" : "default",
                border: "none",
                borderLeft: `1px solid ${isValid ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "0 12px 12px 0",
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
                    <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Person form */
        <div className="mx-auto" style={{ maxWidth: 480 }}>
          <div
            className="rounded-xl p-4 space-y-3"
            style={{
              background: "var(--surface)",
              border: "1.5px solid var(--border)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                className="flex items-center justify-center gap-1.5 px-4 rounded-lg font-semibold text-sm transition-all duration-150"
                style={{
                  height: "40px",
                  background: isValid ? "var(--accent)" : "var(--bg-muted)",
                  color: isValid ? "var(--accent-button-text)" : "var(--text-muted)",
                  cursor: isValid ? "pointer" : "default",
                  border: isValid ? "1px solid var(--accent)" : "1px solid var(--border)",
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
                    Overiť osobu
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IČO error ─────────────────────────── */}
      {icoError && (
        <p className="text-xs mt-2 text-center fade-in" style={{ color: "var(--danger)" }}>
          {icoError}
        </p>
      )}

      {/* ── Source selection ─────────────────── */}
      <div className="mt-5 space-y-2.5">
        {/* Counter above grid */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            {selected.length} z {ENABLED_SOURCES.length} registrov
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(ENABLED_SOURCES.map(s => s.id))}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--accent)" }}
            >
              Označiť všetko
            </button>
            <span style={{ color: "var(--border)" }}>·</span>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
            >
              Odznačiť všetko
            </button>
          </div>
        </div>

        {/* Category groups — 3-column grid on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {SOURCE_CATEGORIES.map((cat) => {
          const catSources = SOURCES.filter((s) => s.category === cat.id);
          if (catSources.length === 0) return null;
          const catEnabled = catSources.filter(s => s.enabled);
          const catSelected = catEnabled.filter(s => selected.includes(s.id));
          const allCatSelected = catEnabled.length > 0 && catSelected.length === catEnabled.length;
          const someCatSelected = catSelected.length > 0 && !allCatSelected;

          return (
            <div
              key={cat.id}
              className="rounded-xl overflow-hidden"
              style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
            >
              {/* Category header */}
              <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer select-none transition-colors hover:bg-opacity-50"
                style={{ background: "var(--bg-muted)" }}
                onClick={() => {
                  if (allCatSelected) {
                    setSelected(p => p.filter(id => !catEnabled.some(s => s.id === id)));
                  } else {
                    setSelected(p => Array.from(new Set([...p, ...catEnabled.map(s => s.id)])));
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded border transition-all"
                    style={{
                      background: allCatSelected ? "var(--accent)" : someCatSelected ? "var(--accent-light)" : "var(--surface)",
                      borderColor: allCatSelected || someCatSelected ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    {allCatSelected && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {someCatSelected && (
                      <span style={{ background: "var(--accent)", width: "6px", height: "2px", borderRadius: "1px" }} />
                    )}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {cat.label}
                  </span>
                </div>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {catSelected.length}/{catEnabled.length}
                </span>
              </div>

              {/* Source chips — compact */}
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                {catSources.map((source) => {
                  const active = selected.includes(source.id);
                  const disabled = !source.enabled;
                  const isFullyDisabled = disabled && source.id === "RUZ";
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => !disabled && toggleSource(source.id)}
                      disabled={disabled}
                      title={source.description}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150"
                      style={{
                        background: disabled ? "var(--bg-subtle)" : active ? "var(--accent-light)" : "var(--bg-muted)",
                        color: disabled ? "var(--text-muted)" : active ? "var(--accent)" : "var(--text-muted)",
                        border: `1px solid ${disabled ? "var(--border)" : active ? "var(--accent-border)" : "var(--border)"}`,
                        opacity: disabled ? 0.5 : 1,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {isFullyDisabled && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <rect x="3" y="11" width="18" height="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      )}
                      {active && !disabled && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {source.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* ── Global error ──────────────────────── */}
      {error && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs mt-4 fade-in"
          style={{
            background: "var(--danger-bg)",
            border: "1px solid var(--danger)",
            color: "var(--danger)",
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

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_SELECTED_SOURCES } from "@/lib/sources";

function isValidIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(ico[i], 10) * (8 - i);
  return (11 - (sum % 11)) % 10 === parseInt(ico[7], 10);
}

interface ReportFormProps {
  selected?: string[];
  onSelectedChange?: (selected: string[]) => void;
}

export default function SearchForm({ selected: extSelected, onSelectedChange }: ReportFormProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [ico, setIco] = useState("");
  const [internalSelected, setInternalSelected] = useState<string[]>(DEFAULT_SELECTED_SOURCES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icoError, setIcoError] = useState<string | null>(null);

  // Use external state if provided, otherwise internal
  const selected = extSelected ?? internalSelected;
  const setSelected = onSelectedChange ?? setInternalSelected;

  useEffect(() => {
    const icoParam = searchParams.get("ico");
    if (icoParam) {
      const cleanIco = icoParam.replace(/\D/g, "").slice(0, 8);
      if (cleanIco.length === 8 && isValidIco(cleanIco)) {
        setIco(cleanIco);
      }
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selected.length === 0) {
      setError("Musíte zvoliť aspoň jeden register na preverenie.");
      return;
    }

    if (ico.length !== 8) {
      setError("IČO musí obsahovať presne 8 číslic.");
      return;
    }

    setLoading(true);

    try {
      const body = { targetType: "COMPANY", sources: selected, ico };

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
      {/* ── Main search bar — narrower, centered ── */}
      <div className="mx-auto" style={{ maxWidth: 480 }}>
        <div
          className="flex items-center rounded-xl transition-all duration-200 bg-surface border border-accent shadow-md h-[44px]"
          id="search-wrap"
        >
          {/* Icon — tick when valid IČO, magnifying glass otherwise */}
          <div className="pl-4 pr-2 flex-shrink-0">
            {ico.length === 8 && !icoError ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-accent">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted-v">
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
            className="flex-1 bg-transparent outline-none text-[0.95rem] tracking-tight text-primary p-0 caret-accent"
            autoFocus
            required
          />

          {/* Clear (x) button */}
          {ico && (
            <button
              type="button"
              onClick={() => { setIco(""); setIcoError(null); inputRef.current?.focus(); }}
              className="flex-shrink-0 flex items-center justify-center mr-1 transition-opacity w-[24px] h-[24px] text-muted-v"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <button
            id="submit-report-btn"
            type="submit"
            disabled={loading || !ico}
            style={{
              background: ico && !loading ? "var(--accent)" : "var(--bg-muted)",
              color: ico && !loading ? "#000000" : "var(--text-muted)",
            }}
            className="flex items-center justify-center gap-1.5 px-4 font-semibold text-sm transition-all duration-150 flex-shrink-0 hover:brightness-110 disabled:cursor-not-allowed cursor-pointer outline-none h-full rounded-r-[11px] border-l border-border"
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

      {/* ── IČO error ─────────────────────────── */}
      {icoError && (
        <p className="text-xs mt-2 text-center fade-in" style={{ color: "var(--danger)" }}>
          {icoError}
        </p>
      )}

      {/* ── Global error ──────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs mt-4 fade-in bg-danger-bg border border-danger text-danger">
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          {error}
        </div>
      )}
    </form>
  );
}

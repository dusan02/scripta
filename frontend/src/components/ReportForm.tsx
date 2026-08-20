"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_SELECTED_SOURCES } from "@/lib/sources";
import { useT } from "@/components/LanguageProvider";
import { CheckIcon, SearchIcon, XIcon, ArrowRightIcon, SpinnerIcon, InfoIcon } from "@/components/icons";
import { trackReportStarted, trackReportCreated } from "@/lib/analytics";

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
  const t = useT();

  const [ico, setIco] = useState("");
  const [internalSelected, setInternalSelected] = useState<string[]>(DEFAULT_SELECTED_SOURCES);
  const [loading, setLoading] = useState(false);
  const [noCredits, setNoCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icoError, setIcoError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [companyLookup, setCompanyLookup] = useState<"idle" | "searching" | "found" | "notfound">("idle");

  useEffect(() => {
    if (ico.length !== 8 || !isValidIco(ico)) {
      setCompanyName(null);
      setCompanyLookup("idle");
      return;
    }
    setCompanyLookup("searching");
    setCompanyName(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup?ico=${ico}`, { signal: controller.signal });
        if (!res.ok) { setCompanyLookup("idle"); return; }
        const data = await res.json();
        if (data.found && data.companyName) {
          setCompanyName(data.companyName);
          setCompanyLookup("found");
        } else {
          setCompanyName(null);
          setCompanyLookup("notfound");
        }
      } catch {
        setCompanyLookup("idle");
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ico]);

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
    setNoCredits(false);

    if (selected.length === 0) {
      setError(t("form.zvoliteRegister"));
      return;
    }

    if (ico.length !== 8) {
      setError(t("form.ico8cislic"));
      return;
    }

    if (companyLookup === "notfound") {
      setError(t("form.firmaNenajdena"));
      return;
    }

    if (companyLookup === "searching") {
      setError(t("form.hladamFirmu"));
      return;
    }

    setLoading(true);
    trackReportStarted(ico);

    try {
      const body = { targetType: "COMPANY", sources: selected, ico, companyName: companyName || undefined };

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          setNoCredits(true);
          setError(null);
          return;
        }
        const detail = data.details ? ` (${typeof data.details === 'string' ? data.details : JSON.stringify(data.details)})` : '';
        setError(
          (data.error ?? t("form.chyba")) + detail
        );
        return;
      }

      trackReportCreated(ico);
      router.refresh();
      router.push(`/reports/${data.reportRequestId}`);
    } catch {
      setError(t("form.sietovaChyba"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      {/* ── Main search bar — narrower, centered ── */}
      <div className="mx-auto" style={{ maxWidth: 480 }}>
        <div
          className="flex items-center rounded-xl transition-all duration-200 bg-surface border shadow-md h-[44px]"
          id="search-wrap"
          style={{ borderColor: isFocused ? "var(--accent)" : "var(--border)" }}
        >
          {/* Icon — tick when valid IČO, magnifying glass otherwise */}
          <div className="pl-4 pr-2 flex-shrink-0">
            {ico.length === 8 && !icoError ? (
              <CheckIcon size={16} className="text-accent" />
            ) : (
              <SearchIcon size={16} className="text-muted-v" />
            )}
          </div>

          {/* Input */}
          <input
            ref={inputRef}
            id="ico"
            type="text"
            inputMode="numeric"
            placeholder={t("form.zadajteIco")}
            aria-label={t("a11y.icoInput")}
            value={ico}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 8);
              setIco(val);
              if (val.length === 8)
                setIcoError(isValidIco(val) ? null : t("form.neplatneIco"));
              else setIcoError(null);
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="flex-1 bg-transparent outline-none focus-visible:outline-none text-[0.95rem] tracking-tight text-primary p-0 caret-accent"
            autoFocus
            required
          />

          {/* Clear (x) button */}
          {ico && (
            <button
              type="button"
              onClick={() => { setIco(""); setIcoError(null); inputRef.current?.focus(); }}
              aria-label={t("a11y.clearIco")}
              className="flex-shrink-0 flex items-center justify-center mr-1 transition-opacity w-[24px] h-[24px] text-muted-v"
            >
              <XIcon size={14} />
            </button>
          )}

          <button
            id="submit-report-btn"
            type="submit"
            disabled={loading || !ico || companyLookup === "searching" || companyLookup === "notfound"}
            style={{
              background: ico && !loading && companyLookup !== "searching" && companyLookup !== "notfound" ? "var(--accent)" : "var(--bg-muted)",
              color: ico && !loading && companyLookup !== "searching" && companyLookup !== "notfound" ? "var(--accent-button-text, #000000)" : "var(--text-muted)",
            }}
            className="flex items-center justify-center gap-1.5 px-4 font-semibold text-sm transition-all duration-150 flex-shrink-0 hover:brightness-110 disabled:cursor-not-allowed cursor-pointer outline-none h-full rounded-r-xl border-l border-border"
          >
            {loading ? (
              <SpinnerIcon size={16} />
            ) : (
              <>
                {t("form.overit")}
                <ArrowRightIcon size={14} />
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

      {/* ── Company name / lookup status ─────────── */}
      {companyLookup === "searching" && (
        <p className="text-xs mt-2 text-center fade-in flex items-center justify-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <SpinnerIcon size={12} />
          {t("form.hladamFirmu")}
        </p>
      )}
      {companyLookup === "found" && companyName && (
        <p className="text-xs mt-2 text-center fade-in" style={{ color: "var(--accent)" }}>
          ✓ {companyName}
        </p>
      )}
      {companyLookup === "notfound" && (
        <p className="text-xs mt-2 text-center fade-in" style={{ color: "var(--danger)" }}>
          {t("form.firmaNenajdena")}
        </p>
      )}

      {/* ── Global error ──────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs mt-4 fade-in bg-danger-bg border border-danger text-danger">
          <InfoIcon size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── No credits — buy credits CTA ─────────── */}
      {noCredits && (
        <div className="mt-4 p-5 rounded-xl fade-in" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>
            {t("form.noCreditsTitle")}
          </p>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
            {t("form.noCreditsDesc")}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => router.push("/credits?plan=payg1")}
              className="px-4 py-2.5 rounded-lg font-bold text-sm transition-all hover:scale-105"
              style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
            >
              {t("form.buy1Report")} — 14 €
            </button>
            <button
              onClick={() => router.push("/credits?plan=payg10")}
              className="px-4 py-2.5 rounded-lg font-semibold text-sm transition-all hover:scale-105"
              style={{ background: "var(--surface-hover)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              {t("form.buy10Reports")} — 89 €
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

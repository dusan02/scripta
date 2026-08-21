"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenerTier } from "@/lib/screener";
import { toURLSearchParams } from "@/lib/url";

type FilterOption = { value: string; label: string; count?: number };

type Props = {
  options: {
    naceSections: Array<{ section: string; sectionName: string }>;
    legalForms: FilterOption[];
    ownershipTypes: Array<{ value: string; label: string }>;
    cities: Array<FilterOption & { kraj?: string }>;
    kraje: FilterOption[];
    okresy: FilterOption[];
    sizeCategories: FilterOption[];
    statuses: FilterOption[];
  };
  tier: ScreenerTier;
  appliedFilters: string[];
  searchParams: Record<string, string | string[] | undefined>;
};

const SELECT_STYLE = "w-full rounded-lg px-3 py-2 text-sm border";

// AUTH filter keys — locked for FREE tier, redirect to login on click
const AUTH_FILTER_KEYS = ["konkurz", "likvidacia", "restrukturalizacia", "vestnikClean"];

// Helper: get string value from searchParams prop
export function ScreenerFilters({ options, tier, appliedFilters, searchParams }: Props) {
  const router = useRouter();
  const [savedSearches, setSavedSearches] = useState<Array<{ id: string; name: string; filters: Record<string, string> }>>([]);
  const [showSaved, setShowSaved] = useState(false);

  // Helper: get string value from searchParams prop
  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  // Save search modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error" | "unauth">("idle");

  // Fetch saved searches on mount (only for authenticated users)
  useEffect(() => {
    if (tier === "FREE") return;
    fetch("/api/saved-searches")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.searches) setSavedSearches(data.searches); })
      .catch(() => {});
  }, [tier]);

  const applyFilter = useCallback(
    (key: string, value: string) => {
      const params = toURLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/screener?${params.toString()}`);
    },
    [router, searchParams],
  );

  const applyAuthFilter = useCallback(
    (key: string) => {
      if (tier === "FREE") {
        // Locked — redirect to login
        router.push("/login?callbackUrl=/screener");
        return;
      }
      // Toggle boolean filter
      const params = toURLSearchParams(searchParams);
      if (params.get(key) === "1") {
        params.delete(key);
      } else {
        params.set(key, "1");
      }
      params.delete("page");
      router.push(`/screener?${params.toString()}`);
    },
    [router, searchParams, tier],
  );

  const applySort = useCallback(
    (sortVal: string) => {
      const [field, dir] = sortVal.split("-");
      const params = toURLSearchParams(searchParams);
      if (field === "latestRevenue" && dir === "desc") {
        params.delete("sort");
        params.delete("dir");
      } else {
        params.set("sort", field);
        params.set("dir", dir);
      }
      params.delete("page");
      router.push(`/screener?${params.toString()}`);
    },
    [router, searchParams],
  );

  const currentSort = sp("sort") || "latestRevenue";
  const currentDir = sp("dir") || "desc";
  const selectedKraj = sp("kraj");

  // Cascading: filter okresy and cities by selected kraj
  // Okres code prefix (first 5 chars) = kraj code (e.g. SK0101 → SK010)
  const filteredOkresy = selectedKraj
    ? options.okresy.filter(o => o.value.startsWith(selectedKraj))
    : options.okresy;
  const filteredCities = selectedKraj
    ? options.cities.filter(c => c.kraj === selectedKraj)
    : options.cities;

  // ── Debounced inputs ────────────────────────────────────────────────────────
  // All text/number inputs use local state + debounce to avoid router.push on
  // every keystroke, which would cause SSR rerender and scroll-to-top.
  const DEBOUNCE_MS = 500;

  const [qInput, setQInput] = useState(sp("q"));
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Numeric filter inputs — local state, debounced router.push
  const numericKeys = ["naceCode", "ageMin", "ageMax", "revenueMin", "revenueMax", "profitMin", "profitMax", "assetsMin", "assetsMax", "equityMin", "equityMax", "latestYear"];
  const [numInputs, setNumInputs] = useState<Record<string, string>>({});
  const numTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Build a stable string key for searchParams to use as effect dependency
  const spKey = JSON.stringify(searchParams);

  // Sync local inputs when URL changes externally (e.g. clear filters, back button)
  useEffect(() => {
    setQInput(sp("q"));
    const next: Record<string, string> = {};
    for (const k of numericKeys) next[k] = sp(k);
    setNumInputs(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spKey]);

  // Debounce fulltext
  useEffect(() => {
    if (qTimer.current) clearTimeout(qTimer.current);
    if (qInput === sp("q")) return;
    qTimer.current = setTimeout(() => applyFilter("q", qInput), DEBOUNCE_MS);
    return () => { if (qTimer.current) clearTimeout(qTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // Update a numeric input locally (no router push yet)
  const setNum = useCallback((key: string, value: string) => {
    setNumInputs(prev => ({ ...prev, [key]: value }));
    if (numTimers.current[key]) clearTimeout(numTimers.current[key]);
    numTimers.current[key] = setTimeout(() => {
      applyFilter(key, value);
    }, DEBOUNCE_MS);
  }, [applyFilter]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const t of Object.values(numTimers.current)) clearTimeout(t);
    };
  }, []);

  // Mobile filter toggle
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="space-y-3">
      {/* Mobile toggle button — visible only on small screens */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
      >
        Filtre {appliedFilters.length > 0 && `(${appliedFilters.length})`}
        <span>{mobileOpen ? "▴" : "▾"}</span>
      </button>

      {/* Filter content — always visible on desktop, toggle on mobile */}
      <div className={mobileOpen ? "block" : "hidden lg:block"}>
      {/* Saved searches — quick access for authenticated users */}
      {tier !== "FREE" && savedSearches.length > 0 && (
        <div className="pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setShowSaved(!showSaved)}
            className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            Uložené vyhľadávania
            <span>{showSaved ? "▾" : "▸"}</span>
          </button>
          {showSaved && (
            <div className="mt-2 space-y-1">
              {savedSearches.map((s) => {
                const qs = new URLSearchParams(s.filters).toString();
                return (
                  <div key={s.id} className="flex items-center gap-1">
                    <button
                      onClick={() => router.push(`/screener?${qs}`)}
                      className="flex-1 text-left px-2 py-1.5 text-xs rounded transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ color: "var(--text)" }}
                    >
                      {s.name}
                    </button>
                    <button
                      onClick={() => {
                        fetch(`/api/saved-searches?id=${s.id}`, { method: "DELETE" })
                          .then(r => { if (r.ok) setSavedSearches(prev => prev.filter(x => x.id !== s.id)); });
                      }}
                      className="text-xs px-1.5 py-1 rounded transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ color: "var(--text-muted)" }}
                      title="Odstrániť"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Filtre
      </h2>

      {/* 1. Fulltext (debounced) */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Fulltext (názov / IČO)
        </label>
        <input
          type="text"
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="Zadajte názov alebo IČO…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>

      {/* 2. NACE section */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          NACE sekcia
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("naceSection")}
          onChange={(e) => applyFilter("naceSection", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.naceSections.map((s) => (
            <option key={s.section} value={s.section}>
              {s.section} — {s.sectionName}
            </option>
          ))}
        </select>
      </div>

      {/* 3. NACE code */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          NACE kód
        </label>
        <input
          type="text"
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="napr. 6201"
          value={numInputs.naceCode ?? ""}
          onChange={(e) => setNum("naceCode", e.target.value)}
        />
      </div>

      {/* 4. Legal form */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Právna forma
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("legalForm")}
          onChange={(e) => applyFilter("legalForm", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.legalForms.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label} ({l.count})
            </option>
          ))}
        </select>
      </div>

      {/* 5. Ownership type */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Druh vlastníctva
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("ownershipType")}
          onChange={(e) => applyFilter("ownershipType", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.ownershipTypes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* 5b. Veľkosť firmy */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Veľkosť firmy
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("sizeCategory")}
          onChange={(e) => applyFilter("sizeCategory", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.sizeCategories.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* 5c. Status firmy */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Status
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("status")}
          onChange={(e) => applyFilter("status", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* 6b. Kraj — first, cascades to Okres + Mesto */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Kraj
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("kraj")}
          onChange={(e) => {
            const params = toURLSearchParams(searchParams);
            const val = e.target.value;
            if (val) {
              params.set("kraj", val);
              // Clear okres/city if they don't belong to the new kraj
              const curOkres = params.get("okres") || "";
              const curCity = params.get("city") || "";
              if (curOkres && !curOkres.startsWith(val)) params.delete("okres");
              if (curCity) {
                const cityKraj = options.cities.find(c => c.value === curCity)?.kraj;
                if (cityKraj && cityKraj !== val) params.delete("city");
              }
            } else {
              params.delete("kraj");
              params.delete("okres");
              params.delete("city");
            }
            params.delete("page");
            router.push(`/screener?${params.toString()}`);
          }}
        >
          <option value="">Všetky</option>
          {options.kraje.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label} ({k.count})
            </option>
          ))}
        </select>
      </div>

      {/* 6c. Okres — cascades from Kraj */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Okres
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("okres")}
          onChange={(e) => applyFilter("okres", e.target.value)}
        >
          <option value="">Všetky</option>
          {filteredOkresy.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </div>

      {/* 6. City — cascades from Kraj */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Mesto
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("city")}
          onChange={(e) => applyFilter("city", e.target.value)}
        >
          <option value="">Všetky</option>
          {filteredCities.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
      </div>

      {/* 7. Age (min/max) */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
            Založenie od (rokov)
          </label>
          <input
            type="number"
            min="0"
            className={SELECT_STYLE}
            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            placeholder="0"
            value={numInputs.ageMin ?? ""}
            onChange={(e) => setNum("ageMin", e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
            Založenie do (rokov)
          </label>
          <input
            type="number"
            min="0"
            className={SELECT_STYLE}
            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            placeholder="∞"
            value={numInputs.ageMax ?? ""}
            onChange={(e) => setNum("ageMax", e.target.value)}
          />
        </div>
      </div>

      {/* 8-11. Financial filters (min/max) */}
      <FinancialRange label="Tržby (€)" minKey="revenueMin" maxKey="revenueMax" numInputs={numInputs} setNum={setNum} />
      <FinancialRange label="Zisk (€)" minKey="profitMin" maxKey="profitMax" numInputs={numInputs} setNum={setNum} />
      <FinancialRange label="Aktíva (€)" minKey="assetsMin" maxKey="assetsMax" numInputs={numInputs} setNum={setNum} />
      <FinancialRange label="Vlastné imanie (€)" minKey="equityMin" maxKey="equityMax" numInputs={numInputs} setNum={setNum} />

      {/* 12. Latest year */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Posledný rok dát (od)
        </label>
        <input
          type="number"
          min="2000"
          max="2030"
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="napr. 2023"
          value={numInputs.latestYear ?? ""}
          onChange={(e) => setNum("latestYear", e.target.value)}
        />
      </div>

      {/* AUTH filters — Vestník (13-16) */}
      <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Vestník udalosti
        </h3>
        <div className="space-y-2">
          {AUTH_FILTER_KEYS.map((key) => {
            const isActive = sp(key) === "1";
            const isLocked = tier === "FREE";
            const labels: Record<string, string> = {
              konkurz: "Konkurz",
              likvidacia: "Likvidácia",
              restrukturalizacia: "Reštrukturalizácia",
              vestnikClean: "Bez Vestník udalostí",
            };
            return (
              <label
                key={key}
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: isLocked ? "var(--text-muted)" : "var(--text)" }}
                onClick={(e) => {
                  if (isLocked) {
                    e.preventDefault();
                    applyAuthFilter(key);
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={isActive && !isLocked}
                  disabled={isLocked}
                  onChange={() => applyAuthFilter(key)}
                  style={{ accentColor: "var(--accent)" }}
                />
                {labels[key]}
                {isLocked && (
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>🔒</span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Sort */}
      <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Zoradiť
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          value={`${currentSort}-${currentDir}`}
          onChange={(e) => applySort(e.target.value)}
        >
          <option value="name-asc">Názov A–Z</option>
          <option value="name-desc">Názov Z–A</option>
          <option value="latestRevenue-desc">Tržby ↓</option>
          <option value="latestRevenue-asc">Tržby ↑</option>
          <option value="latestProfit-desc">Zisk ↓</option>
          <option value="latestProfit-asc">Zisk ↑</option>
          <option value="latestAssets-desc">Aktíva ↓</option>
          <option value="latestAssets-asc">Aktíva ↑</option>
          <option value="latestEquity-desc">Imanie ↓</option>
          <option value="latestEquity-asc">Imanie ↑</option>
          <option value="establishedAt-desc">Založenie ↓ (najstaršie)</option>
          <option value="establishedAt-asc">Založenie ↑ (najmladšie)</option>
          <option value="city-asc">Mesto A–Z</option>
          <option value="city-desc">Mesto Z–A</option>
        </select>
      </div>

      {/* Actions: Reset + Save */}
      <div className="pt-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
        {(appliedFilters.length > 0 || sp("sort") || sp("dir")) && (
          <button
            onClick={() => router.push("/screener")}
            className="w-full px-3 py-2 text-sm rounded-lg font-medium transition-colors hover:bg-[var(--surface-hover)]"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Zrušiť filtre
          </button>
        )}
        <button
          onClick={() => {
            setSaveName("Moje vyhľadávanie");
            setSaveStatus("idle");
            setShowSaveModal(true);
          }}
          className="w-full px-3 py-2 text-sm rounded-lg font-medium transition-colors hover:bg-[var(--surface-hover)]"
          style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
        >
          Uložiť vyhľadávanie
        </button>
      </div>

      {/* Save search modal */}
      {showSaveModal && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowSaveModal(false)}
          />
          <div
            className="fixed bottom-4 left-4 right-4 sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 z-50 rounded-xl p-4 shadow-lg"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <h4 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
              Uložiť vyhľadávanie
            </h4>
            <input
              type="text"
              autoFocus
              value={saveName}
              onChange={(e) => { setSaveName(e.target.value); setSaveStatus("idle"); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveName.trim()) {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).nextElementSibling?.dispatchEvent(new MouseEvent("click"));
                }
                if (e.key === "Escape") setShowSaveModal(false);
              }}
              placeholder="Názov vyhľadávania"
              className="w-full px-3 py-2 text-sm rounded-lg mb-3"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            {saveStatus === "error" && (
              <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>Chyba pri ukladaní. Skúste znova.</p>
            )}
            {saveStatus === "unauth" && (
              <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>Pre uloženie sa prihláste.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 px-3 py-2 text-xs rounded-lg transition-colors hover:bg-[var(--surface-hover)]"
                style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                Zrušiť
              </button>
              <button
                onClick={() => {
                  if (!saveName.trim()) return;
                  setSaveStatus("saving");
                  const params = toURLSearchParams(searchParams);
                  params.delete("page");
                  const filters = Object.fromEntries(params.entries());
                  fetch("/api/saved-searches", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: saveName.trim(), filters }),
                  }).then(async r => {
                    if (r.ok) {
                      const data = await r.json();
                      setSavedSearches(prev => [{ id: data.id, name: data.name, filters }, ...prev]);
                      setShowSaved(true);
                      setShowSaveModal(false);
                    } else if (r.status === 401) {
                      setSaveStatus("unauth");
                    } else {
                      setSaveStatus("error");
                    }
                  }).catch(() => setSaveStatus("error"));
                }}
                disabled={!saveName.trim() || saveStatus === "saving"}
                className="flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-opacity disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
              >
                {saveStatus === "saving" ? "Ukladám…" : "Uložiť"}
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

// ── Financial range component (min/max pair) ─────────────────────────────────
function FinancialRange({
  label,
  minKey,
  maxKey,
  numInputs,
  setNum,
}: {
  label: string;
  minKey: string;
  maxKey: string;
  numInputs: Record<string, string>;
  setNum: (key: string, value: string) => void;
}) {
  const SELECT_STYLE = "w-full rounded-lg px-3 py-2 text-sm border";
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="min"
          value={numInputs[minKey] ?? ""}
          onChange={(e) => setNum(minKey, e.target.value)}
        />
        <input
          type="number"
          className={SELECT_STYLE}
          style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="max"
          value={numInputs[maxKey] ?? ""}
          onChange={(e) => setNum(maxKey, e.target.value)}
        />
      </div>
    </div>
  );
}

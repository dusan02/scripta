"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenerTier } from "@/lib/screener";

type FilterOption = { value: string; label: string; count?: number };

type Props = {
  options: {
    naceSections: Array<{ section: string; sectionName: string }>;
    legalForms: FilterOption[];
    ownershipTypes: Array<{ value: string; label: string }>;
    cities: FilterOption[];
    kraje: FilterOption[];
    okresy: FilterOption[];
  };
  tier: ScreenerTier;
  appliedFilters: string[];
};

const SELECT_STYLE = "w-full rounded-lg px-3 py-2 text-sm border";

// AUTH filter keys — locked for FREE tier, redirect to login on click
const AUTH_FILTER_KEYS = ["konkurz", "likvidacia", "restrukturalizacia", "vestnikClean"];

export function ScreenerFilters({ options, tier, appliedFilters }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const applyFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
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
      const params = new URLSearchParams(searchParams.toString());
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
      const params = new URLSearchParams(searchParams.toString());
      if (field === "name" && dir === "asc") {
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

  const sp = (key: string) => searchParams.get(key) || "";
  const currentSort = sp("sort") || "name";
  const currentDir = sp("dir") || "asc";

  // ── Debounced fulltext ──────────────────────────────────────────────────────
  // Avoid server render on every keystroke. Local state + 400ms debounce → router.push.
  const [qInput, setQInput] = useState(sp("q"));
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local input when URL changes externally (e.g. clear filters, back button)
  useEffect(() => {
    setQInput(sp("q"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (qTimer.current) clearTimeout(qTimer.current);
    // Only push if value actually changed from what's in URL
    if (qInput === sp("q")) return;
    qTimer.current = setTimeout(() => {
      applyFilter("q", qInput);
    }, 400);
    return () => {
      if (qTimer.current) clearTimeout(qTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Filtre
      </h2>

      {/* 1. Fulltext (debounced — 400ms) */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Fulltext (názov / IČO)
        </label>
        <input
          type="text"
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
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
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
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
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="napr. 6201"
          value={sp("naceCode")}
          onChange={(e) => applyFilter("naceCode", e.target.value)}
        />
      </div>

      {/* 4. Legal form */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Právna forma
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
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
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
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

      {/* 6. City */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Mesto
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("city")}
          onChange={(e) => applyFilter("city", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.cities.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
      </div>

      {/* 6b. Kraj */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Kraj
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("kraj")}
          onChange={(e) => applyFilter("kraj", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.kraje.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label} ({k.count})
            </option>
          ))}
        </select>
      </div>

      {/* 6c. Okres */}
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Okres
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("okres")}
          onChange={(e) => applyFilter("okres", e.target.value)}
        >
          <option value="">Všetky</option>
          {options.okresy.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </div>

      {/* 7. Age (min/max) */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
            Vek min (rokov)
          </label>
          <input
            type="number"
            min="0"
            className={SELECT_STYLE}
            style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
            placeholder="0"
            value={sp("ageMin")}
            onChange={(e) => applyFilter("ageMin", e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
            Vek max
          </label>
          <input
            type="number"
            min="0"
            className={SELECT_STYLE}
            style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
            placeholder="∞"
            value={sp("ageMax")}
            onChange={(e) => applyFilter("ageMax", e.target.value)}
          />
        </div>
      </div>

      {/* 8-11. Financial filters (min/max) */}
      <FinancialRange label="Tržby (€)" minKey="revenueMin" maxKey="revenueMax" sp={sp} applyFilter={applyFilter} />
      <FinancialRange label="Zisk (€)" minKey="profitMin" maxKey="profitMax" sp={sp} applyFilter={applyFilter} />
      <FinancialRange label="Aktíva (€)" minKey="assetsMin" maxKey="assetsMax" sp={sp} applyFilter={applyFilter} />
      <FinancialRange label="Vlastné imanie (€)" minKey="equityMin" maxKey="equityMax" sp={sp} applyFilter={applyFilter} />

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
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="napr. 2023"
          value={sp("latestYear")}
          onChange={(e) => applyFilter("latestYear", e.target.value)}
        />
      </div>

      {/* AUTH filters — Vestník (13-16) */}
      <div className="pt-4 border-t" style={{ borderColor: "var(--border)" }}>
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
      <div className="pt-4 border-t" style={{ borderColor: "var(--border)" }}>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
          Zoradiť
        </label>
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
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
          <option value="establishedAt-desc">Vek ↓ (najstaršie)</option>
          <option value="establishedAt-asc">Vek ↑ (najmladšie)</option>
          <option value="city-asc">Mesto A–Z</option>
          <option value="city-desc">Mesto Z–A</option>
        </select>
      </div>

      {/* Clear filters */}
      {(appliedFilters.length > 0 || sp("sort") || sp("dir")) && (
        <button
          onClick={() => router.push("/screener")}
          className="w-full px-3 py-2 text-sm rounded-lg border"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          Zrušiť filtre
        </button>
      )}
    </div>
  );
}

// ── Financial range component (min/max pair) ─────────────────────────────────
function FinancialRange({
  label,
  minKey,
  maxKey,
  sp,
  applyFilter,
}: {
  label: string;
  minKey: string;
  maxKey: string;
  sp: (key: string) => string;
  applyFilter: (key: string, value: string) => void;
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
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="min"
          value={sp(minKey)}
          onChange={(e) => applyFilter(minKey, e.target.value)}
        />
        <input
          type="number"
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          placeholder="max"
          value={sp(maxKey)}
          onChange={(e) => applyFilter(maxKey, e.target.value)}
        />
      </div>
    </div>
  );
}

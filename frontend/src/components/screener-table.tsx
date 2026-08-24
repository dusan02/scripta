"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { slugify } from "@/lib/slug";
import { fmtEurK, fmtYear } from "@/lib/format";
import { spStr } from "@/lib/url";

type Company = {
  ico: string;
  name: string | null;
  legalForm: string | null;
  city: string | null;
  establishedAt: Date | null;
  latestRevenue: string | null;
  latestProfit: string | null;
  latestAssets: string | null;
  latestEquity: string | null;
  latestYear: number | null;
};

// ── Column definitions ──────────────────────────────────────────────────────

type ColKey =
  | "name" | "ico" | "legalForm" | "city" | "establishedAt" | "latestYear"
  | "latestRevenue" | "latestProfit" | "latestAssets" | "latestEquity";

type ColDef = {
  key: ColKey;
  label: string;
  sortField?: string;
  align: "left" | "right";
  minWidth?: string;
};

const ALL_COLUMNS: ColDef[] = [
  { key: "name", label: "Firma", sortField: "name", align: "left", minWidth: "200px" },
  { key: "ico", label: "IČO", sortField: "ico", align: "left", minWidth: "100px" },
  { key: "legalForm", label: "Právna forma", sortField: "legalForm", align: "left", minWidth: "110px" },
  { key: "city", label: "Mesto", sortField: "city", align: "left", minWidth: "140px" },
  { key: "establishedAt", label: "Založenie", sortField: "establishedAt", align: "right", minWidth: "90px" },
  { key: "latestYear", label: "Rok dát", sortField: undefined, align: "right", minWidth: "70px" },
  { key: "latestRevenue", label: "Tržby", sortField: "latestRevenue", align: "right", minWidth: "110px" },
  { key: "latestProfit", label: "Zisk", sortField: "latestProfit", align: "right", minWidth: "100px" },
  { key: "latestAssets", label: "Aktíva", sortField: "latestAssets", align: "right", minWidth: "100px" },
  { key: "latestEquity", label: "Imanie", sortField: "latestEquity", align: "right", minWidth: "100px" },
];

const DEFAULT_COLUMNS: ColKey[] = ["name", "ico", "city", "establishedAt", "latestYear", "latestRevenue", "latestProfit", "latestAssets", "latestEquity"];

// ── Cell renderer ───────────────────────────────────────────────────────────

function Cell({ col, c }: { col: ColDef; c: Company }) {
  switch (col.key) {
    case "name":
      return (
        <Link
          href={`/firma/${c.ico}-${slugify(c.name)}`}
          className="font-medium hover:underline"
          style={{ color: "var(--accent)" }}
          title={c.name || c.ico}
        >
          {c.name || c.ico}
        </Link>
      );
    case "ico":
      return <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{c.ico}</span>;
    case "legalForm":
      return <span className="text-xs" style={{ color: "var(--text-secondary)" }} title={c.legalForm || undefined}>{c.legalForm || "—"}</span>;
    case "city":
      return <span className="text-xs" style={{ color: "var(--text-secondary)" }} title={c.city || undefined}>{c.city || "—"}</span>;
    case "establishedAt":
      return <span className="text-xs" style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmtYear(c.establishedAt)}</span>;
    case "latestYear":
      return <span className="text-xs" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{c.latestYear || "—"}</span>;
    case "latestRevenue":
      return <span className="font-medium" style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtEurK(c.latestRevenue)}</span>;
    case "latestProfit": {
      const val = c.latestProfit ? Number(c.latestProfit) : null;
      const isNeg = val !== null && val < 0;
      return <span style={{ color: isNeg ? "var(--danger)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtEurK(c.latestProfit)}</span>;
    }
    case "latestAssets": {
      const val = c.latestAssets ? Number(c.latestAssets) : null;
      const isNeg = val !== null && val < 0;
      return <span style={{ color: isNeg ? "var(--danger)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtEurK(c.latestAssets)}</span>;
    }
    case "latestEquity": {
      const val = c.latestEquity ? Number(c.latestEquity) : null;
      const isNeg = val !== null && val < 0;
      return <span style={{ color: isNeg ? "var(--danger)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtEurK(c.latestEquity)}</span>;
    }
  }
}

// ── Column toggle dropdown ──────────────────────────────────────────────────

function ColumnToggle({
  columns, visibleCols, onToggle,
}: {
  columns: ColDef[];
  visibleCols: ColKey[];
  onToggle: (key: ColKey) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="chip flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors hover:bg-[var(--surface-hover)]"
        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        title="Nastaviť stĺpce"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
        Stĺpce
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-9 z-50 w-52 rounded-lg shadow-lg overflow-hidden p-2"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="text-xs font-semibold mb-1.5 px-1" style={{ color: "var(--text-muted)" }}>
              Viditeľné stĺpce
            </div>
            {columns.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: "var(--text)" }}
              >
                <input
                  type="checkbox"
                  checked={visibleCols.includes(col.key)}
                  onChange={() => onToggle(col.key)}
                  className="accent-[var(--accent)]"
                />
                <span className="text-xs">{col.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main table component ────────────────────────────────────────────────────

export function ScreenerTable({
  companies,
  searchParams,
}: {
  companies: Company[];
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  const currentSort = spStr(searchParams, "sort") || "latestRevenue";
  const currentDir = spStr(searchParams, "dir") || "desc";

  // Load saved column preferences from localStorage + server
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    let cancelled = false;
    // 1. Load from localStorage first (instant)
    try {
      const saved = localStorage.getItem("screener-columns");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setVisibleCols(parsed.filter((k: string) => ALL_COLUMNS.some(c => c.key === k)));
        }
      }
    } catch {}

    // 2. Sync from server (if authenticated, overrides localStorage)
    fetch("/api/user/prefs")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.prefs?.columns && Array.isArray(data.prefs.columns) && data.prefs.columns.length > 0) {
          const cols = data.prefs.columns.filter((k: string) => ALL_COLUMNS.some(c => c.key === k));
          if (cols.length > 0) {
            setVisibleCols(cols);
            try { localStorage.setItem("screener-columns", JSON.stringify(cols)); } catch {}
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Save column preferences + sync to API for authenticated users
  const toggleColumn = (key: ColKey) => {
    setVisibleCols(prev => {
      // Always keep at least name column
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        const next = prev.filter(k => k !== key);
        saveColumns(next);
        return next;
      } else {
        // Insert in original order
        const next = ALL_COLUMNS.filter(c => [...prev, key].includes(c.key)).map(c => c.key);
        saveColumns(next);
        return next;
      }
    });
  };

  const saveColumns = (cols: ColKey[]) => {
    try { localStorage.setItem("screener-columns", JSON.stringify(cols)); } catch {}
    // Fire-and-forget sync to server (401 = anonymous, silently ignore)
    fetch("/api/user/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screenerColumns: cols }),
    }).catch(() => {});
  };

  const toggleSort = (field: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined) continue;
      const s = typeof value === "string" ? value : value[0];
      if (s) params.set(key, s);
    }
    if (currentSort === field) {
      params.set("dir", currentDir === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", field);
      params.set("dir", field === "name" || field === "city" ? "asc" : "desc");
    }
    params.delete("page");
    router.push(`/screener?${params.toString()}`);
  };

  const sortIndicator = (field?: string) => {
    if (!field) return null;
    if (currentSort !== field) {
      return <span className="ml-1 opacity-25 group-hover:opacity-50 transition-opacity">↕</span>;
    }
    return <span className="ml-1 font-bold" style={{ color: "var(--accent)" }}>{currentDir === "asc" ? "↑" : "↓"}</span>;
  };

  const activeCols = ALL_COLUMNS.filter(c => visibleCols.includes(c.key));

  return (
    <div>
      {/* Toolbar: unit hint + column toggle */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Finančné ukazovatele v tis. €
        </span>
        <ColumnToggle columns={ALL_COLUMNS} visibleCols={visibleCols} onToggle={toggleColumn} />
      </div>

      {/* Table */}
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
        <table className="w-full text-sm" style={{ tableLayout: "fixed", minWidth: "700px" }}>
          <colgroup>
            {activeCols.map(col => (
              <col key={col.key} style={{ width: col.minWidth }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {activeCols.map(col => {
                const isActive = col.sortField && currentSort === col.sortField;
                return (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 text-xs uppercase tracking-wide ${col.align === "right" ? "text-right" : "text-left"} ${col.sortField ? "cursor-pointer select-none group" : ""}`}
                    style={{
                      color: isActive ? "var(--text)" : "var(--text-muted)",
                      fontWeight: isActive ? 700 : 600,
                      whiteSpace: "nowrap",
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "var(--surface)",
                      borderBottom: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                    }}
                    onClick={col.sortField ? () => toggleSort(col.sortField!) : undefined}
                    title={col.sortField ? "Kliknite pre zoradenie" : undefined}
                  >
                    {col.label}
                    {sortIndicator(col.sortField)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {companies.map((c, i) => (
              <tr
                key={c.ico}
                style={{
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  background: i % 2 === 1 ? "var(--bg-muted, var(--surface))" : "transparent",
                }}
                className="hover:bg-[var(--surface-hover)] transition-colors"
              >
                {activeCols.map(col => {
                  // Text columns that need ellipsis truncation
                  const isTextCol = col.key === "name" || col.key === "city" || col.key === "legalForm";
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 ${col.align === "right" ? "text-right" : "text-left"} whitespace-nowrap`}
                      style={isTextCol ? { overflow: "hidden", textOverflow: "ellipsis" } : undefined}
                    >
                      <Cell col={col} c={c} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toURLSearchParams, spStr } from "@/lib/url";

type FilterOption = { value: string; label: string; count?: number };

type Props = {
  naceSections: FilterOption[];
  sizeCategories: FilterOption[];
  cities: FilterOption[];
  legalForms: FilterOption[];
  statuses: FilterOption[];
  revenueRanges: FilterOption[];
  profitRanges: FilterOption[];
  searchParams: Record<string, string | string[] | undefined>;
};

const SELECT_STYLE = "rounded-lg px-3 py-2 text-sm border";

export function FirmyFilters({
  naceSections,
  sizeCategories,
  cities,
  legalForms,
  statuses,
  revenueRanges,
  profitRanges,
  searchParams,
}: Props) {
  const router = useRouter();

  const applyFilter = useCallback(
    (key: string, value: string) => {
      const params = toURLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/firmy?${params.toString()}`);
    },
    [router, searchParams]
  );

  const applySort = useCallback(
    (sortVal: string) => {
      const [field, dir] = sortVal.split("-");
      const params = toURLSearchParams(searchParams);
      if (field === "nazov" && dir === "asc") {
        params.delete("sort");
        params.delete("dir");
      } else {
        params.set("sort", field);
        params.set("dir", dir);
      }
      params.delete("page");
      router.push(`/firmy?${params.toString()}`);
    },
    [router, searchParams]
  );

  const sp = (key: string) => spStr(searchParams, key);
  const currentSort = sp("sort") || "nazov";
  const currentDir = sp("dir") || "asc";

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("odvetvie")}
          onChange={(e) => applyFilter("odvetvie", e.target.value)}
        >
          <option value="">Odvetvie: Všetky</option>
          {naceSections.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>

        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("velkost")}
          onChange={(e) => applyFilter("velkost", e.target.value)}
        >
          <option value="">Veľkosť: Všetky</option>
          {sizeCategories.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>

        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("trzby")}
          onChange={(e) => applyFilter("trzby", e.target.value)}
        >
          <option value="">Tržby: Všetky</option>
          {revenueRanges.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("zisk")}
          onChange={(e) => applyFilter("zisk", e.target.value)}
        >
          <option value="">Zisk: Všetky</option>
          {profitRanges.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("lokalita")}
          onChange={(e) => applyFilter("lokalita", e.target.value)}
        >
          <option value="">Lokalita: Všetky</option>
          {cities.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>

        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("pravnaForma")}
          onChange={(e) => applyFilter("pravnaForma", e.target.value)}
        >
          <option value="">Forma: Všetky</option>
          {legalForms.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label} ({l.count})
            </option>
          ))}
        </select>

        <select
          className={SELECT_STYLE}
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={sp("status")}
          onChange={(e) => applyFilter("status", e.target.value)}
        >
          <option value="">Status: Všetky</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Zoradiť:
        </span>
        <select
          className="rounded px-2 py-1 text-xs border"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
          value={`${currentSort}-${currentDir}`}
          onChange={(e) => applySort(e.target.value)}
        >
          <option value="nazov-asc">Názov A–Z</option>
          <option value="nazov-desc">Názov Z–A</option>
          <option value="trzby-desc">Tržby ↓</option>
          <option value="trzby-asc">Tržby ↑</option>
          <option value="zisk-desc">Zisk ↓</option>
          <option value="zisk-asc">Zisk ↑</option>
          <option value="mesto-asc">Mesto A–Z</option>
          <option value="mesto-desc">Mesto Z–A</option>
        </select>
      </div>
    </div>
  );
}

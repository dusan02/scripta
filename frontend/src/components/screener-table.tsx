"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { slugify } from "@/lib/slug";

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

// Display in thousands of euros (tis. eur) — no € sign, 3 fewer zeros
// Example: 1 234 567 → "1 235"
function fmtEur(val: string | null): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return Math.round(n / 1000).toLocaleString("sk-SK");
}

function fmtEstablished(establishedAt: Date | null): string {
  if (!establishedAt) return "—";
  const year = new Date(establishedAt).getFullYear();
  if (isNaN(year) || year < 1900) return "—";
  return String(year);
}

type Col = {
  key: string;
  label: string;
  sortField?: string; // if set, column is sortable
  align: "left" | "right";
  className?: string;
};

const COLUMNS: Col[] = [
  { key: "name", label: "Firma", sortField: "name", align: "left" },
  { key: "ico", label: "IČO", align: "left" },
  { key: "legalForm", label: "Právna forma", align: "left", className: "hidden xl:table-cell" },
  { key: "city", label: "Mesto", sortField: "city", align: "left" },
  { key: "establishedAt", label: "Založenie", sortField: "establishedAt", align: "right", className: "hidden lg:table-cell" },
  { key: "latestRevenue", label: "Tržby (tis. €)", sortField: "latestRevenue", align: "right" },
  { key: "latestProfit", label: "Zisk (tis. €)", sortField: "latestProfit", align: "right" },
  { key: "latestAssets", label: "Aktíva (tis. €)", sortField: "latestAssets", align: "right", className: "hidden xl:table-cell" },
  { key: "latestEquity", label: "Imanie (tis. €)", sortField: "latestEquity", align: "right", className: "hidden xl:table-cell" },
];

export function ScreenerTable({ companies }: { companies: Company[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSort = searchParams.get("sort") || "latestRevenue";
  const currentDir = searchParams.get("dir") || "desc";

  const toggleSort = (field: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSort === field) {
      // Same field — toggle direction
      params.set("dir", currentDir === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", field);
      // Financials default DESC (biggest first), name/city default ASC (A→Z)
      params.set("dir", field === "name" || field === "city" ? "asc" : "desc");
    }
    params.delete("page");
    router.push(`/screener?${params.toString()}`);
  };

  const sortIndicator = (field?: string) => {
    if (!field) return null;
    if (currentSort !== field) {
      return <span className="ml-1 opacity-0 group-hover:opacity-40 transition-opacity">↕</span>;
    }
    return (
      <span className="ml-1" style={{ color: "var(--accent)" }}>
        {currentDir === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  return (
    <table className="w-full text-sm" style={{ tableLayout: "auto" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${col.align === "right" ? "text-right" : "text-left"} ${col.className || ""} ${col.sortField ? "cursor-pointer select-none group" : ""}`}
              style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}
              onClick={col.sortField ? () => toggleSort(col.sortField!) : undefined}
              title={col.sortField ? "Kliknite pre zoradenie" : undefined}
            >
              {col.label}
              {sortIndicator(col.sortField)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {companies.map((c, i) => (
          <tr
            key={c.ico}
            style={{
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              transition: "background 0.1s",
            }}
            className="hover:bg-[var(--surface-hover)]"
          >
            <td className="px-3 py-2.5 max-w-0">
              <Link
                href={`/firma/${c.ico}-${slugify(c.name)}`}
                className="font-medium hover:underline block truncate"
                style={{ color: "var(--accent)" }}
                title={c.name || c.ico}
              >
                {c.name || c.ico}
              </Link>
            </td>
            <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{c.ico}</td>
            <td className="px-3 py-2.5 text-xs hidden xl:table-cell whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{c.legalForm || "—"}</td>
            <td className="px-3 py-2.5 text-xs max-w-[140px] truncate" style={{ color: "var(--text-secondary)" }} title={c.city || ""}>{c.city || "—"}</td>
            <td className="px-3 py-2.5 text-right text-xs hidden lg:table-cell whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{fmtEstablished(c.establishedAt)}</td>
            <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap" style={{ color: "var(--text)" }}>
              {fmtEur(c.latestRevenue)}
            </td>
            <td className="px-3 py-2.5 text-right whitespace-nowrap" style={{ color: "var(--text)" }}>
              {fmtEur(c.latestProfit)}
            </td>
            <td className="px-3 py-2.5 text-right hidden xl:table-cell whitespace-nowrap" style={{ color: "var(--text)" }}>
              {fmtEur(c.latestAssets)}
            </td>
            <td className="px-3 py-2.5 text-right hidden xl:table-cell whitespace-nowrap" style={{ color: "var(--text)" }}>
              {fmtEur(c.latestEquity)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

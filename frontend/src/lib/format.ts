import type { Decimal } from "@prisma/client/runtime/library";

const LEGAL_STATUSES = ["v konkurze", "v likvidácii", "v reštrukturalizácii", "konkurz", "likvidácia"];

/** Convert Prisma Decimal or number to number, preserving null/undefined. */
export function num(val: Decimal | number | string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return val.toNumber();
}

export function fmtEUR(val: Decimal | number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = num(val);
  if (n === null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} mil. €`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)} tis. €`;
  return `${n.toFixed(0)} €`;
}

export function fmtNum(val: Decimal | number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = num(val);
  if (n === null) return "—";
  const s = (n / 1_000).toFixed(0);
  return Number(s).toLocaleString("sk-SK").replace(/\u00a0/g, "\u00a0");
}

/**
 * Format a value (string | number | null) as thousands of euros.
 * No € sign, 3 fewer zeros: 1 234 567 → "1 235"
 * Uses regular space (U+0020) as thousands separator for consistent rendering.
 * Used by screener table.
 */
export function fmtEurK(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (Number.isNaN(n)) return "—";
  // Round to thousands, format with regular space as separator
  const rounded = Math.round(n / 1000);
  // Use regular space instead of non-breaking space for consistent width
  return rounded.toLocaleString("sk-SK").replace(/[\u00a0\u202f]/g, " ");
}

export function fmtYear(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).getFullYear().toString();
}

/**
 * Splits a company name into lines at legal status keywords and parenthesized text.
 * e.g. "ABC s.r.o. v konkurze (od: 01.01.2023)" → ["ABC s.r.o.", "v konkurze", "(od: 01.01.2023)"]
 */
export function formatCompanyName(name: string): string[] {
  let remaining = name.trim();
  const lines: string[] = [];

  // Extract parenthesized parts first
  const parenMatch = remaining.match(/\([^)]*\)/g);
  if (parenMatch) {
    for (const p of parenMatch) {
      remaining = remaining.replace(p, "").trim();
    }
    // Clean up leftover commas/spaces
    remaining = remaining.replace(/,\s*$/, "").trim();
  }

  // Extract legal status keywords
  let foundStatus: string | null = null;
  for (const status of LEGAL_STATUSES) {
    const idx = remaining.toLowerCase().indexOf(status.toLowerCase());
    if (idx >= 0) {
      const before = remaining.slice(0, idx).replace(/,\s*$/, "").trim();
      const after = remaining.slice(idx).trim();
      if (before) lines.push(before);
      lines.push(after);
      foundStatus = status;
      break;
    }
  }

  if (!foundStatus && remaining) {
    lines.push(remaining);
  }

  // Append parenthesized parts as separate lines
  if (parenMatch) {
    for (const p of parenMatch) {
      lines.push(p.trim());
    }
  }

  return lines.length > 0 ? lines : [name];
}

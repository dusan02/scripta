const LEGAL_STATUSES = ["v konkurze", "v likvidácii", "v reštrukturalizácii", "konkurz", "likvidácia"];

export function fmtEUR(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} mil. €`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)} tis. €`;
  return `${val.toFixed(0)} €`;
}

export function fmtNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = (val / 1_000).toFixed(0);
  return Number(n).toLocaleString("sk-SK").replace(/\u00a0/g, "\u00a0");
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

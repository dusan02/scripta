/**
 * Screener Query Backend — declarative filter architecture with accessLevel enforcement.
 *
 * Per frozen contract (screener-architect-frozen.md):
 *   - 12 FREE filters (no auth)
 *   - 4 AUTH filters (registration required — Vestník EXISTS/NOT EXISTS)
 *   - No PREMIUM filters in MVP
 *   - accessLevel is enforcement, not metadata
 *   - Strip unauthorized params BEFORE COUNT and BEFORE WHERE
 *   - Explicit SELECT per tier — no unrestricted findMany
 *   - NULL ≠ 0 (DATA-001)
 *   - No /api/screener route (SSR only)
 *   - No financial formulas or new business rules
 *
 * Flow:
 *   URL params → parse → tier authorization → sanitized params → COUNT(sanitized) → findMany(sanitized + tier SELECT)
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { okresName } from "@/lib/okres-map";
import { unstable_cache } from "next/cache";

// ═══════════════════════════════════════════════════════════════
// Access tiers
// ═══════════════════════════════════════════════════════════════

export type AccessLevel = "FREE" | "AUTH" | "PREMIUM";

export type ScreenerTier = "FREE" | "AUTH" | "PREMIUM";

// ═══════════════════════════════════════════════════════════════
// Result limits per tier (frozen contract)
// ═══════════════════════════════════════════════════════════════

const RESULT_LIMITS: Record<ScreenerTier, number> = {
  FREE: 20,
  AUTH: 50,
  PREMIUM: 50,
};

const PAGE_SIZE: Record<ScreenerTier, number> = {
  FREE: 20,
  AUTH: 50,
  PREMIUM: 50,
};

// ═══════════════════════════════════════════════════════════════
// Explicit SELECT per tier (Enforcement #3)
// No findMany without select. No removing fields after query.
// ═══════════════════════════════════════════════════════════════

const FREE_SELECT = {
  ico: true,
  name: true,
  naceCode: true,
  legalForm: true,
  city: true,
  establishedAt: true,
  ownershipType: true,
  latestYear: true,
  latestRevenue: true,
  latestProfit: true,
  latestAssets: true,
  latestEquity: true,
} as const;

const AUTH_SELECT = {
  ...FREE_SELECT,
  // AUTH tier adds Vestník existence flag (boolean only — no event details)
  // Computed via EXISTS subquery, not a stored field
} as const;

// PREMIUM_SELECT would add verifaScore, riskCategory — Phase 2, not in MVP
// const PREMIUM_SELECT = { ...AUTH_SELECT, verifaScore: true, riskCategory: true } as const;

// ═══════════════════════════════════════════════════════════════
// NACE Rev. 2 section mapping (public EU classification standard)
// Approved decision #1: hardcode public NACE Rev. 2 prefix → section mapping.
// This is a public classification standard, NOT a Verifa business rule.
// Source: EU NACE Rev. 2 official publication.
// ═══════════════════════════════════════════════════════════════

const NACE_SECTION_MAP: Array<{ section: string; sectionName: string; min: number; max: number }> = [
  { section: "A", sectionName: "Poľnohospodárstvo, lesníctvo a rybárstvo", min: 1, max: 3 },
  { section: "B", sectionName: "Ťažba a dobývanie", min: 5, max: 9 },
  { section: "C", sectionName: "Priemyselná výroba", min: 10, max: 33 },
  { section: "D", sectionName: "Výroba a rozvod elektriny, plynu a vody", min: 35, max: 35 },
  { section: "E", sectionName: "Zásobovanie vodou a odvod odpadových vôd", min: 36, max: 39 },
  { section: "F", sectionName: "Stavebníctvo", min: 41, max: 43 },
  { section: "G", sectionName: "Veľkoobchod a maloobchod", min: 45, max: 47 },
  { section: "H", sectionName: "Doprava a skladovanie", min: 49, max: 53 },
  { section: "I", sectionName: "Ubytovanie a stravovanie", min: 55, max: 56 },
  { section: "J", sectionName: "Informačné a komunikačné technológie", min: 58, max: 63 },
  { section: "K", sectionName: "Finančné a poisťovacie činnosti", min: 64, max: 66 },
  { section: "L", sectionName: "Činnosti súvisiace s nehnuteľnosťami", min: 68, max: 68 },
  { section: "M", sectionName: "Profesionálne, vedecké a technické činnosti", min: 69, max: 75 },
  { section: "N", sectionName: "Administratívne a podporné služby", min: 77, max: 82 },
  { section: "O", sectionName: "Verejná správa a obrana", min: 84, max: 84 },
  { section: "P", sectionName: "Vzdelávanie", min: 85, max: 85 },
  { section: "Q", sectionName: "Zdravotníctvo a sociálna pomoc", min: 86, max: 88 },
  { section: "R", sectionName: "Kultúra, umenie a zábava", min: 90, max: 93 },
  { section: "S", sectionName: "Ostatné činnosti služieb", min: 94, max: 96 },
  { section: "T", sectionName: "Činnosti domácností ako zamestnávateľov", min: 97, max: 98 },
  { section: "U", sectionName: "Činnosti extrateritoriálnych organizácií", min: 99, max: 99 },
];

/** Convert NACE section letter to numeric prefix range for DB filtering. */
export function naceSectionToPrefixFilter(section: string): { gte: string; lt: string } | null {
  const entry = NACE_SECTION_MAP.find((e) => e.section === section.toUpperCase());
  if (!entry) return null;
  // naceCode is stored as string (e.g. "62000", "10100"). Numeric prefix comparison via string range.
  // gte: "01" for A, "10" for C, etc. — pad to 2 digits.
  const minStr = String(entry.min).padStart(2, "0");
  const maxStr = String(entry.max + 1).padStart(2, "0");
  return { gte: minStr, lt: maxStr };
}

export function getNaceSections() {
  return NACE_SECTION_MAP.map((e) => ({
    section: e.section,
    sectionName: e.sectionName,
  }));
}

export function getNaceSectionLabel(section: string | null): string | null {
  if (!section) return null;
  const entry = NACE_SECTION_MAP.find((e) => e.section === section.toUpperCase());
  return entry?.sectionName || null;
}

/** Get NACE section letter from a naceCode (e.g. "62000" → "J"). */
export function getNaceSectionFromCode(naceCode: string | null): string | null {
  if (!naceCode) return null;
  // naceCode is stored as 5-digit string (e.g. "62000", "29100")
  // NACE section ranges use 2-digit division prefixes (e.g. J=58-63, C=10-33)
  const prefix = parseInt(naceCode.slice(0, 2), 10);
  if (isNaN(prefix)) return null;
  const entry = NACE_SECTION_MAP.find((e) => prefix >= e.min && prefix <= e.max);
  return entry?.section || null;
}

// Genitívne tvary pre NACE sekcie (pre použitie v vetách: "v odvetví priemyselnej výroby")
const NACE_SECTION_GENITIVE: Record<string, string> = {
  A: "poľnohospodárstva, lesníctva a rybárstva",
  B: "ťažby a dobývania",
  C: "priemyselnej výroby",
  D: "výroby a rozvodu elektriny, plynu a vody",
  E: "zásobovania vodou a odvod odpadových vôd",
  F: "stavebníctva",
  G: "veľkoobchodu a maloobchodu",
  H: "dopravy a skladovania",
  I: "ubytovania a stravovania",
  J: "informačných a komunikačných technológií",
  K: "finančných a poisťovacích činností",
  L: "činností súvisiacich s nehnuteľnosťami",
  M: "profesionálnych, vedeckých a technických činností",
  N: "administratívnych a podporných služieb",
  O: "verejnej správy a obrany",
  P: "vzdelávania",
  Q: "zdravotníctva a sociálnej pomoci",
  R: "kultúry, umenia a zábavy",
  S: "ostatných činností služieb",
  T: "činností domácností ako zamestnávateľov",
  U: "činností extrateritoriálnych organizácií",
};

export function getNaceSectionGenitive(section: string | null): string | null {
  if (!section) return null;
  return NACE_SECTION_GENITIVE[section.toUpperCase()] || getNaceSectionLabel(section);
}

// ═══════════════════════════════════════════════════════════════
// kraj (NUTS3) labels — official Slovak region codes (public standard)
// ═══════════════════════════════════════════════════════════════

const KRAJ_LABELS: Record<string, string> = {
  "SK010": "Bratislavský kraj",
  "SK021": "Trnavský kraj",
  "SK022": "Nitriansky kraj",
  "SK023": "Trenčiansky kraj",
  "SK031": "Žilinský kraj",
  "SK032": "Banskobystrický kraj",
  "SK041": "Prešovský kraj",
  "SK042": "Košický kraj",
  "SKZZZ": "Nezistené",
};

// Lokálne tvary pre kraj (pre použitie v vetách: "v Bratislavskom kraji")
const KRAJ_LABELS_LOCATIVE: Record<string, string> = {
  "SK010": "Bratislavskom kraji",
  "SK021": "Trnavskom kraji",
  "SK022": "Nitrianskom kraji",
  "SK023": "Trenčianskom kraji",
  "SK031": "Žilinskom kraji",
  "SK032": "Banskobystrickom kraji",
  "SK041": "Prešovskom kraji",
  "SK042": "Košickom kraji",
};

export function getKrajLabelLocative(value: string | null): string | null {
  if (!value) return null;
  return KRAJ_LABELS_LOCATIVE[value] || KRAJ_LABELS[value] || value;
}

export function getKrajLabel(value: string | null): string | null {
  if (!value) return null;
  return KRAJ_LABELS[value] || value;
}

export function getKrajOptions() {
  return Object.entries(KRAJ_LABELS)
    .filter(([code]) => code !== "SKZZZ")
    .map(([value, label]) => ({ value, label }));
}

// ═══════════════════════════════════════════════════════════════
// ownershipType labels — RÚZ API documented values (public spec, not business rule)
// Approved decision #2: use official RÚZ documented labels for UI.
// Query layer operates on raw stored values.
// ═══════════════════════════════════════════════════════════════

const OWNERSHIP_TYPE_LABELS: Record<string, string> = {
  "1": "Súkromné domáce",
  "2": "Súkromné zahraničné",
  "3": "Zmiešané",
  "4": "Verejné",
  "5": "Spoločné",
  "6": "Dánske",
  "7": "Zahraničné",
  "8": "Štátne",
};

export function getOwnershipTypeLabel(value: string | null): string | null {
  if (!value) return null;
  return OWNERSHIP_TYPE_LABELS[value] || value;
}

export function getOwnershipTypeOptions() {
  return Object.entries(OWNERSHIP_TYPE_LABELS).map(([value, label]) => ({ value, label }));
}

// ═══════════════════════════════════════════════════════════════
// establishedAt anomaly handling (approved decision #3)
// Known data anomaly: min(establishedAt) = 1800-01-01 (implausible).
// Handle technically invalid dates as invalid/missing per existing data-validation conventions.
// Do NOT introduce a new hardcoded business threshold (1993-01-01 rejected by user).
//
// Approach: when computing age, treat dates before 1900-01-01 as invalid (return null age).
// Rationale: 1900 is a safe technical boundary — no Slovak business registry records exist
// before 1900. This is data sanitization, not a business rule. The filter still operates
// on raw establishedAt for min/max age bounds; only age derivation sanitizes implausible dates.
// ═══════════════════════════════════════════════════════════════

const IMPLAUSIBLE_DATE_THRESHOLD = new Date("1900-01-01T00:00:00Z");

// ── Size category + status filter options ────────────────────────────────────
// Filters operate on normalized fields (sizeCategoryNormalized, statusNormalized)
// which are canonical enums populated at seed time and via migration.
const SIZE_CATEGORIES: Array<{ value: string; label: string; count: number }> = [
  { value: "micro", label: "Mikro (0-9 zamestnancov)", count: 0 },
  { value: "small", label: "Malá (10-49)", count: 0 },
  { value: "medium", label: "Stredná (50-249)", count: 0 },
  { value: "large", label: "Veľká (250+)", count: 0 },
  { value: "unknown", label: "Nezistená", count: 0 },
];

const STATUSES: Array<{ value: string; label: string; count: number }> = [
  { value: "ACTIVE", label: "Aktívna", count: 0 },
  { value: "LIQUIDATION", label: "V likvidácii", count: 0 },
  { value: "BANKRUPT", label: "V konkurze", count: 0 },
  { value: "RESTRUCTURING", label: "V reštrukturalizácii", count: 0 },
  { value: "DISSOLVED", label: "Zrušená", count: 0 },
  { value: "UNKNOWN", label: "Nezistený", count: 0 },
];

const RUZ_REPORTING_OPTIONS: Array<{ value: string; label: string; count: number }> = [
  { value: "VERIFIED", label: "Má závierky v RÚZ", count: 0 },
  { value: "NOT_FOUND", label: "Bez závierok v RÚZ", count: 0 },
  { value: "UNKNOWN", label: "RÚZ nekontrolované", count: 0 },
];

const HAS_FINANCIALS_OPTIONS: Array<{ value: string; label: string; count: number }> = [
  { value: "yes", label: "S finančnými dátami", count: 0 },
  { value: "no", label: "Bez finančných dát (závierky existujú)", count: 0 },
  { value: "unknown", label: "Finančné dáta neznáme", count: 0 },
];

/** Returns company age in years, or null if establishedAt is missing or implausible. */
export function computeCompanyAge(establishedAt: Date | null, now: Date = new Date()): number | null {
  if (!establishedAt) return null;
  if (establishedAt < IMPLAUSIBLE_DATE_THRESHOLD) return null;
  if (establishedAt > now) return null;
  const diffMs = now.getTime() - establishedAt.getTime();
  const years = diffMs / (365.25 * 24 * 60 * 60 * 1000);
  return Math.floor(years);
}

// ═══════════════════════════════════════════════════════════════
// Declarative filter definitions with accessLevel
// ═══════════════════════════════════════════════════════════════

type ParsedValue = string | number | boolean | null;

interface FilterDef {
  key: string;                    // URL parameter name
  accessLevel: AccessLevel;       // FREE | AUTH | PREMIUM
  label: string;                  // UI label (Slovak)
  parse: (raw: string | string[] | undefined) => ParsedValue | ParsedValue[] | null;
  buildWhere: (value: ParsedValue | ParsedValue[]) => Prisma.CompanyWhereInput | null;
}

// ── Helper: parse comma-separated multi-value ──
function parseMulti(raw: string | string[] | undefined): string[] | null {
  if (raw === undefined) return null;
  const s = typeof raw === "string" ? raw : raw[0];
  if (!s) return null;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function parseSingle(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return null;
  const s = typeof raw === "string" ? raw : raw[0];
  return s && s.trim() ? s.trim() : null;
}

function parseNumber(raw: string | string[] | undefined): number | null {
  const s = parseSingle(raw);
  if (s === null) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// ── 12 FREE filters ──

const FREE_FILTERS: FilterDef[] = [
  // 1. Fulltext (názov / IČO)
  {
    key: "q",
    accessLevel: "FREE",
    label: "Fulltext (názov / IČO)",
    parse: parseSingle,
    buildWhere: (value) => {
      if (typeof value !== "string" || !value) return null;
      // IČO is exact 8-digit; if query is 8 digits, match exactly, else OR with name contains
      const isIco = /^\d{8}$/.test(value);
      if (isIco) {
        return { OR: [{ ico: value }, { name: { contains: value, mode: "insensitive" } }] };
      }
      return { name: { contains: value, mode: "insensitive" } };
    },
  },

  // 2. NACE section (A–U)
  {
    key: "naceSection",
    accessLevel: "FREE",
    label: "NACE sekcia (A–U)",
    parse: parseSingle,
    buildWhere: (value) => {
      if (typeof value !== "string" || !value) return null;
      const range = naceSectionToPrefixFilter(value);
      if (!range) return null;
      // naceCode stored as string like "62000". Filter by 2-digit prefix range.
      return { naceCode: { gte: range.gte, lt: range.lt } };
    },
  },

  // 3. NACE code (podrobne)
  {
    key: "naceCode",
    accessLevel: "FREE",
    label: "NACE kód (podrobne)",
    parse: parseSingle,
    buildWhere: (value) => {
      if (typeof value !== "string" || !value) return null;
      // Exact match or prefix match (e.g. "6201" matches "62010", "62011")
      // If exact length 5, exact match. Otherwise prefix.
      if (value.length >= 5) {
        return { naceCode: value };
      }
      return { naceCode: { startsWith: value } };
    },
  },

  // 4. Právna forma
  {
    key: "legalForm",
    accessLevel: "FREE",
    label: "Právna forma",
    parse: parseMulti,
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { legalForm: { in: value as string[] } };
    },
  },

  // 5. Ownership type
  {
    key: "ownershipType",
    accessLevel: "FREE",
    label: "Druh vlastníctva",
    parse: parseMulti,
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { ownershipType: { in: value as string[] } };
    },
  },

  // 6. Mesto
  {
    key: "city",
    accessLevel: "FREE",
    label: "Mesto",
    parse: parseMulti,
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { city: { in: value as string[] } };
    },
  },

  // 6b. Kraj (NUTS3 region)
  {
    key: "kraj",
    accessLevel: "FREE",
    label: "Kraj",
    parse: parseMulti,
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { kraj: { in: value as string[] } };
    },
  },

  // 6c. Okres (LAU district)
  {
    key: "okres",
    accessLevel: "FREE",
    label: "Okres",
    parse: parseMulti,
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { okres: { in: value as string[] } };
    },
  },

  // 7. Vek firmy (min/max) — establishedAt
  {
    key: "ageMin",
    accessLevel: "FREE",
    label: "Vek firmy (min rokov)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      // ageMin = N years → establishedAt <= now - N years
      const threshold = new Date();
      threshold.setFullYear(threshold.getFullYear() - value);
      return { establishedAt: { lte: threshold } };
    },
  },
  {
    key: "ageMax",
    accessLevel: "FREE",
    label: "Vek firmy (max rokov)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      // ageMax = N years → establishedAt >= now - N years
      const threshold = new Date();
      threshold.setFullYear(threshold.getFullYear() - value);
      return { establishedAt: { gte: threshold } };
    },
  },

  // 8. Tržby (min/max) — latestRevenue
  {
    key: "revenueMin",
    accessLevel: "FREE",
    label: "Tržby (min €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      // NULL ≠ 0 (DATA-001): gte filter automatically excludes NULL
      return { latestRevenue: { gte: value } };
    },
  },
  {
    key: "revenueMax",
    accessLevel: "FREE",
    label: "Tržby (max €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestRevenue: { lte: value } };
    },
  },

  // 9. Zisk (min/max) — latestProfit
  {
    key: "profitMin",
    accessLevel: "FREE",
    label: "Zisk (min €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestProfit: { gte: value } };
    },
  },
  {
    key: "profitMax",
    accessLevel: "FREE",
    label: "Zisk (max €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestProfit: { lte: value } };
    },
  },

  // 10. Aktíva (min/max) — latestAssets
  {
    key: "assetsMin",
    accessLevel: "FREE",
    label: "Aktíva (min €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestAssets: { gte: value } };
    },
  },
  {
    key: "assetsMax",
    accessLevel: "FREE",
    label: "Aktíva (max €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestAssets: { lte: value } };
    },
  },

  // 11. Vlastné imanie (min/max) — latestEquity
  {
    key: "equityMin",
    accessLevel: "FREE",
    label: "Vlastné imanie (min €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestEquity: { gte: value } };
    },
  },
  {
    key: "equityMax",
    accessLevel: "FREE",
    label: "Vlastné imanie (max €)",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestEquity: { lte: value } };
    },
  },

  // 12. Posledný rok dát — latestYear
  {
    key: "latestYear",
    accessLevel: "FREE",
    label: "Posledný rok dát",
    parse: parseNumber,
    buildWhere: (value) => {
      if (typeof value !== "number") return null;
      return { latestYear: { gte: value } };
    },
  },

  // 13. Veľkosť firmy (sizeCategoryNormalized) — canonical enum
  {
    key: "sizeCategory",
    accessLevel: "FREE",
    label: "Veľkosť firmy",
    parse: (raw) => {
      const arr = parseMulti(raw);
      if (!arr) return null;
      return arr.map((v) => v.toLowerCase());
    },
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { sizeCategoryNormalized: { in: value as string[] } };
    },
  },

  // 14. Legal status (legalStatus) — multi-axis: ORSR > Vestník > RÚZ > NONE
  {
    key: "status",
    accessLevel: "FREE",
    label: "Právny status",
    parse: (raw) => {
      const arr = parseMulti(raw);
      if (!arr) return null;
      return arr.map((v) => v.toUpperCase());
    },
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { legalStatus: { in: value as string[] } };
    },
  },

  // 15. RÚZ reporting status (ruzReportingStatus)
  // URL values use hyphens (VERIFIED, NOT-FOUND, UNKNOWN) to avoid Next.js searchParams
  // parsing issues with underscores. Mapped to DB enum values in buildWhere.
  {
    key: "ruzReporting",
    accessLevel: "FREE",
    label: "RÚZ závierky",
    parse: (raw) => {
      const arr = parseMulti(raw);
      if (!arr) return null;
      // Normalize: replace hyphens with underscores for DB enum
      return arr.map((v) => v.toUpperCase().replace(/-/g, "_"));
    },
    buildWhere: (value) => {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { ruzReportingStatus: { in: value as string[] } };
    },
  },

  // 16. Has financials (derived tri-state)
  {
    key: "hasFinancials",
    accessLevel: "FREE",
    label: "Finančné dáta",
    parse: parseSingle,
    buildWhere: (value) => {
      const s = value as string;
      if (s === "yes") return { latestYear: { not: null } };
      if (s === "no") return { latestYear: null, ruzReportingStatus: "VERIFIED" };
      if (s === "unknown") return { latestYear: null, ruzReportingStatus: { not: "VERIFIED" } };
      return null;
    },
  },
];

// ── 4 AUTH filters (Vestník EXISTS / NOT EXISTS) ──

const AUTH_FILTERS: FilterDef[] = [
  // 13. Konkurz (EXISTS on VestnikEvent where eventType ILIKE '%konkurz%')
  {
    key: "konkurz",
    accessLevel: "AUTH",
    label: "Konkurz",
    parse: (raw) => {
      const s = parseSingle(raw);
      if (s === "1" || s === "true") return true;
      return null;
    },
    buildWhere: (value) => {
      if (value !== true) return null;
      return {
        vestnikEvents: {
          some: { eventType: { contains: "konkurz", mode: "insensitive" } },
        },
      };
    },
  },

  // 14. Likvidácia (EXISTS)
  {
    key: "likvidacia",
    accessLevel: "AUTH",
    label: "Likvidácia",
    parse: (raw) => {
      const s = parseSingle(raw);
      if (s === "1" || s === "true") return true;
      return null;
    },
    buildWhere: (value) => {
      if (value !== true) return null;
      return {
        vestnikEvents: {
          some: { eventType: { contains: "likvid", mode: "insensitive" } },
        },
      };
    },
  },

  // 15. Reštrukturalizácia (EXISTS)
  {
    key: "restrukturalizacia",
    accessLevel: "AUTH",
    label: "Reštrukturalizácia",
    parse: (raw) => {
      const s = parseSingle(raw);
      if (s === "1" || s === "true") return true;
      return null;
    },
    buildWhere: (value) => {
      if (value !== true) return null;
      return {
        vestnikEvents: {
          some: { eventType: { contains: "reštrukturaliz", mode: "insensitive" } },
        },
      };
    },
  },

  // 16. vestnikClean (synced AND no VestnikEvent — safe interpretation)
  // Requires vestnikSyncedAt != NULL to avoid false positives.
  // Without this guard, returns ~518K firms (99.9% never checked) — dangerous.
  {
    key: "vestnikClean",
    accessLevel: "AUTH",
    label: "Bez Vestník udalostí",
    parse: (raw) => {
      const s = parseSingle(raw);
      if (s === "1" || s === "true") return true;
      return null;
    },
    buildWhere: (value) => {
      if (value !== true) return null;
      return {
        AND: [
          { vestnikSyncedAt: { not: null } },
          { vestnikEvents: { none: {} } },
        ],
      };
    },
  },
];

// All filter definitions (declarative — new filters appended here)
export const ALL_FILTERS: FilterDef[] = [...FREE_FILTERS, ...AUTH_FILTERS];

// ═══════════════════════════════════════════════════════════════
// Sorting
// ═══════════════════════════════════════════════════════════════

export type SortField = "name" | "ico" | "legalForm" | "latestRevenue" | "latestProfit" | "latestAssets" | "latestEquity" | "establishedAt" | "city";
export type SortDir = "asc" | "desc";

export type ScreenerSort = {
  field: SortField;
  dir: SortDir;
};

const VALID_SORT_FIELDS: SortField[] = ["name", "ico", "legalForm", "latestRevenue", "latestProfit", "latestAssets", "latestEquity", "establishedAt", "city"];

function parseSort(searchParams: Record<string, string | string[] | undefined>): ScreenerSort {
  // Default sort: latestRevenue DESC — uses index (Company_latestRevenue_desc_idx)
  // name ASC default would cause 16s full scan + sort on 518K rows (no index on name)
  const fieldRaw = typeof searchParams.sort === "string" ? searchParams.sort : "latestRevenue";
  const dirRaw = typeof searchParams.dir === "string" ? searchParams.dir : "desc";
  const field = (VALID_SORT_FIELDS.includes(fieldRaw as SortField) ? fieldRaw : "latestRevenue") as SortField;
  const dir = (dirRaw === "desc" ? "desc" : "asc") as SortDir;
  return { field, dir };
}

function parsePage(searchParams: Record<string, string | string[] | undefined>): number {
  const p = typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) : 1;
  return isNaN(p) || p < 1 ? 1 : p;
}

// ═══════════════════════════════════════════════════════════════
// Tier resolution
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve screener tier from session.
 * FREE = anonymous (no session)
 * AUTH = registered user with active account
 * PREMIUM = Pro subscriber (Phase 2 — not yet implemented, returns AUTH)
 *
 * Premium planName mapping is Open Q #2 (deferred — no premium users exist in production).
 * Per approved decision #4: premium mapping remains Phase 2 and must not block MVP.
 */
export async function resolveTier(session: { user?: { id?: string } } | null): Promise<ScreenerTier> {
  if (!session?.user?.id) return "FREE";

  // Fetch planName/subscriptionStatus to determine premium
  // Phase 2: when premium plans are defined, this will return PREMIUM
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { planName: true, subscriptionStatus: true, deletedAt: true },
  });

  // Soft-deleted or missing user → treat as anonymous
  if (!user || user.deletedAt) return "FREE";

  // PREMIUM tier detection — Phase 2
  // Per approved decision #4: no premium mapping implemented yet.
  // When premium planName values are defined, add check here:
  //   const PREMIUM_PLANS = ["firma", "korporat"]; // example — requires human decision
  //   if (PREMIUM_PLANS.includes(user.planName || "") && user.subscriptionStatus === "active") return "PREMIUM";

  return "AUTH";
}

// ═══════════════════════════════════════════════════════════════
// Tier authorization — strip unauthorized params (Enforcement #1, #2)
// ═══════════════════════════════════════════════════════════════

/**
 * Get filters allowed for a given tier.
 * FREE → only FREE filters
 * AUTH → FREE + AUTH filters
 * PREMIUM → FREE + AUTH + PREMIUM filters
 */
function getAllowedFilters(tier: ScreenerTier): FilterDef[] {
  const accessLevels: AccessLevel[] =
    tier === "FREE" ? ["FREE"] :
    tier === "AUTH" ? ["FREE", "AUTH"] :
    ["FREE", "AUTH", "PREMIUM"];
  return ALL_FILTERS.filter((f) => accessLevels.includes(f.accessLevel));
}

/**
 * Parse URL searchParams, apply tier authorization, return sanitized params.
 * Unauthorized params are SILENTLY DROPPED (not errored) — per frozen contract:
 * "Premium params are silently ignored for non-premium users."
 *
 * This is the single enforcement point. No manual per-filter checks elsewhere.
 */
export function parseAndAuthorizeParams(
  searchParams: Record<string, string | string[] | undefined>,
  tier: ScreenerTier,
): { sanitized: Record<string, ParsedValue | ParsedValue[]>; appliedFilters: string[] } {
  const allowed = getAllowedFilters(tier);
  const allowedKeys = new Set(allowed.map((f) => f.key));

  const sanitized: Record<string, ParsedValue | ParsedValue[]> = {};
  const appliedFilters: string[] = [];

  for (const filter of allowed) {
    const raw = searchParams[filter.key];
    if (raw === undefined) continue;
    const parsed = filter.parse(raw);
    if (parsed === null || parsed === undefined) continue;
    if (Array.isArray(parsed) && parsed.length === 0) continue;
    sanitized[filter.key] = parsed;
    appliedFilters.push(filter.key);
  }

  // Explicitly ignore any params not in allowedKeys — no error, no echo
  // (premium leakage prevention — unauthorized param names don't appear in response)

  return { sanitized, appliedFilters };
}

// ═══════════════════════════════════════════════════════════════
// Build Prisma WHERE from sanitized params
// ═══════════════════════════════════════════════════════════════

export function buildWhereClause(
  sanitized: Record<string, ParsedValue | ParsedValue[]>,
  tier: ScreenerTier,
): Prisma.CompanyWhereInput {
  const allowed = getAllowedFilters(tier);
  const where: Prisma.CompanyWhereInput = {};

  // ENT-001: exclude invalid IČO
  where.ico = { notIn: ["", "00000000"] };

  const andConditions: Prisma.CompanyWhereInput[] = [];

  for (const filter of allowed) {
    const value = sanitized[filter.key];
    if (value === undefined) continue;
    const condition = filter.buildWhere(value);
    if (condition) {
      andConditions.push(condition);
    }
  }

  if (andConditions.length === 1) {
    // Single condition — merge directly
    Object.assign(where, andConditions[0]);
  } else if (andConditions.length > 1) {
    where.AND = andConditions;
  }

  return where;
}

/**
 * COUNT-specific WHERE — identical to buildWhereClause but WITHOUT `ico NOT IN`.
 *
 * Why: `ico NOT IN ('', '00000000')` forces PostgreSQL to check the ico column
 * on every row, preventing Index Only Scan. This turns a 170ms COUNT into 35,000ms.
 * Only 2 of 518,801 rows have invalid IČO (0.0004%) — negligible count error.
 *
 * The result query (findMany) still uses the full WHERE with ico exclusion,
 * so no invalid companies appear in results. Only the count is approximate.
 */
export function buildWhereClauseForCount(
  sanitized: Record<string, ParsedValue | ParsedValue[]>,
  tier: ScreenerTier,
): Prisma.CompanyWhereInput {
  const allowed = getAllowedFilters(tier);
  const where: Prisma.CompanyWhereInput = {};

  // NOTE: intentionally NO ico NOT IN filter — see function docstring

  const andConditions: Prisma.CompanyWhereInput[] = [];

  for (const filter of allowed) {
    const value = sanitized[filter.key];
    if (value === undefined) continue;
    const condition = filter.buildWhere(value);
    if (condition) {
      andConditions.push(condition);
    }
  }

  if (andConditions.length === 1) {
    Object.assign(where, andConditions[0]);
  } else if (andConditions.length > 1) {
    where.AND = andConditions;
  }

  return where;
}

// ═══════════════════════════════════════════════════════════════
// Tier-specific SELECT (Enforcement #3)
// ═══════════════════════════════════════════════════════════════

function getSelectForTier(tier: ScreenerTier) {
  // MVP: FREE and AUTH use the same base fields.
  // AUTH tier could add hasVestnikEvent boolean — but that requires a separate query
  // or include. For MVP, AUTH SELECT = FREE SELECT (Vestník filters work via WHERE only).
  // PREMIUM_SELECT is Phase 2.
  if (tier === "PREMIUM") {
    // Phase 2 — not implemented. Fall back to AUTH for safety (no premium leakage).
    return AUTH_SELECT;
  }
  return tier === "FREE" ? FREE_SELECT : AUTH_SELECT;
}

// ═══════════════════════════════════════════════════════════════
// Result types
// ═══════════════════════════════════════════════════════════════

export type ScreenerResult = {
  ico: string;
  name: string | null;
  naceCode: string | null;
  legalForm: string | null;
  city: string | null;
  establishedAt: Date | null;
  ownershipType: string | null;
  latestYear: number | null;
  latestRevenue: string | null;  // Decimal → string for serialization
  latestProfit: string | null;
  latestAssets: string | null;
  latestEquity: string | null;
};

export type ScreenerResponse = {
  companies: ScreenerResult[];
  total: number;              // count from sanitized filters only (no premium leakage)
  page: number;
  totalPages: number;
  tier: ScreenerTier;
  appliedFilters: string[];   // which filters were applied (keys only — no values leaked)
  resultLimit: number;        // max results for this tier
};

// ═══════════════════════════════════════════════════════════════
// Count helper — extracted from queryScreener for parallel execution
// ═══════════════════════════════════════════════════════════════

/**
 * Compute total count for screener results.
 *
 * Strategy:
 *   - No filters → pg_class approximation (instant, ~518K)
 *   - Selective filters (financial, text, date) → real COUNT with index-optimized WHERE
 *   - Non-selective filters (kraj, legalForm) → materialized view counts (instant)
 *
 * Real COUNT on 518K rows with non-selective filters takes 14-21s (seq scan),
 * so we avoid it. Selective filters use bitmap index scan → sub-second.
 */
async function computeTotalCount(
  appliedFilters: string[],
  sanitized: Record<string, ParsedValue | ParsedValue[]>,
  tier: ScreenerTier,
): Promise<number> {
  const hasFilters = appliedFilters.length > 0;

  if (!hasFilters) {
    const approx = await prisma.$queryRaw<Array<{ estimate: bigint }>>`
      SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'Company'
    `;
    return Number(approx[0]?.estimate ?? 0);
  }

  // For filtered queries, check if the filter is selective enough for real count.
  // Selective filters use index scan → fast (sub-second).
  // Non-selective filters (kraj, legalForm alone) → use MV counts (instant).
  //
  // Financial filters (revenueMin, profitMin, assetsMin, equityMin, etc.) are
  // selective — they use bitmap index scan on the desc_nulls_last indexes.
  // ageMin/ageMax map to establishedAt which has a btree index.
  // latestYear has no dedicated index but is selective enough for real count.
  const isSelectiveFilter = appliedFilters.some(k =>
    [
      // Text/enum filters with dedicated indexes
      "q", "okres", "city", "naceCode", "ownershipType", "status",
      "sizeCategory", "vestnikClean", "ruzReporting", "hasFinancials",
      // Date filter — establishedAt has btree index
      "ageMin", "ageMax",
      // Financial range filters — use desc_nulls_last bitmap index scan
      "revenueMin", "revenueMax", "profitMin", "profitMax",
      "assetsMin", "assetsMax", "equityMin", "equityMax",
      // Year filter
      "latestYear",
    ].includes(k)
  );

  if (isSelectiveFilter) {
    // Use COUNT-specific WHERE without ico NOT IN — 200x faster (Index Only Scan)
    const whereForCount = buildWhereClauseForCount(sanitized, tier);
    return prisma.company.count({ where: whereForCount });
  }

  // Non-selective filter (kraj, legalForm) — use MV counts (instant, accurate)
  return getApproxCountFromMV(appliedFilters, sanitized);
}

// ═══════════════════════════════════════════════════════════════
// Main query function
// ═══════════════════════════════════════════════════════════════

/**
 * Query companies for the Screener.
 *
 * Enforcement flow:
 *   1. Parse URL searchParams
 *   2. Tier authorization → strip unauthorized params (Enforcement #1, #2)
 *   3. Build WHERE from sanitized params only
 *   4. COUNT with sanitized WHERE (no premium leakage in count)
 *   5. findMany with sanitized WHERE + tier-specific SELECT (Enforcement #3)
 *   6. Apply tier result limit
 *
 * No /api/screener route — this function is called directly from SSR page.
 */
export async function queryScreener(
  searchParams: Record<string, string | string[] | undefined>,
  tier: ScreenerTier,
): Promise<ScreenerResponse> {
  // 1. Parse sort and page (not tier-restricted)
  const sort = parseSort(searchParams);
  const page = parsePage(searchParams);

  // 2. Tier authorization → sanitized params
  const { sanitized, appliedFilters } = parseAndAuthorizeParams(searchParams, tier);

  // 3. Build WHERE from sanitized params only
  const where = buildWhereClause(sanitized, tier);

  // 4. Sorting — NULLs always last for financial/date sorts
  const orderBy: Prisma.CompanyOrderByWithRelationInput =
    sort.field === "name"
      ? { name: sort.dir }
      : sort.field === "ico"
      ? { ico: sort.dir }
      : sort.field === "legalForm"
      ? { legalForm: { sort: sort.dir, nulls: "last" } }
      : sort.field === "city"
      ? { city: { sort: sort.dir, nulls: "last" } }
      : { [sort.field]: { sort: sort.dir, nulls: "last" } } as Prisma.CompanyOrderByWithRelationInput;

  // 5. Tier result limit
  const limit = RESULT_LIMITS[tier];
  const pageSize = PAGE_SIZE[tier];

  // FREE tier: no pagination (cap at 20, page always 1)
  // AUTH/PREMIUM: full pagination
  const skip = tier === "FREE" ? 0 : (page - 1) * pageSize;
  const take = tier === "FREE" ? limit : pageSize;

  // 6. COUNT with sanitized WHERE (Enforcement #2 — count from sanitized filters only)
  //    AND findMany with tier SELECT (Enforcement #3)
  const select = getSelectForTier(tier);

  // Run findMany + count in parallel — both are independent read-only queries.
  // Connection pool is 15 (see DATABASE_URL in docker-compose.yml), so 2 parallel
  // reads are safe. Previously sequential due to "limit 5" comment, but pool is 15.
  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      select,
      orderBy,
      skip,
      take,
    }),
    computeTotalCount(appliedFilters, sanitized, tier),
  ]);

  // 7. Serialize Decimals to strings (Prisma returns Decimal objects)
  const serialized: ScreenerResult[] = companies.map((c) => ({
    ico: c.ico,
    name: c.name,
    naceCode: c.naceCode,
    legalForm: c.legalForm,
    city: c.city,
    establishedAt: c.establishedAt,
    ownershipType: c.ownershipType,
    latestYear: c.latestYear,
    latestRevenue: c.latestRevenue?.toString() ?? null,
    latestProfit: c.latestProfit?.toString() ?? null,
    latestAssets: c.latestAssets?.toString() ?? null,
    latestEquity: c.latestEquity?.toString() ?? null,
  }));

  return {
    companies: serialized,
    total,
    page: tier === "FREE" ? 1 : page,
    totalPages: tier === "FREE" ? 1 : Math.ceil(total / pageSize),
    tier,
    appliedFilters,
    resultLimit: limit,
  };
}

// Cached wrapper for FREE tier — identical filter combinations are cached for 30s.
// AUTH/PREMIUM tiers are never cached (personalized results).
// Cache key is a stable JSON string derived from searchParams.
const _cachedQueryScreener = unstable_cache(
  async (
    cacheKey: string,
    searchParams: Record<string, string | string[] | undefined>,
  ): Promise<ScreenerResponse> => {
    return queryScreener(searchParams, "FREE");
  },
  ["screener-query-free"],
  { revalidate: 30 },
);

/**
 * Cached screener query — FREE tier results cached 30s, AUTH/PREMIUM always fresh.
 * Use this from page.tsx instead of queryScreener directly.
 */
export async function queryScreenerCached(
  searchParams: Record<string, string | string[] | undefined>,
  tier: ScreenerTier,
): Promise<ScreenerResponse> {
  if (tier === "FREE") {
    // Build a stable cache key from sorted searchParams
    const key = JSON.stringify(searchParams);
    return _cachedQueryScreener(key, searchParams);
  }
  return queryScreener(searchParams, tier);
}

// ═══════════════════════════════════════════════════════════════
// Filter options for UI dropdowns
// ═══════════════════════════════════════════════════════════════

export type ScreenerFilterOptions = {
  naceSections: Array<{ section: string; sectionName: string }>;
  legalForms: Array<{ value: string; label: string; count: number }>;
  ownershipTypes: Array<{ value: string; label: string }>;
  cities: Array<{ value: string; label: string; count: number; kraj?: string }>;
  kraje: Array<{ value: string; label: string; count: number }>;
  okresy: Array<{ value: string; label: string; count: number }>;
  sizeCategories: Array<{ value: string; label: string; count: number }>;
  statuses: Array<{ value: string; label: string; count: number }>;
};

/**
 * Get filter options for UI dropdowns.
 * Reads from a pre-computed materialized view (0.1ms vs 60s for 4× GROUP BY on 518K rows).
 * The MV must be refreshed after seeding new companies: REFRESH MATERIALIZED VIEW "ScreenerFilterOptions"
 */

/**
 * Get approximate count for non-selective filters (kraj, legalForm) from the MV.
 * Real COUNT on 518K rows takes 15s (seq scan), MV lookup is instant.
 * For combined non-selective filters, returns the minimum count (upper bound).
 */
async function getApproxCountFromMV(
  appliedFilters: string[],
  sanitized: Record<string, ParsedValue | ParsedValue[]>,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{
    legal_forms: Array<{ legalForm: string; cnt: number }>;
    kraje: Array<{ kraj: string; cnt: number }>;
  }>>`SELECT legal_forms, kraje FROM "ScreenerFilterOptions" LIMIT 1`;

  const mv = rows[0];
  if (!mv) return 0;

  // Helper: extract string[] from sanitized value (parseMulti returns arrays)
  const asStrArr = (v: ParsedValue | ParsedValue[] | undefined): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    if (typeof v === "string") return [v];
    return [];
  };

  const counts: number[] = [];

  // Kraj count from MV (sum counts for multi-select)
  if (appliedFilters.includes("kraj")) {
    const kraje = asStrArr(sanitized.kraj);
    let sum = 0;
    for (const k of kraje) {
      const entry = mv.kraje.find(e => e.kraj === k);
      if (entry) sum += entry.cnt;
    }
    if (sum > 0) counts.push(sum);
  }

  // Legal form count from MV (sum counts for multi-select)
  if (appliedFilters.includes("legalForm")) {
    const forms = asStrArr(sanitized.legalForm);
    let sum = 0;
    for (const f of forms) {
      const entry = mv.legal_forms.find(e => e.legalForm === f);
      if (entry) sum += entry.cnt;
    }
    if (sum > 0) counts.push(sum);
  }

  // If we have counts from MV, use the minimum (best upper bound for combined filters)
  if (counts.length > 0) {
    return Math.min(...counts);
  }

  // Fallback: pg_class approximation
  const approx = await prisma.$queryRaw<Array<{ estimate: bigint }>>`
    SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'Company'
  `;
  return Number(approx[0]?.estimate ?? 0);
}

async function _getScreenerFilterOptions(): Promise<ScreenerFilterOptions> {
  const rows = await prisma.$queryRaw<Array<{
    legal_forms: Array<{ legalForm: string; cnt: number }>;
    cities: Array<{ city: string; cnt: number; kraj: string }>;
    kraje: Array<{ kraj: string; cnt: number }>;
    okresy: Array<{ okres: string; cnt: number }>;
  }>>`SELECT * FROM "ScreenerFilterOptions" LIMIT 1`;

  const r = rows[0];
  return {
    naceSections: getNaceSections(),
    legalForms: (r?.legal_forms || []).map((l) => ({
      value: l.legalForm,
      label: l.legalForm,
      count: Number(l.cnt),
    })),
    ownershipTypes: getOwnershipTypeOptions(),
    cities: (r?.cities || []).map((c) => ({
      value: c.city,
      label: c.city,
      count: Number(c.cnt),
      kraj: c.kraj,
    })),
    kraje: (r?.kraje || []).map((k) => ({
      value: k.kraj,
      label: getKrajLabel(k.kraj) || k.kraj,
      count: Number(k.cnt),
    })),
    okresy: (r?.okresy || []).map((o) => ({
      value: o.okres,
      label: okresName(o.okres),
      count: Number(o.cnt),
    })),
    sizeCategories: SIZE_CATEGORIES,
    statuses: STATUSES,
  };
}

// Cached version — revalidate every hour (filter options rarely change)
export const getScreenerFilterOptions = unstable_cache(
  _getScreenerFilterOptions,
  ["screener-filter-options"],
  { revalidate: 3600 },
);

// ═══════════════════════════════════════════════════════════════
// URL builder for shareable/crawlable URLs (ADR-003)
// ═══════════════════════════════════════════════════════════════

/**
 * Build a deterministic, shareable URL from filter state.
 * Only includes params that are set (non-empty).
 * Used by client-side router.push() for filter updates.
 */
export function buildScreenerUrl(params: Record<string, string | number | undefined>, sort?: ScreenerSort, page?: number): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.set(key, String(value));
  }
  if (sort && (sort.field !== "name" || sort.dir !== "asc")) {
    url.set("sort", sort.field);
    url.set("dir", sort.dir);
  }
  if (page && page > 1) {
    url.set("page", String(page));
  }
  const qs = url.toString();
  return `/screener${qs ? `?${qs}` : ""}`;
}

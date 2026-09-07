/**
 * SEO URL architecture — clean URL mapping + indexability policy.
 *
 * Canonical SEO URLs:
 *   /firmy/{nace-slug}              — NACE section (e.g. /firmy/ubytovanie-a-stravovanie)
 *   /firmy/{nace-slug}/{region-slug} — NACE × kraj (e.g. /firmy/ubytovanie-a-stravovanie/bratislavsky-kraj)
 *   /firmy/{nace-slug}/{city-slug}   — NACE × city (e.g. /firmy/ubytovanie-a-stravovanie/bratislava)
 *
 * Legacy URLs (308 redirect to canonical):
 *   /odvetvie/{section}             → /firmy/{nace-slug}
 *   /odvetvie/{section}/{kraj}      → /firmy/{nace-slug}/{region-slug}
 *   /kraj/{kraj}                    → stays as-is (region hub, no NACE)
 *   /okres/{okres}                  → stays as-is (district hub, no NACE)
 *   /mesto/{city-slug}              → stays as-is (city hub, no NACE)
 *
 * Non-indexable (noindex):
 *   /screener?...                   — query-param permutations
 *   /firmy?...                      — query-param permutations
 *   /screener/odvetvie/{section}    — redirect URL (307 → /screener?naceSection=)
 *   /screener/kraj/{kraj}           — redirect URL (307 → /screener?kraj=)
 */

import { slugify } from "@/lib/slug";
import { getNaceSections, getKrajLabel, getKrajOptions } from "@/lib/screener";

// ── NACE section → slug mapping ──────────────────────────────────────

/**
 * Human-readable slug for each NACE section.
 * Derived from the short NACE label, slugified.
 */
const NACE_SLUG_MAP: Record<string, string> = {
  A: "polnohospodarstvo-a-lesnictvo",
  B: "tazba-a-dobyanie",
  C: "priemyselna-vyroba",
  D: "energetika",
  E: "vodne-hospodarstvo",
  F: "stavebnictvo",
  G: "obchod",
  H: "doprava-a-skladovanie",
  I: "ubytovanie-a-stravovanie",
  J: "informacie-a-komunikacia",
  K: "financie-a-poisovnictvo",
  L: "nehnutelnosti",
  M: "profesionalne-sluzby",
  N: "administrativne-sluzby",
  O: "verejna-sprava",
  P: "vzdelavanie",
  Q: "zdravotnictvo",
  R: "kultura-a-zabava",
  S: "ostatne-sluzby",
  T: "domacnosti",
  U: "extrateritorialne-cinnosti",
};

/** Reverse map: slug → NACE section letter */
const SLUG_TO_NACE: Record<string, string> = Object.fromEntries(
  Object.entries(NACE_SLUG_MAP).map(([section, slug]) => [slug, section])
);

/** Get the SEO slug for a NACE section letter (e.g. "I" → "ubytovanie-a-stravovanie") */
export function naceSectionToSlug(section: string): string | null {
  return NACE_SLUG_MAP[section.toUpperCase()] || null;
}

/** Resolve a slug back to a NACE section letter (e.g. "ubytovanie-a-stravovanie" → "I") */
export function slugToNaceSection(slug: string): string | null {
  return SLUG_TO_NACE[slug.toLowerCase()] || null;
}

/** Get all valid NACE slugs (for generateStaticParams) */
export function getAllNaceSlugs(): Array<{ section: string; slug: string }> {
  return getNaceSections().map((s) => ({
    section: s.section,
    slug: naceSectionToSlug(s.section)!,
  }));
}

// ── Kraj (region) slug mapping ───────────────────────────────────────

/**
 * Human-readable slug for each kraj.
 * Derived from the kraj label, slugified.
 */
const KRAJ_SLUG_MAP: Record<string, string> = {
  SK010: "bratislavsky-kraj",
  SK021: "trnavsky-kraj",
  SK022: "nitriansky-kraj",
  SK023: "trenciansky-kraj",
  SK031: "zilinsky-kraj",
  SK032: "banskobystricky-kraj",
  SK041: "presovsky-kraj",
  SK042: "kosicky-kraj",
};

const SLUG_TO_KRAJ: Record<string, string> = Object.fromEntries(
  Object.entries(KRAJ_SLUG_MAP).map(([kraj, slug]) => [slug, kraj])
);

/** Get the SEO slug for a kraj code (e.g. "SK010" → "bratislavsky-kraj") */
export function krajToSlug(kraj: string): string | null {
  return KRAJ_SLUG_MAP[kraj] || null;
}

/** Resolve a slug back to a kraj code (e.g. "bratislavsky-kraj" → "SK010") */
export function slugToKraj(slug: string): string | null {
  return SLUG_TO_KRAJ[slug.toLowerCase()] || null;
}

/** Get all valid kraj slugs (for generateStaticParams) */
export function getAllKrajSlugs(): Array<{ kraj: string; slug: string }> {
  return getKrajOptions().map((k) => ({
    kraj: k.value,
    slug: krajToSlug(k.value)!,
  }));
}

// ── Legacy URL → canonical URL mapping ───────────────────────────────

/**
 * Build the canonical SEO URL for a NACE section.
 * Returns /firmy/{nace-slug} or null if section is invalid.
 */
export function buildNaceCanonicalPath(section: string): string | null {
  const slug = naceSectionToSlug(section);
  if (!slug) return null;
  return `/firmy/${slug}`;
}

/**
 * Build the canonical SEO URL for a NACE × kraj combination.
 * Returns /firmy/{nace-slug}/{region-slug} or null if either is invalid.
 */
export function buildNaceKrajCanonicalPath(section: string, kraj: string): string | null {
  const naceSlug = naceSectionToSlug(section);
  const krajSlug = krajToSlug(kraj);
  if (!naceSlug || !krajSlug) return null;
  return `/firmy/${naceSlug}/${krajSlug}`;
}

/**
 * Build the canonical SEO URL for a NACE × city combination.
 * Returns /firmy/{nace-slug}/{city-slug} or null if section is invalid.
 */
export function buildNaceCityCanonicalPath(section: string, cityName: string): string | null {
  const naceSlug = naceSectionToSlug(section);
  if (!naceSlug) return null;
  return `/firmy/${naceSlug}/${slugify(cityName)}`;
}

// ── Indexability policy ──────────────────────────────────────────────

/**
 * Whitelist of indexable SEO route patterns.
 * Only these URL patterns should be indexed by Google.
 *
 * Everything else (query-param permutations, sort variants, pagination
 * beyond the canonical page, session params, UI params) is noindex.
 */
export const INDEXABLE_SEO_PATTERNS = [
  // NACE section hubs
  /^\/firmy\/[a-z0-9-]+$/,
  // NACE × region
  /^\/firmy\/[a-z0-9-]+\/[a-z0-9-]+$/,
  // NACE × city (same pattern as region — resolved at runtime)
  // Company pages
  /^\/firma\/[0-9]+-[a-z0-9-]+$/,
  // Region hubs (legacy, still canonical)
  /^\/kraj\/[A-Z0-9]+$/,
  // District hubs
  /^\/okres\/[A-Z0-9]+$/,
  // City hubs
  /^\/mesto\/[a-z0-9-]+$/,
  // Glossary
  /^\/slovnik\/[a-z0-9-]+$/,
  // Static pages
  /^\/$/,
  /^\/pricing$/,
  /^\/register$/,
  /^\/documents$/,
  /^\/slovnik$/,
  /^\/terms$/,
  /^\/privacy$/,
  /^\/dpa$/,
  /^\/firmy$/,
] as const;

/**
 * Determine if a URL path is an indexable SEO route.
 * This is the single source of truth for indexability policy.
 *
 * Query-param permutations (/screener?naceSection=I&sort=name&page=2)
 * are NEVER indexable — only clean SEO URLs are.
 *
 * Pagination on hub pages (?page=2) is NOT indexable — only the first page
 * of each hub is canonical.
 */
export function isIndexableSeoRoute(pathname: string): boolean {
  // Strip trailing slash for consistency
  const path = pathname.replace(/\/$/, "") || "/";

  // Query params = never indexable (except for the bare /firmy and /screener
  // which are handled by their own metadata, not here)
  // This function checks the PATH only — query param handling is in page metadata

  // Check against whitelist
  for (const pattern of INDEXABLE_SEO_PATTERNS) {
    if (pattern.test(path)) {
      // Additional check: /firmy/{slug} must be a valid NACE slug or city slug
      // (not a random string). This is resolved at runtime by the page.
      // The pattern match is a necessary but not sufficient condition.
      return true;
    }
  }

  return false;
}

/**
 * Check if a pathname is a legacy /odvetvie/ URL that should redirect.
 */
export function isLegacyOdvetviePath(pathname: string): boolean {
  return /^\/odvetvie\/[A-U]($|\/)/.test(pathname);
}

/**
 * Resolve a legacy /odvetvie/ path to its canonical /firmy/ path.
 * Returns null if the path cannot be resolved.
 */
export function resolveLegacyOdvetviePath(pathname: string): string | null {
  // /odvetvie/{section} → /firmy/{nace-slug}
  const single = pathname.match(/^\/odvetvie\/([A-U])$/);
  if (single) {
    return buildNaceCanonicalPath(single[1]);
  }

  // /odvetvie/{section}/{kraj} → /firmy/{nace-slug}/{region-slug}
  const combined = pathname.match(/^\/odvetvie\/([A-U])\/(SK[0-9]{3})$/);
  if (combined) {
    return buildNaceKrajCanonicalPath(combined[1], combined[2]);
  }

  return null;
}

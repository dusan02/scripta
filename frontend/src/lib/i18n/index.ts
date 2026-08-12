import type { Dict, Lang } from "./types";

export type { Lang, Dict } from "./types";

export const VALID_LANGS: Lang[] = ["sk", "en", "de", "cz", "hu", "pl"];

export const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: "sk", label: "Slovenčina", flag: "🇸🇰" },
  { code: "cz", label: "Čeština", flag: "🇨🇿" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "hu", label: "Magyar", flag: "🇭🇺" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
];

const URL_PREFIX_MAP: Record<Lang, string> = {
  sk: "sk",
  en: "en",
  de: "de",
  cz: "cs",
  hu: "hu",
  pl: "pl",
};

const URL_TO_LANG: Record<string, Lang> = {
  en: "en",
  de: "de",
  cs: "cz",
  hu: "hu",
  pl: "pl",
};

const URL_PREFIXES = ["en", "de", "cs", "hu", "pl"];

export const HREFLANG_MAP: Record<Lang, string> = {
  sk: "sk",
  en: "en",
  de: "de",
  cz: "cs",
  hu: "hu",
  pl: "pl",
};

export function localizePath(path: string, lang: Lang): string {
  if (lang === "sk") return path;
  const prefix = URL_PREFIX_MAP[lang];
  if (path === "/") return `/${prefix}`;
  return `/${prefix}${path}`;
}

export function delocalizePath(path: string): { path: string; lang: Lang | null } {
  for (const prefix of URL_PREFIXES) {
    if (path === `/${prefix}`) return { path: "/", lang: URL_TO_LANG[prefix] };
    if (path.startsWith(`/${prefix}/`)) return { path: path.slice(`/${prefix}`.length), lang: URL_TO_LANG[prefix] };
  }
  return { path, lang: null };
}

export const LOCALE_MAP: Record<Lang, string> = {
  sk: "sk-SK",
  cz: "cs-CZ",
  en: "en-GB",
  de: "de-DE",
  hu: "hu-HU",
  pl: "pl-PL",
};

import sk from "./sk";
import en from "./en";
import de from "./de";
import cz from "./cz";
import hu from "./hu";
import pl from "./pl";

export const translations: Record<Lang, Dict> = { sk, en, de, cz, hu, pl };

export function normalizeLang(lang: string | null | undefined): Lang {
  if (lang && VALID_LANGS.includes(lang as Lang)) return lang as Lang;
  return "sk";
}

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let str = translations[lang]?.[key] ?? translations.sk[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}

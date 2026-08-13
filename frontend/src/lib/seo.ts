import type { Metadata } from "next";
import { Lang, VALID_LANGS, translations, HREFLANG_MAP } from "./i18n";

const BASE_URL = "https://verifa.sk";

const LOCALE_MAP: Record<Lang, string> = {
  sk: "sk_SK",
  en: "en_GB",
  de: "de_DE",
  cz: "cs_CZ",
  hu: "hu_HU",
  pl: "pl_PL",
};

const HTML_LANG_MAP: Record<Lang, string> = {
  sk: "sk",
  en: "en",
  de: "de",
  cz: "cs",
  hu: "hu",
  pl: "pl",
};

/** SEO metadata per language — hardcoded for performance (no i18n lookup needed) */
const SEO_DATA: Record<Lang, {
  title: string;
  description: string;
  keywords: string[];
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
  orgDescription: string;
  websiteDescription: string;
}> = {
  sk: {
    title: "Verifa.sk — Business Risk Report",
    description: "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy v jednom PDF. Automatizované manažérske zhrnutie, mapa rizík podvodu, predikcia úpadku, alert na štátne pohľadávky, audítorský posudok a Verifa Score (0–100) z 25+ registrov SR.",
    keywords: ["business risk report", "riziko firmy", "overenie firmy", "previerka firmy", "due diligence", "automatizovaný posudok firmy", "predikcia úpadku", "insolvency score", "fraud heatmap", "going concern", "audítorský posudok", "Verifa Score", "Altman Z-Score", "Piotroski F-Score", "Beneish M-Score", "daňoví dlžníci", "ORSR", "RÚZ", "Obchodný vestník", "insolvencia", "exekúcie", "RPVS", "advokát", "právnik", "notár", "účtovník", "špedícia", "register", "report"],
    ogTitle: "Verifa.sk — Business Risk Report",
    ogDescription: "Automatizovaný Business Risk Report — automatizované manažérske zhrnutie, mapa rizík podvodu, predikcia úpadku, alert na štátne pohľadávky a Verifa Score z 25+ registrov SR.",
    twitterTitle: "Verifa.sk — Business Risk Report",
    twitterDescription: "Automatizovaný Business Risk Report — automatizovaný posudok, fraud heatmap, predikcia úpadku a Verifa Score z 25+ registrov SR v jednom PDF.",
    orgDescription: "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy z štátnych registrov SR s automatizovanou analýzou finančného zdravia.",
    websiteDescription: "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy z štátnych registrov SR.",
  },
  en: {
    title: "Verifa.sk — Business Risk Report",
    description: "Automated Business Risk Report — financial, legal and forensic risk of a company in one PDF. Automated executive summary, fraud risk map, bankruptcy prediction, state receivables alert, audit opinion and Verifa Score (0–100) from 25+ Slovak public registries.",
    keywords: ["business risk report", "company risk assessment", "company verification", "due diligence", "automated company assessment", "bankruptcy prediction", "insolvency score", "fraud heatmap", "going concern", "audit opinion", "Verifa Score", "Altman Z-Score", "Piotroski F-Score", "Beneish M-Score", "tax debtors", "ORSR", "RÚZ", "Commercial Bulletin", "insolvency", "executions", "RPVS", "lawyer", "notary", "accountant", "freight forwarder", "registry", "report", "Slovakia company check"],
    ogTitle: "Verifa.sk — Business Risk Report",
    ogDescription: "Automated Business Risk Report — executive summary, fraud risk map, bankruptcy prediction, state receivables alert and Verifa Score from 25+ Slovak registries.",
    twitterTitle: "Verifa.sk — Business Risk Report",
    twitterDescription: "Automated Business Risk Report — automated assessment, fraud heatmap, bankruptcy prediction and Verifa Score from 25+ Slovak registries in one PDF.",
    orgDescription: "Automated Business Risk Report — financial, legal and forensic risk of a company from Slovak state registries with automated financial health analysis.",
    websiteDescription: "Automated Business Risk Report — financial, legal and forensic risk of a company from Slovak state registries.",
  },
  de: {
    title: "Verifa.sk — Business Risk Report",
    description: "Automatisierter Business Risk Report — finanzielle, rechtliche und forensische Risiken eines Unternehmens in einem PDF. Automatisierte Management-Zusammenfassung, Betrugssrisikokarte, Insolvenzvorhersage, Staatliche Forderungen-Warnung, Prüfungsvermerk und Verifa Score (0–100) aus 25+ slowakischen Registern.",
    keywords: ["business risk report", "unternehmensrisiko", "firmenprüfung", "due diligence", "automatisierte unternehmensbewertung", "insolvenzvorhersage", "insolvency score", "fraud heatmap", "going concern", "prüfungsvermerk", "Verifa Score", "Altman Z-Score", "Piotroski F-Score", "Beneish M-Score", "steuerschuldner", "ORSR", "RÚZ", "Handelsregister", "insolvenz", "Zwangsvollstreckung", "RPVS", "rechtsanwalt", "notar", "buchhalter", "spediteur", "register", "bericht", "slowakei firmenprüfung"],
    ogTitle: "Verifa.sk — Business Risk Report",
    ogDescription: "Automatisierter Business Risk Report — Management-Zusammenfassung, Betrugssrisikokarte, Insolvenzvorhersage, Staatliche Forderungen-Warnung und Verifa Score aus 25+ slowakischen Registern.",
    twitterTitle: "Verifa.sk — Business Risk Report",
    twitterDescription: "Automatisierter Business Risk Report — automatisierte Bewertung, Fraud Heatmap, Insolvenzvorhersage und Verifa Score aus 25+ slowakischen Registern in einem PDF.",
    orgDescription: "Automatisierter Business Risk Report — finanzielle, rechtliche und forensische Risiken eines Unternehmens aus slowakischen Staatsregistern mit automatisierter Finanzanalyse.",
    websiteDescription: "Automatisierter Business Risk Report — finanzielle, rechtliche und forensische Risiken eines Unternehmens aus slowakischen Staatsregistern.",
  },
  cz: {
    title: "Verifa.sk — Business Risk Report",
    description: "Automatizovaný Business Risk Report — finanční, právní a forenzní riziko firmy v jednom PDF. Automatizované manažerské shrnutí, mapa rizik podvodu, predikce úpadku, alert na státní pohledávky, auditorský posudek a Verifa Score (0–100) z 25+ registrů SR.",
    keywords: ["business risk report", "riziko firmy", "ověření firmy", "previerka firmy", "due diligence", "automatizovaný posudek firmy", "predikce úpadku", "insolvency score", "fraud heatmap", "going concern", "auditorský posudek", "Verifa Score", "Altman Z-Score", "Piotroski F-Score", "Beneish M-Score", "daňoví dlužníci", "ORSR", "RÚZ", "Obchodní věstník", "insolvence", "exekuce", "RPVS", "advokát", "právník", "notář", "účetník", "spedice", "registr", "report"],
    ogTitle: "Verifa.sk — Business Risk Report",
    ogDescription: "Automatizovaný Business Risk Report — automatizované manažerské shrnutí, mapa rizik podvodu, predikce úpadku, alert na státní pohledávky a Verifa Score z 25+ registrů SR.",
    twitterTitle: "Verifa.sk — Business Risk Report",
    twitterDescription: "Automatizovaný Business Risk Report — automatizovaný posudek, fraud heatmap, predikce úpadku a Verifa Score z 25+ registrů SR v jednom PDF.",
    orgDescription: "Automatizovaný Business Risk Report — finanční, právní a forenzní riziko firmy ze státních registrů SR s automatizovanou analýzou finančního zdraví.",
    websiteDescription: "Automatizovaný Business Risk Report — finanční, právní a forenzní riziko firmy ze státních registrů SR.",
  },
  hu: {
    title: "Verifa.sk — Business Risk Report",
    description: "Automatizált Business Risk Report — a vállalat pénzügyi, jogi és forenzikus kockázata egyetlen PDF-ben. Automatizált vezetői összefoglaló, csalási kockázati térkép, csődelőrejelzés, állami követelések figyelmeztetés, könyvvizsgálói jelentés és Verifa Score (0–100) 25+ szlovák nyilvántartásból.",
    keywords: ["business risk report", "vállalati kockázat", "cégeellenőrzés", "due diligence", "automatizált vállalati értékelés", "csődkockázat", "insolvency score", "fraud heatmap", "going concern", "könyvvizsgálói jelentés", "Verifa Score", "Altman Z-Score", "Piotroski F-Score", "Beneish M-Score", "adós adófizetők", "ORSR", "RÚZ", "Kereskedelmi Közlöny", "csődeljárás", "végrehajtás", "RPVS", "ügyvéd", "jogász", "közjegyző", "könyvelő", "fuvarszervező", "nyilvántartás", "jelentés", "szlovákia cégellenőrzés"],
    ogTitle: "Verifa.sk — Business Risk Report",
    ogDescription: "Automatizált Business Risk Report — vezetői összefoglaló, csalási kockázati térkép, csődelőrejelzés, állami követelések figyelmeztetés és Verifa Score 25+ szlovák nyilvántartásból.",
    twitterTitle: "Verifa.sk — Business Risk Report",
    twitterDescription: "Automatizált Business Risk Report — automatizált értékelés, fraud heatmap, csődelőrejelzés és Verifa Score 25+ szlovák nyilvántartásból egyetlen PDF-ben.",
    orgDescription: "Automatizált Business Risk Report — a vállalat pénzügyi, jogi és forenzikus kockázata szlovák állami nyilvántartásokból automatizált pénzügyi egészség elemzéssel.",
    websiteDescription: "Automatizált Business Risk Report — a vállalat pénzügyi, jogi és forenzikus kockázata szlovák állami nyilvántartásokból.",
  },
  pl: {
    title: "Verifa.sk — Business Risk Report",
    description: "Zautomatyzowany Business Risk Report — ryzyko finansowe, prawne i forensiczne firmy w jednym PDF. Zautomatyzowane podsumowanie zarządcze, mapa ryzyka oszustw, predykcja upadłości, alert o roszczeniach państwowych, opinia audytora i Verifa Score (0–100) z 25+ słowackich rejestrów.",
    keywords: ["business risk report", "ryzyko firmy", "weryfikacja firmy", "due diligence", "zautomatyzowana ocena firmy", "predykcja upadłości", "insolvency score", "fraud heatmap", "going concern", "opinia audytora", "Verifa Score", "Altman Z-Score", "Piotroski F-Score", "Beneish M-Score", "dłużnicy podatkowi", "ORSR", "RÚZ", "Dziennik Handlowy", "upadłość", "egzekucje", "RPVS", "adwokat", "notariusz", "księgowy", "spedycja", "rejestr", "raport", "słowacja sprawdzenie firmy"],
    ogTitle: "Verifa.sk — Business Risk Report",
    ogDescription: "Zautomatyzowany Business Risk Report — podsumowanie zarządcze, mapa ryzyka oszustw, predykcja upadłości, alert o roszczeniach państwowych i Verifa Score z 25+ słowackich rejestrów.",
    twitterTitle: "Verifa.sk — Business Risk Report",
    twitterDescription: "Zautomatyzowany Business Risk Report — zautomatyzowana ocena, fraud heatmap, predykcja upadłości i Verifa Score z 25+ słowackich rejestrów w jednym PDF.",
    orgDescription: "Zautomatyzowany Business Risk Report — ryzyko finansowe, prawne i forensiczne firmy ze słowackich rejestrów państwowych z zautomatyzowaną analizą kondycji finansowej.",
    websiteDescription: "Zautomatyzowany Business Risk Report — ryzyko finansowe, prawne i forensyczne firmy ze słowackich rejestrów państwowych.",
  },
};

/** Page-specific SEO titles/descriptions per language */
const PAGE_SEO: Record<string, Record<Lang, { title: string; description: string }>> = {
  pricing: {
    sk: { title: "Cenník", description: "Cenník Verifa.sk — 1 report za 14 €, 10 reportov za 89 €, 50 reportov za 349 €. Kredity neexpirujú. 1 skúšobný kredit zadarmo pri registrácii." },
    en: { title: "Pricing", description: "Verifa.sk pricing — 1 report for €14, 10 reports for €89, 50 reports for €349. Credits never expire. 1 free trial credit on registration." },
    de: { title: "Preise", description: "Verifa.sk Preise — 1 Bericht für 14 €, 10 Berichte für 89 €, 50 Berichte für 349 €. Guthaben verfällt nicht. 1 Gratis-Testguthaben bei Registrierung." },
    cz: { title: "Ceník", description: "Ceník Verifa.sk — 1 report za 14 €, 10 reportů za 89 €, 50 reportů za 349 €. Kredity neexpirují. 1 zkušební kredit zdarma při registraci." },
    hu: { title: "Árazás", description: "Verifa.sk árazás — 1 jelentés 14 €, 10 jelentés 89 €, 50 jelentés 349 €. A kreditek nem járnak le. 1 ingyenes próbakredit regisztrációkor." },
    pl: { title: "Cennik", description: "Cennik Verifa.sk — 1 raport za 14 €, 10 raportów za 89 €, 50 raportów za 349 €. Kredity nie wygasają. 1 darmowy kredyt próbny przy rejestracji." },
  },
  slovnik: {
    sk: { title: "Slovník pojmov", description: "Slovník finančných a forenzných pojmov — Altman Z-Score, Piotroski F-Score, Beneish M-Score, due diligence a ďalšie." },
    en: { title: "Glossary", description: "Glossary of financial and forensic terms — Altman Z-Score, Piotroski F-Score, Beneish M-Score, due diligence and more." },
    de: { title: "Glossar", description: "Glossar finanzieller und forensischer Begriffe — Altman Z-Score, Piotroski F-Score, Beneish M-Score, Due Diligence und mehr." },
    cz: { title: "Slovník pojmů", description: "Slovník finančních a forenzních pojmů — Altman Z-Score, Piotroski F-Score, Beneish M-Score, due diligence a další." },
    hu: { title: "Szótár", description: "Pénzügyi és forenzikus fogalmak szótára — Altman Z-Score, Piotroski F-Score, Beneish M-Score, due diligence és továbbiak." },
    pl: { title: "Słownik pojęć", description: "Słownik pojęć finansowych i forensycznych — Altman Z-Score, Piotroski F-Score, Beneish M-Score, due diligence i więcej." },
  },
  documents: {
    sk: { title: "Dokumenty", description: "Príručky a právne dokumenty Verifa.sk — užívateľská príručka, vzory reportov, GDPR, DPA, všeobecné obchodné podmienky." },
    en: { title: "Documents", description: "Verifa.sk manuals and legal documents — user manual, sample reports, GDPR, DPA, terms and conditions." },
    de: { title: "Dokumente", description: "Verifa.sk Handbücher und Rechtsdokumente — Benutzerhandbuch, Musterberichte, GDPR, DPA, Allgemeine Geschäftsbedingungen." },
    cz: { title: "Dokumenty", description: "Příručky a právní dokumenty Verifa.sk — uživatelská příručka, vzory reportů, GDPR, DPA, všeobecné obchodní podmínky." },
    hu: { title: "Dokumentumok", description: "Verifa.sk kézikönyvek és jogi dokumentumok — felhasználói kézikönyv, mintajelentések, GDPR, DPA, általános szerződési feltételek." },
    pl: { title: "Dokumenty", description: "Podręczniki i dokumenty prawne Verifa.sk — podręcznik użytkownika, przykładowe raporty, GDPR, DPA, regulamin." },
  },
  terms: {
    sk: { title: "Podmienky používania", description: "Podmienky používania služby Verifa.sk." },
    en: { title: "Terms of Service", description: "Terms of service for Verifa.sk." },
    de: { title: "Nutzungsbedingungen", description: "Nutzungsbedingungen der Dienstleistung Verifa.sk." },
    cz: { title: "Podmínky používání", description: "Podmínky používání služby Verifa.sk." },
    hu: { title: "Felhasználási feltételek", description: "A Verifa.sk szolgáltatás felhasználási feltételei." },
    pl: { title: "Regulamin", description: "Regulamin usługi Verifa.sk." },
  },
  privacy: {
    sk: { title: "Ochrana osobných údajov", description: "Zásady ochrany osobných údajov služby Verifa.sk v súlade s GDPR." },
    en: { title: "Privacy Policy", description: "Privacy policy of Verifa.sk in compliance with GDPR." },
    de: { title: "Datenschutz", description: "Datenschutzrichtlinie der Dienstleistung Verifa.sk gemäß GDPR." },
    cz: { title: "Ochrana osobních údajů", description: "Zásady ochrany osobních údajů služby Verifa.sk v souladu s GDPR." },
    hu: { title: "Adatvédelem", description: "A Verifa.sk szolgáltatás adatvédelmi irányelvei a GDPR-nak megfelelően." },
    pl: { title: "Prywatność", description: "Polityka prywatności usługi Verifa.sk zgodnie z GDPR." },
  },
  dpa: {
    sk: { title: "Dohoda o spracúvaní údajov (DPA)", description: "Dohoda o spracúvaní osobných údajov medzi Verifa.sk a zákazníkom." },
    en: { title: "Data Processing Agreement (DPA)", description: "Data processing agreement between Verifa.sk and the customer." },
    de: { title: "Datenverarbeitungsvereinbarung (DPA)", description: "Datenverarbeitungsvereinbarung zwischen Verifa.sk und dem Kunden." },
    cz: { title: "Dohoda o zpracování údajů (DPA)", description: "Dohoda o zpracování osobních údajů mezi Verifa.sk a zákazníkem." },
    hu: { title: "Adatkezelési megállapodás (DPA)", description: "Adatkezelési megállapodás a Verifa.sk és az ügyfél között." },
    pl: { title: "Umowa o przetwarzaniu danych (DPA)", description: "Umowa o przetwarzaniu danych osobowych między Verifa.sk a klientem." },
  },
};

/** Firma page SEO — with {name}, {ico}, {city} placeholders */
const FIRMA_SEO: Record<Lang, { title: string; description: string }> = {
  sk: {
    title: "{name} ({ico}) — Finančné dáta, zisk, súvaha",
    description: "{name} ({ico}){city} — účtovné závierky, tržby, zisk, aktíva, osoby a udalosti z verejných registrov SR (ORSR, RÚZ, Obchodný vestník)."
  },
  en: {
    title: "{name} ({ico}) — Financial data, profit, balance sheet",
    description: "{name} ({ico}){city} — financial statements, revenue, profit, assets, persons and events from public Slovak registries (ORSR, RÚZ, Obchodný vestník)."
  },
  de: {
    title: "{name} ({ico}) — Finanzdaten, Gewinn, Bilanz",
    description: "{name} ({ico}){city} — Jahresabschlüsse, Umsatz, Gewinn, Aktiva, Personen und Ereignisse aus öffentlichen slowakischen Registern (ORSR, RÚZ, Obchodný vestník)."
  },
  cz: {
    title: "{name} ({ico}) — Finanční data, zisk, rozvaha",
    description: "{name} ({ico}){city} — účetní závěrky, tržby, zisk, aktiva, osoby a události z veřejných registrů SR (ORSR, RÚZ, Obchodný vestník)."
  },
  hu: {
    title: "{name} ({ico}) — Pénzügyi adatok, profit, mérleg",
    description: "{name} ({ico}){city} — pénzügyi kimutatások, árbevétel, profit, eszközök, személyek és események szlovák nyilvántartásokból (ORSR, RÚZ, Obchodný vestník)."
  },
  pl: {
    title: "{name} ({ico}) — Dane finansowe, zysk, bilans",
    description: "{name} ({ico}){city} — sprawozdania finansowe, przychody, zysk, aktywa, osoby i zdarzenia z publicznych słowackich rejestrów (ORSR, RÚZ, Obchodný vestník)."
  },
};

export function getLangFromCookie(cookieHeader: string | null | undefined): Lang {
  if (!cookieHeader) return "sk";
  const match = cookieHeader.match(/verifa-lang=(\w+)/);
  if (match && VALID_LANGS.includes(match[1] as Lang)) {
    return match[1] as Lang;
  }
  return "sk";
}

/**
 * Get language from request headers — checks x-verifa-lang header first
 * (set by middleware from ?lang=xx), then falls back to cookie.
 */
export function getLangFromHeaders(headers: Headers): Lang {
  // Check custom header set by middleware (from ?lang=xx)
  const langHeader = headers.get("x-verifa-lang");
  if (langHeader && VALID_LANGS.includes(langHeader as Lang)) {
    return langHeader as Lang;
  }
  // Fall back to cookie
  const cookie = headers.get("cookie") || "";
  return getLangFromCookie(cookie);
}

export function getHtmlLang(lang: Lang): string {
  return HTML_LANG_MAP[lang];
}

export function getOgLocale(lang: Lang): string {
  return LOCALE_MAP[lang];
}

/** Generate hreflang alternates for a given path using URL prefixes */
export function getHreflangAlternates(path: string = "/"): Record<string, string> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const result: Record<string, string> = {};
  for (const lang of VALID_LANGS) {
    const hreflang = HREFLANG_MAP[lang]; // cz → cs (ISO 639-1)
    if (lang === "sk") {
      result[hreflang] = `${BASE_URL}${cleanPath}`;
    } else {
      const prefix = lang === "cz" ? "cs" : lang;
      result[hreflang] = `${BASE_URL}/${prefix}${cleanPath === "/" ? "" : cleanPath}`;
    }
  }
  // x-default points to SK (no prefix)
  result["x-default"] = `${BASE_URL}${cleanPath}`;
  return result;
}

/** Get the canonical URL for a given path and language */
export function getCanonicalUrl(path: string, lang: Lang): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (lang === "sk") {
    return `${BASE_URL}${cleanPath}`;
  }
  return `${BASE_URL}/${lang}${cleanPath === "/" ? "" : cleanPath}`;
}

/** Generate localized global metadata */
export function generateGlobalMetadata(lang: Lang, canonicalPath: string = "/"): Metadata {
  const seo = SEO_DATA[lang];
  const alternates = getHreflangAlternates(canonicalPath);
  const canonical = getCanonicalUrl(canonicalPath, lang);

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: seo.title,
      template: "%s | Verifa.sk",
    },
    description: seo.description,
    keywords: seo.keywords,
    robots: { index: true, follow: true },
    icons: {
      icon: "/icon.svg",
      shortcut: "/icon.svg",
    },
    openGraph: {
      type: "website",
      locale: LOCALE_MAP[lang],
      siteName: "Verifa.sk",
      title: seo.ogTitle,
      description: seo.ogDescription,
      images: [
        {
          url: "/logo-verifa.png",
          width: 1200,
          height: 630,
          alt: "Verifa.sk — Business Risk Report",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.twitterTitle,
      description: seo.twitterDescription,
      images: ["/logo-verifa.png"],
    },
    alternates: {
      canonical,
      languages: alternates,
    },
  };
}

/** Generate localized metadata for a specific page (pricing, slovnik, etc.) */
export function generatePageMetadata(page: string, lang: Lang): Metadata {
  const pageSeo = PAGE_SEO[page]?.[lang] || PAGE_SEO[page]?.sk;
  if (!pageSeo) return generateGlobalMetadata(lang, `/${page}`);

  const seo = SEO_DATA[lang];
  const alternates = getHreflangAlternates(`/${page}`);
  const canonical = getCanonicalUrl(`/${page}`, lang);

  return {
    title: pageSeo.title,
    description: pageSeo.description,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: LOCALE_MAP[lang],
      siteName: "Verifa.sk",
      title: `${pageSeo.title} | Verifa.sk`,
      description: pageSeo.description,
      images: [{ url: "/logo-verifa.png", width: 1200, height: 630, alt: "Verifa.sk" }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${pageSeo.title} | Verifa.sk`,
      description: pageSeo.description,
    },
    alternates: {
      canonical,
      languages: alternates,
    },
  };
}

/** Generate localized metadata for a company (firma) page */
export function generateFirmaMetadata(name: string, ico: string, city: string | null, lang: Lang): Metadata {
  const template = FIRMA_SEO[lang];
  const cityPart = city ? `, ${city}` : "";
  const title = template.title
    .replace("{name}", name)
    .replace("{ico}", ico);
  const description = template.description
    .replace("{name}", name)
    .replace("{ico}", ico)
    .replace("{city}", cityPart);

  const firmaPath = `/firma/${ico}`;
  const canonicalUrl = getCanonicalUrl(firmaPath, lang);
  const alternates = getHreflangAlternates(firmaPath);

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: alternates,
    },
    openGraph: {
      title: `${title} | Verifa.sk`,
      description,
      url: canonicalUrl,
      type: "website",
      locale: LOCALE_MAP[lang],
      siteName: "Verifa.sk",
      images: [{ url: "/logo-verifa.png", width: 1200, height: 630, alt: `${name} — Verifa.sk` }],
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

/** Get localized Organization + WebSite JSON-LD */
export function getLocalizedJsonLd(lang: Lang) {
  const seo = SEO_DATA[lang];
  const t = translations[lang];

  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Verifa.sk",
      url: "https://verifa.sk",
      logo: "https://verifa.sk/logo-verifa.png",
      description: seo.orgDescription,
      email: "info@verifa.sk",
      areaServed: "SK",
      knowsAbout: ["business risk report", "finančná analýza", "forenzný audit", "registre SR", "Altman Z-score", "Piotroski model"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Verifa.sk",
      url: "https://verifa.sk",
      description: seo.websiteDescription,
      publisher: {
        "@type": "Organization",
        name: "Verifa.sk",
        url: "https://verifa.sk",
      },
    },
  ];
}

/** Get localized FAQ JSON-LD for landing page */
export function getFaqJsonLd(lang: Lang) {
  const t = translations[lang];
  const faqKeys = [
    { q: "home.faq1q", a: "home.faq1a" },
    { q: "home.faq2q", a: "home.faq2a" },
    { q: "home.faq3q", a: "home.faq3a" },
    { q: "home.faq5q", a: "home.faq5a" },
    { q: "home.faq6q", a: "home.faq6a" },
    { q: "home.faq7q", a: "home.faq7a" },
    { q: "home.faq8q", a: "home.faq8a" },
    { q: "home.faq9q", a: "home.faq9a" },
    { q: "home.faq10q", a: "home.faq10a" },
    { q: "home.faq11q", a: "home.faq11a" },
  ];

  const questions = faqKeys
    .filter(({ q }) => t[q]) // Only include if key exists
    .map(({ q, a }) => ({
      "@type": "Question",
      name: t[q],
      acceptedAnswer: {
        "@type": "Answer",
        text: t[a],
      },
    }));

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions,
  };
}

/** Get localized SoftwareApplication + Service JSON-LD */
export function getServiceJsonLd(lang: Lang) {
  const t = translations[lang];
  const seo = SEO_DATA[lang];

  const serviceNames: Record<Lang, string[]> = {
    sk: ["Automatizované manažérske zhrnutie", "Mapa rizík podvodu (fraud heatmap)", "Predikcia úpadku (insolvency score)", "Alert na štátne pohľadávky", "Audítorský posudok & Going Concern", "Právne riziká & timeline udalostí"],
    en: ["Automated executive summary", "Fraud risk map (fraud heatmap)", "Bankruptcy prediction (insolvency score)", "State receivables alert", "Audit opinion & Going Concern", "Legal risks & event timeline"],
    de: ["Automatisierte Management-Zusammenfassung", "Betrugssrisikokarte (fraud heatmap)", "Insolvenzvorhersage (insolvency score)", "Staatliche Forderungen-Warnung", "Prüfungsvermerk & Going Concern", "Rechtliche Risiken & Ereignis-Timeline"],
    cz: ["Automatizované manažerské shrnutí", "Mapa rizik podvodu (fraud heatmap)", "Predikce úpadku (insolvency score)", "Alert na státní pohledávky", "Auditorský posudek & Going Concern", "Právní rizika & timeline událostí"],
    hu: ["Automatizált vezetői összefoglaló", "Csalási kockázati térkép (fraud heatmap)", "Csődelőrejelzés (insolvency score)", "Állami követelések figyelmeztetés", "Könyvvizsgálói jelentés & Going Concern", "Jogi kockázatok & esemény timeline"],
    pl: ["Zautomatyzowane podsumowanie zarządcze", "Mapa ryzyka oszustw (fraud heatmap)", "Predykcja upadłości (insolvency score)", "Alert o roszczeniach państwowych", "Opinia audytora & Going Concern", "Ryzyka prawne & oś czasu zdarzeń"],
  };

  const serviceTypes: Record<Lang, string> = {
    sk: "Due Diligence, Forenzný audit, Finančná analýza",
    en: "Due Diligence, Forensic audit, Financial analysis",
    de: "Due Diligence, Forensische Prüfung, Finanzanalyse",
    cz: "Due Diligence, Forenzní audit, Finanční analýza",
    hu: "Due Diligence, Forenzikus audit, Pénzügyi elemzés",
    pl: "Due Diligence, Audyt forensyczny, Analiza finansowa",
  };

  const services = serviceNames[lang] || serviceNames.sk;

  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Verifa.sk",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: seo.description,
      url: "https://verifa.sk",
      offers: [
        { "@type": "Offer", price: "14.00", priceCurrency: "EUR", description: "1× Report" },
        { "@type": "Offer", price: "89.00", priceCurrency: "EUR", description: "10× Report" },
        { "@type": "Offer", price: "349.00", priceCurrency: "EUR", description: "50× Report" },
      ],
      provider: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Business Risk Report",
      provider: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
      areaServed: { "@type": "Country", name: "Slovensko" },
      serviceType: serviceTypes[lang],
      description: seo.orgDescription,
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        itemListElement: services.map((name) => ({
          "@type": "Offer",
          itemOffered: { "@type": "Service", name },
        })),
      },
    },
  ];
}

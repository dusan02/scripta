import { prisma } from "@/lib/prisma";

const ORSR_SEARCH_URL = "https://www.orsr.sk/hladaj_ico.asp";
const ORSR_BASE = "https://www.orsr.sk";
const ORSR_ENCODING = "windows-1250";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
};

const EMPTY_MARKERS = [
  "Nenašli sa žiadne",
  "Podmienkam nevyhovuje žiadny",
  "Záznamy: 0 - 0 / 0",
  "Kritériám vyhľadávania nezodpovedá žiadny záznam",
];

const ACADEMIC_TITLES = new Set([
  "ing", "mgr", "mudr", "mddr", "mvdr", "bc", "bca", "judr",
  "phdr", "rndr", "pharmdr", "thdr", "thlic", "paeddr", "dr",
  "prof", "doc", "akad", "phd", "dba", "edd", "dsc", "drsc",
  "csc", "dis", "etds", "mba",
  "ll.m", "ll.b", "ll.d", "j.d",
]);

const ZIP_RE = /\b(\d{3}\s?\d{2})\b/;
const LABEL_RE = /^[A-ZÁ-Ž][a-zá-ž]+\s*[a-zá-ž]*:/;
const SUBLABELS = new Set(["vznik funkcie", "konanie menom", "spôsob konania", "dátum aktualizácie"]);

const BLACKLIST_PHRASES = [
  "konanie", "za spoločnosť", "za spolocnost",
  "výška", "vyska", "vklad", "imanie", "splatené", "splatene",
  "základné", "zakladne", "podpisovanie", "podpis",
  "spôsob", "obchodné", "obchodne meno",
  "pripojí", "pripoji", "vykonáva", "vykonava",
  "samostatne", "spoločne", "spolocne",
  "záložné", "zalozne", "záložné právo", "zalozne pravo",
  "prevod", "prevod podielu", "zmena",
];

const NON_PERSON_KEYWORDS = [
  "republika", "spolková", "veľkovojvodstvo", "vojvodstvo",
  "kráľovstvo", "kralovstvo", "federácia", "federacia",
  "štáty", "staty", "štát", "stat",
  "spoločnosť", "spolocnost", "corporation", "corp", "inc",
  "gmbh", "ag", "sarl", "ltd", "limited", "llc", "sa", "nv", "bv",
  "holding", "holdings", "group", "partners", "capital",
  "trust", "foundation", "stiftung", "gesmbh",
];

type PersonInfo = {
  rawName: string;
  cleanName: string;
  city: string | null;
  street: string | null;
  zipCode: string | null;
  role: string;
  functionStart: Date | null;
};

function decodeWindows1250(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder(ORSR_ENCODING).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .split("\n")
    .map((l) => l.replace(/\t/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function findExtractLinks(html: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\s+[^>]*href=["']([^"']*vypis\.asp[^"']*)["'][^>]*>([^<]*)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    let href = match[1].replace(/&amp;/g, "&");
    if (href.startsWith("http")) {
      // already absolute
    } else if (href.startsWith("/")) {
      href = ORSR_BASE + href;
    } else {
      href = ORSR_BASE + "/" + href;
    }
    // Prefer "Aktuálny" (P=0), skip "Úplný" (P=1) for auto-seed
    const linkText = match[2].trim();
    if (linkText === "Úplný") continue;
    if (href.includes("P=1")) continue;
    if (!seen.has(href)) {
      seen.add(href);
      links.push(href);
    }
  }
  return links;
}

function extractCompanyName(text: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("obchodné meno") || lower.includes("obchodne meno")) {
      // Next non-empty line is the name
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const candidate = lines[j].trim();
        if (candidate && !candidate.toLowerCase().startsWith("od:") && !candidate.startsWith("(")) {
          return cleanCompanyName(candidate.split("(od:")[0].trim());
        }
      }
    }
  }
  return null;
}

function cleanCompanyName(raw: string): string {
  let name = raw.trim();
  name = name.replace(/\s*\(od:\s*\d{2}\.\d{2}\.\d{4}\)\s*$/, "");
  if (name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).trim();
  }
  return name;
}

function extractFindings(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("v likvidácii")) return "POZOR: Spoločnosť je v likvidácii.";
  if (lower.includes("vymazaná z obchodného registra")) return "POZOR: Spoločnosť je vymazaná z ORSR.";
  return "Aktívna spoločnosť v ORSR (bez zistených anomálií).";
}

function extractAddress(text: string): { city: string | null; street: string | null; zipCode: string | null } {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("sídlo") || lower.includes("bydlisko")) {
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const line = lines[j].trim();
        const zipMatch = line.match(ZIP_RE);
        if (zipMatch) {
          const zipCode = zipMatch[1].replace(/\s/g, "");
          const cityPart = line.replace(ZIP_RE, "").replace(/[,;]/g, "").trim();
          // Street might be on previous line
          let street: string | null = null;
          for (let k = j - 1; k > i; k--) {
            const prevLine = lines[k].trim();
            if (prevLine && !prevLine.toLowerCase().startsWith("od:") && !prevLine.startsWith("(") && /\d/.test(prevLine)) {
              street = prevLine;
              break;
            }
          }
          return { city: cityPart || null, street, zipCode };
        }
      }
    }
  }
  return { city: null, street: null, zipCode: null };
}

function extractLegalForm(text: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("právna forma")) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const candidate = lines[j].trim();
        if (candidate && !candidate.toLowerCase().startsWith("od:") && !candidate.startsWith("(")) {
          return candidate.split("(od:")[0].trim();
        }
      }
    }
  }
  return null;
}

function isHumanName(line: string): boolean {
  if (line.includes(" - ")) line = line.split(" - ")[0].trim();
  const lowered = line.toLowerCase().trim();
  if (lowered.includes(":")) return false;
  if (/\d/.test(line)) return false;
  if (line.length > 60) return false;
  for (const phrase of BLACKLIST_PHRASES) {
    if (lowered.includes(phrase)) return false;
  }
  for (const keyword of NON_PERSON_KEYWORDS) {
    if (lowered.includes(keyword)) return false;
  }
  const words = line.split(/\s+/);
  const nameWords = words.filter((w) => {
    const lower = w.toLowerCase().replace(/[.,]+$/g, "");
    return !ACADEMIC_TITLES.has(lower);
  }).filter((w) => {
    const stripped = w.replace(/[.,;]+$/g, "");
    return stripped.length > 0 && /[a-zA-ZÁ-ž]/.test(stripped);
  });
  if (nameWords.length < 2) return false;
    return nameWords.every((w) => /^[A-Za-zÁ-ž]+$/.test(w.replace(/[.,;]+$/g, "")));
}

function parsePersonsFromSection(text: string, sectionLabel: string, role: string): PersonInfo[] {
  const persons: PersonInfo[] = [];
  const sectionStart = text.indexOf(sectionLabel + ":");
  if (sectionStart === -1) return persons;

  const afterSection = text.substring(sectionStart + sectionLabel.length + 1);
  const lines = afterSection.split("\n");

  const sectionLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped) {
      if (sectionLines.length > 0) continue;
      continue;
    }
    if (LABEL_RE.test(stripped) && stripped.length < 60) {
      const labelLower = stripped.split(":")[0].trim().toLowerCase();
      if (SUBLABELS.has(labelLower)) {
        sectionLines.push(stripped);
        continue;
      }
      break;
    }
    sectionLines.push(stripped);
  }

  let i = 0;
  while (i < sectionLines.length) {
    const line = sectionLines[i];
    if (line.toLowerCase().startsWith("od:") || line.startsWith("(")) { i++; continue; }
    if (/^\d/.test(line)) { i++; continue; }
    if (!isHumanName(line)) { i++; continue; }

    const namePart = line.includes(" - ") ? line.split(" - ")[0].trim() : line;
    const words = namePart.split(/\s+/);
    const nameWords = words.filter((w) => {
      const lower = w.toLowerCase().replace(/[.,]+$/g, "");
      return !ACADEMIC_TITLES.has(lower);
    }).filter((w) => {
      const stripped = w.replace(/[.,;]+$/g, "");
      return stripped.length > 0 && /[a-zA-ZÁ-ž]/.test(stripped);
    });
    if (nameWords.length < 2) { i++; continue; }

    const rawName = line;
    const cleanName = nameWords.join(" ");

    let city: string | null = null;
    let street: string | null = null;
    let zipCode: string | null = null;
    let functionStart: Date | null = null;
    for (let j = i + 1; j < Math.min(i + 5, sectionLines.length); j++) {
      const addrLine = sectionLines[j];
      // Check for "od:" date line (function start)
      const odMatch = addrLine.match(/\(od:\s*(\d{2}\.\d{2}\.\d{4})\)/);
      if (odMatch) {
        const [d, m, y] = odMatch[1].split(".");
        functionStart = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      }
      const zipMatch = addrLine.match(ZIP_RE);
      if (zipMatch) {
        zipCode = zipMatch[1].replace(/\s/g, "");
        const cityPart = addrLine.replace(ZIP_RE, "").replace(/[,;]/g, "").trim();
        if (cityPart) city = cityPart;
        // Street might be on previous line
        for (let k = j - 1; k > i; k--) {
          const prevLine = sectionLines[k].trim();
          if (prevLine && !prevLine.toLowerCase().startsWith("od:") && !prevLine.startsWith("(") && /\d/.test(prevLine) && !prevLine.includes(" - ")) {
            street = prevLine;
            break;
          }
        }
        break;
      }
      if (/^[A-ZÁ-Ž]/.test(addrLine) && !/\d/.test(addrLine) && !addrLine.toLowerCase().startsWith("od:")) {
        city = addrLine.trim();
      }
    }

    persons.push({ rawName, cleanName, city, street, zipCode, role, functionStart });
    i++;
  }

  return persons;
}

function extractPersons(text: string): PersonInfo[] {
  const persons: PersonInfo[] = [];
  persons.push(...parsePersonsFromSection(text, "Štatutárny orgán", "statutar"));
  persons.push(...parsePersonsFromSection(text, "Dozorná rada", "dozorna_rada"));
  persons.push(...parsePersonsFromSection(text, "Spoločníci", "spolocnik"));
  return persons;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    return decodeWindows1250(buffer);
  } finally {
    clearTimeout(timeout);
  }
}

export async function seedFromOrsr(ico: string): Promise<{
  name: string | null;
  legalForm: string | null;
  city: string | null;
  street: string | null;
  zipCode: string | null;
  status: string | null;
  persons: PersonInfo[];
} | null> {
  try {
    // 1. Search by IČO
    const searchHtml = await fetchWithTimeout(
      `${ORSR_SEARCH_URL}?ICO=${ico}&SID=0`,
      10000
    );

    // 2. Check empty results
    if (EMPTY_MARKERS.some((m) => searchHtml.includes(m))) {
      return null;
    }

    // 3. Find extract links (Aktuálny)
    const links = findExtractLinks(searchHtml);
    if (links.length === 0) return null;

    // 4. Fetch detail page
    let detailHtml: string | null = null;
    for (const url of links) {
      try {
        detailHtml = await fetchWithTimeout(url, 10000);
        if (detailHtml && !detailHtml.includes("Výpis je neaktuálny")) break;
      } catch {
        continue;
      }
    }
    if (!detailHtml) return null;

    // 5. Parse
    const text = htmlToText(detailHtml);
    const name = extractCompanyName(text);
    const legalForm = extractLegalForm(text);
    const address = extractAddress(text);
    const findings = extractFindings(text);
    const persons = extractPersons(text);

    const status = findings.includes("likvidácii")
      ? "LIQUIDATION"
      : findings.includes("vymazaná")
        ? "DISSOLVED"
        : "ACTIVE";

    // 6. Upsert Company + Replace CompanyPerson[] in a single transaction
    //    First INSERT ON CONFLICT DO NOTHING to ensure row exists, then SELECT FOR UPDATE
    //    to lock it. This prevents race condition when concurrent requests seed the same IČO.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`INSERT INTO "Company" (ico) VALUES (${ico}) ON CONFLICT (ico) DO NOTHING`;
      await tx.$queryRaw`SELECT 1 FROM "Company" WHERE ico = ${ico} FOR UPDATE`;
      await tx.company.update({
        where: { ico },
        data: {
          name: name || undefined,
          legalForm: legalForm || undefined,
          city: address.city || undefined,
          street: address.street || undefined,
          zipCode: address.zipCode || undefined,
          status,
          orsrSyncedAt: new Date(),
        },
      });

      if (persons.length > 0) {
        await tx.companyPerson.deleteMany({ where: { companyIco: ico } });
        await tx.companyPerson.createMany({
          data: persons.map((p) => ({
            companyIco: ico,
            rawName: p.rawName,
            cleanName: p.cleanName,
            role: p.role,
            city: p.city,
            street: p.street,
            zipCode: p.zipCode,
            functionStart: p.functionStart,
          })),
        });
      }
    });

    return {
      name,
      legalForm,
      city: address.city,
      street: address.street,
      zipCode: address.zipCode,
      status,
      persons,
    };
  } catch (e) {
    console.error(`[ORSR] seedFromOrsr failed for ${ico}:`, e);
    return null;
  }
}

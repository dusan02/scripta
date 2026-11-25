import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildCompanyUrl } from "@/lib/slug";
import { translate, type Lang } from "@/lib/i18n";

type CrossFirmLink = {
  ico: string;
  name: string | null;
  role: string;
  personName: string;
};

// Common Slovak names to skip — too many false positives
const COMMON_NAMES = new Set([
  "jan horak", "jan kovac", "peter kovac", "peter horak", "milan kovac",
  "jan novak", "peter novak", "milan novak", "jozef kovac", "jozef novak",
  "jan hruska", "peter hruska", "martin kovac", "martin novak",
  "jan toth", "peter toth", "milan toth", "jozef toth",
  "jan molnar", "peter molnar", "laszlo molnar",
  "jan varga", "peter varga", "joseph varga",
  "jan balaz", "peter balaz", "milan balaz",
  "jan demeter", "peter demeter",
  "marian kovac", "marian novak", "marian horak",
  "jan szabo", "peter szabo",
  "jan baca", "peter baca",
  "jan gabor", "peter gabor",
]);

export type PreloadedPerson = {
  cleanName: string | null;
  city: string | null;
  isActive?: boolean;
  role?: string;
};

export function filterEligibleCrossFirmPersons(
  persons: PreloadedPerson[]
): Array<{ cleanName: string; city: string | null }> {
  const seen = new Set<string>();
  const eligible: Array<{ cleanName: string; city: string | null }> = [];
  for (const person of persons) {
    if (!person.cleanName) continue;
    const normalized = person.cleanName.toLowerCase().trim();
    if (COMMON_NAMES.has(normalized)) continue;
    if (normalized.length < 8) continue; // skip very short names
    const dedupeKey = `${normalized}|${person.city ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    eligible.push({ cleanName: person.cleanName, city: person.city ?? null });
    if (eligible.length >= 5) break;
  }
  return eligible;
}

export async function getCrossFirmPersons(
  ico: string,
  preloadedPersons?: PreloadedPerson[]
): Promise<CrossFirmLink[]> {
  // Reuse preloaded companyPersons when available; otherwise fetch up to 5 active statutars/spolocnici.
  const persons: PreloadedPerson[] = preloadedPersons
    ? preloadedPersons
        .filter(
          (p) =>
            p.isActive !== false &&
            (!p.role || p.role === "statutar" || p.role === "spolocnik")
        )
        .slice(0, 5)
    : await prisma.companyPerson.findMany({
        where: {
          companyIco: ico,
          isActive: true,
          role: { in: ["statutar", "spolocnik"] },
        },
        select: { cleanName: true, city: true },
        take: 5,
      });

  const eligible = filterEligibleCrossFirmPersons(persons);
  if (eligible.length === 0) return [];

  // Single batched query replaces up to 5 sequential N+1 findMany calls.
  const otherPersons = await prisma.companyPerson.findMany({
    where: {
      companyIco: { not: ico },
      isActive: true,
      role: "statutar",
      OR: eligible.map((p) => ({
        cleanName: p.cleanName,
        ...(p.city ? { city: p.city } : {}),
      })),
    },
    select: {
      companyIco: true,
      role: true,
      cleanName: true,
      city: true,
      company: { select: { name: true } },
    },
    take: 25,
  });

  // Preserve original per-person priority order (max 3 per person, max 5 total, unique companyIco).
  const results: CrossFirmLink[] = [];
  const seenIcos = new Set<string>([ico]);
  for (const person of eligible) {
    let addedForPerson = 0;
    for (const op of otherPersons) {
      if (op.cleanName !== person.cleanName) continue;
      if (person.city && op.city !== person.city) continue;
      if (seenIcos.has(op.companyIco)) continue;
      seenIcos.add(op.companyIco);
      results.push({
        ico: op.companyIco,
        name: op.company.name,
        role: op.role,
        personName: person.cleanName,
      });
      addedForPerson++;
      if (addedForPerson >= 3 || results.length >= 5) break;
    }
    if (results.length >= 5) break;
  }

  return results.slice(0, 5);
}

export async function CrossFirmPersons({ ico, links: preloadedLinks, lang = "sk" }: { ico: string; links?: CrossFirmLink[]; lang?: Lang }) {
  const links = preloadedLinks ?? await getCrossFirmPersons(ico);
  if (links.length === 0) return null;
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);

  return (
    <div className="mb-6 no-print">
      <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
        {t("firma.dalsieSpojene")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {links.map((f) => (
          <Link
            key={f.ico}
            href={buildCompanyUrl(f.ico, f.name)}
            className="block rounded-lg p-3 text-sm transition-colors hover:opacity-80"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="font-medium truncate" style={{ color: "var(--text)" }}>
              {f.name || `${t("firma.icoLabel")} ${f.ico}`}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {t("firma.icoLabel")}: {f.ico} · {t("firma.osobaLabel")}: {f.personName}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

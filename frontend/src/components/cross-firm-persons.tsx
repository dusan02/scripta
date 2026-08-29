import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildCompanyUrl } from "@/lib/slug";

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

async function getCrossFirmPersons(ico: string): Promise<CrossFirmLink[]> {
  // Get active statutars/spolocnici for this company
  const persons = await prisma.companyPerson.findMany({
    where: {
      companyIco: ico,
      isActive: true,
      role: { in: ["statutar", "spolocnik"] },
    },
    select: { cleanName: true, city: true },
    take: 5,
  });

  const results: CrossFirmLink[] = [];
  const seenIcos = new Set<string>([ico]);

  for (const person of persons) {
    if (!person.cleanName) continue;
    const normalized = person.cleanName.toLowerCase().trim();
    if (COMMON_NAMES.has(normalized)) continue;
    if (normalized.length < 8) continue; // skip very short names

    // Find other companies where this person is an active statutar
    const otherPersons = await prisma.companyPerson.findMany({
      where: {
        companyIco: { not: ico },
        isActive: true,
        role: "statutar",
        cleanName: person.cleanName,
        ...(person.city ? { city: person.city } : {}),
      },
      select: {
        companyIco: true,
        role: true,
        company: { select: { name: true } },
      },
      take: 3,
    });

    for (const op of otherPersons) {
      if (seenIcos.has(op.companyIco)) continue;
      seenIcos.add(op.companyIco);
      results.push({
        ico: op.companyIco,
        name: op.company.name,
        role: op.role,
        personName: person.cleanName,
      });
    }

    if (results.length >= 5) break;
  }

  return results.slice(0, 5);
}

export async function CrossFirmPersons({ ico }: { ico: string }) {
  const links = await getCrossFirmPersons(ico);
  if (links.length === 0) return null;

  return (
    <div className="mb-6 no-print">
      <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
        Ďalšie spoločnosti spojené s osobami firmy
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
              {f.name || `IČO ${f.ico}`}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              IČO: {f.ico} · osoba: {f.personName}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

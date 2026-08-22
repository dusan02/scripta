import { prisma } from "@/lib/prisma";
import { naceSection } from "@/lib/nace-sections";

const UA = "Verifa.sk/1.0 (+https://verifa.sk)";
const RUZ_NACE_URL = "https://www.registeruz.sk/cruz-public/api/sk-nace";
const NACE_REV2_CSV_URL = "https://gist.githubusercontent.com/b-rodrigues/4218d6daa8275acce80ebef6377953fe/raw/nace_rev2.csv";

// EN section names (NACE Rev. 2 official)
const SECTION_EN: Record<string, string> = {
  A: "Agriculture, forestry and fishing",
  B: "Mining and quarrying",
  C: "Manufacturing",
  D: "Electricity, gas, steam and air conditioning supply",
  E: "Water supply; sewerage, waste management and remediation activities",
  F: "Construction",
  G: "Wholesale and retail trade; repair of motor vehicles and motorcycles",
  H: "Transportation and storage",
  I: "Accommodation and food service activities",
  J: "Information and communication",
  K: "Financial and insurance activities",
  L: "Real estate activities",
  M: "Professional, scientific and technical activities",
  N: "Administrative and support service activities",
  O: "Public administration and defence; compulsory social security",
  P: "Education",
  Q: "Human health and social work activities",
  R: "Arts, entertainment and recreation",
  S: "Other service activities",
  T: "Activities of households as employers; undifferentiated goods- and services-producing activities of households for own use",
  U: "Activities of extraterritorial organisations and bodies",
};

interface NaceHierarchy {
  sections: Record<string, string>;
  divisions: Record<string, string>;
  groups: Record<string, string>;
  classes: Record<string, string>;
}

/**
 * Parse NACE Rev. 2 CSV and extract hierarchy (sections, divisions, groups, classes).
 * Returns EN descriptions for each level.
 */
async function fetchNaceRev2Hierarchy(): Promise<NaceHierarchy> {
  const resp = await fetch(NACE_REV2_CSV_URL, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`NACE Rev. 2 CSV returned ${resp.status}`);

  const csv = await resp.text();
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw new Error("NACE Rev. 2 CSV is empty");

  // Parse CSV — header + data rows
  // Format: "Order","Level","Code","Parent","Description",...
  const sections: Record<string, string> = {};
  const divisions: Record<string, string> = {};
  const groups: Record<string, string> = {};
  const classes: Record<string, string> = {};

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse — handle quoted fields
    const line = lines[i];
    const match = line.match(/^"(\d+)","(\d+)","([^"]*)","([^"]*)","([^"]*)"/);
    if (!match) continue;
    const [, , levelStr, code, , description] = match;
    const level = parseInt(levelStr, 10);
    if (!code || !description) continue;

    if (level === 1) sections[code] = description;
    else if (level === 2) divisions[code] = description;
    else if (level === 3) groups[code] = description;
    else if (level === 4) classes[code] = description;
  }

  return { sections, divisions, groups, classes };
}

/**
 * Seeds the NaceCode table with SK NACE Rev. 2 codes from RÚZ API + NACE Rev. 2 hierarchy.
 * This is a one-time (or rare) operation — NACE codes change infrequently.
 * Run manually: npx tsx src/lib/seed-nace.ts
 */
export async function seedNaceCodes(): Promise<{ created: number; skipped: number; total: number }> {
  // 1. Fetch SK NACE codes from RÚZ API (SK + EN labels for 5-digit codes)
  const resp = await fetch(RUZ_NACE_URL, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`RÚZ NACE API returned ${resp.status}`);

  const data = await resp.json();
  const items: Array<{ kod: string; nazov: { sk: string; en: string } }> = data.klasifikacie || [];
  if (items.length === 0) throw new Error("No NACE codes returned from RÚZ API");

  // 2. Fetch NACE Rev. 2 hierarchy (EN descriptions for divisions, groups, classes)
  const hier = await fetchNaceRev2Hierarchy();

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const code = item.kod;
    const description = item.nazov.sk;
    const descriptionEn = item.nazov.en || null;
    const { section, sectionName } = naceSection(code);
    const sectionNameEn = section ? SECTION_EN[section] || null : null;

    // Derive hierarchy from 5-digit SK NACE code
    // "49410" -> division "49", group "49.4", class "49.41"
    const division = code.substring(0, 2);
    const group = `${code.substring(0, 2)}.${code.substring(2, 3)}`;
    const classCode = `${code.substring(0, 2)}.${code.substring(2, 4)}`;

    const divisionName = hier.divisions[division] || null;
    const groupName = hier.groups[group] || null;
    const className = hier.classes[classCode] || null;

    try {
      await prisma.naceCode.upsert({
        where: { code },
        create: {
          code, description, descriptionEn,
          section, sectionName, sectionNameEn,
          division, divisionName,
          group, groupName,
          class: classCode, className,
        },
        update: {
          description, descriptionEn,
          section, sectionName, sectionNameEn,
          division, divisionName,
          group, groupName,
          class: classCode, className,
        },
      });
      created++;
    } catch {
      skipped++;
    }
  }

  return { created, skipped, total: items.length };
}

// Run directly if executed as script
if (require.main === module) {
  seedNaceCodes()
    .then((r) => {
      console.log(`NACE seed complete: ${r.created} created/updated, ${r.skipped} skipped, ${r.total} total`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("NACE seed failed:", e);
      process.exit(1);
    });
}

import { prisma } from "@/lib/prisma";
import { naceSection } from "@/lib/nace-sections";

const UA = "Verifa.sk/1.0 (+https://verifa.sk)";
const RUZ_NACE_URL = "https://www.registeruz.sk/cruz-public/api/sk-nace";

/**
 * Seeds the NaceCode table with SK NACE Rev. 2 codes from RÚZ API.
 * This is a one-time (or rare) operation — NACE codes change infrequently.
 * Run manually: npx tsx src/lib/seed-nace.ts
 */
export async function seedNaceCodes(): Promise<{ created: number; skipped: number; total: number }> {
  const resp = await fetch(RUZ_NACE_URL, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`RÚZ NACE API returned ${resp.status}`);

  const data = await resp.json();
  const items: Array<{ kod: string; nazov: { sk: string } }> = data.klasifikacie || [];
  if (items.length === 0) throw new Error("No NACE codes returned from API");

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const code = item.kod;
    const description = item.nazov.sk;
    const { section, sectionName } = naceSection(code);

    try {
      await prisma.naceCode.upsert({
        where: { code },
        create: { code, description, section, sectionName },
        update: { description, section, sectionName },
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

import { NextResponse } from "next/server";
import { glossaryTerms } from "@/lib/glossary";

// llms.txt — GEO (Generative Engine Optimization) discovery file per llmstxt.org.
// Helps ChatGPT, Perplexity, Claude and other AI engines understand what Verifa.sk
// is and which pages to cite. Static content only — no DB calls, fast response.

export const dynamic = "force-static";

const BASE_URL = "https://verifa.sk";

function buildLlmsTxt(): string {
  const lines: string[] = [];

  lines.push("# Verifa.sk");
  lines.push("");
  lines.push("> Automatizované preverenie slovenských firiem — finančné, právne a forenzné riziko v jednom PDF reporte generovanom z 25+ verejných registrov SR.");
  lines.push("");
  lines.push("Verifa.sk agreguje dáta z ORSR (obchodný register), RÚZ (register účtovných závierok), Obchodného vestníka, registra daňových dlžníkov, RPVS, insolvenčného registra, exekúcií a ďalších štátnych zdrojov. Nad dátami počíta finančné ukazovatele (Altman Z-Score, Piotroski F-Score, Beneish M-Score), 5-pilierové Verifa Score (0–100) a generuje Business Risk Report v PDF do 10–15 minút od zadania IČO. Databáza pokrýva viac než pol milióna slovenských firiem.");
  lines.push("");
  lines.push(`Plný obsah tejto dokumentácie: ${BASE_URL}/llms-full.txt`);
  lines.push("");
  lines.push("## Hlavné stránky");
  lines.push("");
  lines.push(`- [Domov](${BASE_URL}): prehľad služby, Verifa Score, FAQ`);
  lines.push(`- [Cenník](${BASE_URL}/pricing): ceny reportov a platobné metódy (karta, Apple Pay, Google Pay, PayPal, SEPA cez Paddle)`);
  lines.push(`- [Zoznam firiem](${BASE_URL}/firmy): huby firiem podľa odvetvia a regiónu`);
  lines.push(`- [Screener](${BASE_URL}/screener): filtrovanie firiem podľa financií, odvetvia a regiónu`);
  lines.push(`- [Dokumenty](${BASE_URL}/documents): vzorový report a podklady`);
  lines.push(`- [Slovník pojmov](${BASE_URL}/slovnik): vysvetlenie finančných a právnych pojmov`);
  lines.push("");
  lines.push("## Kľúčové funkcie reportu");
  lines.push("");
  lines.push(`- [Verifa Score](${BASE_URL}/slovnik/verifa-score): 5-pilierové hodnotenie rizika 0–100 (AAA/A/B/C) — finančná stabilita, právne riziko, daňová disciplína, insolvenčné konania, forenzné indikátory`);
  lines.push(`- [Insolvency Score](${BASE_URL}/slovnik/insolvency-score): predikcia úpadku na základe Altman Z-Score, Piotroski F-Score, likvidity, zadlženosti a trendov`);
  lines.push("- Manažérske zhrnutie v prirodzenom jazyku — vložiteľné do spisu, vhodné pre právnikov, notárov a účtovníkov");
  lines.push("- Alert na štátne pohľadávky: daňové dlhy, sociálna a zdravotná poisťovňa, register úpadcov");
  lines.push("- Forenzná analýza: mapa rizík podvodu, Beneish M-Score, kontrola súvislostí medzi osobami a firmami");
  lines.push("- PDF bez vodoznaku, pripravené na zdieľanie s klientom");
  lines.push("");
  lines.push("## Slovník pojmov");
  lines.push("");
  for (const t of glossaryTerms) {
    lines.push(`- [${t.title}](${BASE_URL}/slovnik/${t.slug}): ${t.shortDescription}`);
  }
  lines.push("");
  lines.push("## Podmienky");
  lines.push("");
  lines.push(`- [Obchodné podmienky](${BASE_URL}/terms)`);
  lines.push(`- [Ochrana osobných údajov](${BASE_URL}/privacy)`);
  lines.push(`- [Refund policy](${BASE_URL}/refund): vrátenie platby do 14 dní alebo kredit pri technickom zlyhaní`);
  lines.push("");
  lines.push(`Kontakt: info@verifa.sk. Report je informačný nástroj pre due diligence, nenahrádza právne ani daňové poradenstvo.`);
  lines.push("");

  return lines.join("\n");
}

export async function GET() {
  return new NextResponse(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

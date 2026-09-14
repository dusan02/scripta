import { NextResponse } from "next/server";
import { glossaryTerms } from "@/lib/glossary";

// llms-full.txt — extended GEO documentation per llmstxt.org convention.
// Contains the full FAQ, methodology and glossary so AI engines can answer
// questions about Verifa.sk without crawling every page.

export const dynamic = "force-static";

const BASE_URL = "https://verifa.sk";

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Ako dlho trvá spracovanie reportu?",
    a: "Väčšina reportov je hotových do 10–15 minút od zadania IČO, v závislosti od veľkosti spoločnosti.",
  },
  {
    q: "Sú dáta z registrov aktuálne?",
    a: "Áno, dáta sú získavané priamo z registrov v čase vygenerovania reportu.",
  },
  {
    q: "Aké platobné metódy akceptujete?",
    a: "Prijímame platby kartou (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal a SEPA bankový prevod cez Paddle.",
  },
  {
    q: "Čo ak report zlyhá?",
    a: "Ak z dôvodu technického výpadku hlavných štátnych registrov nebude možné report vygenerovať, vrátime vám plnú sumu alebo pripíšeme kredit na nový report.",
  },
  {
    q: "Je report právne záväzný?",
    a: "Nie. Report je informačný nástroj pre due diligence a interné posúdenie rizika. Poskytuje dôveryhodný podklad pre rozhodovanie, ale nenahrádza právne alebo daňové poradenstvo.",
  },
  {
    q: "Môžem report zdieľať s klientom?",
    a: "Áno. Report je štandardné PDF pripravené na zdieľanie — môžete ho poslať klientovi, priložiť do spisu alebo archivovať. Neobsahuje vodoznak ani obmedzenia.",
  },
  {
    q: "Čo je Verifa Score?",
    a: "Verifa Score je 5-pilierové hodnotenie rizika firmy na stupnici 0–100 s kategóriou AAA/A/B/C. Zahŕňa finančnú stabilitu, právne riziko, daňovú disciplínu, insolvenčné konania a forenzné indikátory.",
  },
  {
    q: "Obsahuje report automatizovaný posudok firmy?",
    a: "Áno, každý report obsahuje automatizované manažérske zhrnutie v prirodzenom jazyku, ktoré identifikuje kľúčové riziká a odporúčania. Posudok je priamo vložiteľný do spisu alebo správy pre klienta — vhodné pre právnikov, notárov a účtovníkov.",
  },
  {
    q: "Vie report predpovedať bankrot firmy?",
    a: "Áno, report obsahuje Insolvency Score — algoritmický model, ktorý odhaduje pravdepodobnosť úpadku na základe Altman Z-Score, Piotroski F-Score, likvidity, zadlženosti a trendov. Doplnený o trendy kľúčových ukazovateľov v čase.",
  },
  {
    q: "Upozorní ma report na daňové dlhy firmy?",
    a: "Áno, report obsahuje alert na štátne pohľadávky — upozornenie na daňové dlhy, sociálnu a zdravotnú poisťovňu. Ak firma dlží štátu, je vysoké riziko nezaplatenia faktúry. Systém tiež kontroluje Register úpadcov a insolvenčný register.",
  },
];

function buildLlmsFullTxt(): string {
  const lines: string[] = [];

  lines.push("# Verifa.sk");
  lines.push("");
  lines.push("> Automatizované preverenie slovenských firiem — finančné, právne a forenzné riziko v jednom PDF reporte generovanom z 25+ verejných registrov SR.");
  lines.push("");
  lines.push("Verifa.sk je platforma pre automatizované due diligence slovenských firiem. Zadáte IČO, systém do 10–15 minút preverí 25+ štátnych registrov (ORSR, RÚZ, Obchodný vestník, register daňových dlžníkov, RPVS, insolvenčný register, exekúcie a ďalšie), vypočíta finančné ukazovatele a Verifa Score (0–100) a vygeneruje Business Risk Report v PDF. Databáza pokrýva viac než pol milióna slovenských firiem s účtovnými závierkami.");
  lines.push("");
  lines.push("## Ako Verifa Score funguje");
  lines.push("");
  lines.push("Verifa Score je 5-pilierové hodnotenie rizika firmy na stupnici 0–100 s kategóriou AAA/A/B/C:");
  lines.push("");
  lines.push("1. Finančná stabilita — rentabilita, zadlženosť, likvidita, trendy z účtovných závierok (Altman Z-Score, Piotroski F-Score)");
  lines.push("2. Právne riziko — konania v ORSR, Obchodnom vestníku, živnostenský register, štatutárne zmeny");
  lines.push("3. Daňová disciplína — register daňových dlžníkov, pohľadávky voči sociálnej a zdravotnej poisťovni");
  lines.push("4. Insolvenčné konania — register úpadcov, insolvenčný register, exekúcie");
  lines.push("5. Forenzné indikátory — Beneish M-Score, fraud heatmap, prepojenia osôb a firiem");
  lines.push("");
  lines.push("## Časté otázky (FAQ)");
  lines.push("");
  for (const f of FAQ) {
    lines.push(`### ${f.q}`);
    lines.push("");
    lines.push(f.a);
    lines.push("");
  }
  lines.push("## Slovník pojmov — plné vysvetlenia");
  lines.push("");
  for (const t of glossaryTerms) {
    lines.push(`## ${t.title}`);
    lines.push("");
    lines.push(`URL: ${BASE_URL}/slovnik/${t.slug}`);
    lines.push(`Kategória: ${t.category}`);
    lines.push("");
    lines.push(t.fullDescription);
    lines.push("");
  }
  lines.push(`Kontakt: info@verifa.sk. Report je informačný nástroj pre due diligence a interné posúdenie rizika, nenahrádza právne ani daňové poradenstvo.`);
  lines.push("");

  return lines.join("\n");
}

export async function GET() {
  return new NextResponse(buildLlmsFullTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

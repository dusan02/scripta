export interface GlossaryTerm {
  slug: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  category: "Finančná analýza" | "Právne registre" | "Due Diligence";
}

export const glossaryTerms: GlossaryTerm[] = [
  {
    slug: "altman-z-score",
    title: "Altman Z-Score",
    shortDescription: "Model na predikciu úpadku firmy na základe finančných ukazovateľov.",
    fullDescription: `Altman Z-Score je finančný model vyvinutý profesorom Edwardom Altmanom v roku 1968 na predikciu pravdepodobnosti úpadku firmy. Model kombinuje päť kľúčových finančných ukazovateľov do jedného skóre, ktoré odhaduje, či je firma v zóne bezpečnosti, šedej zóne, alebo zóne rizika úpadku.

## Ako sa vypočíta

Z-Score sa počíta ako vážený súčet piatich ukazovateľov:

- **X1** = pracovný kapitál / celkové aktíva
- **X2** = nerozdelený zisk / celkové aktíva
- **X3** = EBIT / celkové aktíva
- **X4** = trhová hodnota vlastného imania / účtovná hodnota celkových záväzkov
- **X5** = tržby / celkové aktíva

Výsledná hodnota sa interpretuje takto:

- **Z > 2.99** — Bezpečná zóna (firma je finančne zdravá)
- **1.81 < Z < 2.99** — Šedá zóna (varovný signál, potrebné hlbšie skúmanie)
- **Z < 1.81** — Zóna úpadku (vysoké riziko bankrotu do 2 rokov)

## Význam pre due diligence

Altman Z-Score je jedným z kľúčových ukazovateľov, ktoré Verifa.sk zahrňuje do každého reportu. Pomáha rýchlo identifikovať firmy, ktoré sú finančne nestabilné, aj keď ich účtovná závierka na prvý pohľad vyzerá dobre.

## Obmedzenia

Model bol pôvodne vytvorený pre americké výrobné firmy. Pre služby a iné odvetvia môže byť menej presný. Preto sa v Verifa.sk reporte kombinuje s ďalšími ukazovateľmi ako Piotroski F-Score a vlastným Verifa Score.`,
    category: "Finančná analýza",
  },
  {
    slug: "piotroski-f-score",
    title: "Piotroski F-Score",
    shortDescription: "Skóre 0-9 hodnotiace finančné zdravie firmy na základe 9 kritérií.",
    fullDescription: `Piotroski F-Score je finančný ukazovateľ vyvinutý profesorom Josephom Piotroskim v roku 2000. Hodnotí finančné zdravie firmy pomocou 9 kritérií rozdelených do troch kategórií. Každé kritérium môže byť splnené (1 bod) alebo nesplnené (0 bodov), takže maximálne skóre je 9.

## Tri kategórie kritérií

**1. Ziskovosť (Profitability)**
- Kladný čistý zisk
- Kladný prevádzkový cash flow
- Rast návratnosti aktív (ROA)
- Cash flow vyšší než čistý zisk (kvalita zisku)

**2. Financie a zadlženosť (Leverage, Liquidity)**
- Pokles pomeru zadlženia
- Rast likvidity (current ratio)
- Žiadne vydávanie nových akcií (riedenie podielov)

**3. Efektívnosť (Operating Efficiency)**
- Rast hrubej marže
- Rast obratu aktív (asset turnover)

## Interpretácia

- **F-Score 8-9** — Silná firma, nízke riziko
- **F-Score 4-7** — Priemerná firma, vyžaduje pozornosť
- **F-Score 0-3** — Slabá firma, vysoké riziko

## Význam pre due diligence

Piotroski F-Score dopĺňa Altman Z-Score tým, že sa zameriava na trend (zlepšovanie alebo zhoršovanie) skôr než na absolútne hodnoty. Verifa.sk ho využíva na identifikáciu firiem, ktoré sa finančne zlepšujú alebo zhoršujú v čase — čo je kľúčové pri posudzovaní obchodných partnerov.`,
    category: "Finančná analýza",
  },
  {
    slug: "due-diligence",
    title: "Due Diligence",
    shortDescription: "Proces dôkladnej preverenia firmy pred obchodnou transakciou.",
    fullDescription: `Due diligence je proces systematického skúmania a preverenia firmy pred uzavretím obchodnej transakcie — či už ide o akvizíciu, fúziu, poskytnutie úveru, alebo uzavretie dlhodobej zmluvy s obchodným partnerom. Cieľom je odhaliť riziká, ktoré nie sú viditeľné na prvý pohľad.

## Typy due diligence

- **Finančná due diligence** — overenie finančného zdravia, histórie ziskov, záväzkov a cash flow
- **Právna due diligence** — kontrola súdnych sporov, záložných práv, insolvenčných konaní, platnosti zmlúv
- **Daňová due diligence** — kontrola daňových povinností, dlhov voči finančnej správe a poisťovniam
- **Prevádzková due diligence** — hodnotenie procesov, zmlúv s dodávateľmi a klientmi

## Prečo je due diligence dôležitá

V slovenskom prostredí je due diligence kritická najmä pri:

- **Overovaní obchodných partnerov** — pred uzavretím zmluvy s novým dodávateľom alebo klientom
- **Akvizíciách a fúziách** — pred kúpou podielu v spoločnosti
- **Poskytovaní úverov** — banky a finančné inštitúcie vyžadujú preverenie bonnosti
- **Povinnosti konania s odbornou starostlivosťou** — konateľ spoločnosti má zákonnú povinnosť overovať bonnosť partnerov

## Ako Verifa.sk pomáha

Verifa.sk automatizuje proces due diligence tým, že z jedného zadania IČO zozbiera dáta z 20+ štátnych registrov, vykoná finančnú analýzu a vygeneruje komplexný PDF report s Verifa Score. To, čo by trvalo právnikovi alebo finančnému analytikovi hodiny, zvládne systém do 5 minút.`,
    category: "Due Diligence",
  },
  {
    slug: "orsr",
    title: "ORSR — Obchodný register SR",
    shortDescription: "Centrálny register obchodných spoločností na Slovensku.",
    fullDescription: `ORSR (Obchodný register Slovenskej republiky) je verejný register, ktorý vedú okresné súdy. Obsahuje základné informácie o všetkých obchodných spoločnostiach a iných právnických osobách registrovaných na Slovensku.

## Čo ORSR obsahuje

- **Základné údaje** — názov firmy, sídlo, IČO, DIČ, právna forma
- **Štatutárne orgány** — kto je oprávnený konať v mene spoločnosti
- **Spoločníci/akcionári** — zoznam vlastníkov a ich podielov
- **Výška základného imania** — pri splatení a nesplatení
- **Predmety podnikania** — zoznam oprávnených činností
- **Súdne rozhodnutia** — zmeny v registri, výmazy, zánik

## Prečo je dôležitý pre due diligence

ORSR je východiskový bod každej preverky firmy. Umožňuje overiť:

- Či firma vôbec existuje a nie je v procese výmazu
- Kto je oprávnený za firmu konať (či osoba, s ktorou rokujete, je skutočne štatutár)
- Aké sú skutočné predmety podnikania (či firma môže vykonávať činnosť, na ktorú sa hlási)
- Zmeny v štruktúre vlastníctva (časté zmeny môžu byť varovným signálom)

## Verifa.sk a ORSR

Verifa.sk automaticky stiahne aktuálny výpis z ORSR pre každý report a zahrnie ho do PDF prílohy. Systém tiež kontroluje, či nedošlo k nedávnym zmenám v registri, ktoré by mohli byť relevantné pre posudok.`,
    category: "Právne registre",
  },
  {
    slug: "rpvs",
    title: "RPVS — Register partnerov verejného sektora",
    shortDescription: "Register osôb pôsobiacich v súvislosti s verejnými zdrojmi.",
    fullDescription: `RPVS (Register partnerov verejného sektora) je register, ktorý vedie Ministerstvo vnútra SR podľa zákona č. 54/2018 Z. z. o partnerstve verejného sektora. Jeho cieľom je zviditeľniť skutočných vlastníkov firiem, ktoré obchodujú so štátom a samosprávou.

## Kto sa musí registrovať

Do RPVS sa musia zapísať právnické osoby, ktoré:

- Uchádzajú sa o verejné zákazky
- Prijímajú príspevky z verejných zdrojov
- Prevádzkujú služby všeobecného hospodárskeho záujmu
- Sú subjektmi, ktoré prijímajú finančné príspevky

## Čo RPVS obsahuje

- **Skutočný vlastník** — fyzická osoba, ktorá reálne kontroluje firmu (nie len formálny spoločník)
- **Výška podielu** — percento vlastníctva skutočného vlastníka
- **Spôsob kontroly** — priamy alebo nepriamy vplyv
- **Zdroj povinnosti** — z akého dôvodu je firma v registri

## Prečo je dôležitý pre due diligence

RPVS je kľúčový pri overovaní firiem, ktoré:

- Pôsobia vo verejných zákazkách — overenie transparentnosti
- Majú komplexnú vlastnícku štruktúru — odhalenie skutočných vlastníkov
- Sú v podozrení z daňových alebo iných podvodov — prepojenie s politickými osobami

## Verifa.sk a RPVS

Verifa.sk automaticky stiahne výpis z RPVS (ak je firma v registri) a zahrnie ho do reportu. Ak firma v registri nie je, systém to explicitne uvedie — čo samo o sebe je dôležitá informácia.`,
    category: "Právne registre",
  },
  {
    slug: "register-upadcov",
    title: "Register úpadcov",
    shortDescription: "Register firiem v insolvenčnom alebo reštrukturalizačnom konaní.",
    fullDescription: `Register úpadcov je verejný register, ktorý vedie Ministerstvo spravodlivosti SR. Obsahuje záznamy o firmách a fyzických osobách, voči ktorým sa vedie insolvenčné konanie, reštrukturalizačné konanie, alebo ktoré boli vyhlásené za úpadca.

## Čo Register úpadcov obsahuje

- **Základné údaje úpadca** — názov firmy, IČO, sídlo
- **Druh konania** — insolvenčné, reštrukturalizačné, oddlženie
- **Stav konania** — začaté, prebiehajúce, skončené
- **Správca** — menovaný insolvenčný správca
- **Veritelia** — prihlásené pohľadávky
- **Dátum vyhlásenia** — kedy bolo konanie začaté

## Prečo je kritický pre due diligence

Overenie v Registri úpadcov je absolútnou nevyhnutnosťou pred:

- **Uzavretím zmluvy** — firma v insolvenčnom konaní nemusí byť schopná plniť záväzky
- **Poskytnutím úveru alebo fakturácie** — riziko nenávratnosti
- **Akvizíciou** — skryté záväzky môžu zničiť hodnotu obstarania
- **Prijatím ako dodávateľa** — prerušenie dodávok v dôsledku úpadku

## Varovné signály

- Viacnásobné insolvenčné konania v minulosti
- Konanie vo fáze "začaté" bez riešenia
- Reštrukturalizačné plány bez schválenia

## Verifa.sk a Register úpadcov

Verifa.sk kontroluje Register úpadcov pre každý report. Ak je firma v registri, systém to označí červeným semaforom na titulnej strane reportu a zahrnie detailný výpis do prílohy.`,
    category: "Právne registre",
  },
  {
    slug: "verifa-score",
    title: "Verifa Score",
    shortDescription: "Vlastné skóre dôveryhodnosti firmy v rozsahu 0-100.",
    fullDescription: `Verifa Score je vlastný ukazovateľ dôveryhodnosti firmy, ktorý vyvíja Verifa.sk. Je to agregované skóre v rozsahu 0-100, ktoré na jednoduchý a zrozumiteľný spôsob vyjadruje celkové riziko spolupráce s danou firmou.

## Ako sa počíta

Verifa Score sa vypočíta na základe viacerých dimenzií:

- **Finančné zdravie** — Altman Z-Score, Piotroski F-Score, trendy ziskovosti a zadlženosti
- **Právna stabilita** — insolvenčné konania, exekúcie, súdne spory, sankcie
- **Registerná transparentnosť** — ORSR, RPVS, registrácia DPH, živnostenský register
- **Daňová disciplína** — dlhy voči finančnej správe, sociálnej poisťovni a zdravotným poisťovniam
- **Historická stabilita** — vek firmy, zmeny v štruktúre, frekvencia zmien štatutárov

## Kategórie rizika

- **80-100 (AAA)** — Veľmi nízke riziko, firma je vysoko dôveryhodná
- **60-79 (A)** — Nízke riziko, firma je spoľahlivá
- **40-59 (B)** — Stredné riziko, vyžaduje pozornosť
- **0-39 (C)** — Vysoké riziko, odporúča sa opatrnosť

## Dôležité upozornenie

Verifa Score je **informatívny ukazovateľ**, nie právny ani finančný posudok. Slúži ako pomocný nástroj pre rýchle orientačné posúdenie firmy. Nemal by byť jediným podkladom pre rozhodovanie — odporúčame sa zohľadniť aj kontext a špecifiká konkrétnej obchodnej situácie.

## Verifa Score v reporte

Každý Verifa.sk report obsahuje Verifa Score na titulnej strane spolu s kategóriou rizika a krátkym slovným posudkom. Detailný rozpad skóre podľa jednotlivých dimenzií je dostupný v analytickej časti reportu.`,
    category: "Due Diligence",
  },
];

export function getGlossaryTerm(slug: string): GlossaryTerm | undefined {
  return glossaryTerms.find((t) => t.slug === slug);
}

export function getGlossaryTermsByCategory(): Record<string, GlossaryTerm[]> {
  const grouped: Record<string, GlossaryTerm[]> = {};
  for (const term of glossaryTerms) {
    if (!grouped[term.category]) grouped[term.category] = [];
    grouped[term.category].push(term);
  }
  return grouped;
}

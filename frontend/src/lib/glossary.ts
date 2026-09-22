export interface GlossaryTerm {
  slug: string;
  title: string;
  seoTitle?: string;
  shortDescription: string;
  fullDescription: string;
  category: "Finančná analýza" | "Finančné ukazovatele" | "Právne registre" | "Risk Assessment";
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
    shortDescription: "Proces dôkladného preverenia firmy pred obchodnou transakciou.",
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

Verifa.sk automatizuje proces due diligence tým, že z jedného zadania IČO zozbiera dáta z 25+ štátnych registrov, vykoná finančnú analýzu a vygeneruje Business Risk Report s Verifa Score. To, čo by trvalo právnikovi alebo finančnému analytikovi hodiny, zvládne systém do 5 minút.`,
    category: "Risk Assessment",
  },
  {
    slug: "orsr",
    title: "ORSR — Obchodný register SR",
    seoTitle: "ORSR — Obchodný register SR: čo je a ako ho využiť | Verifa.sk",
    shortDescription: "Centrálny register obchodných spoločností na Slovensku — overenie existencie firmy, štatutárov a predmetov podnikania.",
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
    category: "Risk Assessment",
  },
  {
    slug: "going-concern",
    title: "Going Concern (pokračovanie činnosti)",
    shortDescription: "Princíp, že firma bude pokračovať v činnosti aj v dohľadnej budúcnosti — kľúčový pre audítorský posudok.",
    fullDescription: `**Going Concern** (v preklade "pokračovanie činnosti") je základný účtovný princíp, ktorý predpokladá, že spoločnosť bude pokračovať v svojej činnosti aj v dohľadnej budúcnosti (minimálne 12 mesiacov od dátumu závierky) a nie je v situácii, ktorá by viedla k jej zánku alebo úpadku.

## Prečo je to dôležité

Ak auditor vyjadri **pochybnosť o going concern**, znamená to, že existuje signifikantné riziko, že firma nebude schopná plniť svoje záväzky. To má vážne dôsledky:

- **Pre dodávateľov** — riziko nezaplatenia faktúr
- **Pre banky** — riziko nedoplatenia úverov
- **Pre investorov** — riziko straty investície
- **Pre účtovníkov** — ovplyvňuje spôsob oceňovania majetku (historické ceny vs. likvidačné hodnoty)

## Typy audítorských posudkov

- **Bez výhrad** — auditor nepovažuje going concern za ohrozené
- **S výhradou** — auditor vyjadril pochybnosť, ale závierka je aj tak zostavená na princípe going concern
- **Zamietavý** — auditor nepovažuje za možné vyjadriť posudok

## Going Concern v Verifa.sk reporte

Verifa.sk report extrahuje typ audítorského posudku z RÚZ a zobrazuje ho v sekcii "Finančný posudok". Ak auditor vyjadril pochybnosť o going concern, systém zobrazí varovný box s červeným okrajom.`,
    category: "Finančné ukazovatele",
  },
  {
    slug: "fraud-heatmap",
    title: "Fraud Heatmap (mapa rizík podvodu)",
    shortDescription: "Vizuálny semafor, ktorý agreguje red flags z 7 kategórií do jedného prehľadného gridu.",
    fullDescription: `**Fraud Heatmap** (mapa rizík podvodu) je vizualizácia v Verifa.sk reporte, ktorá agreguje nálezy z viacerých zdrojov do jedného prehľadného gridu. Každá kategória má farebný semafor (zelená/žltá/oranžová/červená) podľa závažnosti nálezov.

## 7 kategórií rizík

1. **Obchodný vestník** — konkurzy, reštrukturalizácie, výmazy, likvidácie
2. **Forenzná analýza** — anomálie v účtovných dátach, manipulácia ukazovateľov
3. **Naratívna analýza** — riziká z poznámok k výkazom (going concern, key risks)
4. **Poznámky k výkazom** — off-balance sheet, kontingentné záväzky, vnútroskupinové transakcie
5. **Auditné overenie** — typ posudku, výhrady audítora
6. **Právne registre** — insolvenčný register, exekúcie, diskvalifikácie
7. **Finančné ukazovatele** — Altman Z'', Piotroski F, Beneish M, likvidita

## Ako to čítať

- **Zelená (Žiadne)** — v kategórii neboli nájdené žiadne red flags
- **Žltá (Nízke)** — malé anomálie, sledovať
- **Oranžová (Stredné/Vysoké)** — signifikantné riziká, vyžaduje pozornosť
- **Červená (Kritické)** — kritické nálezy, okamžité riziko

Fraud heatmap je na prvej strane reportu a umožňuje na jeden pohľad identifikovať, v ktorých oblastiach má firma problémy.`,
    category: "Risk Assessment",
  },
  {
    slug: "insolvency-score",
    title: "Insolvency Score (predikcia úpadku)",
    shortDescription: "Algoritmický model, ktorý odhaduje pravdepodobnosť bankrotu firmy na základe finančných ukazovateľov.",
    fullDescription: `**Insolvency Score** je algoritmický model v Verifa.sk reporte, ktorý odhaduje pravdepodobnosť úpadku (bankrotu) firmy na základe historických finančných ukazovateľov.

## Ako funguje

Model kombinuje viacero finančných metrík:

- **Altman Z''-Score** — akademicky overený model predikcie bankrotu
- **Piotroski F-Score** — hodnotenie finančnej sily (0-9)
- **Likvidita** — current ratio, quick ratio, cash ratio
- **Zadlženosť** — D/E ratio, equity ratio
- **Rentabilita** — ROA, ROE, EBITDA margin
- **Trendy** — smerovanie ukazovateľov (zlepšenie/zhoršenie)

## Interpretácia

- **Nízke riziko** — firma je finančne zdravá, pravdepodobnosť úpadku je minimálna
- **Stredné riziko** — existujú signály zhoršujúce sa finančnej situácie
- **Vysoké riziko** — firma vykazuje viaceré varovné signály
- **Kritické riziko** — firma je v ťažkostiach, úpadok je pravdepodobný

## Pre koho je to kľúčové

- **Špedícia a logistika** — bude partner schopný platiť faktúry za prepravu?
- **Dodávatelia** — má zmysel poskytnúť odklad splatnosti?
- **Banky a leasing** — je klient bonitný na úver?
- **Investori** — je bezpečné investovať?

Insolvency Score je doplnený 3-4 trendmi, ktoré ukazujú smerovanie kľúčových ukazovateľov v čase.`,
    category: "Finančné ukazovatele",
  },
  {
    slug: "ico",
    title: "IČO — identifikačné číslo organizácie",
    seoTitle: "IČO: čo je identifikačné číslo organizácie a kde ho nájsť | Verifa.sk",
    shortDescription: "Osemmiestne identifikačné číslo, ktoré jednoznačne identifikuje každú firmu a právnickú osobu na Slovensku.",
    fullDescription: `IČO (identifikačné číslo organizácie) je osemmiestne číslo, ktoré prideľuje Štatistický úrad SR každej firme, živnostníkovi a právnickej osobe pri jej vzniku. Je to základný identifikátor firmy — podobne ako rodné číslo pre fyzickú osobu.

## Kde IČO nájdete

- **Obchodný register (orsr.sk)** — pri každom zázname firmy
- **Faktúry a obchodné dokumenty** — povinná náležitosť faktúry
- **Firemné stránky** — obvykle v pätičke alebo v sekcii Kontakt
- **Verifa.sk vyhľadávanie** — stačí zadať názov firmy, IČO nájdete v detaile

## Na čo IČO slúži

IČO používate pri overovaní firmy, pri vystavovaní faktúr, pri kontrole v štátnych registroch (Register úpadcov, zoznam daňových dlžníkov) a pri podávaní účtovných závierok. Ak chcete overiť firmu, IČO je najspoľahlivejší vstupný údaj — názvy firiem sa môžu meniť, IČO ostáva rovnaké.

## IČO vs DIČ vs IČ DPH

- **IČO** — identifikácia organizácie všeobecne (štatistický účel)
- **DIČ** — daňové identifikačné číslo (Finančná správa)
- **IČ DPH** — identifikácia pre daň z pridanej hodnoty (formát SK + DIČ)

## Verifa.sk a IČO

Stačí zadať IČO a Verifa za minúty stiahne dáta z obchodného registra, RÚZ a ďalších 25+ registrov — a vygeneruje kompletný Business Risk Report s finančnou analýzou a Verifa Score.`,
    category: "Právne registre",
  },
  {
    slug: "dic",
    title: "DIČ — daňové identifikačné číslo",
    seoTitle: "DIČ: čo je daňové identifikačné číslo a čím sa líši od IČO | Verifa.sk",
    shortDescription: "Desaťmiestne číslo, ktoré prideľuje Finančná správa SR fyzickým a právnickým osobám pre daňové účely.",
    fullDescription: `DIČ (daňové identifikačné číslo) je desaťmiestne číslo, ktoré prideľuje Finančná správa SR pri registrácii k dani. Používa sa vo všetkej daňovej agende — na faktúrach, daňových priznaniach a pri komunikácii s finančnou správou.

## Rozdiel medzi IČO, DIČ a IČ DPH

- **IČO** (8 číslic) — identifikátor organizácie, prideľuje Štatistický úrad
- **DIČ** (10 číslic) — daňový identifikátor, prideľuje Finančná správa
- **IČ DPH** — formát „SK" + DIČ, používa sa pri obchodovaní v rámci EÚ a v systéme VIES

## Kde DIČ overiť

DIČ firmy nájdete na jej faktúrach, v obchodnom registri a v registri platiteľov DPH. Ak partner uvádza DIČ, ktoré nesedí s jeho údajmi v registroch, ide o varovný signál — typický pri podvodných faktúrach alebo tzv. bielych koňoch.

## Verifa.sk a DIČ

Verifa report zobrazuje DIČ aj IČ DPH firmy priamo z oficiálnych registrov a kontroluje, či firma nie je na zozname daňových dlžníkov alebo v registri zrušených platiteľov DPH.`,
    category: "Právne registre",
  },
  {
    slug: "vypis-obchodny-register",
    title: "Výpis z obchodného registra",
    seoTitle: "Výpis z obchodného registra SR: čo obsahuje a kde ho stiahnuť | Verifa.sk",
    shortDescription: "Oficiálny dokument s aktuálnymi údajmi o firme — štatutári, spoločníci, základné imanie a predmety podnikania.",
    fullDescription: `Výpis z obchodného registra SR (ORSR) je oficiálny dokument obsahujúci aktuálne údaje zapísané o firme. Získate ho bezplatne na orsr.sk — stačí zadať IČO alebo názov firmy.

## Čo výpis obsahuje

- **Identifikačné údaje** — názov, IČO, DIČ, právna forma, sídlo
- **Štatutárne orgány** — konatelia, predstavenstvo, dozorná rada a spôsob konania
- **Spoločníci a vlastníci** — zoznam vlastníkov a výška ich vkladov
- **Základné imanie** — výška a splatenie
- **Predmety podnikania** — oprávnené činnosti firmy
- **Deň zápisu a história zmien** — kedy firma vznikla a čo sa menilo

## Aktuálny vs úplný výpis

- **Aktuálny výpis** — len dnes platné údaje (stačí na rýchle overenie)
- **Úplný výpis** — vrátane historických zmien (odhalí napr. časté výmeny konateľov — varovný signál)

## Na čo výpis potrebujete

Pri overovaní obchodného partnera, pri zmluvách nad určitú hodnotu, pri úverových konaniach a pri due diligence. Výpis samostatne však nezobrazuje finančné zdravie firmy — na to potrebujete účtovné závierky z RÚZ a kontrolu dlhových registrov.

## Verifa.sk a výpis z ORSR

Verifa report obsahuje aktuálny výpis z obchodného registra ako prílohu a automaticky kontroluje nedávne zmeny v registri — vrátane zmien štatutárov a vlastníctva, ktoré môžu signalizovať riziko.`,
    category: "Právne registre",
  },
  {
    slug: "ruz",
    title: "RÚZ — Register účtovných závierok",
    seoTitle: "RÚZ — Register účtovných závierok: čo obsahuje a ako čítať výkazy | Verifa.sk",
    shortDescription: "Verejný register účtovných závierok slovenských firiem — súvahy, výkazy ziskov a strát a poznámky.",
    fullDescription: `Register účtovných závierok (RÚZ) je verejná databáza, do ktorej slovenské firmy povinne ukladajú svoje účtovné závierky. Vedie ho Ministerstvo financií SR a nájdete ho na registeruz.sk.

## Čo RÚZ obsahuje

- **Súvaha (balancia)** — aktíva a pasíva firmy ku dňu závierky
- **Výkaz ziskov a strát** — tržby, náklady a výsledok hospodárenia
- **Poznámky** — metodika, záväzky, pohľadávky a ďalšie detaily
- **Správa audítora** — ak má firma povinný audit

## Kto má povinnosť ukladať závierky

Všetky právnické osoby s účtovnou povinnosťou — s.r.o., a.s., družstvá aj niektoré živnosti. Firma, ktorá závierky neukladá, porušuje zákon — absencia závierok v RÚZ je sama o sebe rizikový signál.

## Ako čítať údaje z RÚZ

Najdôležitejšie ukazovatele: tržby (obrat), čistý zisk/strata, vlastné imanie (ak je záporné, firma je technicky v úpadku) a celkové záväzky. Trend za posledné 3 roky hovorí viac než jeden rok.

## Verifa.sk a RÚZ

Verifa automaticky stiahne účtovné závierky z RÚZ, vypočíta finančné ukazovatele (likvidita, zadlženosť, rentabilita) a zaradí ich do Business Risk Reportu — nemusíte výkazy čítať manuálne.`,
    category: "Právne registre",
  },
  {
    slug: "insolventnost",
    title: "Insolventnosť a úpadok firmy",
    seoTitle: "Insolventnosť firmy: čo to je, znaky a ako ju overiť | Verifa.sk",
    shortDescription: "Stav, keď firma nedokáže platiť svoje záväzky — ako ju rozpoznať a kde ju overiť ešte pred formálnym úpadkom.",
    fullDescription: `Firma je insolventná (v úpadku), ak je predlžená alebo v platobnej neschopnosti. Predlženie znamená, že záväzky presahujú hodnotu majetku; platobná neschopnosť znamená, že firma neplatí dva a viac záväzky viac než 30 dní po splatnosti.

## Typické znaky insolventnosti

- **Záznam v Registri úpadcov** — konkurz alebo reštrukturalizácia
- **Daňové dlhy** — firma na zozname daňových dlžníkov Finančnej správy
- **Dlhy voči poisťovniam** — nedoplatky Sociálnej a zdravotnej poisťovni
- **Záporné vlastné imanie** — účtovná strata presahuje imanie
- **Exekúcie a súdne spory** — veritelia si nárokujú pohľadávky súdnou cestou

## Prečo insolventnosť kontrolovať pred zmluvou

Ak dodáte tovar alebo službu firme, ktorá následne skrachuje, stanete sa len jedným z veriteľov v konkurze — s priemerným uspokojením v jednotkách percent. Overenie partnera pred podpisom zmluvy je najlacnejšia poistka.

## Ako overiť insolventnosť

Priamo v Registri úpadcov (ru.justice.sk) a v insolvenčnom registri Ministerstva spravodlivosti. Problém: firma sa môže nachádzať „na hrane" mesiace predtým, než sa objaví v registri.

## Verifa.sk a predikcia úpadku

Verifa report kontroluje Register úpadcov automaticky a navyše vypočíta Insolvency Score — predikciu rizika úpadku na základe finančných ukazovateľov, ktorá odhalí riziko skôr, než firma formálne vstúpi do insolvenčného konania.`,
    category: "Risk Assessment",
  },
  {
    slug: "konkurz",
    title: "Konkurz a reštrukturalizácia",
    seoTitle: "Konkurz vs reštrukturalizácia: rozdiely a čo znamenajú pre veriteľov | Verifa.sk",
    shortDescription: "Dve formy úpadkového konania — čo znamenajú pre dodávateľov a obchodných partnerov firmy.",
    fullDescription: `Konkurz a reštrukturalizácia sú dve formy riešenia úpadku firmy podľa zákona o konkurze a reštrukturalizácii. Obe sa evidujú v Registri úpadcov, ale majú pre veriteľov zásadne odlišné dôsledky.

## Konkurz

Konkurz znamená likvidáciu firmy — správca speňaží majetok a výťažok rozdelí veriteľom. Ak firma v konkurze dlhujete vám, získate typicky len malé percento pohľadávky (v praxi často pod 10 %). Firma po konkurze zaniká.

## Reštrukturalizácia

Reštrukturalizácia je pokus o záchranu firmy — dlžník pokračuje v podnikaní pod dohľadom správcu a veritelia schvália reštrukturalizačný plán. Pre veriteľa je to lepší scenár než konkurz, ale plnenie pohľadávok je spravidla znížené a rozložené v čase.

## Čo to znamená pre obchodného partnera

- **Nikdy nedodávajte firme v úpadku na faktúru** — riziko je extrémne
- **Prihláška pohľadávky** — ak už pohľadávku máte, prihláste ju v zákonom stanovenej lehote, inak prepadne
- **Skontrolujte partnerov pravidelne** — úpadok môže nastať aj počas dlhodobej spolupráce

## Verifa.sk a konkurz

Verifa report kontroluje Register úpadcov pri každom overení a zobrazí aktívne konania aj ich históriu. Insolvency Score navyše signalizuje riziko ešte predtým, než konanie začne.`,
    category: "Risk Assessment",
  },
  {
    slug: "danovy-dlznik",
    title: "Daňový dlžník — dlhy firmy voči štátu",
    seoTitle: "Daňový dlžník: ako zistiť, či firma dlhuje štátu | Verifa.sk",
    shortDescription: "Zoznamy daňových dlžníkov Finančnej správy a dlhy voči poisťovniam — kľúčový varovný signál pri overovaní firmy.",
    fullDescription: `Daňový dlžník je firma, ktorá má evidované daňové nedoplatky voči Finančnej správe SR. Zoznamy dlžníkov sú verejné — Finančná správa ich zverejňuje pravidelne na svojom webe.

## Aké dlhy voči štátu sa dajú overiť

- **Daňové nedoplatky** — zoznam daňových dlžníkov Finančnej správy
- **Dlhy voči Sociálnej poisťovni** — zoznam dlžníkov Sociálnej poisťovne
- **Dlhy voči zdravotným poisťovniam** — nedoplatky na zdravotnom poistení
- **Colné a spotrebné dlhy** — pri relevantných odvetviach

## Prečo sú štátne dlhy varovným signálom

Firma, ktorá neplatí štátu, zvyčajne neplatí ani dodávateľom — štát je len prvý, kto si dlh vymáha. Daňové dlhy navyše znamenajú riziko blokácie účtu firmy exekúciou, čím sa jej platobná schopnosť zastaví zo dňa na deň.

## Praktický limit

Finančná správa zverejňuje dlhy nad určitú hranicu (typicky 170 €). Menšie nedoplatky v zozname nenájdete — preto sa oplatí kombinovať viacero zdrojov.

## Verifa.sk a štátne pohľadávky

Verifa report obsahuje alert na štátne pohľadávky — automaticky skontroluje daňové dlhy, dlhy voči poisťovniam a upozorní na riziko nezaplatenia faktúr.`,
    category: "Risk Assessment",
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

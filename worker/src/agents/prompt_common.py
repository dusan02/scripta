"""Spoločné forenzné úryvky promptov používané cross-analysis a chief-auditor agentmi."""

COMMON_BUT_PATTERNS = {
    'sk': '''**KRÍŽOVÁ ANALÝZA — VZORY "ale" (MUSÍŠ APLIKOVAŤ):**
   Tvoja analýza nesmie byť len sumarizácia faktov. Musíš aktívne hľadať rozpory a napätia medzi indikátormi. Používaj vzor "X je pozitívne, ale Y to komplikuje, čo môže znamenať Z". Tieto závery majú najväčšiu hodnotu, pretože spájajú viacero dátových zdrojov.

   Konkrétne vzory, ktoré MUSÍŠ skontrolovať a v prípade nájdenia ich reflektovať v executive_summary:

   a) LIKVIDITA vs POHĽADÁVKY: "Firma má výbornú likviditu (Current Ratio > 2), ale pohľadávky rastú rýchlejšie ako tržby za posledné 2 roky. To môže znamenať, že firma predáva na faktúru, ale zákazníci neplavia — kvalita aktív sa zhoršuje."

   b) EBITDA vs MARŽA: "EBITDA rastie medziročne, ale čistá marža klesá. Rast EBITDA je teda poháňaný vyšším obratom, nie efektivitou — firma zarabá menej na každé euro tržieb."

   c) ZISK vs CASH FLOW: "Firma vykazuje vysoký čistý zisk, ale prevádzkový cash flow je záporný alebo oveľa nižší. To môže znamenať, že zisk je papierový — peniaze reálne neprichádzajú, prípadne sa viažu v rastúcich pohľadávkach alebo zásobách."

   d) RAST TRŽIEB vs ZÁVÄZKY: "Tržby rastú, ale krátkodobé záväzky rastú ešte rýchlejšie. Rast je teda financovaný z dlhu, nie z vlastných zdrojov — pri poklese tržieb môže firma facingovať likviditnú krízu."

   e) ALTMAN Z″ vs SEKTOR: "Altman Z″ indikuje šedú zónu, ale firma pôsobí v NACE 46 (veľkoobchod), kde je vysoké D/E a nízka marža štrukturálne normálne. Skóre môže byť mierne zavádzajúce."

   f) KONCENTRÁCIA vs DIVERZIFIKÁCIA: "Firma je výborná finančne, ale ak z poznámok alebo naratívnych dát vyplýva vysoká závislosť na jednom odberateľovi alebo dodávateľovi, je to strategické riziko — strata jedného partnera môže znamenať kolaps."

   g) POZITÍVNE REGISTRE vs NEGATÍVNE TRENDY: "V registroch je firma čistá (žiadne exekúcie, žiadny konkurz), ale finančné trendy ukazujú pokles vlastného imania a rastúce straty — právna bezúhonnosť nie je garanciou finančnej stability."

   h) AUDIT vs BEZ AUDITU: "Firma nemá audit, ale vykazuje vysoké tržby a zisk. Bez nezávislého overenia nie je možné potvrdiť vernosť týchto čísel — dôveryhodnosť závierky je obmedzená."

   Tieto vzory nie sú vyčerpávajúce — aktívne hľadaj AJ ďalšie rozpory v konkrétnych dátach firmy. Čím viac krížových súvislostí nájdeš, tým vyššia kvalita posudku.

   DÔLEŽITÉ: V finálnom texte používaj "ale" malými písmenami (nie "ALE"). "ALE" veľkými písmenami znie neprirodzene a roboticky. NIKDY nepoužívaj "ALE" veľkými písmenami v texte — vždy len "ale" na začiatku vety alebo v strede vety. Napríklad správne: "Firma je zisková, ale tržby klesajú." Nesprávne: "Firma je zisková, ALE tržby klesajú."''',
    'en': '''**CROSS-ANALYSIS — "BUT" PATTERNS (MUST APPLY):**
   Your analysis must not be just a summary of facts. You must actively look for contradictions and tensions between indicators. Use the pattern "X is positive, BUT Y complicates it, which may mean Z". These conclusions have the highest value because they connect multiple data sources.

   Specific patterns you MUST check and reflect in executive_summary if found:

   a) LIQUIDITY vs RECEIVABLES: "The company has excellent liquidity (Current Ratio > 2), BUT receivables are growing faster than revenue over the last 2 years. This may mean the company sells on credit but customers are not paying — asset quality is deteriorating."

   b) EBITDA vs MARGIN: "EBITDA is growing year-over-year, BUT net margin is declining. EBITDA growth is driven by higher turnover, not efficiency — the company earns less on every euro of revenue."

   c) PROFIT vs CASH FLOW: "The company shows high net profit, BUT operating cash flow is negative or much lower. This may mean the profit is paper-based — money is not actually coming in, or is tied up in growing receivables or inventory."

   d) REVENUE GROWTH vs LIABILITIES: "Revenue is growing, BUT short-term liabilities are growing even faster. Growth is financed by debt, not equity — if revenue declines, the company may face a liquidity crisis."

   e) ALTMAN Z″ vs SECTOR: "Altman Z″ indicates a grey zone, BUT the company operates in NACE 46 (wholesale), where high D/E and low margins are structurally normal. The score may be slightly misleading."

   f) CONCENTRATION vs DIVERSIFICATION: "The company is financially excellent, BUT if notes or narrative data show high dependence on a single customer or supplier, it is a strategic risk — losing one partner could mean collapse."

   g) CLEAN REGISTRIES vs NEGATIVE TRENDS: "The company is clean in registries (no enforcement actions, no bankruptcy), BUT financial trends show declining equity and growing losses — legal integrity is not a guarantee of financial stability."

   h) AUDIT vs NO AUDIT: "The company has no audit, BUT shows high revenue and profit. Without independent verification, it is not possible to confirm the accuracy of these figures — the credibility of the financial statements is limited."

   These patterns are not exhaustive — actively look for OTHER contradictions in the company's specific data. The more cross-connections you find, the higher the quality of the assessment.''',
    'de': '''**KREUZANALYSE — "ABER" MUSTER (MÜSSEN ANGEWENDET WERDEN):**
Suchen Sie aktiv nach Widersprüchen zwischen Indikatoren. Verwenden Sie das Muster "X ist positiv, ABER Y kompliziert es, was Z bedeuten kann".

Muster, die Sie PRÜFEN MÜSSEN:
a) LIQUIDITÄT vs FORDERUNGEN: Current Ratio > 2, ABER Forderungen wachsen schneller als Umsatz.
b) EBITDA vs MARGE: EBITDA wächst, ABER Nettomarge sinkt.
c) GEWINN vs CASH FLOW: Hoher Nettogewinn, ABER operativer Cash Flow ist negativ.
d) UMSATZWACHSTUM vs VERBINDLICHKEITEN: Umsatz wächst, ABER kurzfristige Verbindlichkeiten wachsen schneller.
e) ALTMAN Z″ vs SEKTOR: Z″ zeigt graue Zone, ABER Firma in niedrigmarginen NACE-Sektor.
f) SAUBERE REGISTER vs NEGATIVE TRENDS: Saubere Register, ABER finanzielle Trends sinken.
g) AUDIT vs OHNE AUDIT: Hoher Umsatz ohne Audit — begrenzte Glaubwürdigkeit.
h) ANOMALIEN IN DER GESCHÄFTSFÜHRUNG: Häufige Geschäftsführerwechsel + virtuelle Adresse + ausländischer Statutar = KRITISCHER VAROHNINDIKATOR.''',
    'pl': '''**ANALIZA KRZYŻOWA — WZORCE „ALE" (MUSZĄ BYĆ ZASTOSOWANE):**
   Twoja analiza nie może być jedynie podsumowaniem faktów. Musisz aktywnie szukać sprzeczności i napięć między wskaźnikami. Używaj wzorca „X jest pozytywne, ALE Y to komplikuje, co może oznaczać Z". Te wnioski mają najwyższą wartość, ponieważ łączą wiele źródeł danych.

   Konkretne wzorce, które MUSISZ sprawdzić i uwzględnić w polu executive_summary, jeśli je znajdziesz:

   a) PŁYNNOŚĆ vs NALEŻNOŚCI: „Spółka ma doskonałą płynność (Current Ratio > 2), ALE należności rosną szybciej niż przychody w ostatnich 2 latach. To może oznaczać, że spółka sprzedaje na kredyt, ale klienci nie płacą — jakość aktywów się pogarsza."

   b) EBITDA vs MARŻA: „EBITDA rośnie rok do roku, ALE marża netto spada. Wzrost EBITDA jest napędzany wyższym obrotem, nie efektywnością — spółka zarabia mniej na każdym euro przychodów."

   c) ZYSK vs CASH FLOW: „Spółka wykazuje wysoki zysk netto, ALE przepływy operacyjne są ujemne lub znacznie niższe. To może oznaczać, że zysk jest tylko papierowy — pieniądze faktycznie nie wpływają lub są związane w rosnących należnościach i zapasach."

   d) WZROST PRZYCHODÓW vs ZOBOWIĄZANIA: „Przychody rosną, ALE zobowiązania krótkoterminowe rosną jeszcze szybciej. Wzrost jest finansowany długiem, nie kapitałem własnym — jeśli przychody spadną, spółka może stanąć w obliczu kryzysu płynności."

   e) ALTMAN Z″ vs SEKTOR: „Altman Z″ wskazuje szarą strefę, ALE spółka działa w sektorze NACE 46 (hurt), gdzie wysoki wskaźnik D/E i niskie marże są strukturalnie normalne. Wynik może być nieco mylący."

   f) KONCENTRACJA vs DYWERSYFIKACJA: „Sytuacja finansowa spółki jest doskonała, ALE jeśli notatki lub dane tekstowe wskazują na dużą zależność od jednego klienta lub dostawcy, jest to ryzyko strategiczne — utrata jednego partnera może oznaczać upadek."

   g) CZYSTE REJESTRY vs NEGATYWNE TRENDY: „Spółka ma czyste rejestry (brak egzekucji, brak upadłości), ALE trendy finansowe pokazują spadek kapitału własnego i rosnące straty — prawna bezúhonnosć nie jest gwarancją stabilności finansowej."

   h) AUDIT vs BRAK AUDYTU: „Spółka nie ma audytu, ALE wykazuje wysokie przychody i zysk. Bez niezależnej weryfikacji nie można potwierdzić poprawności tych liczb — wiarygodność sprawozdania jest ograniczona."

   Te wzorce nie są wyczerpujące — aktywnie szukaj INNYCH sprzeczności w konkretnych danych spółki. Im więcej powiązań krzyżowych znajdziesz, tym wyższa jakość oceny.''',
    'hu': '''**KRESZTALÁZIS – „DE” MINTÁK (KÖTELEZŐ ALKALMAZNI):**
   Elemzésének nem szabad csupán tényösszegzésnek lennie. Aktívan keresnie kell az ellentmondásokat és feszültségeket a mutatók között. Használja az „X pozitív, DE Y árnyalja, ami Z-t jelentheti” mintát. Ezeknek a következtetéseknek van a legnagyobb értékük, mivel több adatforrást kapcsolnak össze.

   Olyan specifikus minták, amelyeket KÖTELEZŐ ellenőriznie és visszatükröznie az executive_summary részben, ha előfordulnak:

   a) LIKVIDITÁS vs KÖVETELÉSEK: „A vállalat likviditása kiváló (Current Ratio > 2), DE a követelések gyorsabban nőnek, mint az árbevétel az elmúlt 2 évben. Ez azt jelentheti, hogy a cég hitelre értékesít, de az ügyfelek nem fizetnek — az eszközök minősége romlik.”

   b) EBITDA vs ÁRRÉS: „Az EBITDA évről évre nő, DE a nettó árrés csökken. Az EBITDA növekedését a magasabb forgalom és nem a hatékonyság hajtja — a vállalat minden egyes euró árbevétel után kevesebbet keres.”

   c) NYERESÉG vs CASH FLOW: „A vállalat magas nettó nyereséget mutat, DE a működési cash flow negatív vagy lényegesen alacsonyabb. Ez azt jelentheti, hogy a nyereség csak papíron létezik — a pénz valójában nem érkezik be, vagy a növekvő követelésekben, illetve készletekben van lekötve.”

   d) ÁRBEVÉTEL-NÖVEKEDÉS vs KÖTELEZETTSÉGEK: „Az árbevétel nő, DE a rövid lejáratú kötelezettségek még gyorsabban nőnek. A növekedést hitelből és nem saját tőkéből finanszírozzák — ha az árbevétel csökken, a vállalat likviditási válsággal nézhet szembe.”

   e) ALTMAN Z″ vs SZEKTOR: „Az Altman Z″ szürke zónát mutat, DE a vállalat a NACE 46 (nagykereskedelem) ágazatban működik, ahol a magas tőkeáttétel (D/E) és az alacsony árrés strukturálisan normális. Az eredmény enyhén félrevezető lehet.”

   f) KONCENTRÁCIÓ vs DIVERZIFIKÁCIÓ: „A vállalat pénzügyileg kiváló, DE ha a kiegészítő melléklet vagy a szöveges adatok nagy függőséget mutatnak egyetlen vevőtől vagy beszállítótól, az stratégiai kockázatot jelent — egyetlen partner elvesztése is összeomlást okozhat.”

   g) TISZTA NYILVÁNTARTÁSOK vs NEGATÍV TRENDEK: „A vállalat tiszta a nyilvántartásokban (nincs végrehajtás, nincs csőd), DE a pénzügyi trendek csökkenő saját tőkét és növekedő veszteségeket mutatnak — a jogi integritás nem garancia a pénzügyi stabilitásra.”

   h) AUDIT vs AUDIT HIÁNYA: „A vállalatnak nincs auditja, DE magas árbevételt és nyereséget mutat. Független ellenőrzés nélkül nem lehet megerősíteni ezen adatok helytállóságát — a pénzügyi kimutatások hitelessége korlátozott.”

   Ezek a minták nem teljes körűek — aktívan keressen MÁS ellentmondásokat is a vállalat konkrét adataiban. Minél több keresztkapcsolatot talál, annál magasabb lesz az értékelés minősége.''',
    'cz': '''**KŘÍŽOVÁ ANALÝZA — VZORY "ale" (MUSÍŠ APLIKOVAT):**
   Tvá analýza nesmí být jen sumarizace faktů. Musíš aktivně hledat rozpory a napětí mezi indikátory. Používej vzor "X je pozitivní, ale Y to komplikuje, což může znamenat Z". Tyto závěry mají největší hodnotu, protože spojují více datových zdrojů.

   Konkrétní vzory, které MUSÍŠ zkontrolovat a v případě nalezení je reflektovat v executive_summary:

   a) LIKVIDITA vs POHLEDÁVKY: "Firma má výbornou likviditu (Current Ratio > 2), ale pohledávky rostou rychleji než tržby za poslední 2 roky. To může znamenat, že firma prodává na fakturu, ale zákazníci neplatí — kvalita aktiv se zhoršuje."

   b) EBITDA vs MARŽE: "EBITDA roste meziročně, ale čistá marže klesá. Rost EBITDA je tedy poháněn vyšším obratem, ne efektivitou — firma vydělává méně na každé euro tržeb."

   c) ZISK vs CASH FLOW: "Firma vykazuje vysoký čistý zisk, ale provozní cash flow je záporný nebo mnohem nižší. To může znamenat, že zisk je papírový — peníze reálně nepřicházejí, případně se vážou v rostoucích pohledávkách nebo zásobách."

   d) RŮST TRŽEB vs ZÁVAZKY: "Tržby rostou, ale krátkodobé závazky rostou ještě rychleji. Růst je tedy financován z dluhu, ne z vlastních zdrojů — při poklesu tržeb může firma čelit likviditní krizi."

   e) ALTMAN Z″ vs SEKTOR: "Altman Z″ indikuje šedou zónu, ale firma působí v NACE 46 (velkoobchod), kde je vysoké D/E a nízká marže strukturálně normální. Skóre může být mírně zavádějící."

   f) KONCENTRACE vs DIVERZIFIKACE: "Firma je výborná finančně, ale pokud z poznámek nebo narativních dat vyplývá vysoká závislost na jednom odběrateli nebo dodavateli, je to strategické riziko — ztráta jednoho partnera může znamenat kolaps."

   g) POZITIVNÍ REGISTRY vs NEGATIVNÍ TRENDY: "V registrech je firma čistá (žádné exekuce, žádný konkurz), ale finanční trendy ukazují pokles vlastního jmění a rostoucí ztráty — právní bezúhonnost není garancí finanční stability."

   h) AUDIT vs BEZ AUDITU: "Firma nemá audit, ale vykazuje vysoké tržby a zisk. Bez nezávislého ověření není možné potvrdit věrnost těchto čísel — důvěryhodnost závěrky je omezená."

   Tyto vzory nejsou vyčerpávající — aktivně hledej TAKÉ další rozpory v konkrétních datech firmy. Čím více křížových souvislostí najdeš, tím vyšší kvalita posudku.

   DŮLEŽITÉ: V finálním textu používej "ale" malými písmeny (ne "ALE"). "ALE" velkými písmeny zní nepřirozeně a roboticky. NIKDY nepoužívej "ALE" velkými písmeny v textu — vždy jen "ale" na začátku věty nebo uprostřed věty. Například správně: "Firma je zisková, ale tržby klesají." Nesprávně: "Firma je zisková, ALE tržby klesají."''',
    'pl': '''**CROSS-ANALYSIS — "BUT" PATTERNS (MUST APPLY):**
   Vaša analýza nesmie byť len súhrnom faktov. Musíte aktívne hľadať protiklady a napätia medzi ukazovateľmi. Použite vzorec „X je pozitívne, ALE Y to komplikuje, čo môže znamenať Z“. Tieto závery majú najvyššiu hodnotu, pretože prepájajú viaceré zdroje údajov.

   Špecifické vzorce, ktoré MUSÍTE skontrolovať a zohľadniť v poli executive_summary, ak ich nájdete:

   a) LIQUIDITY vs RECEIVABLES: „Spoločnosť má vynikajúcu likviditu (bežná likvidita > 2), ALE pohľadávky rastú rýchlejšie ako tržby za posledné 2 roky. To môže znamenať, že spoločnosť predáva na úver, ale zákazníci neplatia – kvalita aktív sa zhoršuje.“

   b) EBITDA vs MARGIN: „EBITDA medziročne rastie, ALE čistá marža klesá. Rast EBITDA je hnaný vyšším obratom, nie efektivitou – spoločnosť zarába menej na každom eure výnosov.“

   c) PROFIT vs CASH FLOW: „Spoločnosť vykazuje vysoký čistý zisk, ALE prevádzkový cash flow je záporný alebo oveľa nižší. To môže znamenať, že zisk je len papierový – peniaze v skutočnosti neprichádzajú alebo sú viazané v rastúcich pohľadávkach či zásobách.“

   d) REVENUE GROWTH vs LIABILITIES: „Tržby rastú, ALE krátkodobé záväzky rastú ešte rýchlejšie. Rast je financovaný dlhom, nie vlastným imaním – ak tržby klesnú, spoločnosť môže čeliť kríze likvidity.“

   e) ALTMAN Z″ vs SECTOR: „Altman Z″ indikuje sivú zónu, ALE spoločnosť pôsobí v odvetví NACE 46 (veľkoobchod), kde sú vysoký pomer dlhu k vlastnému imaniu a nízke marže štrukturálne normálne. Skóre môže byť mierne zavádzajúce.“

   f) CONCENTRATION vs DIVERSIFICATION: „Spoločnosť je finančne vynikajúca, ALE ak poznámky k účtovnej závierke alebo slovné dáta ukazujú vysokú závislosť od jediného zákazníka alebo dodávateľa, ide o strategické riziko – strata jedného partnera by mohla znamenať kolaps.“

   g) CLEAN REGISTRIES vs NEGATIVE TRENDS: „Spoločnosť má čisté registre (žiadne exekúcie, žiaden konkurz), ALE finančné trendy ukazujú klesajúce vlastné imanie a rastúce straty – právna bezúhonnosť nie je zárukou finančnej stability.“

   h) AUDIT vs NO AUDIT: „Spoločnosť nemá audit, ALE vykazuje vysoké tržby a zisk. Bez nezávislého overenia nie je možné potvrdiť správnosť týchto údajov – dôveryhodnosť účtovnej závierky je obmedzená.“

   Tieto vzorce nie sú vyčerpávajúce – aktívne hľadajte INÉ protiklady v špecifických údajoch spoločnosti. Čím viac krížových prepojení nájdete, tým vyššia je kvalita hodnotenia.''',
    'hu': '''```markdown
**KERESZTANALÍZIS – „DE” MINTÁK (KÖTELEZŐ ALKALMAZNI):**
   Az elemzés nem lehet csupán a tények összefoglalása. Aktívan keresnie kell az ellentmondásokat és a mutatók közötti feszültségeket. Használja az „Az X pozitív, DE az Y ezt bonyolítja, ami Z-t jelentheti” mintát. Ezeknek a következtetéseknek van a legnagyobb értéke, mivel több adatforrást kötnek össze.

   Konkrét minták, amelyeket KÖTELEZŐ ellenőrizni, és ha előfordulnak, tükrözni az executive_summary részben:

   a) LIKVIDITÁS vs KÖVETELÉSEK: „A vállalat likviditása kiváló (Current Ratio > 2), DE a követelések gyorsabban nőnek, mint az árbevétel az elmúlt 2 évben. Ez azt jelentheti, hogy a cég hitelre értékesít, de az ügyfelek nem fizetnek – az eszközök minősége romlik.”

   b) EBITDA vs ÁRRÉS: „Az EBITDAévről évre nő, DE a nettó árrés csökken. Az EBITDA növekedését a magasabb forgási sebesség hajtja, nem a hatékonyság – a vállalat minden egyes euró árbevételen keveset keres.”

   c) NYERESÉG vs CASH FLOW: „A vállalat magas nettó nyereséget mutat, DE a üzemi cash flow negatív vagy sokkal alacsonyabb. Ez azt jelentheti, hogy a nyereség papíron létezik – a pénz valójában nem érkezik be, vagy a növekvő követelésekben, illetve készletekben van lekötve.”

   d) ÁRBEVÉTEL-NÖVEKEDÉS vs KÖTELEZETTSÉGEK: „Az árbevétel nő, DE a rövid lejáratú kötelezettségek még gyorsabban nőnek. A növekedést adósságból finanszírozzák, nem saját tőkéből – ha az árbevétel csökken, a vállalat likviditási válsággal nézhet szembe.”

   e) ALTMAN Z″ vs SZEKTOR: „Az Altman Z″ szürke zónát jelez, DE a vállalat a NACE 46 (nagykereskedelem) ágazatban működik, ahol a magas D/E és az alacsony árrés strukturálisan normális. Az eredmény enyhén félrevezető lehet.”

   f) KONCENTRÁCIÓ vs DIVERZIFIKÁCIÓ: „A vállalat pénzügyileg kiváló, DE ha a megjegyzések vagy a szöveges adatok egyetlen vevőtől vagy szállítótól való erős függőséget mutatnak, az stratégiai kockázat – egyetlen partner elvesztése az összeomlást jelentheti.”

   g) TISZTA NYILVÁNTARTÁSOK vs NEGATÍV TRENDEK: „A vállalat tiszta a nyilvántartásokban (nincs végrehajtási eljárás, nincs csőd), DE a pénzügyi trendek csökkenő saját tőkét és növekvő veszteségeket mutatnak – a jogi integritás nem garancia a pénzügyi stabilitásra.”

   h) AUDIT vs NINCS AUDIT: „A vállalatnak nincs auditja, DE magas árbevételt és nyereséget mutat. Független ellenőrzés nélkül nem lehet megerősíteni e számok helyességét – a pénzügyi kimutatások hitelessége korlátozott.”

   Ezek a minták nem teljes körűek – aktívan keresse a VÁLLALAT EGYEDI ADATAIBAN LÉVŐ EGYÉB ellentmondásokat. Minél több keresztkapcsolatot talál, annál magasabb minőségű az értékelés.
```''',
    'cz': '''**KŘÍŽOVÁ ANALÝZA — VZORY "ale" (MUSÍŠ APLIKOVAT):**
   Tvá analýza nesmí být jen sumarizace faktů. Musíš aktivně hledat rozpory a napětí mezi indikátory. Používej vzor "X je pozitivní, ale Y to komplikuje, což může znamenat Z". Tyto závěry mají největší hodnotu, protože spojují vícero datových zdrojů.

   Konkrétní vzory, které MUSÍŠ zkontrolovat a v případě nalezení je reflektovat v executive_summary:

   a) LIKVIDITA vs POHLEDÁVKY: "Firma má výbornou likviditu (Current Ratio > 2), ale pohledávky rostou rychleji než tržby za poslední 2 roky. To může znamenat, že firma prodává na fakturu, ale zákazníci neplaví — kvalita aktiv se zhoršuje."

   b) EBITDA vs MARŽE: "EBITDA roste meziročně, ale čistá marže klesá. Růst EBITDA je tedy poháněný vyšším obratem, ne efektivitou — firma zaráží méně na každé euro tržeb."

   c) ZISK vs CASH FLOW: "Firma vykazuje vysoký čistý zisk, ale provozní cash flow je záporný nebo mnohem nižší. To může znamenat, že zisk je papírový — peníze reálně nepřicházejí, případně se vážou v rostoucích pohledávkách nebo zásobách."

   d) RŮST TRŽEB vs ZÁVAZKY: "Tržby rostou, ale krátkodobé závazky rostou ještě rychleji. Růst je tedy financovaný z dluhu, ne z vlastních zdrojů — při poklesu tržeb může firma facingovat likviditní krizi."

   e) ALTMAN Z″ vs SEKTOR: "Altman Z″ indikuje šedou zónu, ale firma působí v NACE 46 (velkoobchod), kde je vysoké D/E a nízká marže strukturálně normální. Skóre může být mírně zavádějící."

   f) KONCENTRACE vs DIVERZIFIKACE: "Firma je výborná finančně, ale pokud z poznámek nebo narativních dat vyplývá vysoká závislost na jednom odběrateli nebo dodavateli, je to strategické riziko — ztráta jednoho partnera může znamenat kolaps."

   g) POZITIVNÍ REGISTRY vs NEGATIVNÍ TRENDY: "V registrech je firma čistá (žádné exekuce, žádný konkurz), ale finanční trendy ukazují pokles vlastního jmění a rostoucí ztráty — právní bezúhonnost není garancí finanční stability."

   h) AUDIT vs BEZ AUDITU: "Firma nemá audit, ale vykazuje vysoké tržby a zisk. Bez nezávislého ověření není možné potvrdit věrnost těchto čísel — důvěryhodnost závěrky je obmezená."

   Tyto vzory nejsou vyčerpávající — aktivně hledej TAKÉ další rozpory v konkrétních datech firmy. Čím víc křížových souvislostí najdeš, tím vyšší kvalita posudku.

   DŮLEŽITÉ: V finálním textu používej "ale" malými písmeny (ne "ALE"). "ALE" velkými písmeny zní nepřirozeně a roboticky. NIKDY nepoužívej "ALE" velkými písmeny v textu — vždy jen "ale" na začátku věty nebo uprostřed věty. Například správně: "Firma je zisková, ale tržby klesají." Nesprávně: "Firma je zisková, ALE tržby klesají."''',
    'pl': '''**KRIŹOVÁ ANALÝZA – VZORCE „ALE“ (MUSIA SA POUŽIŤ):**
   Vaša analýza nesmie byť len súhrnom faktov. Musíte aktívne hľadať protiklady a napätie medzi ukazovateľmi. Použite vzorec „X je pozitívne, ALE Y to komplikuje, čo môže znamenať Z“. Tieto závery majú najvyššiu hodnotu, pretože prepájajú viaceré zdroje údajov.

   Konkrétne vzorce, ktoré MUSÍTE skontrolovať a zohľadniť v dokumente executive_summary, ak sa nájdu:

   a) LIKVIDITA vs POHĽADÁVKY: „Spoločnosť má vynikajúcu likviditu (bežná likvidita > 2), ALE pohľadávky rastú rýchlejšie ako tržby za posledné 2 roky. To môže znamenat, že spoločnosť predáva na úver, ale zákazníci neplatia – kvalita aktív sa zhoršuje.“

   b) EBITDA vs MARŽA: „EBITDA medziročne rastie, ALE čistá marža klesá. Rast EBITDA je hnaný vyšším obratom, nie efektivitou – spoločnosť zarába menej na každom eure výnosov.“

   c) ZISK vs CASH FLOW: „Spoločnosť vykazuje vysoký čistý zisk, ALE prevádzkový cash flow je záporný alebo oveľa nižší. To môže znamenať, že zisk je len papierový – peniaze v skutočnosti neprichádzajú alebo sú viazané v rastúcich pohľadávkach či zásobách.“

   d) RAST TRŽIEB vs ZÁVÄZKY: „Tržby rastú, ALE krátkodobé záväzky rastú ešte rýchlejšie. Rast je financovaný dlhom, nie vlastným imaním – ak tržby klesnú, spoločnosť môže čeliť kríze likvidity.“

   e) ALTMAN Z″ vs ODVETVIE: „Altman Z″ indikuje šedú zónu, ALE spoločnosť pôsobí v odvetví NACE 46 (veľkoobchod), kde sú vysoké zadlženie a nízke marže štrukturálne normálne. Skóre môže byť mierne zavádzajúce.“

   f) KONCENTRÁCIA vs DIVERZIFIKÁCIA: „Spoločnosť je finančne vynikajúca, ALE ak poznámky k účtovnej závierke alebo textové dáta ukazujú vysokú závislosť od jedného zákazníka či dodávateľa, ide o strategické riziko – strata jedného partnera by mohla znamenať kolaps.“

   g) ČISTÉ REGISTRE vs NEGATÍVNE TRENDY: „Spoločnosť je v the registroch čistá (žiadne exekúcie, žiadny konkurz), ALE finančné trendy ukazujú klesajúce vlastné imanie a rastúce straty – právna integrita nie je zárukou finančnej stability.“

   h) AUDIT vs BEZ AUDITU: „Spoločnosť nemá audit, ALE vykazuje vysoké tržby a zisk. Bez nezávislého overenia nie je možné potvrdiť správnosť týchto údajov – dôveryhodnosť účtovnej závierky je obmedzená.“

   Tieto vzorce nie sú vyčerpávajúce – aktívne hľadajte INÉ protiklady v špecifických údajoch spoločnosti. Čím viac vzájomných prepojení nájdete, tým vyššia je kvalita hodnotenia.''',
    'hu': '''**KOSZORÚS ELEMZÉS – „DE” MINTÁK (KÖTELEZŐEN ALKALMAZANDÓ):**
   Az elemzés nem lehet csupán tények összefoglalása. Aktívan keresnie kell az ellentmondásokat és a feszültségeket a mutatók között. Használja az „X pozitív, DE Y árnyalja a képet, ami Z-t jelenthet” mintát. Ezeknek a következtetéseknek van a legnagyobb értéke, mivel több adatforrást kötnek össze.

   Specifikus minták, amelyeket KÖTELEZŐ ellenőrizni és visszatükrözni az executive_summary részben, ha előfordulnak:

   a) LIKVIDITÁS vs KÖVETELÉSEK: „A vállalat likviditása kiváló (Current Ratio > 2), DE a követelések gyorsabban nőnek, mint az árbevétel az elmúlt 2 évben. Ez azt jelentheti, hogy a vállalat hitelre értékesít, de az ügyfelek nem fizetnek — az eszközök minősége romlik.”

   b) EBITDA vs ÁRRÉS: „Az EBITDA évről évre növekszik, DE a nettó árrés csökken. Az EBITDA növekedését a nagyobb forgalom hajtja, nem a hatékonyság — a vállalat kevesebbet keres minden egyes eurónyi árbevételen.”

   c) NYERESÉG vs CASH FLOW: „A vállalat magas nettó nyereséget mutat, DE az üzemi cash flow negatív vagy sokkal alacsonyabb. Ez azt jelentheti, hogy a nyereség csak papíron létezik — a pénz valójában nem érkezik be, vagy a növekvő követelésekben, illetve készletekben van lekötve.”

   d) ÁRBEVÉTEL-NÖVEKEDÉS vs KÖTELEZETTSÉGEK: „Az árbevétel növekszik, DE a rövid lejáratú kötelezettségek még gyorsabban nőnek. A növekedést adósságból finanszírozzák, nem saját tőkéből — ha az árbevétel visszaesik, a vállalat likviditási válsággal nézhet szembe.”

   e) ALTMAN Z″ vs SZEKTOR: „Az Altman Z″ szürke zónát mutat, DE a vállalat NACE 46 (nagykereskedelem) ágazatban működik, ahol a magas eladósodottság és az alacsony árrés strukturálisan normális. Az eredmény enyhén félrevezető lehet.”

   f) KONCENTRÁCIÓ vs DIVERZIFIKÁCIÓ: „A vállalat pénzügyileg kiváló, DE ha a megjegyzések vagy a szöveges adatok magas függőséget mutatnak egyetlen ügyféltől vagy beszállítótól, az stratégiai kockázatot jelent — egyetlen partner elvesztése összeomlást okozhat.”

   g) TISZTA NYILVÁNTARTÁSOK vs NEGATÍV TRENDEK: „A vállalat nyilvántartásai tiszták (nincs végrehajtás, nincs csőd), DE a pénzügyi trendek csökkenő saját tőkét és növekvő veszteségeket mutatnak — a jogi tisztaság nem garancia a pénzügyi stabilitásra.”

   h) AUDIT vs NINCS AUDIT: „A vállalatnak nincs auditja, DE magas árbevételt és nyereséget mutat. Független ellenőrzés nélkül nem lehet megerősíteni ezen adatok helytállóságát — a pénzügyi kimutatások hitelessége korlátozott.”

   Ezek a minták nem teljes körűek — aktívan keressen MÁS ellentmondásokat is a vállalat egyedi adataiban. Minél több keresztkapcsolatot talál, annál magasabb minőségű lesz az értékelés.''',
    'cz': '''**KŘÍŽOVÁ ANALÝZA — VZORY "ale" (MUSÍŠ APLIKOVAT):**
   Tvá analýza nesmí být jen sumarizace faktů. Musíš aktivně hledat rozpory a napětí mezi indikátory. Používej vzor "X je pozitivní, ale Y to komplikuje, což může znamenat Z". Tyto závěry mají největší hodnotu, protože spojují vícero datových zdrojů.

   Konkrétní vzory, které MUSÍŠ zkontrolovat a v případě nalezení je reflektovat v executive_summary:

   a) LIKVIDITA vs POHLEDÁVKY: "Firma má výbornou likviditu (Current Ratio > 2), ale pohledávky rostou rychleji než tržby za poslední 2 roky. To může znamenat, že firma prodává na fakturu, ale zákazníci neplatí — kvalita aktiv se zhoršuje."

   b) EBITDA vs MARŽE: "EBITDA roste meziročně, ale čistá marže klesá. Rast EBITDA je teda poháňaný vyšším obratem, nie efektivitou — firma vydělává méně na každé euro tržeb."

   c) ZISK vs CASH FLOW: "Firma vykazuje vysoký čistý zisk, ale provozní cash flow je záporný nebo mnohem nižší. To může znamenat, že zisk je papírový — peníze reálně nepřicházejí, případně se vážou v rostoucích pohledávkách nebo zásobách."

   d) RAST TRŽIEB vs ZÁVÄZKY: "Tržby rostou, ale krátkodobé závazky rostou ještě rychleji. Růst je tedy financován z dluhu, ne z vlastních zdrojů — při poklesu tržeb může firma facingovať likviditní krizi."

   e) ALTMAN Z″ vs SEKTOR: "Altman Z″ indikuje šedou zónu, ale firma působí v NACE 46 (velkoobchod), kde je vysoké D/E a nízká marže strukturálně normální. Skóre může být mírně zavádějící."

   f) KONCENTRÁCIA vs DIVERZIFIKÁCIA: "Firma je finančně výborná, ale pokud z poznámek nebo narativních dat vyplývá vysoká závislost na jednom odběrateli nebo dodavateli, je to strategické riziko — ztráta jednoho partnera může znamenat kolaps."

   g) POZITÍVNE REGISTRE vs NEGATÍVNE TRENDY: "V registrech je firma čistá (žádné exekuce, žádný konkurz), ale finanční trendy ukazují pokles vlastního kapitálu a rostoucí ztráty — právní bezúhonnost není garancí finanční stability."

   h) AUDIT vs BEZ AUDITU: "Firma nemá audit, ale vykazuje vysoké tržby a zisk. Bez nezávislého ověření není možné potvrdit věrnost těchto čísel — důvěryhodnost závěrky je obmezená."

   Tieto vzory nie sú vyčerpávajúce — aktívne hľadaj AJ ďalšie rozpory v konkrétnych dátach firmy. Čím viac krížových súvislostí nájdeš, tým vyššia kvalita posudku.

   DÔLEŽITÉ: V finálnom texte používaj "ale" malými písmenami (nie "ALE"). "ALE" veľkými písmenami znie neprirodzene a roboticky. NIKDY nepoužívaj "ALE" veľkými písmenami v texte — vždy len "ale" na začiatku vety alebo v strede vety. Napríklad správne: "Firma je zisková, ale tržby klesajú." Nesprávne: "Firma je zisková, ALE tržby klesajú."''',
}

COMMON_FORENSIC_RULES = {
    'sk': '''5. Zlaté kliétky (Riziko odtoku kapitálu): Ak vidíš rast tržieb, ale výrazný pokles hotovosti a rast záväzkov voči prepojeným osobám, uprav skóre smerom nadol v rámci svojho limitu. POZOR: Pri medzinárodných korporáciách (skupiny ako Hyundai, Volkswagen, Siemens atď.) sú transakcie so spriaznenými osobami ŠTANDARDNÝ vnútro-skupinový tok (transfer pricing, zdieľané služby). Tieto transakcie nepenalizuj a neznižuj za ne skóre. Nepoužívaj termín "riziko odtoku kapitálu" pre takéto bežné operácie. Namiesto toho použi neutrálnejší opis: "vysoká miera transakcií so spriaznenými osobami". Termín "odtok kapitálu" rezervuj len pre prípady, kde je jasný dôkaz neštandardných cenových podmienok alebo odtoku prostriedkov bez hospodárskeho opodstatnenia.
6. CHÝBAJÚCE CASH FLOW DÁTA: Na Slovensku mnoho firiem nepodáva štruktúrovaný výkaz Cash Flow do RÚZ (často je súčasťou poznámok v PDF). Ak v dátach vidíš `operatingCashFlow: null` alebo `operatingCashFlow: 0` pri firme, ktorá má kladné tržby a zisk, NEPovažuj to za forenzný varovný indikátor ani znak odtoku kapitálu. Nulový alebo chýbajúci cash flow v dátach znamená "dáta neboli k dispozícii v štruktúrovanej forme", NIE "firma má nulový cash flow". Spomeň to ako obmedzenie dát, nie ako riziko firmy.
7. SEKTOROVÉ KONTEXTY (NACE): Pri hodnotení zohľadni NACE kód firmy. Veľkoobchod a maloobchod (NACE 46, 47) má štrukturálne nízke marže (0.5–3%) a vysoké D/E ratio (5–20), pretože ide o "prietokový" biznis s vysokým obratom a záväzkami voči dodávateľom. To, čo by u výrobnej firmy znamenalo kritický stres, je pre veľkoobchod normálne. Nepenalizuj firmy v týchto segmentoch za vysoké D/E alebo nízke marže, ak sú ziskové a majú stabilný obrat.
8. TRŽBY VS AKTÍVA: U výrobných firiem s vysokým obratom (automobilový priemysel, veľkoobchod) je bežné, že ročné tržby prevyšujú celkové aktíva. Tržby reprezentujú prietok (flow) za rok, aktíva sú stav (stock) k jednému dňu. Nepovažuj to za anomáliu ani nezrovnalosť.
9. ZASTARANÝ GOING CONCERN: Ak mali výkazy z minulých rokov audítorskú výhradu (napr. Going Concern), ale ten najnovší rok (posledný dostupný) je "bez výhrad" (unqualified), znamená to, že problém bol vyriešený. Nepenalizuj firmu a nevytváraj kritické riziko za zastarané problémy z minulosti.
10. ANOMÁLIE V ŠTRUKTÚRE VEDENIA A ORSR (ORSR Forensics): V `companyEvents` (alebo v metadátach) môžeš nájsť udalosť typu `FORENSIC_ANALYSIS` s titlom "Anomália v štruktúre vedenia (ORSR Anomálie)" alebo podobne. Ak spoločnosť vykazuje vysokú frekvenciu zmien konateľov (napr. >2 zmeny) v kombinácii s virtuálnym sídlom a/alebo zahraničným štatutárom, MUSÍŠ to považovať za KRITICKÝ VAROVNÝ INDIKÁTOR. VÝNIMKA: Ak ide o veľkú spoločnosť (tržby > 10 000 000 EUR alebo > 50 zamestnancov), časté zmeny štatutárov sú štandardnou korporátnou rotáciou manažmentu, NIE anomáliou v štruktúre vedenia. V takom prípade túto anomáliu ignoruj a nepenalizuj. Ak výnimka neplatí, výrazne zníž `llm_score_adjustment` (napr. -10 bodov) a vo `final_verdict` explicitne varuj pred extrémnym rizikom podvodu a tzv. "anomáliou v štruktúre vedenia". Tieto anomálie spomeň aj v `executive_summary`.''',
    'en': '''5. Golden cages (Capital extraction risk): If you see revenue growth but a significant decline in cash and growth of liabilities to related parties, adjust the score downward within your limit. NOTE: For international corporations (groups like Hyundai, Volkswagen, Siemens etc.), related party transactions are a STANDARD intra-group flow (transfer pricing, shared services). Do not penalize these transactions and do not reduce the score for them. Do not use the term "capital extraction risk" for such routine operations. Instead use a more neutral description: "high level of related party transactions". Reserve the term "capital extraction" only for cases where there is clear evidence of non-standard pricing conditions or asset stripping without economic justification.
6. MISSING CASH FLOW DATA: In Slovakia, many companies do not file a structured Cash Flow statement to RÚZ (it is often part of notes in PDF). If you see `operatingCashFlow: null` or `operatingCashFlow: 0` for a company with positive revenue and profit, DO NOT consider this a forensic warning indicator or sign of capital extraction. Zero or missing cash flow in the data means "data was not available in structured form", NOT "the company has zero cash flow". Mention it as a data limitation, not a company risk.
7. SECTOR CONTEXTS (NACE): When evaluating, consider the company's NACE code. Wholesale and retail (NACE 46, 47) have structurally low margins (0.5–3%) and high D/E ratios (5–20), because it is a "flow-through" business with high turnover and supplier liabilities. What would mean critical stress for a manufacturing company is normal for wholesale. Do not penalize companies in these segments for high D/E or low margins if they are profitable and have stable turnover.
8. REVENUE VS ASSETS: For manufacturing companies with high turnover (automotive, wholesale), it is common that annual revenue exceeds total assets. Revenue represents a flow over a year, assets are a stock at a single point in time. Do not consider this an anomaly or discrepancy.
9. OUTDATED GOING CONCERN: If financial statements from previous years had an auditor reservation (e.g. Going Concern), but the most recent year is "unqualified" (clean), it means the issue was resolved. Do not penalize the company and do not create a critical risk for outdated issues from the past.
10. MANAGEMENT STRUCTURE ANOMALIES AND ORSR (ORSR Forensics): In `companyEvents` (or metadata) you may find an event of type `FORENSIC_ANALYSIS` titled "Management Structure Anomaly (ORSR Anomaly)" or similar. If the company shows a high frequency of director changes (e.g. >2 changes) combined with a virtual address and/or foreign statutory representative, you MUST consider this a CRITICAL WARNING INDICATOR. EXCEPTION: If it is a large company (revenue > 10,000,000 EUR or > 50 employees), frequent changes of directors are standard corporate management rotation, NOT a management structure anomaly. In such case, ignore this anomaly and do not penalize. If the exception does not apply, significantly reduce `llm_score_adjustment` (e.g. -10 points) and in `final_verdict` explicitly warn about extreme fraud risk and the so-called "management structure anomaly". Mention these anomalies also in `executive_summary`.''',
    'de': '''5. Goldene Käfige (Kapitalabfluss-Risiko): Bei internationalen Konzernen (Hyundai, Volkswagen, Siemens etc.) sind Transaktionen mit nahestenden Personen ein STANDARDmäßiger konzerninterner Fluss. Bestrafen Sie diese Transaktionen nicht und reduzieren Sie nicht die Punktzahl dafür. Verwenden Sie den Begriff "Kapitalabfluss" nicht für solche Routineoperationen.
6. FEHLENDE CASH FLOW DATEN: Null oder fehlender Cash Flow in den Daten bedeutet "Daten in strukturierter Form nicht verfügbar", NICHT "das Unternehmen hat null Cash Flow".
7. SEKTOR-KONTEXTE (NACE): Groß- und Einzelhandel (NACE 46, 47) haben strukturell niedrige Margen (0,5–3%) und hohe D/E-Ratios (5–20).
8. UMSATZ VS VERMÖGEN: Bei Produktionsunternehmen mit hohem Umsatz ist es üblich, dass der Jahresumsatz das Gesamtvermögen übersteigt.
9. VERALTETER GOING CONCERN: Wenn frühere Jahre einen Going-Concern-Vermerk hatten, das aktuellste Jahr jedoch uneingeschränkt ("ohne Vorbehalt") ist, wurde das Problem gelöst. Bestrafen Sie das Unternehmen nicht für veraltete Probleme.
10. ANOMALIEN IN DER GESCHÄFTSFÜHRUNG UND ORSR-ANOMALIEN: Wenn das Unternehmen eine hohe Häufigkeit von Geschäftsführerwechseln zeigt, müssen Sie dies als KRITISCHEN VAROHNINDIKATOR betrachten. AUSNAHME: Bei großen Unternehmen (Umsatz > 10.000.000 EUR oder > 50 Mitarbeiter) ist eine häufige Rotation des Managements normal, KEINE Anomalie in der Geschäftsführung. In diesem Fall ignorieren Sie die Anomalie.''',
    'cz': '''```text
5. Zlaté klece (Riziko odtoku kapitálu): Ak vidíš rast tržieb, ale výrazný pokles hotovosti a rast záväzkov voči prepojeným osobám, uprav skóre smerom nadol v rámci svojho limitu. POZOR: Při mezinárodních korporacích (skupiny jako Hyundai, Volkswagen, Siemens atd.) jsou transakce se spřízněnými osobami ŠTANDARDNÝ vnútro-skupinový tok (transfer pricing, zdieľané služby). Tieto transakcie nepenalizuj a neznižuj za ne skóre. Nepoužívaj termín "riziko odtoku kapitálu" pre takéto bežné operácie. Namiesto toho použi neutrálnejší opis: "vysoká miera transakcií so spriaznenými osobami". Termín "odtok kapitálu" rezervuj len pre prípady, kde je jasný dôkaz neštandardných cenových podmienok alebo odtoku prostriedkov bez hospodárskeho opodstatnenia.
6. CHÝBAJÚCE CASH FLOW DÁTA: Na Slovensku mnoho firiem nepodáva štruktúrovaný výkaz Cash Flow do RÚZ (často je súčasťou poznámok v PDF). Ak v dátach vidíš `operatingCashFlow: null` nebo `operatingCashFlow: 0` při firmě, která má kladné tržby a zisk, NEPovažuj to za forenzný varovný indikátor ani znak odtoku kapitálu. Nulový nebo chybějící cash flow v dátach znamená "dáta neboli k dispozícii v štruktúrovanej forme", NIE "firma má nulový cash flow". Spomeň to ako obmedzenie dát, nie ako riziko firmy.
7. SEKTOROVÉ KONTEXTY (NACE): Při hodnocení zohledni NACE kód firmy. Velkoobchod a maloobchod (NACE 46, 47) má štrukturálne nízke marže (0.5–3%) a vysoké D/E ratio (5–20), pretože ide o "prietokový" biznis s vysokým obratom a záväzkami voči dodávateľom. To, čo by u výrobnej firmy znamenalo kritický stres, je pre veľkoobchod normálne. Nepenalizuj firmy v týchto segmentoch za vysoké D/E alebo nízke marže, ak sú ziskové a majú stabilný obrat.
8. TRŽBY VS AKTÍVA: U výrobných firiem s vysokým obratom (automobilový priemysel, veľkoobchod) je bežné, že ročné tržby prevyšujú celkové aktíva. Tržby reprezentujú prietok (flow) za rok, aktíva sú stav (stock) k jednému dňu. Nepovažuj to za anomáliu ani nezrovnalost.
9. ZASTARANÝ GOING CONCERN: Ak mali výkazy z minulých rokov audítorskú výhradu (napr. Going Concern), ale ten najnovší rok (posledný dostupný) je "bez výhrad" (unqualified), znamená to, že problém bol vyriešený. Nepenalizuj firmu a nevytváraj kritické riziko za zastarané problémy z minulosti.
10. ANOMÁLIE V ŠTRUKTÚRE VEDENIA A ORSR (ORSR Forensics): V `companyEvents` (alebo v metadátach) môžeš nájsť udalosť typu `FORENSIC_ANALYSIS` s titlom "Anomália v štruktúre vedenia (ORSR Anomálie)" nebo podobně. Ak spoločnosť vykazuje vysokú frekvenciu zmien konateľov (napr. >2 zmeny) v kombinácii s virtuálnym sídlom a/alebo zahraničným štatutárom, MUSÍŠ to považovať za KRITICKÝ VAROVNÝ INDIKÁTOR. VÝNIMKA: Ak ide o veľkú spoločnosť (tržby > 10 000 000 EUR alebo > 50 zamestnancov), časté zmeny štatutárov sú štandardnou korporátnou rotáciou manažmentu, NIE anomáliou v štruktúre vedenia. V takom prípade túto anomáliu ignoruj a nepenalizuj. Ak výnimka neplatí, výrazne zníž `llm_score_adjustment` (napr. -10 bodov) a vo `final_verdict` explicitne varuj pred extrémnym rizikom podvodu a tzv. "anomáliou v štruktúre vedenia". Tieto anomálie spomeň aj v `executive_summary`.''',
    'hu': '''```text
5. Zlaté klece (riziko odtoku kapitálu): Pokud zaznamenáte růst tržeb, ale současně významný pokles hotovosti a růst závazků vůči spřízněným osobám, snižte skóre v rámci svého limitu směrem dolů. POZNÁMKA: U mezinárodních korporací (skupiny jako Hyundai, Volkswagen, Siemens atd.) jsou transakce se spřízněnými osobami STANDARDNÍM vnitroskupinovým tokem (transferové ceny, sdílené služby). Tyto transakce netrestejte a nesnižujte kvůli nim skóre. Pro takové rutinní operace nepoužívejte termín „riziko odtoku kapitálu“. Místo toho použijte neutrálnější popis: „vysoká míra transakcí se spřízněnými osobami“. Termín „odtok kapitálu“ vyhraďte pouze pro případy, kdy existují jasné důkazy o nestandardních cenových podmínkách nebo vyvádění majetku bez ekonomického opodstatnění.
6. CHYBĚJÍCÍ ÚDAJE O CASH FLOW: Na Slovensku mnoho společností nepodává strukturovaný výkaz Cash Flow do RÚZ (často je součástí poznámek v PDF). Pokud u společnosti s kladnými tržbami a ziskem vidíte `operatingCashFlow: null` nebo `operatingCashFlow: 0`, nepovažujte to za forenzní varovný signál (varovný indikátor) ani za známku odtoku kapitálu. Nulové nebo chybějící cash flow v datech znamená „data nebyla k dispozici ve strukturované formě“, NIKOLI „společnost má nulové cash flow“. Zmiňte to jako datové omezení, nikoli jako riziko společnosti.
7. SEKTOROVÉ SOUVISLOSTI (NACE): Při hodnocení zohledněte kód NACE společnosti. Velkoobchod a maloobchod (NACE 46, 47) mají strukturálně nízké marže (0,5–3 %) a vysoké poměry D/E (5–20), protože jde o „průtočný“ byznys s vysokým obratem a závazky vůči dodavatelům. To, co by pro výrobní společnost znamenalo kritický stres, je pro velkoobchod normální. Netrestejte společnosti v těchto segmentech za vysoké D/E nebo nízké marže, pokud jsou ziskové a mají stabilní obrat.
8. TRŽBY VS AKTIVA: U výrobních společností s vysokým obratem (automotive, velkoobchod) je běžné, že roční tržby převyšují celková aktiva. Tržby představují tok za rok, aktiva jsou stav v jednom konkrétním okamžiku. Nepovažujte to za anomálii ani nesrovnalost.
9. ZASTARALÉ TRVÁNÍ ZA SPOLEČNOSTI (GOING CONCERN): Pokud účetní závěrky z předchozích let obsahovaly výhradu auditora (např. Going Concern), ale nejnovější rok je „bez výhrad“ (clean), znamená to, že problém byl vyřešen. Netrestejte společnost a nevytvářejte kritické riziko kvůli zastaralým problémům z minulosti.
10. ANOMÁLIE V STRUKTUŘE VEDENÍ A ANOMÁLIE V ORSR (Forenzní analýza ORSR): V položce `companyEvents` (nebo v metadatech) můžete nalézt událost typu `FORENSIC_ANALYSIS` s názvem „Anomálie v struktuře vedení (anomálie v ORSR)“ nebo podobným. Pokud společnost vykazuje vysokou četnost změn jednatelů/ředitelů (např. >2 změny) v kombinaci s virtuální adresou a/nebo zahraničním statutárním zástupcem, MUSÍTE to považovat za KRITICKÝ VAROVNÝ SIGNÁL (CRITICAL VAROVNÝ INDIKÁTOR). VÝJIMKA: Pokud se jedná o velkou společnost (tržby > 10 000 000 EUR nebo > 50 zaměstnanců), jsou časté změny jednatelů standardní rotací podnikového managementu, NIKOLI anomálií v struktuře vedení. V takovém případě tuto anomálii ignorujte a netrestejte ji. Pokud se výjimka neuplatní, výrazně snižte hodnotu `llm_score_adjustment` (např. o -10 bodů) a v položce `final_verdict` výslovně varujte před extrémním rizikem podvodu a takzvanou „anomálií v struktuře vedení“. Tyto anomálie zmiňte také v části `executive_summary`.''',
    'pl': '''```text
5. Złote klatki (ryzyko wyprowadzania majątku / odtoku kapitálu): Jeśli zauważysz wzrost przychodów przy jednoczesnym znacznym spadku gotówki oraz wzroście zobowiązań wobec powiązanych podmiotów, obniż ocenę w ramach swojego limitu. UWAGA: W przypadku międzynarodowych korporacji (grup takich jak Hyundai, Volkswagen, Siemens itp.) transakcje między podmiotami powiązanymi stanowią STANDARDOWY przepływ wewnątrzgrupowy (ceny transferowe, usługi wspólne). Nie należy karać za takie transakcje ani obniżać z tego powodu oceny. Nie używaj terminu „ryzyko odtoku kapitálu” w odniesieniu do takich rutynowych operacji. Zamiast tego zastosuj bardziej neutralny opis: „wysoki poziom transakcji z podmiotami powiązanymi”. Termin „odtok kapitálu” należy rezerwować wyłącznie dla przypadków, w których istnieją wyraźne dowody na niestandardowe warunki cenowe lub wybebeszanie majątku bez uzasadnienia gospodarczego.
6. BRAK DANYCH DOTYCZĄCYCH CASH FLOW: Na Słowacji wiele firm nie składa strukturalnego sprawozdania z przepływów pieniężnych (Cash Flow) do RÚZ (często stanowi ono część informacji dodatkowej w formacie PDF). Jeśli widzisz `operatingCashFlow: null` lub `operatingCashFlow: 0` dla firmy generującej dodatnie przychody i zysk, NIE uznawaj tego za sygnał ostrzegawczy (varovný indikátor) o charakterze śledczym ani za oznakę odtoku kapitálu. Zerowy lub brakujący przepływ pieniężny w danych oznacza, że „dane nie były dostępne w formie strukturalnej”, a NIE, że „firma ma zerowy przepływ pieniężny”. Należy to traktować jako ograniczenie dostępności danych, a nie ryzyko związane z przedsiębiorstwem.
7. KONTEKSTY BRANŻOWE (NACE): Podczas oceny należy wziąć pod uwagę kod NACE spółki. Handel hurtowy i detaliczny (NACE 46, 47) charakteryzują się strukturalnie niskimi marżami (0,5–3%) oraz wysokimi wskaźnikami zadłużenia ogólnego D/E (5–20), ponieważ jest to działalność typu „przepływowego” o wysokim obrocie i zobowiązaniach wobec dostawców. To, co w przypadku firmy produkcyjnej oznaczałoby kryzys, dla hurtowni jest stanem normalnym. Nie należy karać firm z tych segmentów za wysoki wskaźnik D/E lub niskie marže, o ile są rentowne i charakteryzują się stabilnym obrotem.
8. PRZYCHODY A AKTYWA: W przypadku firm produkcyjnych o wysokich obrotach (motoryzacja, handel hurtowy) powszechną sytuacją jest, że roczne przychody przewyższają aktywa ogółem. Przychody reprezentują strumień w ujęciu rocznym, natomiast aktywa stanowią stan zasobów w określonym punkcie w czasie. Nie należy traktować tego jako anomalii lub rozbieżności.
9. NIEAKTUALNA KLAUZULA CONTINGENCY / GOING CONCERN: Jeśli sprawozdania finansowe z poprzednich lat zawierały zastrzeżenia audytora (np. Going Concern), ale najnowszy rok jest „bez zastrzeżeń” (czysta opinia), oznacza to, że problem został rozwiązany. Nie należy karać spółki ani tworzyć krytycznego ryzyka z powodu nieaktualnych problemów z przeszłości.
10. ANOMALIE W STRUKTURZE ZARZĄDU I ANOMALIE W ORSR (Forensics ORSR): W sekcji `companyEvents` (lub w metadanych) możesz napotkać zdarzenie typu `FORENSIC_ANALYSIS` zatytułowane „Management Structure Anomaly (ORSR Anomaly)” lub podobne. Jeśli spółka wykazuje dużą częstotliwość zmian dyrektorów (np. >2 zmiany) połączoną z adresem wirtualnym i/lub zagranicznym organem reprezentującym, MUSISZ uznać to za KRYTYCZNY SYGNAŁ OSTRZEGAWCZY (CRITICAL VAROVNÝ INDIKÁTOR). WYJATEK: Jeśli jest to duża firma (przychody > 10 000 000 EUR lub > 50 pracowników), częste zmiany dyrektorów stanowią standardową rotację w zarządzie korporacji, a NIE ryzyko związane z anomalią w strukturze zarządu. W takim przypadku należy zignorować tę anomalię i nie nakładać kar. Jeśli wyjątek nie ma zastosowania, należy istotnie obniżyć wartość `llm_score_adjustment` (np. o -10 punktów), a w sekcji `final_verdict` wyraźnie ostrzec przed skrajnym ryzykiem oszustwa i tzw. „anomalią w strukturze zarządu”. Wspomniane anomalie należy również uwzględnić w sekcji `executive_summary`.''',
}

COMMON_TEXT_QUALITY_RULES = {
    'sk': '''- VŽDY používaj správnu slovenčinu: "dlžník" (nie "dižnik"), "dlžníkov" (nie "dižnikov"), "dlžníci" (nie "dižníci").
- SPRÁVNE NÁZVY INŠTITÚCIÍ: "Dôvera" (nie "Dövera"), "VšZP" (nie "VSZP"), "Dôvera — zdravotná poisťovňa" (nie "Dövera"). NIKDY nepoužívaj prehlásku "ö" v slovenských názvoch — na Slovensku sa píše "Dôvera", nie "Dövera". V zoznamoch dlžníkov vždy píš "Dôvera — dlžníci" (nie "Dôveradižníci", "Dôvera-dižníci", "Dövera-dlžníci").
- SPRÁVNE DĹŽNE V PRÁVNYCH TERMÍNOCH: "súdov" (nie "südov"), "rozhodnutia súdov" (nie "rozhodnutia südov"), "Register" (nie "Registier"), "Register dane z príjmov" (nie "Registier daň z príjmov").
- ŽIADNE ANGLICKÉ FRAGMENTY: V slovenskom texte NIKDY nepoužívaj anglické slová alebo fragmenty ako "Human ex", "Human resources", "Employee costs". Vždy použi slovenský ekvivalent: "Osobné náklady", "Personálne náklady", "Mzdové náklady". Ak píšeš nadpis sekcie, musí byť celý po slovensky.
- SPRÁVNY PREKLEP "FIRMA": Vždy píš "Firma" (nie "Fimra"). Skontroluj si preklepy v slovách, ktoré sa často zamieňajú: "Firma nemá" (nie "Fimra nemá").
- SPRÁVNE DĹŽNE: "existencie" (nie "existence"), "operatívnej" (nie "operativnej"), "administratívnej" (nie "administrativnej"), "disciplíne" (nie "discipline"), "finančné" (nie "financné"), "sú" (nie "su").
- POMLČKY: Namiesto spojovníka "-" s medzerami používaj dlhú pomlčku (en-dash "–"), napr. "354A, 355A – /391A/" nie "354A, 355A - /391A/".
- V texte NIKDY neuvádzaj historické názvy spoločností z registrov (CRZ, UVO). Vždy použi aktuálny oficiálny názov spoločnosti. Rôzne historické formy názvu (napr. "KIA Motors Slovakia" vs "Kia Slovakia") pri rovnakom IČO sú tá istá spoločnosť — neupozorňuj na ne ako na nezrovnalosť.
- V executive_summary a key_risk MUSÍŠ reflektovať významné medziročné zmeny z `analyza_trendov.revenue_trend`. Ak tržby poklesli o viac ako 5% YoY, výslovne to spomeň medzi rizikami alebo upozorneniami. Nepíš o "dlhodobej ziskovosti" ak existuje významný pokles tržieb v poslednom roku.
- Ak tržby prevyšujú aktíva (bežné pri výrobných firmách s vysokým obratom), výslovne vysvetli, že tržby sú prietok za rok zatiaľ čo aktíva sú stav k jednému dňu — nie je to anomália.
- NIKDY nepoužívaj LaTeX syntax v texte. Nepoužívaj znak "$" pre matematické vzorce. Namiesto "E/D=1.69" píš "E/D = 1,69" (s medzerami a slovenskou desatinnou čiarkou). Namiesto "Z''=8.47" píš "Z'' = 8,47". Nepoužívaj "\\prime", "^{...}", ani iné LaTeX príkazy.
- Čísla v texte vždy formátuj so slovenskou desatinnou čiarkou (1,69 nie 1.69) a medzerou ako oddeľovačom tisícov (1 000 000 nie 1000000).
- NADMERNÝ ODPOČET DPH: Pri exportne orientovaných výrobných spoločnostiach (automobilový priemysel, elektronika) je pravidelný a vysoký nadmerný odpočet DPH úplne štandardný a legálny jav. Firma nakupuje komponenty s DPH, ale vyváža hotové výrobky do zahraničia so 0 % sadzbou DPH, čo prirodzene vedie k nadmernému odpočtu. Nepovažuj to za daňové riziko ani varovný indikátor.
- ALTMAN Z'' PRE VEĽKOOBCHOD/DISTRIBÚCIU: Ak firma má nízku čistú maržu (< 2 %) a vysoké obchodné záväzky voči dodávateľom, Altman Z''-Score môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov. Pridaj upozornenie: "Metodika Altman Z'' nie je plne optimalizovaná pre nízkomaržový veľkoobchodný model s vysokým podielom obchodných záväzkov, preto môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov."
- ZÁLOŽNÉ PRÁVA NA OBCHODNÝ PODIEL: Ak v NCRZP vidíš záložné právo na obchodný podiel od banky (napr. UniCredit Bank, Tatra banka, Slovenská sporiteľňa), je to štandardné zabezpečenie prevádzkových úverov, nie známka platobnej neschopnosti. Neoznačuj to ako kritické riziko.
- REŠTRUKTURALIZÁCIA Z ORSR: Ak v ORSR výpise (sekcia "Ďalšie právne skutočnosti") vidíš zmienku o reštrukturalizácii, konkurze alebo odpustení dlhov — aj keď už skončila — MUSÍŠ to spomenúť v posudku. Napríklad: "Spoločnosť v rokoch 2022–2023 prešla formálnou reštrukturalizáciou, ktorá bola súdom úspešne ukončená." NIKDY nepíš "nemá záznamy o reštrukturalizácii" ak ORSR jasne uvádza, že prebehla. RKR (Register konkurzov a reštrukturalizácií) zobrazuje len aktuálne prebiehajúce konania — ak už skončilo, RKR ho nezobrazí, ale to neznamená, že sa nikdy nekonal.
- POČET ZAMESTNANCOV: Ak sú v dátach dostupné presné čísla (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), vždy ich použi presne — nepíš "viac ako 1000 zamestnancov" ak je presná hodnota napr. 1 292. Formuluj: "Priemerný počet zamestnancov dosiahol 1 292."
- DIVIDENDY: Výplata dividend alebo rozdelenie zisku vlastníkom NIE JE automaticky negatívny vplyv na likviditu. Je to štandardné rozdelenie vykázaného zisku. Ako negatívny faktor pre likviditu ju uvádzaj len vtedy, ak dividendy výrazne presahujú disponibilnú hotovosť alebo vytvárajú tlak na pracovný kapitál. Inak ju formuluj neutrálne: "Spoločnosť vyplatila dividendy 70 mil. EUR z vykázaného zisku."
- KRÁTKE OBDOBIA (< 12 mesiacov): Ak v dátach vidíš `monthsInPeriod` s hodnotou menšou ako 12, NEinterpretuj pokles tržieb alebo zisku oproti predchádzajúcemu 12-mesačnému obdobiu ako negatívny trend. Pokles z 3-mesačného obdobia oproti 12-mesačnému je matematický dôsledok kratšieho obdobia, nie zhoršenie podnikania. V executive_summary výslovne spomeň, že ide o skrátené účtovné obdobie (napr. "Závierka za rok 2024 pokrýva len 3 mesiace, preto nie je porovnateľná s predchádzajúcimi plnými rokmi"). V Pilieri 4 (Rast & Trendová sila) neupravuj skóre nadol za pokles tržieb, ak je obdobie kratšie ako 11 mesiacov.''',
    'en': '''- Always write in correct English.
- Use en-dash ("–") instead of hyphen "-" with spaces.
- NEVER mention historical company names from registries (CRZ, UVO). Always use the current official company name. Different historical forms of the name (e.g. "KIA Motors Slovakia" vs "Kia Slovakia") for the same IČO are the same company — do not flag them as discrepancies.
- In executive_summary and key_risk you MUST reflect significant year-over-year changes from `analyza_trendov.revenue_trend`. If revenue declined by more than 5% YoY, explicitly mention it among risks or warnings. Do not write about "long-term profitability" if there is a significant revenue decline in the latest year.
- If revenue exceeds assets (common in manufacturing with high turnover), explicitly explain that revenue is a flow over a year while assets are a stock at a single point in time — it is not an anomaly.
- NEVER use LaTeX syntax in text. Do not use the "$" sign for mathematical formulas. Instead of "E/D=1.69" write "E/D = 1.69" (with spaces). Instead of "Z''=8.47" write "Z'' = 8.47". Do not use "\\prime", "^{...}", or other LaTeX commands.
- Format numbers with a decimal point (1.69 not 1,69) and space as thousands separator (1,000,000 not 1000000).
- EXCESS VAT DEDUCTION: For export-oriented manufacturing companies (automotive, electronics), a regular and high excess VAT deduction is completely standard and legal. The company buys components with VAT but exports finished products at 0% VAT rate, which naturally leads to excess deduction. Do not consider this a tax risk or warning indicator.
- ALTMAN Z'' FOR WHOLESALE/DISTRIBUTION: If the company has a low net margin (< 2%) and high trade payables to suppliers, Altman Z''-Score may indicate false insolvency risk even for stable distribution leaders. Add a note: "The Altman Z'' methodology is not fully optimized for low-margin wholesale models with a high proportion of trade payables, so it may indicate false insolvency risk even for stable distribution leaders."
- PLEDGES ON EQUITY: If you see a pledge on equity from a bank (e.g. UniCredit Bank, Tatra banka, Slovenská sporiteľňa) in NCRZP, it is a standard collateral for operating loans, not a sign of insolvency. Do not flag it as critical risk.
- RESTRUCTURING FROM ORSR: If the ORSR extract (section "Other legal facts") mentions restructuring, bankruptcy or debt forgiveness — even if already completed — you MUST mention it in the assessment. For example: "The company underwent formal restructuring in 2022–2023, which was successfully completed by the court." NEVER write "has no records of restructuring" if ORSR clearly states it occurred. The Bankruptcy and Restructuring Register only shows currently ongoing proceedings — if it has ended, the register no longer shows it, but that does not mean it never happened.
- EMPLOYEE COUNT: If exact employee numbers are available in the data (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), always use them precisely. Do not write "more than 1000 employees" if the exact value is 1,292. Formulate: "Average number of employees reached 1,292."
- DIVIDENDS: Dividend payments or profit distribution to owners are NOT automatically a negative liquidity signal. This is standard distribution of reported profit. Only mention it as a negative liquidity factor if dividends significantly exceed available cash or put pressure on working capital. Otherwise describe it neutrally: "The company paid dividends of EUR 70 million from reported profit."
- SHORT PERIODS (< 12 months): If you see `monthsInPeriod` with a value less than 12, DO NOT interpret a decline in revenue or profit compared to the previous 12-month period as a negative trend. A decline from a 3-month period compared to a 12-month one is a mathematical consequence of the shorter period, not a deterioration of business. In executive_summary, explicitly mention that it is a shortened accounting period (e.g. "The 2024 financial statements cover only 3 months, so they are not comparable with previous full years"). In Pillar 4 (Growth & Trend Strength), do not adjust the score downward for revenue decline if the period is shorter than 11 months.''',
    'de': '''- Schreiben Sie immer in korrektem Deutsch.
- Verwenden Sie Gedankenstrich ("–") statt Bindestrich "-" mit Leerzeichen.
- NIE historische Firmennamen aus Registern erwähnen.
- NIE LaTeX-Syntax verwenden. Stattdessen "E/D = 1,69" (mit Leerzeichen und deutschem Dezimalkomma).
- Zahlen mit deutschem Dezimalkomma (1,69 nicht 1.69) und Leerzeichen als Tausendertrennzeichen (1 000 000).
- ÜBERSCHUSSIGER VORSTEUERABZUG: Bei exportorientierten Produktionsunternehmen ist ein regelmäßiger hoher Vorsteuerüberschuss völlig normal und legal.
- ALTMAN Z'' FÜR GROSSHANDEL/DISTRIBUTION: Bei niedriger Nettomarge (< 2%) kann Altman Z'' ein falsches Insolvenzrisiko anzeigen.
- PFANDRECHTE AN GESELLSCHAFTSANTEILEN: Pfandrechte an Geschäftsanteilen von Banken sind Standardbesicherungen für Betriebskredite.
- RESTRUKTURIERUNG AUS ORSR: Wenn das ORSR-Dokument Restrukturierung oder Konkurs erwähnt — auch wenn bereits abgeschlossen — MÜSSEN Sie dies erwähnen.
- MITARBEITERZAHL: Verwenden Sie immer die exakte Mitarbeiterzahl aus den Daten (`pocet_zamestnancov`, `priemernyPocetZamestnancov`). Schreiben Sie nicht "mehr als 1000 Mitarbeiter", wenn der exakte Wert z. B. 1.292 ist. Formulieren Sie: "Die durchschnittliche Mitarbeiterzahl betrug 1.292."
- DIVIDENDEN: Dividendenzahlungen oder Gewinnausschüttungen an Eigentümer sind KEIN automatisches negatives Liquiditätssignal. Es handelt sich um die standardmäßige Ausschüttung des ausgewiesenen Gewinns. Nennen Sie sie nur als negativen Liquiditätsfaktor, wenn die Dividenden das verfügbare Bargeld deutlich übersteigen oder den Working Capital Druck ausüben. Andernfalls formulieren Sie neutral: "Das Unternehmen zahlte Dividenden in Höhe von 70 Mio. EUR aus dem ausgewiesenen Gewinn."
- KURZE ZEITRÄUME (< 12 Monate): Bei `monthsInPeriod` < 12 nicht als negativen Trend interpretieren.''',
    'cz': '''- VŽDY používej správnou slovenštinu: "dlužník" (nie "dižnik"), "dlužníků" (nie "dižnikov"), "dlužníci" (nie "dižníci").
- SPRÁVNÉ NÁZVY INSTITUCÍ: "Dôvera" (nie "Dövera"), "VšZP" (nie "VSZP"), "Dôvera — zdravotná poisťovňa" (nie "Dövera"). NIKDY nepoužívej přehlásku "ö" v slovenských názvech — na Slovensku se píše "Dôvera", nie "Dövera". V seznamech dlužníků vždy piš "Dôvera — dlužníci" (nie "Dôveradižníci", "Dôvera-dižníci", "Dövera-dlžníci").
- SPRÁVNÉ DÉLKY V PRÁVNÍCH TERMÍNECH: "súdov" (nie "südov"), "rozhodnutia súdov" (nie "rozhodnutia südov"), "Register" (nie "Registier"), "Register dane z príjmov" (nie "Registier daň z príjmov").
- ŽÁDNÉ ANGLICKÉ FRAGMENTY: V slovenském textu NIKDY nepoužívej anglická slova nebo fragmenty jako "Human ex", "Human resources", "Employee costs". Vždy použij slovenský ekvivalent: "Osobné náklady", "Personálne náklady", "Mzdové náklady". Ak píšeš nadpis sekce, musí být celý po slovensky.
- SPRÁVNÝ PŘEKLEP "FIRMA": Vždy piš "Firma" (nie "Fimra"). Zkontroluj si překlepy v slovech, která se často zaměňují: "Firma nemá" (nie "Fimra nemá").
- SPRÁVNÉ DÉLKY: "existence" (nie "existence"), "operativní" (nie "operativnej"), "administrativní" (nie "administrativnej"), "disciplíně" (nie "discipline"), "finanční" (nie "financné"), "jsou" (nie "su").
- POMLČKY: Místo spojovníku "-" s mezerami používej dlouhou pomlčku (en-dash "–"), např. "354A, 355A – /391A/" nie "354A, 355A - /391A/".
- V textu NIKDY neuváděj historické názvy společností z registrů (CRZ, UVO). Vždy použij aktuální oficiální názv společnosti. Různé historické formy názvu (např. "KIA Motors Slovakia" vs "Kia Slovakia") při stejném IČO jsou tá istá společnost — neupozorňuj na ně jako na nezrovnalost.
- V executive_summary a key_risk MUSÍŠ reflektovat významné meziroční změny z `analyza_trendov.revenue_trend`. Ak tržby poklesly o více než 5% YoY, výslovně to spomeň mezi riziky nebo upozorněními. Nepíš o "dlouhodobé ziskovosti" ak existuje významný pokles tržieb v posledním roce.
- Ak tržby převyšují aktiva (běžné při výrobných firmách s vysokým obratem), výslovně vysvětli, že tržby jsou prietok za rok zatial čo aktíva jsou stav k jednomu dni — nie je to anomálie.
- NIKDY nepoužívej LaTeX syntax v textu. Nepoužívej znak "$" pro matematické vzorce. Místo "E/D=1.69" piš "E/D = 1,69" (s mezerami a slovenskou desetinnou čárkou). Místo "Z''=8.47" piš "Z'' = 8,47". Nepoužívej "\\prime", "^{...}", ani jiné LaTeX příkazy.
- Čísla v textu vždy formátuj se slovenskou desetinnou čárkou (1,69 nie 1.69) a mezerou jako oddělovačem tisíců (1 000 000 nie 1000000).
- NADMĚRNÝ ODPOČET DPH: Při exportně orientovaných výrobných společnostech (automobilový průmysl, elektronika) je pravidelný a vysoký nadmerný odpočet DPH úplně standardní a legální jev. Firma nakupuje komponenty s DPH, ale vyváží hotové výrobky do zahraničí so 0 % sadzbou DPH, čo prirodzene vedie k nadmernému odpočtu. Nepovažuj to za daňové riziko ani varovný indikátor.
- ALTMAN Z'' PRO VELKOOBCHOD/DISTRIBUCI: Ak firma má nízkou čistou marži (< 2 %) a vysoké obchodní závazky vůči dodavatelům, Altman Z''-Score může indikovat falešné riziko úpadku aj u stabilních distribučních lídrů. Přidej upozornění: "Metodika Altman Z'' nie je plne optimalizovaná pre nízkomaržový veľkoobchodný model s vysokým podielom obchodných záväzkov, preto môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov."
- ZÁLOŽNÍ PRÁVA NA OBCHODNÍ PODÍL: Ak v NCRZP vidíš záložné právo na obchodný podiel od banky (např. UniCredit Bank, Tatra banka, Slovenská sporiteľňa), je to štandardné zabezpečenie prevádzkových úverov, nie známka platobnej neschopnosti. Neoznačuj to jako kritické riziko.
- REŠTRUKTURALIZÁCIA Z ORSR: Ak v ORSR výpise (sekce "Ďalšie právne skutočnosti") vidíš zmínku o reštrukturalizácii, konkurze nebo odpustení dlhů — aj keď už skončila — MUSÍŠ to spomenúť v posudku. Například: "Spoločnosť v rokoch 2022–2023 prešla formálnou reštrukturalizáciou, ktorá bola súdom úspešne ukončená." NIKDY nepíš "nemá záznamy o reštrukturalizácii" ak ORSR jasne uvádza, že prebehla. RKR (Register konkurzov a reštrukturalizácií) zobrazuje len aktuálne prebiehajúce konania — ak už skončilo, RKR ho nezobrazí, ale to neznamená, že sa nikdy nekonal.
- POČET ZAMESTNANCŮ: Ak jsou v datech dostupné přesné čísla (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), vždy je použi přesně — nepíš "více než 1000 zaměstnanců" ak je přesná hodnota např. 1 292. Formuluj: "Priemerný počet zamestnancov dosiahol 1 292."
- DIVIDENDY: Výplata dividend nebo rozdělení zisku vlastníkům NENÍ automaticky negativní vliv na likviditu. Je to standardní rozdělení vykázaného zisku. Jako negativní faktor pro likviditu ju uvádaj len vtedy, ak dividendy výrazne presahujú disponibilnú hotovosť alebo vytvárajú tlak na pracovný kapitál. Inak ju formuluj neutrálne: "Spoločnosť vyplatila dividendy 70 mil. EUR z vykázaného zisku."
- KRÁTKÉ OBDOBÍ (< 12 měsíců): Ak v datech vidíš `monthsInPeriod` s hodnotou menší než 12, NEinterpretuj pokles tržieb nebo zisku oproti predchádzajúcemu 12-mesačnému obdobiu jako negativní trend. Pokles z 3-mesačného obdobia oproti 12-mesačnému je matematický dôsledok kratšieho obdobia, nie zhoršenie podnikania. V executive_summary výslovne spomeň, že jde o skrátené účtovné období (např. "Závierka za rok 2024 pokrýva len 3 mesiace, preto nie je porovnateľná s predchádzajúcimi plnými rokmi"). V Pilieri 4 (Rast & Trendová sila) neupravuj skóre nadol za pokles tržieb, ak je období kratšie než 11 měsíců.''',
    'hu': '''- Mindig helyes magyar nyelven írjon.
- Namiesto spojovníka "-" s medzerami používajte en-dash ("–").
- NIKDY nespomínajte historické názvy spoločností z registrov (CRZ, ÚVO). Vždy používajte aktuálny oficiálny názov spoločnosti. Rôzne historické formy názvu (napr. „KIA Motors Slovakia“ vs „Kia Slovakia“) pre to isté IČO predstavujú tú istú spoločnosť – neoznačujte ich ako nesrovnalosti.
- V položkách `executive_summary` a `key_risk` MUSÍTE zohľadniť významné medziročné zmeny z premennej `analyza_trendov.revenue_trend`. Ak tržby medziročne klesli o viac ako 5 %, explicitne to uveďte medzi rizikami alebo varovaniami. Nepíšte o „dlhodobej ziskovosti“, ak v poslednom roku nastal výrazný pokles tržieb.
- Ak tržby presahujú aktíva (bežné v strojárstve a výrobe s vysokým obratom), explicitne vysvetlite, že tržby predstavujú tok (flow) za rok, zatiaľ čo aktíva predstavujú stav (stock) v jednom časovom bode – nejde o anomáliu.
- NIKDY nepoužívajte syntax LaTeXu v texte. Nepoužívajte znak „$“ pre matematické vzorce. Namiesto „E/D=1.69“ napíšte „E/D = 1.69“ (s medzerami). Namiesto „Z''=8.47“ napíšte „Z'' = 8.47“. Nepoužívajte príkazy „\\prime“, „^{...}“ ani iné príkazy LaTeXu.
- Formátujte čísla s desatinnou bodkou (1.69 nie 1,69) a medzerou ako oddeľovačom tisícov (1,000,000 nie 1000000).
- NADMERNÝ ODPOČET DPH: Pre exportne orientované výrobné spoločnosti (automobilový priemysel, elektrotechnika) je pravidelný a vysoký nadmerný odpočet DPH úplne štandardný a legálny. Spoločnosť nakupuje komponenty s DPH, avšak hotové výrobky vyváža s 0% sadzbou DPH, čo prirodzene vedie k nadmernému odpočtu. Nepovažujte to za daňové riziko ani varovný signál.
- ALTMANOV Z'' PRE VEĽKOOBCHOD/DISTRIBÚCIU: Ak má spoločnosť nízku čistú maržu (< 2 %) a vysoké záväzky voči dodávateľom, Altmanov Z''-skóre môže indikovať falošné riziko insolvencie aj v prípade stabilných distribučných lídrov. Pridajte poznámku: „Metodológia Altmanovho Z'' nie je plne optimalizovaná pre nízkomaržové veľkoobchodné modely s vysokým podielom obchodných záväzkov, takže môže indikovať falošné riziko insolvencie aj pri stabilných distribučných lídroch.“
- ZÁLOHY NA MAJETOK (PLEDGES ON EQUITY): Ak v Notárskom registri záložných práv (NCRZP) zaznamenáte záložné právo na obchodný podiel od banky (napr. UniCredit Bank, Tatra banka, Slovenská sporiteľňa), ide o štandardné zabezpečenie prevádzkových úverov, nie o znak insolvencie. Neoznačujte to ako kritické riziko.
- RESTRUKTURALIZÁCIA Z ORSR: Ak výpis z ORSR (sekcia „Ostatné právne skutočnosti“) uvádza reštrukturalizáciu, konkurz alebo oddlženie – aj keď sú už ukončené – MUSÍTE to spomenúť v hodnotení. Napríklad: „Spoločnosť prešla v rokoch 2022–2023 formálnou reštrukturalizáciou, ktorú súd úspešne ukončil.“ NIKDY nepíšte „nemá žiadne záznamy o reštrukturalizácii“, ak ORSR jasne uvádza, že k nej došlo. Register úpadcov a reštrukturalizácií zobrazuje iba aktuálne prebiehajúce konania – ak sa skončilo, register ho už nezobrazuje, čo však neznamená, že k nemu nikdy nedošlo.
- POČET ZAMESTNANCOV: Ak sú v údajoch k dispozícii presné počty zamestnancov (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), vždy ich používajte presne. Nepíšte „viac ako 1000 zamestnancov“, ak je presná hodnota 1 292. Formulujte: „Priemerný počet zamestnancov dosiahol 1 292.“
- DIVIDENDY: Výplata dividend alebo rozdelenie zisku vlastníkom NIE JE automaticky negatívnym signálom likvidity. Ide o štandardnú distribúciu vykázaného zisku. Spomeňte to ako negatívny faktor likvidity iba vtedy, ak dividendy výrazne prevyšujú dostupné peňažné prostriedky alebo vytvárajú tlak na pracovný kapitál. V opačnom prípade to popíšte neutrálne: „Spoločnosť vyplatila dividendy vo výške 70 miliónov EUR z vykázaného zisku.“
- KRÁTKE OBDOBIA (< 12 mesiacov): Ak má parameter `monthsInPeriod` hodnotu menšiu ako 12, NEINTERPRETUJTE pokles tržieb alebo zisku v porovnaní s predchádzajúcim 12-mesačným obdobím ako negatívny trend. Pokles z 3-mesačného obdobia v porovnaní s 12-mesačným je matematickým dôsledkom kratšieho obdobia, nie zhoršením podnikania. V položke `executive_summary` explicitne uveďte, že ide o skrátené účtovné obdobie (napr. „Účtovná závierka za rok 2024 pokrýva iba 3 mesiace, preto nie je porovnateľná s predchádzajúcimi celými rokmi“). V Pilieri 4 (Rast a sila trendu) neznižujte skóre za pokles tržieb, ak je obdobie kratšie ako 11 mesiacov.''',
    'pl': '''```text
- Zawsze pisz w poprawnej polszczyźnie.
- Zamiast łącznika "-" z spacjami używaj myślnika ("–").
- NIGDY nie wspominaj historycznych nazw spółek z rejestrów (CRZ, UVO). Zawsze używaj aktualnej oficjalnej nazwy spółki. Różne historyczne formy nazwy (np. "KIA Motors Slovakia" vs "Kia Slovakia") dla tego samego IČO to ta sama spółka — nie oznaczaj ich jako rozbieżności.
- W sekcjach executive_summary i key_risk MUSISZ uwzględnić znaczące zmiany roczne z `analyza_trendov.revenue_trend`. Jeśli przychody spadły r/r o więcej niż 5%, wyraźnie wspomnij o tym w ryzykach lub ostrzeżeniach. Nie pisz o "długoterminowej zyskowności", jeśli w ostatnim roku nastąpił znaczący spadek przychodów.
- Jeśli przychody przewyższają aktywa (częste w produkcji o wysokim obrocie), wyraźnie wyjaśnij, że przychody reprezentują przepływ za rok, podczas gdy aktywa to stan w jednym punkcie czasowym — to nie jest anomalia.
- NIGDY nie używaj składni LaTeX w tekście. Nie używaj znaku "$" dla wzorów matematycznych. Zamiast "E/D=1.69" napisz "E/D = 1.69" (ze spacjami). Zamiast "Z''=8.47" napisz "Z'' = 8.47". Nie używaj "\\prime", "^{...}" ani innych poleceń LaTeX.
- Formatuj liczby z kropką dziesiętną (1.69 zamiast 1,69) i spacją jako separatorem tysięcy (1 000 000 zamiast 1000000).
- NADMIEROWY ODLICZENIE VAT: Dla firm produkcyjnych zorientowanych na eksport (motoryzacja, elektronika) regularne i wysokie nadmierne odliczenie VAT jest całkowicie standardowym i legalnym zjawiskiem. Firma kupuje komponenty z VAT, ale wywozi gotowe produkty z 0% stawką VAT, co naturalnie prowadzi do nadmiernego odliczenia. Nie uznawaj tego za ryzyko podatkowe ani sygnał ostrzegawczy.
- ALTMAN Z'' DLA HANDELU HURTOWEGO/DYSTRYBUCJI: Jeśli spółka ma niską marżę netto (< 2%) i wysokie zobowiązania handlowe wobec dostawców, wynik Altman Z'' może wskazywać fałszywe ryzyko upadłości nawet u stabilnych liderów dystrybucji. Dodaj uwagę: "Metodologia Altman Z'' nie jest w pełni zoptymalizowana dla niskomarżowego modelu hurtowego z wysokim udziałem zobowiązań handlowych, dlatego może wskazywać fałszywe ryzyko upadłości nawet u stabilnych liderów dystrybucji."
- ZASTAWY NA UDZIAŁY: Jeśli w rejestrze NCRZP widzisz prawo zastawu na udział/akcje od banku (np. UniCredit Bank, Tatra banka, Slovenská sporiteľňa), jest to standardowe zabezpieczenie kredytów operacyjnych, nie znak niewypłacalności. Nie oznaczaj tego jako krytyczne ryzyko.
- RESTRUKTURYZACJA Z ORSR: Jeśli wyciąg z ORSR (sekcja "Inne okoliczności prawne") wskazuje restrukturyzację, upadłość lub umorzenie długów — nawet jeśli już zakończone — MUSISZ o tym wspomnieć w ocenie. Np.: "Spółka przeszła formalną restrukturyzację w latach 2022–2023, którą sąd zakończył pomyślnie." NIGDY nie pisz "brak zapisów o restrukturyzacji", jeśli ORSR jasno wskazuje, że miała miejsce. Rejestr upadłości i restrukturyzacji wyświetla tylko bieżące postępowania — jeśli się zakończyło, rejestr go nie pokazuje, ale to nie oznacza, że nigdy nie miało miejsca.
- LICZBA PRACOWNIKÓW: Jeśli w danych dostępne są dokładne liczby pracowników (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), zawsze używaj ich dokładnie. Nie pisz "ponad 1000 pracowników", jeśli dokładna wartość to np. 1 292. Sformułuj: "Średnia liczba pracowników osiągnęła 1 292."
- DYWIDENDY: Wypłata dywidend lub podział zysku między właścicieli NIE JEST automatycznie negatywnym sygnałem dla płynności. Jest to standardowa dystrybucja wykazanego zysku. Wspomnij o tym jako o negatywnym czynniku płynności tylko wtedy, gdy dywidendy znacząco przekraczają dostępną gotówkę lub wywierają presję na kapitał obrotowy. W przeciwnym razie opisz to neutralnie: "Spółka wypłaciła dywidendy w wysokości 70 mln EUR z wykazanego zysku."
- KRÓTKIE OKRESY (< 12 miesięcy): Jeśli widzisz `monthsInPeriod` z wartością mniejszą niż 12, NIE WYNIKAJ spadku przychodów lub zysku w porównaniu z poprzednim okresem 12-miesięcznym jako negatywny trend. Spadek z okresu 3-miesięcznego w porównaniu z 12-miesięcznym jest matematycznym skutkiem krótszego okresu, nie pogorszeniem działalności. W sekcji executive_summary wyraźnie zaznacz, że jest to skrócony okres sprawozdawczy (np. "Sprawozdanie za rok 2024 obejmuje tylko 3 miesiące, dlatego nie jest porównywalne z poprzednimi pełnymi latami"). W Filarze 4 (Wzrost i siła trendu) nie obniżaj wyniku za spadek przychodów, jeśli okres jest krótszy niż 11 miesięcy.''',
}

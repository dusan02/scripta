# Kontrolný report: RÚZ JSON parser pre SK GAAP

## Cieľ
Nahradiť LLM extrakciu numerických dát z SK GAAP výkazov priamo parsovaním štruktúrovaného JSONu z RÚZ API. IFRS zostáva na LLM.

## Zmenené súbory

- `worker/src/ruz_parser.py` — **nový parser**
- `worker/src/ruz_api.py` — integrácia parseru, ukladanie `.metrics.json` sidecaru
- `worker/src/pipeline.py` — hybridný tok: SK GAAP s sidecarom preskočí LLM
- `worker/src/db_repository.py` — neprepisovať reálny audítorský názor placeholderom

## Mapping RÚZ šablóna 699 → FinancialMetrics

### Strana aktív (tabuľka 0, riadky 1–78, offset = 1)
| `cisloRiadku` | Text | `FinancialMetrics` pole | Poznámka |
|---|---|---|---|
| 1 | SPOLU MAJETOK | `celkove_aktiva` | Netto 2 = bežné obdobie |
| 33 | Obežný majetok | `obezny_majetok` | |
| 34 | Zásoby súčet | `zasoby` | |
| 53 | Krátkodobé pohľadávky súčet | - | medzisúčet |
| 54 | Pohľadávky z obchodného styku súčet | `pohladavky_z_obchodneho_styku` | |
| 71 | Finančné účty | `peniaze_a_penazne_ekvivalenty_k_31_12` | fallback pre cash |
| 72 | Peniaze | `peniaze_a_penazne_ekvivalenty_k_31_12` | použije sa ak existuje |

### Strana pasív (tabuľka 1, riadky 79–145, offset = 79)
| `cisloRiadku` | Text | `FinancialMetrics` pole |
|---|---|---|
| 80 | Vlastné imanie | `vlastne_imanie_celkom` |
| 101 | Záväzky | - | kontrolný súčet |
| 102 | Dlhodobé záväzky súčet | `dlhodobe_zavazky` |
| 122 | Krátkodobé záväzky súčet | `kratkodobe_zavazky` |
| 123 | Záväzky z obchodného styku súčet | `zavazky_z_obchodneho_styku` |
| 131 | Záväzky voči zamestnancom | `zavazky_zamestnanci` |
| 132 | Záväzky zo sociálneho poistenia | `zavazky_sp` |
| 133 | Daňové záväzky a dotácie | `danove_zavazky` |

### Výkaz ziskov a strát (tabuľka 2, riadky 1–61, offset = 1)
| `cisloRiadku` | Text | `FinancialMetrics` pole |
|---|---|---|
| 1 | Čistý obrat | `trzby_z_hlavnej_cinnosti` |
| 2 | Výnosy z hospodárskej činnosti spolu | fallback pre `trzby_z_hlavnej_cinnosti` |
| 15 | Osobné náklady | `osobne_naklady` |
| 21 | Odpisy a opravné položky | `odpisy` |
| 28 | Pridaná hodnota | `hruba_marza` (proxy) |
| 49 | Nákladové úroky | `uroky` |
| 61 | Výsledok hospodárenia po zdanení | `zisk_alebo_strata_po_zdaneni` |

Indexovanie `data[]` v JSONe: `data[cisloRiadku - offset]`.

## Logika integrácie

1. `ruz_api._process_zavierka` po stiahnutí všetkých `vykazy` pre ne-konsolidovanú závierku zavolá `ruz_parser.parse_zavierka_to_metrics`.
2. Ak parser vráti `FinancialMetrics`, uloží sa `.metrics.json` sidecar vedľa `.txt` súboru (`IFRS_ico_rok_idx.txt` → `IFRS_ico_rok_idx.metrics.json`).
3. `pipeline._process_ifrs` pri `.txt` súbore najskôr skúsi načítať `.metrics.json`. Ak existuje, vytvorí `CompanyFinancialExtraction` priamo z parseru a **preskočí LLM**.
4. `.pdf` súbory s `"notes"` v názve (RÚZ prílohy k SK GAAP — audítorské správy/poznámky) sa preskočia v `_process_ifrs`, aby prázdne LLM metriky neprepísali parsované dáta. Poznámky spracuje `_process_notes`.
5. `db_repository.save_to_db` neuloží/aktualizuje `auditoropinion`, ak `nazor_auditora` je placeholder ("Neznámy" a pod.).

## Sanity checks v parseri

- `assets ≈ equity + shortTermLiabilities + longTermLiabilities` (tolerancia 1% alebo 1 EUR)
- `trzby_z_hlavnej_cinnosti` a `osobne_naklady` nesmú byť záporné

## Nájdené a opravené chyby

| # | Chyba | Oprava |
|---|---|---|
| 1 | `_extract_row_value` predpokladal len plné riadky s labelmi; pri data-only formáte by vrátilo `None` | detekcia `len(row)` a offsetu dátových stĺpcov |
| 2 | `_to_float` nerozoznávalo viaceré formáty čísel (desatinná čiarka, medzery ako tisíc oddeľovače, zmiešané) | robustná normalizácia reťazca |
| 3 | extrakcia roka z `obdobieDo[:4]` zlyhá na ne-ISO dátumoch | regex `20\d{2}` |
| 4 | `_sanity_check` obsahoval nepoužitý/mŕtvy kód a slabú kontrolu bilancie | vyčistené, porovnáva `assets` vs `equity + total_liabilities` |
| 5 | `metrics_to_extraction` používalo `"IČO {ico}"` ako placeholder, ktorý `save_to_db` **nepoznalo** → prepísalo by sa meno firmy | zmenené na `"Spoločnosť s IČO {ico}"` |
| 6 | parsed metriky s `audit=Neznámy` by v `save_to_db` prepísali reálny audítorský názor z notes PDF | pridaná `_is_unknown_auditor_opinion` a guard v `save_to_db` |
| 7 | `ruz_api.py` držal `_parsed_metrics_holder` zbytočne | zjednodušené na lokálnu `parsed_metrics` |
| 8 | notes PDF by v `pipeline._process_ifrs` spustilo LLM a prázdne metriky by mohli prepísať parsované | pridaný `return` pre `.pdf` s `"notes"` v názve |

## Zostávajúce riziká / otázky na overenie

1. **Formát `data[]` v reálnom RÚZ JSONe** nie je overený priamo. Parser podporuje dve varianty (plné riadky aj data-only), ale overiť treba.
2. **Ďalšie šablóny** — zatiaľ podporovaná len **699 (Úč POD)**. ROPO (id 2), FNM (id 3), mikro jednotky, konsolidované atď. nie sú mapované.
3. **Cash flow** — `ciste_penazne_toky_z_prevadzkovej_cinnosti`, `investicny_cash_flow`, `financny_cash_flow` zostávajú `None`, pretože šablóna 699 neobsahuje cash flow výkaz. Použije sa existujúci `estimate_missing_cash_flow`.
4. **Audítorský názor pre SK GAAP** — momentálne sa neextrahuje z notes PDF (poskočené v `_process_ifrs`); `auditoropinion` ostane prázdny kým sa nepridá samostatná extrakcia.
5. **Škálovanie jednotiek** — predpokladá sa, že RÚZ JSON vracia hodnoty v EUR, nie v tisícoch. Overiť.
6. **Negatívne hodnoty** — `_to_float` nekonvertuje zátvorkovú notáciu `(1234)` na `-1234`. Ak RÚZ používa zátvorky pre záporné hodnoty, treba doplniť.
7. **Konsolidované závierky** — parser sa spúšťa len ak `konsolidovana == False`. Ak RÚZ vracia konsolidovanú SK GAAP, pôjde stále cez LLM.
8. **Paralelné zápisy** — `save_to_db` používa `asyncio.Lock`, ale v pipeline môže nastať race medzi `.txt` parsed dátami a `.pdf` notes. Notes PDF je teraz preskočené, takže toto riziko je eliminované.

## Odporúčané testy

1. Spustiť `python -m pytest` / príslušné testy v projekte.
2. Na hostovskom stroji spustiť `download_ifrs_reports` pre test IČO `31333532` a overiť, že sa vytvorí `.metrics.json` sidecar.
3. Porovnať `FinancialMetrics` z parseru s predchádzajúcim LLM výstupom pre to isté IČO/roky.
4. Skontrolovať logy sanity checks: `Balance sheet mismatch` by mal byť minimálny alebo žiadny.
5. Overiť `auditoropinion` tabuľku — pre SK GAAP by nemala obsahovať `Neznámy` z parsovaných metrík.

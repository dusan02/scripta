# Report: Ako funguje RÚZ scraper a parser — kód a logika pre iné LLM

> **Verzia:** 2.0 — aktualizovaná po implementácii vylepšení (júl 2026)

## 1. Cieľ a kontext

Tento report opisuje **kompletný flow** sťahovania a parsovania účtovných závierok zo systému **RÚZ (Register účtovných závierok)** — od scraper fázy cez RÚZ Open API až po deterministický JSON parser.

- **Vstup:** IČO firmy → RÚZ Open API (`/api/uctovne-jednotky`, `/api/uctovna-zavierka`, `/api/uctovny-vykaz`), konkrétne `obsah.tabulky` a `obsah.titulnaStrana`.
- **Výstup:** `FinancialMetrics` Pydantic model → `.metrics.json` sidecar → DB tabuľka `FinancialStatement`.
- **Prečo:** Nahradzuje LLM extrakciu pre SK GAAP, kde sú dáta štruktúrované. IFRS/konsolidované závierky zostávajú na LLM (tie prichádzajú ako PDF).

## 2. Architektúra a scraper flow

```
Report Request (IČO)
  │
  ├─ 1. Scraper fáza (main.py → scrapers/registeruz.py)
  │    └─ RegisterUzScraper.run()
  │         └─ ruz_api.download_ifrs_reports(ico, max_years=_cfg.ruz_max_years)
  │              ├─ Cache check (24h TTL v assets/{ico}/)
  │              ├─ API: uctovne-jednotky?ico=… → entity_id
  │              ├─ API: uctovna-jednotka?id=… → zavierka_ids + vs_ids
  │              ├─ Sort by period (newest first) + dedup → top max_years
  │              ├─ Parallel: _process_zavierka() per závierka
  │              │    ├─ Fetch uctovny-vykaz pre každý výkaz
  │              │    ├─ If tabs exist & have data → _format_vykaz_tables() → .txt
  │              │    ├─ If tabs exist but EMPTY → fallback: _download_prilohy() → PDF
  │              │    ├─ If no tabs → _download_prilohy() → PDF
  │              │    ├─ SK GAAP (nekonsolidované): parse_zavierka_to_metrics() → .metrics.json sidecar
  │              │    └─ IFRS/konsolidované: len PDF (LLM extrakcia neskôr)
  │              └─ Parallel: _process_vs() per výročná správa → PDF
  │
  ├─ 2. Pipeline fáza (pipeline.py → process_company)
  │    └─ _process_ifrs() per súbor:
  │         ├─ .txt s .metrics.json → fast path (preskočí LLM)
  │         ├─ .txt bez sidecar → LLM extrakcia (fallback)
  │         ├─ _notes.pdf → preskočí (auditor/poznámky)
  │         └─ IFRS .pdf → LLM extrakcia + verifikácia
  │
  └─ 3. Uloženie do DB (db_repository.py)
       └─ FinancialMetrics → FinancialStatement (upsert by ico+year)
```

### Kľúčové súbory

| Súbor | Úloha |
|-------|-------|
| `src/scrapers/registeruz.py` | RegisterUzScraper — volá ruz_api.download_ifrs_reports(), vracia ScrapedSource. |
| `src/ruz_api.py` | RÚZ Open API klient: entity lookup, paralelný download, JSON → .txt, PDF prílohy, cache (24h). |
| `src/ruz_parser.py` | Deterministický parser: parse_tables_to_metrics, _estimate_cf, _to_float, _get_row, sanity checks, sidecar. |
| `src/pipeline.py` | _process_ifrs — fast path cez .metrics.json sidecar alebo LLM pre IFRS. |
| `src/db_repository.py` | Mapuje FinancialMetrics → DB FinancialStatement; chráni AuditorOpinion. |
| `src/config.py` | ruz_max_years = 5 — config override (default funkcie download_ifrs_reports je 10). |

## 3. Dátové formáty RÚZ JSON (šablóna 699)

RÚZ API vracia `obsah.tabulky` v dvoch formátoch:

### Formát A: List-of-lists (do 2024)

```json
{
  "nazov": {"sk": "Strana aktív"},
  "data": [
    ["A.", "SPOLU AKTÍVA", "1", "1234", "0", "1234", "1100"],
    ...
  ]
}
```

- **Strana aktív** (cisloRiadku 1–78): 7 stĺpcov: [Označenie, Text, Číslo, Brutto, Korekcia, Netto2(curr), Netto3(prev)].
- **Strana pasív** (cisloRiadku 79–145): 5 stĺpcov: [Označenie, Text, Číslo, Bežné, Predchádzajúce].
- **Výkaz ziskov a strát** (cisloRiadku 1–61): 5 stĺpcov ako pasíva.

### Formát B: Flat array (2025+)

```json
{
  "nazov": {"sk": "Strana aktív"},
  "rows": 0,
  "data": [52184858, 26149900, 26034958, 11000000, ...]
}
```

- **Strana aktív**: 312 skalárov = 78 riadkov × 4 dátové stĺpce (Brutto, Korekcia, Netto2, Netto3).
- **Strana pasív**: 134 skaláry = 67 riadkov × 2 dátové stĺpce (Bežné, Predchádzajúce).
- **Výkaz ziskov a strát**: 122 skalárov = 61 riadkov × 2 dátové stĺpce.

Parser deteguje formát podľa `isinstance(data[0], list)` a automaticky prerába flat array na riadky pomocou `data_cols` parametra.

### Prázdne tabuľky

Ak `tabulky` má 0 riadkov aj 0 dát → scraper stiahne PDF prílohy ako fallback.

## 4. Mapovanie riadkov → FinancialMetrics

### Strana aktív (table 0, offset = 1)

| cisloRiadku | Text | FinancialMetrics pole | Stĺpec |
|---|---|---|---|
| 1 | SPOLU AKTÍVA | celkove_aktiva | Netto2 (col 2 z 4) |
| 33 | Obežný majetok | obezny_majetok | Netto2 |
| 34 | Zásoby | zasoby | Netto2 (curr), Netto3 (prev→OCF) |
| 54 | Pohľadávky z obch. styku | pohladavky_z_obchodneho_styku | Netto2 (curr), Netto3 (prev→OCF) |
| 72 | Peniaze | peniaze_a_penazne_ekvivalenty_k_31_12 | Netto2 |

### Strana pasív (table 1, offset = 79)

| cisloRiadku | Text | FinancialMetrics pole | Stĺpec |
|---|---|---|---|
| 80 | Vlastné imanie celkom | vlastne_imanie_celkom | Bežné (col 0 z 2) |
| 102 | Dlhodobé záväzky súčet | dlhodobe_zavazky | Bežné |
| 122 | Krátkodobé záväzky súčet | kratkodobe_zavazky | Bežné |
| 123 | Záväzky z obch. styku | zavazky_z_obchodneho_styku | Bežné (curr), Predch. (prev→OCF) |
| 131 | Záväzky voči zamestnancom | zavazky_zamestnanci | Bežné |
| 132 | Záväzky zo soc. poistenia | zavazky_sp | Bežné |
| 133 | Daňové záväzky a dotácie | danove_zavazky | Bežné |

### Výkaz ziskov a strát (table 2, offset = 1)

| cisloRiadku | Text | FinancialMetrics pole |
|---|---|---|
| 1 | Čistý obrat | trzby_z_hlavnej_cinnosti |
| 2 | Výnosy z hosp. činnosti | fallback pre trzby_z_hlavnej_cinnosti |
| 10 | Náklady na predaný tovar | vstup do hruba_marza (Tržby - COGS) |
| 15 | Osobné náklady | osobne_naklady |
| 21 | Odpisy | odpisy (+ vstup do OCF odhadu) |
| 28 | Pridaná hodnota | fallback pre hruba_marza (ak COGS chýba) |
| 49 | Nákladové úroky | uroky |
| 61 | Výsledok po zdanení | zisk_alebo_strata_po_zdaneni (+ vstup do OCF odhadu) |

## 5. Kľúčové funkcie

### `_to_float` — normalizácia čísel

Podporuje:
- "1 234 567,89" → 1234567.89
- "1,234.56" → 1234.56 (EN formát, detekcia cez rfind)
- "1.234,56" → 1234.56 (SK formát)
- "(1 234)" → -1234.0 (zátvorková notácia)
- prázdne, None, medzery → None

### `_get_row` — detekcia flat vs list-of-lists

```python
def _get_row(tables, table_idx, cislo_riadku, offset, data_cols=0):
    # Flat: start = (cisloRiadku - offset) * data_cols
    # List: data[cisloRiadku - offset]
```

**`data_cols` je povinný** pre správnu detekciu flat formátu.

### `_identify_tables` — detekcia tabuliek podľa názvu

Vyhľadáva substrings (case-insensitive). Ak aktív/pasív chýba, **zaloguje WARNING** so zoznamom dostupných názvov — uľahčuje debugovanie.

### `_estimate_cf` — nepriamy odhad operating CF *(nové)*

```python
def _estimate_cf(net_profit, depreciation,
                 inventory_curr, inventory_prev,
                 receivables_curr, receivables_prev,
                 payables_curr, payables_prev) -> Optional[float]:
    """CF ≈ Net Profit + Depreciation − ΔInventory − ΔReceivables + ΔPayables"""
```

- Vracia None ak net_profit alebo depreciation chýba.
- Čiastočné WC dáta: aplikuje dostupné delty.
- Prev-period hodnoty sú priamo v JSON závierky (Netto3/Predchádzajúce stĺpce).

## 6. Hlavný parser `parse_tables_to_metrics`

Flow:
1. `_identify_tables` → zoradí tabuľky
2. Extrakcia roku → **validácia: ak rok > current_year + 1, vráti None** *(nové)*
3. **Unit detection**: `assets < 5000` a `zamestnancov > 5` → ×1000 *(zlepšené: bolo < 1000, > 10)*
4. Extrakcia metrík (current period)
5. **OCF odhad** z prev-period hodnôt (Netto3/Predchádzajúce) *(nové)*
6. Aplikácia unit_multiplier
7. Zostavenie FinancialMetrics — `ciste_penazne_toky_z_prevadzkovej_cinnosti = estimated_ocf`
8. **2-tier sanity check** *(zlepšené)*

### Verejné API parsera

```python
# Hlavná funkcia — spracuje všetky výkazy jednej závierky
parse_zavierka_to_metrics(vykazy: list[dict], ico: str, titulna_strana: Optional[dict] = None)

# Nízkoúrovňová funkcia — iba tabuľky + titulná strana
parse_tables_to_metrics(tables: list[dict], titulna_strana: dict, ico: str)

# Interný helper (súkromný)
_parse_single_vykaz(vykaz: dict, ico: str)
```

## 7. Sanity checks (2-tier)

| Prah | Správa | Dôvod |
|---|---|---|
| rel ≤ 5% | Žiadny warning | OK — ostatné pasíva sú malé |
| 5% < rel ≤ 15% | "Balance sheet minor gap … likely accruals" | Bežné pre firmy s časovým rozlíšením |
| rel > 15% | "Balance sheet large mismatch … possible parsing error" | Pravdepodobná chyba parsera |

*Poznámka: Parser zachytáva len ST + LT záväzky. Riadky 140-145 (ostatné pasíva) nie sú mapované.*

## 8. ruz_api — zmeny

### `ftype` — opravené pomenovanie súborov *(opravené)*

```python
konsolidovana = z.get("konsolidovana", False)
ftype = "IFRS" if konsolidovana else "SKGAAP"   # bolo vždy "IFRS"
```

Súbory sa teraz správne pomenúvajú:
- SK GAAP: `SKGAAP_{ico}_{year}_{idx}.txt` + `.metrics.json`
- IFRS: `IFRS_{ico}_{year}_{idx}.pdf`

### Odstránená duplicitná extrakcia záväzkov *(opravené)*

Blok `# Extrakcia štátnych záväzkov zo šablóny Úč POD` v `_format_vykaz_tables` bol odstránený. Záväzky voči zamestnancom, SP a štátu sú teraz dostupné výhradne cez `ruz_parser.py` sidecar mechanizmus, čím sa eliminuje duplicitná flat-detection logika s potenciálne rozdielnym správaním.

## 9. Sidecar formát

```json
{
  "ico": null,
  "metriky": { ... FinancialMetrics fields ... },
  "source": "ruz_json_parser"
}
```

## 10. Wrapping do `CompanyFinancialExtraction`

```python
def metrics_to_extraction(metrics, ico, company_name=""):
    # Všetky polia → confidence=HIGH
    # nazov_spolocnosti → placeholder (save_to_db ignoruje)
    # audit → placeholder (save_to_db neukladá do auditoropinion)
```

## 11. Mapovanie do DB

`save_to_db` → `financialstatement.upsert(where: {companyIco_year: {companyIco, year}})`.

**Poznámka k OCF:** `operatingCashFlow` teraz obsahuje nepriamo odhadnutú hodnotu (nie null) ak sú k dispozícii zisk a odpisy.

## 12. Obmedzenia a riziká

1. **Dense arrays predpoklad** — parser číta `data[cisloRiadku - offset]`. Sparse arrays by posunuli indexovanie.
2. **Flat formát (2025+)** — RIEŠENÉ cez `isinstance(data[0], list)`.
3. **Prázdne tabuľky** — RIEŠENÉ: fallback na PDF prílohy.
4. **Len šablóna 699 (Úč POD)** — ROPO, FNM, mikro jednotky nie sú mapované.
5. **Cash flow** — ČIASTOČNE RIEŠENÉ: nepriamy odhad z Zisk + Odpisy ± ΔWC. Priamy CF výkaz v šablóne 699 neexistuje.
6. **Konsolidované závierky** — iba pre `konsolidovana == False`.
7. **Audítorský názor** — nie je extrahovaný parsérom.
8. **Jednotky EUR vs tisíce** — RIEŠENÉ: heuristika `assets < 5000 and zamestnancov > 5`.
9. **Negatívne čísla v zátvorkách** — RIEŠENÉ: `_to_float("(1234)") = -1234`.
10. **Hrubá marža** — RIEŠENÉ: Tržby - COGS, fallback Pridaná hodnota.
11. **Budúce roky** — RIEŠENÉ: odmietnuté roky > current_year + 1.
12. **Cache (24h)** — súbory v `assets/{ico}/`.
13. **RÚZ API výpadky** — sentinel `__ENTITY_NOT_FOUND__` vs. prázdny zoznam (retry).
14. **Pomenovanie súborov** — OPRAVENÉ: `SKGAAP_*` pre nekonsolidované.

## 13. Čo overiť pri teste

- Pre reálne IČO: `celkove_aktiva`, `vlastne_imanie_celkom`, `trzby`, `hruba_marza` voči RÚZ webu.
- `[SK_GAAP PARSED]` log → fast path použitý (sidecar načítaný).
- Sanity check log: `"sanity checks passed"` alebo warning s percentom.
- **OCF:** `ciste_penazne_toky_z_prevadzkovej_cinnosti` ≠ None ak sú odpisy + zisk k dispozícii.
- **Flat formát (2025+):** Porovnaj parsované hodnoty s RÚZ webom.
- **Súbory:** SK GAAP závierky → `SKGAAP_*.txt`, nie `IFRS_*.txt`.
- **Budúci rok:** `obdobieDo = "2099-12-31"` → parser vráti None + zaloguje warning.
- **Cache:** Re-generácia do 24h → `[RUZ_API] Cache hit` log.

# Report: Unit Testy pre RÚZ JSON Parser — pre kontrolu iným LLM

## 1. Súhrn

- **Súbor:** `tests/test_ruz_parser.py`
- **Počet testov:** 48
- **Výsledok:** ✅ Všetky prešli (48 passed, 0 failed)
- **Čas behu:** ~0.5s
- **Framework:** pytest + pytest-asyncio

## 2. Štruktúra testov

| Skupina | Počet | Testovaná funkcionalita |
|---|---|---|
| `TestToFloat` | 20 | Normalizácia slovenských čísel, zátvorková notácia, edge cases |
| `TestExtractRowValue` | 8 | Extrakcia hodnôt z rôznych formátov riadkov |
| `TestSanityCheck` | 6 | Bilančná rovnováha, negatívne tržby/náklady |
| `TestParseTablesToMetrics` | 14 | Kompletný parsing, unit detection, hrubá marža, edge cases |

## 3. Detailný prehľad testov

### 3.1 `TestToFloat` (20 testov)

Testuje funkciu `_to_float()` — konverziu slovenských číselných formátov na float.

| Test | Vstup | Očakávaný výstup | Popis |
|---|---|---|---|
| `test_slovak_thousands_comma_decimal` | `"1 234 567,89"` | `1234567.89` | Slovak formát: medzery = tisíce, čiarka = desatinná |
| `test_us_thousands_dot_decimal` | `"1,234,567.89"` | `1234567.89` | US formát: čiarka = tisíce, bodka = desatinná |
| `test_parentheses_negative_integer` | `"(1 234)"` | `-1234.0` | Zátvorková notácia = záporné číslo |
| `test_parentheses_negative_decimal` | `"(1234,56)"` | `-1234.56` | Zátvorky + desatinná čiarka |
| `test_parentheses_negative_with_spaces` | `"( 1 234 )"` | `-1234.0` | Zátvorky s medzerami |
| `test_plain_integer_string` | `"1234"` | `1234.0` | Plain integer |
| `test_plain_float_string` | `"1234.56"` | `1234.56` | Plain float |
| `test_integer_input` | `1234` (int) | `1234.0` | Priamy int input |
| `test_float_input` | `1234.56` (float) | `1234.56` | Priamy float input |
| `test_empty_string` | `""` | `None` | Prázdny string |
| `test_space_string` | `" "` | `None` | Iba medzera |
| `test_none` | `None` | `None` | None input |
| `test_boolean` | `True` / `False` | `None` | Boolean (odmietnuté) |
| `test_nbsp_thousand_separator` | `"1\xa0234\xa0567,89"` | `1234567.89` | Non-breaking space ako tisícový separator |
| `test_multiple_dots` | `"1.234.567,89"` | `1234567.89` | Viac bodiek + čiarka (mix) |
| `test_negative_with_dot` | `"-1234.56"` | `-1234.56` | Priamy zápis záporného čísla |
| `test_zero` | `"0"` | `0.0` | Nula |
| `test_zero_in_parentheses` | `"(0)"` | `0.0` | Nula v zátvorkách (nie záporná) |
| `test_garbage_string` | `"abc"` | `None` | Nečíselný string |
| `test_mixed_comma_dot` | `"1.234,56"` | `1234.56` | Mix: bodka = tisíc, čiarka = desatinná |

### 3.2 `TestExtractRowValue` (8 testov)

Testuje funkciu `_extract_row_value()` — extrakcia hodnôt z riadkov rôznych formátov.

| Test | Popis | Vstup | Očakávaný výstup |
|---|---|---|---|
| `test_aktiv_full_row_current` | Aktív riadok, Netto2 (bežné obdobie) | `["A", "Dlh. majetok", "10", "100", "0", "100", "50"]`, data_cols=4, target=2 | `100.0` |
| `test_aktiv_full_row_preceding` | Aktív riadok, Netto3 (predchádzajúce) | rovnaký riadok, target=3 | `50.0` |
| `test_aktiv_data_only_row` | Iba dátové stĺpce (bez labelov) | `["100", "0", "100", "50"]`, target=2 | `100.0` |
| `test_pasiv_full_row` | Pasív riadok, bežné + predchádzajúce | `["A", "Vlastné imanie", "80", "500000", "450000"]` | `500000.0` / `450000.0` |
| `test_row_too_short` | Príliš krátky riadok | `["A", "Text"]`, data_cols=4 | `None` |
| `test_row_none` | None riadok | `None` | `None` |
| `test_target_col_out_of_range` | Target stĺpec mimo rozsah | `["A", "Text", "1", "100"]`, target=5 | `None` |
| `test_parentheses_in_row` | Zátvorky v dátach (strata) | `["A", "Strata", "61", "(50000)", "(40000)"]` | `-50000.0` / `-40000.0` |

### 3.3 `TestSanityCheck` (6 testov)

Testuje funkciu `_sanity_check()` — validácia finančnej konzistencie.

| Test | Popis | Vstupne metriky | Očakávaný výsledok |
|---|---|---|---|
| `test_balance_sheet_ok` | Aktíva = imanie + záväzky | aktíva=100, imanie=50, ST=30, LT=20 | 0 warnings |
| `test_balance_sheet_mismatch` | Aktíva ≠ imanie + záväzky | aktíva=100, imanie=40, ST=30, LT=20 (súčet=90) | "Balance sheet mismatch" |
| `test_balance_sheet_within_tolerance` | Rozdiel v tolerancii (1%) | aktíva=100, imanie=50, ST=30, LT=20.5 (súčet=100.5, diff=0.5) | 0 warnings |
| `test_negative_revenue` | Negatívne tržby | tržby=-1000 | "Revenue is negative" |
| `test_negative_personnel_costs` | Negatívne osobné náklady | náklady=-500 | "Personnel costs are negative" |
| `test_no_warnings_when_all_none` | Všetko None | prázdne metriky | 0 warnings |

### 3.4 `TestParseTablesToMetrics` (14 testov)

Testuje hlavnú funkciu `parse_tables_to_metrics()` — kompletný parsing RÚZ JSON do `FinancialMetrics`.

| Test | Popis | Scenár | Overenie |
|---|---|---|---|
| `test_basic_parsing` | Základný parsing | aktíva=1M, imanie=500k, tržby=5M, zisk=200k | rok=2024, aktíva=1M, tržby=5M |
| `test_gross_margin_from_cogs` | Hrubá marža z COGS | tržby=5M, COGS=3M | hruba_marza=2M (Tržby - COGS) |
| `test_gross_margin_fallback_to_value_added` | Fallback na Pridanú hodnotu | tržby=5M, COGS=None, pridaná=1.5M | hruba_marza=1.5M |
| `test_unit_detection_thousands_eur` | Detekcia tisícov EUR | aktíva=500, zamestnanci=50 | aktíva=500k (×1000) |
| `test_unit_detection_eur_normal` | Normálne EUR | aktíva=500k, zamestnanci=50 | aktíva=500k (bez multipliera) |
| `test_unit_detection_small_company_no_multiplier` | Malá firma bez multipliera | aktíva=500, zamestnanci=5 | aktíva=500 (bez multipliera) |
| `test_parentheses_in_net_profit` | Strata v zátvorkách | net_profit="(50000)" | zisk=-50000.0 |
| `test_missing_tables` | Prázdne tabuľky | `[]` | None |
| `test_missing_aktiv_pasiv` | Chýba aktív/pasív | iba income tabuľka | None |
| `test_missing_year` | Chýba rok | obdobieDo="" | None |
| `test_consolidated_flag` | Konsolidovaná závierka | konsolidovana=True | is_consolidated=True |
| `test_employee_count` | Počet zamestnancov | pocet_zam=1292 | pocet_zamestnancov=1292 |
| `test_months_computation` | Plný rok | 2024-01-01 → 2024-12-31 | pocet_mesiacov=12 |
| `test_months_short_period` | Kratšie obdobie | 2024-07-01 → 2024-12-31 | pocet_mesiacov=6 |

## 4. Test helper funkcie

### `_make_metrics(**kwargs)`
Vytvorí `FinancialMetrics` s všetkými opcional poliami nastavenými na `None`, okrem tých čo sú explicitne zadané.

### `_make_tables(...)`
Vytvorí mock RÚZ JSON tabuľky so správnymi indexami v `data[]` poli:
- **Aktív:** offset=1, riadky 1-78 → indexy 0-77, 7 stĺpcov
- **Pasív:** offset=79, riadky 80-145 → indexy 1-66, 5 stĺpcov
- **Income:** offset=1, riadky 1-61 → indexy 0-60, 5 stĺpcov

Padding riadky používajú prázdne stringy `""` (nie `"0"`), aby `_to_float` vrátil `None` pre chýbajúce dáta.

### `_set_row(arr, idx, row, cols=7)`
Zabezpečí že pole je dostatočne veľké a vloží riadok na správny index.

## 5. Bug fixy nájdené počas testovania

### 5.1 `_to_float` — mixed comma/dot logika

**Pôvodný kód** predpokladal že pri mixe bodky a čiarky je bodka vždy tisícový separator:
```python
# Pôvodné (chybné):
cleaned = cleaned.replace('.', '').replace(',', '.')
```

**Problém:** `"1,234,567.89"` (US formát) → bodka je desatinná, čiarka je tisíc → `1234.56789` ❌

**Opravené:** Posledný separator je desatinný:
```python
last_comma = cleaned.rfind(',')
last_dot = cleaned.rfind('.')
if last_comma > last_dot:
    cleaned = cleaned.replace('.', '').replace(',', '.')  # čiarka = desatinná
else:
    cleaned = cleaned.replace(',', '')  # bodka = desatinná
```

### 5.2 Test helper padding

**Pôvodný kód** paddingoval s `"0"` čo spôsobovalo že `_to_float("0")` vrátilo `0.0` namiesto `None`. To znamenalo že COGS sa chápal ako `0.0` a `hruba_marza = Tržby - 0 = Tržby`.

**Oprava:** Padding s `""` → `_to_float("")` vracia `None`.

## 6. Ako spustiť

```bash
cd worker
pip install pytest pytest-asyncio
python -m pytest tests/test_ruz_parser.py -v
```

## 7. Pokrytie kritických scenárov

| Scenár | Pokryté testom | Stav |
|---|---|---|
| Slovak formát čísel (`"1 234 567,89"`) | `test_slovak_thousands_comma_decimal` | ✅ |
| US formát čísel (`"1,234,567.89"`) | `test_us_thousands_dot_decimal` | ✅ |
| Zátvorková notácia (`(1234)` = -1234) | `test_parentheses_negative_*` (3 testy) | ✅ |
| Nbsp separator (`1\xa0234`) | `test_nbsp_thousand_separator` | ✅ |
| Hrubá marža = Tržby - COGS | `test_gross_margin_from_cogs` | ✅ |
| Hrubá marža fallback (Pridaná hodnota) | `test_gross_margin_fallback_to_value_added` | ✅ |
| Unit detection (tisíce EUR) | `test_unit_detection_thousands_eur` | ✅ |
| Unit detection (normálne EUR) | `test_unit_detection_eur_normal` | ✅ |
| Unit detection (malá firma) | `test_unit_detection_small_company_no_multiplier` | ✅ |
| Bilančná rovnováha | `test_balance_sheet_ok` / `test_balance_sheet_mismatch` | ✅ |
| Negatívne tržby | `test_negative_revenue` | ✅ |
| Chýbajúce tabuľky | `test_missing_tables` / `test_missing_aktiv_pasiv` | ✅ |
| Chýbajúci rok | `test_missing_year` | ✅ |
| Konsolidovaná závierka | `test_consolidated_flag` | ✅ |
| Počet zamestnancov | `test_employee_count` | ✅ |
| Počet mesiacov obdobia | `test_months_computation` / `test_months_short_period` | ✅ |

## 8. Nepokryté oblasti (budúce testy)

- **Sidecar save/load** (`save_metrics_sidecar`, `load_metrics_sidecar`) — testovanie JSON serializácie
- `metrics_to_extraction` — konverzia do `CompanyFinancialExtraction`
- **Identifikácia tabuliek** (`_identify_tables`) — keď sú tabuľky v inom poradí
- **Rôzne šablóny** — ROPO, FNM, mikro jednotky (mimo 699)
- **Cash flow statement** — keď bude pridaný do parsera
- **Edge case:** `data[]` pole s `None` hodnotami medzi riadkami (nehustené pole)

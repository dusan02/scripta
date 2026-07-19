# Report: Ako sa parsujú RÚZ dáta — kód a logika pre iné LLM

## 1. Cieľ a kontext

Tento report opisuje **deterministický parser** pre slovenské účtovné závierky zo systému **RÚZ (Register účtovných závierok)**.

- **Vstup:** JSON odpoveď z RÚZ API (`/api/uctovny-vykaz`, `/api/zaverky`), konkrétne `obsah.tabulky` a `obsah.titulnaStrana`.
- **Výstup:** `FinancialMetrics` Pydantic model, ktorý sa uloží ako `.metrics.json` sidecar a/alebo rovno do DB.
- **Prečo:** Nahradzuje LLM extrakciu pre SK GAAP, kde sú dáta štruktúrované. IFRS/konsolidované závierky zostávajú na LLM (tie prichádzajú ako PDF).

## 2. Súbory a zodpovednosti

| Súbor | Úloha |
|-------|-------|
| `src/ruz_parser.py` | Hlavný parser: `parse_tables_to_metrics`, `_to_float`, `_extract_row_value`, sanity checks, sidecar save/load. |
| `src/ruz_api.py` | Stiahne výkazy, zavolá parser, uloží `.metrics.json` vedľa `.txt`. |
| `src/pipeline.py` | `_process_ifrs` najskôr skúsi `.metrics.json` sidecar a preskočí LLM. |
| `src/db_repository.py` | Mapuje `FinancialMetrics` → DB tabuľka `FinancialStatement`; chráni `AuditorOpinion` pred placeholderom. |

## 3. Predpokladaná štruktúra RÚZ JSON (šablóna 699)

```json
{
  "obsah": {
    "titulnaStrana": {
      "obdobieOd": "2023-01-01",
      "obdobieDo": "2023-12-31",
      "konsolidovana": false,
      "pocetZamestnancov": 1292
    },
    "tabulky": [
      {
        "nazov": {"sk": "Strana aktív"},
        "data": [
          ["A. Nal", "SPOLU AKTÍVA", "1", "1234", "0", "1234", "1100"],
          ...
        ]
      },
      {
        "nazov": {"sk": "Strana pasív"},
        "data": [
          ["A. Vlastné imanie", "Vlastné imanie celkom", "80", "500000", "450000"],
          ...
        ]
      },
      {
        "nazov": {"sk": "Výkaz ziskov a strát"},
        "data": [
          ["01", "Čistý obrat", "1", "1000000", "900000"],
          ...
        ]
      }
    ]
  }
}
```

- **Strana aktív** (`cisloRiadku` 1–78): každý riadok má 7 stĺpcov: `[Označenie, Text, Číslo, Brutto, Korekcia, Netto2 (bežné), Netto3 (predchádzajúce)]`.
- **Strana pasív** (`cisloRiadku` 79–145): 5 stĺpcov: `[Označenie, Text, Číslo, Bežné, Predchádzajúce]`.
- **Výkaz ziskov a strát** (`cisloRiadku` 1–61): 5 stĺpcov ako pasíva.

## 4. Mapovanie riadkov → FinancialMetrics

### Strana aktív (`table 0`, offset = 1)

```python
ROW_TOTAL_ASSETS = 1
ROW_CURRENT_ASSETS = 33
ROW_INVENTORY = 34
ROW_TRADE_RECEIVABLES_TOTAL = 53
ROW_TRADE_RECEIVABLES = 54
ROW_FINANCIAL_ACCOUNTS = 71
ROW_CASH = 72
```

| `cisloRiadku` | Text | `FinancialMetrics` pole | Dátový stĺpec |
|---|---|---|---|
| 1 | SPOLU AKTÍVA | `celkove_aktiva` | Netto2 (col 5, data col 2) |
| 33 | Obežný majetok | `obezny_majetok` | Netto2 |
| 34 | Zásoby | `zasoby` | Netto2 |
| 54 | Pohľadávky z obchodného styku súčet | `pohladavky_z_obchodneho_styku` | Netto2 |
| 72 | Peniaze | `peniaze_a_penazne_ekvivalenty_k_31_12` | Netto2 |

### Strana pasív (`table 1`, offset = 79)

```python
ROW_TOTAL_EQUITY = 80
ROW_TOTAL_LIABILITIES = 101
ROW_LT_LIABILITIES = 102
ROW_LT_BANK_LOANS = 121
ROW_ST_LIABILITIES = 122
ROW_TRADE_PAYABLES = 123
ROW_EMPLOYEE_LIAB = 131
ROW_SOCIAL_INS_LIAB = 132
ROW_TAX_LIAB = 133
ROW_ST_BANK_LOANS = 139
```

| `cisloRiadku` | Text | `FinancialMetrics` pole | Dátový stĺpec |
|---|---|---|---|
| 80 | Vlastné imanie celkom | `vlastne_imanie_celkom` | Bežné (data col 0) |
| 102 | Dlhodobé záväzky súčet | `dlhodobe_zavazky` | Bežné |
| 122 | Krátkodobé záväzky súčet | `kratkodobe_zavazky` | Bežné |
| 123 | Záväzky z obchodného styku súčet | `zavazky_z_obchodneho_styku` | Bežné |
| 131 | Záväzky voči zamestnancom | `zavazky_zamestnanci` | Bežné |
| 132 | Záväzky zo sociálneho poistenia | `zavazky_sp` | Bežné |
| 133 | Daňové záväzky a dotácie | `danove_zavazky` | Bežné |

### Výkaz ziskov a strát (`table 2`, offset = 1)

```python
ROW_NET_REVENUE = 1
ROW_OPERATING_INCOME = 2
ROW_PERSONNEL_COSTS = 15
ROW_DEPRECIATION = 21
ROW_VALUE_ADDED = 28
ROW_INTEREST_EXPENSE = 49
ROW_NET_PROFIT = 61
```

| `cisloRiadku` | Text | `FinancialMetrics` pole |
|---|---|---|
| 1 | Čistý obrat | `trzby_z_hlavnej_cinnosti` |
| 2 | Výnosy z hospodárskej činnosti spolu | fallback pre `trzby_z_hlavnej_cinnosti` |
| 15 | Osobné náklady | `osobne_naklady` |
| 21 | Odpisy | `odpisy` |
| 28 | Pridaná hodnota | `hruba_marza` (proxy) |
| 49 | Nákladové úroky | `uroky` |
| 61 | Výsledok hospodárenia po zdanení | `zisk_alebo_strata_po_zdaneni` |

## 5. Kľúčové pomocné funkcie

### `_to_float` — normalizácia slovenských čísel

```python
def _to_float(val) -> Optional[float]:
    if val is None or val == "" or val == " ":
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        cleaned = val.strip()
        if not cleaned:
            return None
        # Medzery / nbsp ako tisícové oddeľovače
        cleaned = re.sub(r'[\s\xa0]', '', cleaned)
        if ',' in cleaned and '.' in cleaned:
            # Mix: bodka = tisíc, čiarka = desatinná
            cleaned = cleaned.replace('.', '').replace(',', '.')
        elif ',' in cleaned:
            # Iba čiarka → desatinná
            cleaned = cleaned.replace(',', '.')
        # Ak zostane viac bodiek, posledná je desatinná
        if cleaned.count('.') > 1:
            parts = cleaned.split('.')
            cleaned = ''.join(parts[:-1]) + '.' + parts[-1]
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    return None
```

Podporuje:
- `"1 234 567,89"` → `1234567.89`
- `"1,234,567.89"` → `1234567.89`
- `1234567` → `1234567.0`
- prázdne, `None`, medzery → `None`

### `_extract_row_value` — extrakcia z riadkov rôznych formátov

```python
def _extract_row_value(row, data_cols: int, target_col: int) -> Optional[float]:
    if row is None:
        return None

    if isinstance(row, list):
        if len(row) == data_cols:
            data_start = 0
        elif len(row) > data_cols:
            data_start = len(row) - data_cols
        else:
            return None
        idx = data_start + target_col
        if 0 <= idx < len(row):
            return _to_float(row[idx])
        return None

    # Skalár pre single-column data
    if isinstance(row, (int, float, str)) and data_cols == 1 and target_col == 0:
        return _to_float(row)

    return None
```

Logika:
- `data_cols` = počet **dátových** stĺpcov (4 pre aktíva, 2 pre pasíva a P&L).
- Ak riadok obsahuje presne `data_cols` prvkov, sú to už len dáta (data-only riadok).
- Ak má viac, posledných `data_cols` prvkov sú dáta — predošlé sú `Označenie`, `Text`, `Číslo riadku`.
- Skalár podporuje jednoduché single-column výkazy.

### `_get_row`, `_get_activ_value`, `_get_pasiv_value`, `_get_income_value`

```python
def _get_row(tables: list, table_idx: int, cislo_riadku: int, offset: int) -> Optional[list]:
    if table_idx >= len(tables):
        return None
    data = tables[table_idx].get("data", [])
    idx = cislo_riadku - offset
    if 0 <= idx < len(data):
        return data[idx]
    return None

# Strana aktív: data_cols=4, dátové stĺpce [Brutto, Korekcia, Netto2, Netto3]
def _get_activ_value(tables, cislo_riadku, current=True):
    row = _get_row(tables, 0, cislo_riadku, _ACTIV_OFFSET)
    if row is None: return None
    target = 2 if current else 3  # Netto2 / Netto3
    return _extract_row_value(row, 4, target)

# Strana pasív: data_cols=2, dátové stĺpce [Bežné, Predchádzajúce]
def _get_pasiv_value(tables, cislo_riadku, current=True):
    row = _get_row(tables, 1, cislo_riadku, _PASIV_OFFSET)
    if row is None: return None
    target = 0 if current else 1
    return _extract_row_value(row, 2, target)

# Výkaz ziskov a strát: data_cols=2, dátové stĺpce [Bežné, Predchádzajúce]
def _get_income_value(tables, cislo_riadku, current=True):
    row = _get_row(tables, 2, cislo_riadku, _INCOME_OFFSET)
    if row is None: return None
    target = 0 if current else 1
    return _extract_row_value(row, 2, target)
```

**Dôležité:** `data[cisloRiadku - offset]` predpokladá, že pole `data[]` je **zhustené** — bez prázdnych riadkov medzi `cisloRiadku`. Ak RÚZ vracia pole vrátane `None`/prázdnych medzier, mapovanie sa posunie.

## 6. Hlavný parser `parse_tables_to_metrics`

```python
def parse_tables_to_metrics(tables: list[dict], titulna_strana: dict, ico: str) -> Optional[FinancialMetrics]:
    if not tables:
        return None

    # Identifikácia tabuliek podľa názvu
    tab_map = _identify_tables(tables)
    if "aktiv" not in tab_map or "pasiv" not in tab_map:
        return None

    ordered = [
        tables[tab_map["aktiv"]],
        tables[tab_map["pasiv"]],
    ]
    if "income" in tab_map:
        ordered.append(tables[tab_map["income"]])

    # Rok z obdobieDo
    obdobie_do = titulna_strana.get("obdobieDo", "")
    year = None
    if obdobie_do:
        m = re.search(r'(20\d{2})', str(obdobie_do))
        if m:
            year = int(m.group(1))
    if year is None:
        return None

    # Počet zamestnancov a mesiacov
    pocet_zam = titulna_strana.get("pocetZamestnancov") or titulna_strana.get("priemernyPocetZamestnancov")
    pocet_zam_int = int(float(pocet_zam)) if pocet_zam is not None else None
    months = _compute_months(titulna_strana.get("obdobieOd", ""), obdobie_do)
    konsolidovana = titulna_strana.get("konsolidovana", False)

    # Extrakcia
    celkove_aktiva   = _get_activ_value(ordered, ROW_TOTAL_ASSETS)
    obezny_majetok   = _get_activ_value(ordered, ROW_CURRENT_ASSETS)
    zasoby           = _get_activ_value(ordered, ROW_INVENTORY)
    peniaze          = _get_activ_value(ordered, ROW_CASH)
    pohladavky       = _get_activ_value(ordered, ROW_TRADE_RECEIVABLES)

    vlastne_imanie   = _get_pasiv_value(ordered, ROW_TOTAL_EQUITY)
    dlhodobe         = _get_pasiv_value(ordered, ROW_LT_LIABILITIES)
    kratkodobe       = _get_pasiv_value(ordered, ROW_ST_LIABILITIES)
    zav_obchod       = _get_pasiv_value(ordered, ROW_TRADE_PAYABLES)
    zam_zav          = _get_pasiv_value(ordered, ROW_EMPLOYEE_LIAB)
    sp_zav           = _get_pasiv_value(ordered, ROW_SOCIAL_INS_LIAB)
    dan_zav          = _get_pasiv_value(ordered, ROW_TAX_LIAB)

    has_income = len(ordered) > 2
    trzby      = _get_income_value(ordered, ROW_NET_REVENUE) if has_income else None
    marza      = _get_income_value(ordered, ROW_VALUE_ADDED) if has_income else None
    naklady    = _get_income_value(ordered, ROW_PERSONNEL_COSTS) if has_income else None
    odpisy     = _get_income_value(ordered, ROW_DEPRECIATION) if has_income else None
    uroky      = _get_income_value(ordered, ROW_INTEREST_EXPENSE) if has_income else None
    zisk       = _get_income_value(ordered, ROW_NET_PROFIT) if has_income else None

    if trzby is None and has_income:
        trzby = _get_income_value(ordered, ROW_OPERATING_INCOME)

    metrics = FinancialMetrics(
        rok_zavierky=year,
        celkove_aktiva=celkove_aktiva,
        obezny_majetok=obezny_majetok,
        vlastne_imanie_celkom=vlastne_imanie,
        kratkodobe_zavazky=kratkodobe,
        dlhodobe_zavazky=dlhodobe,
        trzby_z_hlavnej_cinnosti=trzby,
        hruba_marza=marza,
        zisk_alebo_strata_po_zdaneni=zisk,
        peniaze_a_penazne_ekvivalenty_k_31_12=peniaze,
        ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
        osobne_naklady=naklady,
        pohladavky_z_obchodneho_styku=pohladavky,
        zavazky_z_obchodneho_styku=zav_obchod,
        zasoby=zasoby,
        odpisy=odpisy,
        investicny_cash_flow=None,
        financny_cash_flow=None,
        uroky=uroky,
        pocet_zamestnancov=pocet_zam_int,
        zavazky_sp=sp_zav,
        danove_zavazky=dan_zav,
        zavazky_zamestnanci=zam_zav,
        mena="EUR",
        typ_zavierky="SK_GAAP",
        pocet_mesiacov_obdobia=months,
        is_consolidated=konsolidovana,
    )

    warnings = _sanity_check(metrics)
    for w in warnings:
        logger.warning(f"[RUZ_PARSER] IČO {ico} rok {year}: {w}")

    return metrics
```

## 7. Sanity checks

```python
def _sanity_check(metrics: FinancialMetrics) -> list[str]:
    warnings = []
    assets = metrics.celkove_aktiva
    equity = metrics.vlastne_imanie_celkom
    total_liab = (metrics.dlhodobe_zavazky or 0) + (metrics.kratkodobe_zavazky or 0)

    if assets is not None and equity is not None:
        expected = equity + total_liab
        diff = abs(assets - expected)
        tolerance = max(abs(assets) * 0.01, 1.0)
        if diff > tolerance:
            warnings.append(
                f"Balance sheet mismatch: assets={assets} vs equity+liabilities={expected}"
            )

    if metrics.trzby_z_hlavnej_cinnosti is not None and metrics.trzby_z_hlavnej_cinnosti < 0:
        warnings.append(f"Revenue is negative: {metrics.trzby_z_hlavnej_cinnosti}")

    if metrics.osobne_naklady is not None and metrics.osobne_naklady < 0:
        warnings.append(f"Personnel costs are negative: {metrics.osobne_naklady}")

    return warnings
```

- Bilancia: `aktíva ≈ vlastné imanie + dlhodobé záväzky + krátkodobé záväzky` (tolerancia 1% alebo 1 EUR).
- Tržby a osobné náklady nesmú byť záporné.

## 8. Sidecar formát a pipeline integrácia

### Uloženie sidecar (`save_metrics_sidecar`)

```python
def save_metrics_sidecar(metrics: FinancialMetrics, txt_path: str) -> str:
    sidecar_path = Path(txt_path).with_suffix(".metrics.json")
    data = {
        "ico": None,
        "metriky": metrics.model_dump(),
        "source": "ruz_json_parser",
    }
    with open(sidecar_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, default=str)
    return str(sidecar_path)
```

### Načítanie sidecar (`load_metrics_sidecar`)

```python
def load_metrics_sidecar(txt_path: str) -> Optional[FinancialMetrics]:
    sidecar_path = Path(txt_path).with_suffix(".metrics.json")
    if not sidecar_path.exists():
        return None
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        metrics_dict = data.get("metriky", data)
        return FinancialMetrics.model_validate(metrics_dict)
    except Exception:
        return None
```

### Integrácia v `ruz_api._process_zavierka`

```python
parsed_metrics = None
if not konsolidovana and all_vykazy:
    try:
        from src.ruz_parser import parse_zavierka_to_metrics, save_metrics_sidecar
        parsed_metrics = parse_zavierka_to_metrics(all_vykazy, ico)
        if parsed_metrics:
            logger.info(f"[RUZ_API] JSON parser: IČO {ico} rok {year} ...")
    except Exception as e:
        logger.warning(f"[RUZ_API] JSON parser failed ... {e}")

if extracted_tables:
    txt_path = _save_text(extracted_tables, ftype, year, ico, period, index, out_path)
    saved_files.append(txt_path)

    if parsed_metrics is not None:
        save_metrics_sidecar(parsed_metrics, txt_path)
```

### Integrácia v `pipeline._process_ifrs`

```python
# RÚZ notes PDF (auditor reports / poznámky k SK GAAP) — preskočíme LLM extrakciu
if file_path.lower().endswith(".pdf") and "notes" in file_name.lower():
    return

# SK GAAP fast path
if file_path.lower().endswith(".txt"):
    from src.ruz_parser import load_metrics_sidecar, metrics_to_extraction
    parsed_metrics = load_metrics_sidecar(file_path)
    if parsed_metrics is not None:
        data = metrics_to_extraction(parsed_metrics, ico, company_name or fallback_name)
        _ifrs_results.append(data)
        return

# Inak pokračuje LLM extrakcia (IFRS alebo starý SK GAAP .txt bez sidecaru)
```

## 9. Wrapping do `CompanyFinancialExtraction`

```python
def metrics_to_extraction(metrics, ico, company_name=""):
    confidence_fields = [
        "celkove_aktiva", "obezny_majetok", "vlastne_imanie_celkom",
        "kratkodobe_zavazky", "dlhodobe_zavazky", "trzby_z_hlavnej_cinnosti",
        # ...
    ]
    verification_confidence = [
        VerificationConfidenceItem(field=f, confidence="HIGH")
        for f in confidence_fields
        if getattr(metrics, f, None) is not None
    ]

    return CompanyFinancialExtraction(
        ico=ico,
        nazov_spolocnosti=company_name or f"Spoločnosť s IČO {ico}",
        audit=AuditorReportData(
            nazor_auditora="Neznámy",
            going_concern_riziko=False,
            auditor_vyhrady_text=None,
        ),
        metriky=metrics,
        verification_confidence=verification_confidence,
    )
```

- Všetky parsované polia majú `confidence=HIGH`.
- `nazov_spolocnosti` je placeholder `"Spoločnosť s IČO {ico}"` — `save_to_db` ho ignoruje, aby neprepísal reálny názov z ORSR.
- `audit` je placeholder `"Neznámy"` — `save_to_db` ho **neukladá** do `auditoropinion`, aby neprepísal skutočný názor audítora.

## 10. Mapovanie do databázy (`save_to_db`)

```python
stmt_fields = {
    'totalAssets': data.metriky.celkove_aktiva,
    'currentAssets': data.metriky.obezny_majetok,
    'equity': data.metriky.vlastne_imanie_celkom,
    'shortTermLiabilities': data.metriky.kratkodobe_zavazky,
    'longTermLiabilities': data.metriky.dlhodobe_zavazky,
    'mainActivityRevenue': data.metriky.trzby_z_hlavnej_cinnosti,
    'grossProfit': data.metriky.hruba_marza,
    'netProfitLoss': data.metriky.zisk_alebo_strata_po_zdaneni,
    'cashAndEquivalents': data.metriky.peniaze_a_penazne_ekvivalenty_k_31_12,
    'operatingCashFlow': data.metriky.ciste_penazne_toky_z_prevadzkovej_cinnosti,
    'staffCosts': data.metriky.osobne_naklady,
    'tradeReceivables': data.metriky.pohladavky_z_obchodneho_styku,
    'tradePayables': data.metriky.zavazky_z_obchodneho_styku,
    'inventory': data.metriky.zasoby,
    'depreciation': data.metriky.odpisy,
    'investingCashFlow': data.metriky.investicny_cash_flow,
    'financingCashFlow': data.metriky.financny_cash_flow,
    'interestExpense': data.metriky.uroky,
    'employeeCount': data.metriky.pocet_zamestnancov,
    'socialInsuranceLiabilities': data.metriky.zavazky_sp,
    'taxLiabilities': data.metriky.danove_zavazky,
    'employeeLiabilities': data.metriky.zavazky_zamestnanci,
    'currency': data.metriky.mena,
    'statementType': data.metriky.typ_zavierky,
    'monthsInPeriod': data.metriky.pocet_mesiacov_obdobia,
    'isConsolidated': data.metriky.is_consolidated,
}

stmt_data = {k: v for k, v in stmt_fields.items() if v is not None}

await db.financialstatement.upsert(
    where={'companyIco_year': {'companyIco': data.ico, 'year': data.metriky.rok_zavierky}},
    data={
        'create': {'companyIco': data.ico, 'year': data.metriky.rok_zavierky, **stmt_data},
        'update': stmt_data,
    }
)
```

## 11. Známe obmedzenia a riziká (pre kontrolu)

1. **Predpoklad zhusteného `data[]` poľa.** Parser používa `cisloRiadku - offset`. Ak RÚZ JSON vracia pole s `None`/prázdnych riadkami alebo inak poradím, mapovanie sa posunie. **Treba overiť s reálnym API výstupom.**
2. **Len šablóna 699 (Úč POD).** ROPO, FNM, mikro jednotky a iné šablóny nie sú mapované.
3. **Cash flow chýba.** `ciste_penazne_toky_z_prevadzkovej_cinnosti`, `investicny_cash_flow`, `financny_cash_flow` sú `None`, lebo šablóna 699 neobsahuje výkaz peňažných tokov. Používa sa následný `estimate_missing_cash_flow`.
4. **Konsolidované závierky.** Parser beží len ak `konsolidovana == False`. Konsolidované SK GAAP/IFRS idú cez LLM.
5. **Audítorský názor.** Parser neextrahuje audítorskú správu. `auditoropinion` ostáva prázdny, kým sa nepridá samostatná extrakcia z notes PDF.
6. **Jednotky.** Predpokladá sa, že RÚZ vracia hodnoty v EUR. Ak by vracal v tisícoch EUR, čísla by boli 1000× menšie. **Treba overiť.**
7. **Negatívne čísla v zátvorkách.** `_to_float` nekonvertuje `(1234)` na `-1234`. Ak RÚZ používa túto notáciu, treba doplniť.
8. **Cashflow proxy.** `hruba_marza` je mapovaná z riadku 28 "Pridaná hodnota". Pre niektoré výkazy to môže byť hrubá marža, pre iné iba pridaná hodnota.

## 12. Čo overiť pri teste

- Pre jedno reálne IČO so SK GAAP závierkou porovnaj:
  - `celkove_aktiva` z parsera vs. RÚZ web/JSON.
  - `vlastne_imanie_celkom` vs. strana pasív.
  - `trzby_z_hlavnej_cinnosti` vs. výkaz ziskov a strát.
  - `danove_zavazky` vs. riadok 133 pasív.
- Skontroluj logy sanity checkov — `Balance sheet mismatch` by mal byť minimálny.
- Over, že `.metrics.json` sa vytvorí vedľa `.txt` a pipeline ho načíta (`[SK_GAAP PARSED]` log).

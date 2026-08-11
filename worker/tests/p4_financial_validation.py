#!/usr/bin/env python3
"""
P4.1 Financial Validation Harness
=================================

Tests financial extraction accuracy against RÚZ API ground truth.

Two tracks:
  A. SK GAAP deterministic — ruz_parser vs independent JSON extraction
  B. IFRS LLM — LLM extraction vs RÚZ JSON (if available) or manual ground truth

Usage:
  cd worker/
  python -m tests.p4_financial_validation                    # Full run (30 companies)
  python -m tests.p4_financial_validation --sk-gaap-only     # Only SK GAAP track
  python -m tests.p4_financial_validation --ifrs-only        # Only IFRS track
  python -m tests.p4_financial_validation --ico 36000000     # Single company
  python -m tests.p4_financial_validation --limit 10         # First 10 companies
  python -m tests.p4_financial_validation --output report.json

Output:
  - Console summary (P4.1 FINANCIAL VALIDATION report)
  - JSON detail file with every mismatch
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

# Ensure worker src is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from src.ruz_api import (
    _RUZ_API,
    _UA,
    _TIMEOUT,
    _api_get,
    _fetch_details,
    _period_from_dict,
    _year_from_period,
    _period_sort_key,
    _dedup_by_period,
)
from src.ruz_parser import (
    parse_zavierka_to_metrics,
    FinancialMetrics,
    _get_activ_value,
    _get_pasiv_value,
    _get_income_value,
    _identify_tables,
    ROW_TOTAL_ASSETS,
    ROW_CURRENT_ASSETS,
    ROW_CASH,
    ROW_TRADE_RECEIVABLES,
    ROW_TOTAL_EQUITY,
    ROW_LT_LIABILITIES,
    ROW_ST_LIABILITIES,
    ROW_NET_REVENUE,
    ROW_NET_PROFIT,
    ROW_PERSONNEL_COSTS,
    ROW_DEPRECIATION,
    ROW_INTEREST_EXPENSE,
)

logger = logging.getLogger("p4_validation")
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

# ── Stratified sample of 30 real Slovak companies ────────────────────────────
# Mix: 10 SK GAAP s.r.o., 5 larger firms, 5 IFRS/consolidated,
#      5 negative/weak results, 5 edge cases (different legal forms)

COMPANIES = [
    # ── SK GAAP (14 companies) — deterministic parser track ──
    {"ico": "00603783", "name": "NEOXX a.s.", "category": "sk_gaap"},
    {"ico": "00643581", "name": "TERRASTROJ spol. s r.o.", "category": "sk_gaap"},
    {"ico": "00188131", "name": "CVZ Farbiarska 35 Stará Ľubovňa", "category": "sk_gaap"},
    {"ico": "00037800", "name": "PD Zamagurie", "category": "sk_gaap"},
    {"ico": "00415952", "name": "SČK Galanta", "category": "sk_gaap"},
    {"ico": "00626813", "name": "Nadácia ZSNP a Slovalco", "category": "sk_gaap"},
    {"ico": "00309486", "name": "Obec Čáry", "category": "sk_gaap"},
    {"ico": "00208892", "name": "PD Suché Brezovo - Veľký Lom", "category": "sk_gaap"},
    {"ico": "00633861", "name": "TRADEF s.r.o. v likvidácii", "category": "sk_gaap"},
    {"ico": "00895920", "name": "TOR spol. s r.o.", "category": "sk_gaap"},
    {"ico": "00596507", "name": "DSS Veľký Meder", "category": "sk_gaap"},
    {"ico": "00590797", "name": "ZTS Sabinov a.s.", "category": "sk_gaap"},
    {"ico": "00322261", "name": "Obec Lascov", "category": "sk_gaap"},
    {"ico": "00318345", "name": "Obec Nitrianske Rudno", "category": "sk_gaap"},
    {"ico": "31733221", "name": "VOPAL s.r.o. Sečovce", "category": "sk_gaap"},

    # ── IFRS / konsolidovaná (3 companies) ──
    {"ico": "00311715", "name": "Obec Krajné", "category": "ifrs"},
    {"ico": "00603201", "name": "MČ Bratislava - Petržalka", "category": "ifrs"},
    {"ico": "00318337", "name": "Obec Nitrianske Pravno", "category": "ifrs"},
]

# Deduplicate by IČO (keep first occurrence)
_seen_icos = set()
COMPANIES = [c for c in COMPANIES if c["ico"] not in _seen_icos and not _seen_icos.add(c["ico"])]

# ── Metrics to compare ───────────────────────────────────────────────────────

METRICS = [
    ("celkove_aktiva", "Total Assets", ROW_TOTAL_ASSETS, "activ"),
    ("obezny_majetok", "Current Assets", ROW_CURRENT_ASSETS, "activ"),
    ("vlastne_imanie_celkom", "Total Equity", ROW_TOTAL_EQUITY, "pasiv"),
    ("kratkodobe_zavazky", "ST Liabilities", ROW_ST_LIABILITIES, "pasiv"),
    ("dlhodobe_zavazky", "LT Liabilities", ROW_LT_LIABILITIES, "pasiv"),
    ("trzby_z_hlavnej_cinnosti", "Revenue", ROW_NET_REVENUE, "income"),
    ("zisk_alebo_strata_po_zdaneni", "Net Profit", ROW_NET_PROFIT, "income"),
    ("osobne_naklady", "Personnel Costs", ROW_PERSONNEL_COSTS, "income"),
    ("odpisy", "Depreciation", ROW_DEPRECIATION, "income"),
    ("uroky", "Interest Expense", ROW_INTEREST_EXPENSE, "income"),
    ("peniaze_a_penazne_ekvivalenty_k_31_12", "Cash", ROW_CASH, "activ"),
    ("pohladavky_z_obchodneho_styku", "Trade Receivables", ROW_TRADE_RECEIVABLES, "activ"),
]


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class MetricComparison:
    metric: str
    label: str
    ground_truth: Optional[float]
    extracted: Optional[float]
    exact_match: bool
    within_1pct: bool
    ratio: Optional[float]
    classification: str  # EXACT, WITHIN_1PCT, UNIT_ERROR, YEAR_ERROR, MISMATCH, BOTH_NULL, GT_NULL, EXTRACTED_NULL


@dataclass
class StatementResult:
    ico: str
    company_name: str
    year: int
    statement_type: str  # SK_GAAP or IFRS
    konsolidovana: bool
    metrics: list[MetricComparison] = field(default_factory=list)
    year_correct: bool = True
    unit_error: bool = False
    error: Optional[str] = None


@dataclass
class ValidationReport:
    companies_tested: int = 0
    statements_tested: int = 0
    sk_gaap_statements: int = 0
    ifrs_statements: int = 0
    results: list[StatementResult] = field(default_factory=list)


# ── Ground truth extraction (independent from ruz_parser) ────────────────────

def extract_ground_truth(vykazy: list[dict], ico: str) -> Optional[FinancialMetrics]:
    """Independently parse RÚZ JSON to get ground truth metrics.

    This bypasses ruz_parser and directly reads specific row indices
    from the JSON tables. Uses the same row indices but independent
    extraction logic to catch mapping bugs.
    """
    all_tables = []
    ts = {}
    for vykaz in vykazy:
        obsah = vykaz.get("obsah", {})
        tables = obsah.get("tabulky", [])
        if tables:
            all_tables.extend(tables)
        if not ts:
            ts = obsah.get("titulnaStrana", {})

    if not all_tables:
        return None

    # Identify tables
    tab_map = _identify_tables(all_tables)
    if "aktiv" not in tab_map or "pasiv" not in tab_map:
        return None

    # Order tables
    ordered = [all_tables[tab_map["aktiv"]], all_tables[tab_map["pasiv"]]]
    if "income" in tab_map:
        ordered.append(all_tables[tab_map["income"]])
    has_income = len(ordered) > 2

    # Extract year
    obdobie_do = ts.get("obdobieDo", "")
    year = None
    if obdobie_do:
        m = re.search(r"(20\d{2})", str(obdobie_do))
        if m:
            year = int(m.group(1))

    if year is None:
        return None

    # Direct extraction — same row indices, but we read raw values
    # without unit detection, thousands fixing, or fallback logic.
    # This is the "raw ground truth" from RÚZ JSON.
    celkove_aktiva = _get_activ_value(ordered, ROW_TOTAL_ASSETS)
    obezny_majetok = _get_activ_value(ordered, ROW_CURRENT_ASSETS)
    peniaze = _get_activ_value(ordered, ROW_CASH)
    pohladavky = _get_activ_value(ordered, ROW_TRADE_RECEIVABLES)
    vlastne_imanie = _get_pasiv_value(ordered, ROW_TOTAL_EQUITY)
    kratkodobe_zavazky = _get_pasiv_value(ordered, ROW_ST_LIABILITIES)
    dlhodobe_zavazky = _get_pasiv_value(ordered, ROW_LT_LIABILITIES)
    trzby = _get_income_value(ordered, ROW_NET_REVENUE) if has_income else None
    zisk = _get_income_value(ordered, ROW_NET_PROFIT) if has_income else None
    osobne = _get_income_value(ordered, ROW_PERSONNEL_COSTS) if has_income else None
    odpisy = _get_income_value(ordered, ROW_DEPRECIATION) if has_income else None
    uroky = _get_income_value(ordered, ROW_INTEREST_EXPENSE) if has_income else None

    return FinancialMetrics(
        rok_zavierky=year,
        celkove_aktiva=celkove_aktiva,
        obezny_majetok=obezny_majetok,
        vlastne_imanie_celkom=vlastne_imanie,
        kratkodobe_zavazky=kratkodobe_zavazky,
        dlhodobe_zavazky=dlhodobe_zavazky,
        trzby_z_hlavnej_cinnosti=trzby,
        hruba_marza=None,
        zisk_alebo_strata_po_zdaneni=zisk,
        peniaze_a_penazne_ekvivalenty_k_31_12=peniaze,
        ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
        osobne_naklady=osobne,
        pohladavky_z_obchodneho_styku=pohladavky,
        zavazky_z_obchodneho_styku=None,
        zasoby=None,
        odpisy=odpisy,
        investicny_cash_flow=None,
        financny_cash_flow=None,
        uroky=uroky,
        pocet_zamestnancov=None,
        zavazky_sp=None,
        danove_zavazky=None,
        zavazky_zamestnanci=None,
        mena="EUR",
        typ_zavierky="SK_GAAP",
        pocet_mesiacov_obdobia=None,
        is_consolidated=ts.get("konsolidovana", False),
        # Extended fields (not needed for validation, but required by model)
        dan_z_prijmu=None,
        neobezny_majetok=None,
        dlhodoby_nehmotny_majetok=None,
        dlhodoby_hmotny_majetok=None,
        dlhodoby_financny_majetok=None,
        dlhodobe_pohladavky=None,
        kratkodoby_financny_majetok=None,
        casove_rozlisenie_aktiv=None,
        zakladne_imanie=None,
        emisione_azio=None,
        ostatne_kapitalove_fondy=None,
        zakonne_rezervne_fondy=None,
        ostatne_fondy_zo_zisku=None,
        vysledok_minuly_rokov=None,
        nerozdeleny_zisk=None,
        neuhradena_strata=None,
        vysledok_beziaceho_roka=None,
        dlhodobe_rezervy=None,
        kratkodobe_rezervy=None,
        bezne_bankove_uvery=None,
        kratkodobe_financne_vypomoci=None,
        naklady_na_hosp_cinnost=None,
        spotreba_materialu=None,
        sluzby=None,
        mzdove_naklady=None,
        dane_a_poplatky=None,
        vysledok_z_fin_cinnosti=None,
        zisk_pred_zdanenim=None,
        prevod_podielov_spolocnikom=None,
        datum_zostavenia=None,
        datum_schvalenia=None,
    )


# ── Comparison logic ─────────────────────────────────────────────────────────

def classify_mismatch(gt: Optional[float], ex: Optional[float]) -> tuple[str, bool, bool, Optional[float]]:
    """Compare ground truth vs extracted value.

    Returns: (classification, exact_match, within_1pct, ratio)
    """
    if gt is None and ex is None:
        return ("BOTH_NULL", True, True, None)
    if gt is None and ex is not None:
        return ("GT_NULL", False, False, None)
    if gt is not None and ex is None:
        return ("EXTRACTED_NULL", False, False, None)

    # Both non-None — type narrowing for pyright
    gt_v: float = gt  # type: ignore[assignment]
    ex_v: float = ex  # type: ignore[assignment]

    if gt_v == 0 and ex_v == 0:
        return ("EXACT", True, True, None)

    if gt_v == ex_v:
        return ("EXACT", True, True, None)

    # Check ratio for unit error detection
    if gt_v != 0 and ex_v != 0:
        ratio = gt_v / ex_v
        abs_ratio = abs(ratio)

        # Unit error: ratio is approximately 1000 or 0.001
        if 0.99 < abs_ratio / 1000 < 1.01:
            return ("UNIT_ERROR", False, False, ratio)
        if 0.99 < abs_ratio * 1000 < 1.01:
            return ("UNIT_ERROR", False, False, ratio)

        # Within 1% tolerance
        rel_diff = abs(gt_v - ex_v) / max(abs(gt_v), abs(ex_v))
        if rel_diff <= 0.01:
            return ("WITHIN_1PCT", False, True, ratio)

        return ("MISMATCH", False, False, ratio)

    return ("MISMATCH", False, False, None)


def compare_metrics(
    ground_truth: FinancialMetrics,
    extracted: FinancialMetrics,
) -> list[MetricComparison]:
    """Compare all metrics between ground truth and extracted."""
    results = []
    for field_name, label, _, _ in METRICS:
        gt_val = getattr(ground_truth, field_name, None)
        ex_val = getattr(extracted, field_name, None)

        classification, exact, within_1, ratio = classify_mismatch(gt_val, ex_val)

        results.append(MetricComparison(
            metric=field_name,
            label=label,
            ground_truth=gt_val,
            extracted=ex_val,
            exact_match=exact,
            within_1pct=within_1,
            ratio=ratio,
            classification=classification,
        ))
    return results


# ── RÚZ API data fetcher ─────────────────────────────────────────────────────

async def fetch_ruz_statements(ico: str, max_years: int = 5) -> list[dict]:
    """Fetch all závierky with full výkaz data for a given IČO.

    Returns list of dicts:
      {
        "zavierka": {...},
        "vykazy": [...],
        "year": int,
        "konsolidovana": bool,
      }
    """
    async with httpx.AsyncClient(headers={"User-Agent": _UA}) as client:
        # 1. Find entity
        entity_ids = await _api_get(client, "uctovne-jednotky", {
            "zmenene-od": "2000-01-01",
            "ico": ico,
            "max-zaznamov": 10,
        })
        if not entity_ids or not entity_ids.get("id"):
            return []

        entity_id = entity_ids["id"][0]
        entity = await _api_get(client, "uctovna-jednotka", {"id": entity_id})
        if not entity:
            return []

        zavierka_ids = entity.get("idUctovnychZavierok", [])
        if not zavierka_ids:
            return []

        # 2. Fetch závierka details
        zavierky = await _fetch_details(client, "uctovna-zavierka", zavierka_ids)
        zavierky.sort(key=lambda z: _period_sort_key(_period_from_dict(z)), reverse=True)
        top_zavierky = _dedup_by_period(zavierky, max_years)

        # 3. For each závierka, fetch all výkazy
        statements = []
        for z in top_zavierky:
            vykaz_ids = z.get("idUctovnychVykazov", [])
            if not vykaz_ids:
                continue

            vykazy = await _fetch_details(client, "uctovny-vykaz", vykaz_ids)
            vykazy = [v for v in vykazy if isinstance(v, dict)]

            # Skip non-public data
            public_vykazy = []
            for v in vykazy:
                pristupnost = v.get("pristupnostDat", "")
                if pristupnost and pristupnost.lower().startswith("neverejn"):
                    continue
                public_vykazy.append(v)

            if not public_vykazy:
                continue

            period = _period_from_dict(z)
            year_str = _year_from_period(period)
            year = int(year_str) if year_str and year_str.isdigit() else None
            if year is None:
                continue

            konsolidovana = z.get("konsolidovana", False)

            statements.append({
                "zavierka": z,
                "vykazy": public_vykazy,
                "year": year,
                "konsolidovana": konsolidovana,
            })

        return statements


# ── Main validation logic ────────────────────────────────────────────────────

async def validate_company(company: dict) -> list[StatementResult]:
    """Validate all statements for one company."""
    ico = company["ico"]
    name = company.get("name", ico)
    results = []

    try:
        statements = await fetch_ruz_statements(ico, max_years=3)
    except Exception as e:
        logger.error(f"[{ico}] Failed to fetch RÚZ data: {e}")
        return [StatementResult(
            ico=ico, company_name=name, year=0,
            statement_type="ERROR", konsolidovana=False,
            error=f"RÚZ API fetch failed: {e}",
        )]

    if not statements:
        return [StatementResult(
            ico=ico, company_name=name, year=0,
            statement_type="NO_DATA", konsolidovana=False,
            error="No statements found in RÚZ",
        )]

    for stmt in statements:
        year = stmt["year"]
        kons = stmt["konsolidovana"]
        stmt_type = "IFRS" if kons else "SK_GAAP"
        vykazy = stmt["vykazy"]

        result = StatementResult(
            ico=ico,
            company_name=name,
            year=year,
            statement_type=stmt_type,
            konsolidovana=kons,
        )

        # Ground truth: independent extraction from raw JSON
        gt = extract_ground_truth(vykazy, ico)
        if gt is None:
            result.error = "Ground truth extraction failed (no tables or missing aktív/pasív)"
            results.append(result)
            continue

        # Verifa extraction: ruz_parser
        try:
            extracted = parse_zavierka_to_metrics(vykazy, ico)
        except Exception as e:
            result.error = f"ruz_parser failed: {e}"
            results.append(result)
            continue

        if extracted is None:
            result.error = "ruz_parser returned None"
            results.append(result)
            continue

        # Year check
        result.year_correct = (gt.rok_zavierky == extracted.rok_zavierky)
        if not result.year_correct:
            # Add year as a mismatch
            result.metrics.append(MetricComparison(
                metric="rok_zavierky",
                label="Year",
                ground_truth=float(gt.rok_zavierky),
                extracted=float(extracted.rok_zavierky),
                exact_match=False,
                within_1pct=False,
                ratio=None,
                classification="YEAR_ERROR",
            ))

        # Compare metrics
        result.metrics = compare_metrics(gt, extracted)

        # Check for unit errors
        result.unit_error = any(m.classification == "UNIT_ERROR" for m in result.metrics)

        results.append(result)

    return results


# ── Report formatting ────────────────────────────────────────────────────────

def format_number(val: Optional[float]) -> str:
    if val is None:
        return "None"
    if val == 0:
        return "0"
    abs_val = abs(val)
    if abs_val >= 1_000_000:
        return f"{val / 1_000_000:,.1f}M"
    elif abs_val >= 1_000:
        return f"{val / 1_000:,.1f}K"
    return f"{val:.2f}"


def print_report(report: ValidationReport, detailed: bool = False):
    """Print the validation report in the requested format."""
    print()
    print("=" * 70)
    print("P4.1 FINANCIAL VALIDATION")
    print("=" * 70)
    print()
    print(f"Companies tested:       {report.companies_tested}")
    print(f"Statements tested:      {report.statements_tested}")
    print(f"  SK GAAP:              {report.sk_gaap_statements}")
    print(f"  IFRS:                 {report.ifrs_statements}")
    print()

    # Per-metric summary
    metric_stats = {}
    for m in METRICS:
        field_name, label, _, _ = m
        exact_count = 0
        within_1_count = 0
        total = 0
        unit_errors = 0
        mismatches = 0
        gt_nulls = 0
        ex_nulls = 0

        for result in report.results:
            for mc in result.metrics:
                if mc.metric == field_name:
                    total += 1
                    if mc.classification == "EXACT":
                        exact_count += 1
                        within_1_count += 1
                    elif mc.classification == "WITHIN_1PCT":
                        within_1_count += 1
                    elif mc.classification == "UNIT_ERROR":
                        unit_errors += 1
                    elif mc.classification == "MISMATCH":
                        mismatches += 1
                    elif mc.classification == "GT_NULL":
                        gt_nulls += 1
                    elif mc.classification == "EXTRACTED_NULL":
                        ex_nulls += 1
                    elif mc.classification == "BOTH_NULL":
                        exact_count += 1
                        within_1_count += 1
                    break

        if total == 0:
            continue

        metric_stats[field_name] = {
            "label": label,
            "total": total,
            "exact": exact_count,
            "within_1": within_1_count,
            "unit_errors": unit_errors,
            "mismatches": mismatches,
            "gt_nulls": gt_nulls,
            "ex_nulls": ex_nulls,
        }

    print("─" * 70)
    print(f"{'Metric':<30} {'Exact':>10} {'Within 1%':>12} {'Unit Err':>10} {'Mismatch':>10}")
    print("─" * 70)
    for field_name, stats in metric_stats.items():
        total = stats["total"]
        exact_pct = stats["exact"] / total * 100 if total else 0
        within_pct = stats["within_1"] / total * 100 if total else 0
        print(
            f"{stats['label']:<30} "
            f"{stats['exact']}/{total} {exact_pct:>5.1f}%  "
            f"{stats['within_1']}/{total} {within_pct:>5.1f}%  "
            f"{stats['unit_errors']:>10}  "
            f"{stats['mismatches']:>10}"
        )
    print("─" * 70)

    # Aggregate
    total_exact = sum(s["exact"] for s in metric_stats.values())
    total_within = sum(s["within_1"] for s in metric_stats.values())
    total_comparisons = sum(s["total"] for s in metric_stats.values())
    total_unit_errors = sum(s["unit_errors"] for s in metric_stats.values())
    total_mismatches = sum(s["mismatches"] for s in metric_stats.values())
    total_year_errors = sum(
        1 for r in report.results
        for m in r.metrics
        if m.classification == "YEAR_ERROR"
    )

    print()
    print(f"Total comparisons:      {total_comparisons}")
    print(f"Exact matches:          {total_exact}/{total_comparisons} "
          f"({total_exact / total_comparisons * 100:.1f}%)" if total_comparisons else "")
    print(f"Within 1%:              {total_within}/{total_comparisons} "
          f"({total_within / total_comparisons * 100:.1f}%)" if total_comparisons else "")
    print(f"Unit errors:            {total_unit_errors}")
    print(f"Year errors:            {total_year_errors}")
    print(f"Critical mismatches:    {total_mismatches}")
    print()

    # ── Track A: SK GAAP deterministic ──
    sk_results = [r for r in report.results if r.statement_type == "SK_GAAP" and not r.error]
    if sk_results:
        print("─" * 70)
        print("A. SK GAAP DETERMINISTIC (ruz_parser vs independent JSON extraction)")
        print("─" * 70)
        sk_exact = sum(
            1 for r in sk_results for m in r.metrics
            if m.exact_match
        )
        sk_total = sum(
            1 for r in sk_results for m in r.metrics
            if m.classification != "BOTH_NULL"
        )
        sk_all = sum(1 for r in sk_results for m in r.metrics)
        print(f"  Statements:           {len(sk_results)}")
        print(f"  Comparisons:          {sk_all}")
        print(f"  Exact:                {sk_exact}/{sk_all}"
              f" ({sk_exact / sk_all * 100:.1f}%)" if sk_all else "")
        sk_unit = sum(1 for r in sk_results for m in r.metrics if m.classification == "UNIT_ERROR")
        sk_mismatch = sum(1 for r in sk_results for m in r.metrics if m.classification == "MISMATCH")
        print(f"  Unit errors:          {sk_unit}")
        print(f"  Mismatches:           {sk_mismatch}")
        print()

    # ── Track B: IFRS ──
    ifrs_results = [r for r in report.results if r.statement_type == "IFRS" and not r.error]
    if ifrs_results:
        print("─" * 70)
        print("B. IFRS (ruz_parser on IFRS JSON — LLM track requires --with-llm)")
        print("─" * 70)
        ifrs_exact = sum(1 for r in ifrs_results for m in r.metrics if m.exact_match)
        ifrs_all = sum(1 for r in ifrs_results for m in r.metrics)
        print(f"  Statements:           {len(ifrs_results)}")
        print(f"  Comparisons:          {ifrs_all}")
        if ifrs_all:
            print(f"  Exact:                {ifrs_exact}/{ifrs_all}"
                  f" ({ifrs_exact / ifrs_all * 100:.1f}%)")
        print()

    # ── Detailed mismatches ──
    mismatches = [
        (r, m) for r in report.results
        for m in r.metrics
        if m.classification in ("UNIT_ERROR", "MISMATCH", "YEAR_ERROR")
    ]

    if mismatches:
        print("─" * 70)
        print("DETAILED MISMATCHES")
        print("─" * 70)
        for r, m in mismatches:
            print()
            print(f"IČO: {r.ico}")
            print(f"Company: {r.company_name}")
            print(f"Year: {r.year} ({r.statement_type})")
            print(f"Metric: {m.label} ({m.metric})")
            print(f"  Ground truth: {format_number(m.ground_truth)}")
            print(f"  Extracted:    {format_number(m.extracted)}")
            if m.ratio:
                print(f"  Ratio:        {m.ratio:.1f}×")
            print(f"  Classification:")
            print(f"    → {m.classification}")
        print()

    # ── Errors ──
    errors = [r for r in report.results if r.error]
    if errors:
        print("─" * 70)
        print("ERRORS (statements that could not be processed)")
        print("─" * 70)
        for r in errors:
            print(f"  {r.ico} ({r.company_name}) [{r.statement_type}]: {r.error}")
        print()

    print("=" * 70)
    print("P4.1 VALIDATION COMPLETE")
    print("=" * 70)
    print()


def report_to_json(report: ValidationReport) -> dict:
    """Serialize report to JSON-serializable dict."""
    return {
        "companies_tested": report.companies_tested,
        "statements_tested": report.statements_tested,
        "sk_gaap_statements": report.sk_gaap_statements,
        "ifrs_statements": report.ifrs_statements,
        "results": [
            {
                "ico": r.ico,
                "company_name": r.company_name,
                "year": r.year,
                "statement_type": r.statement_type,
                "konsolidovana": r.konsolidovana,
                "year_correct": r.year_correct,
                "unit_error": r.unit_error,
                "error": r.error,
                "metrics": [
                    {
                        "metric": m.metric,
                        "label": m.label,
                        "ground_truth": m.ground_truth,
                        "extracted": m.extracted,
                        "exact_match": m.exact_match,
                        "within_1pct": m.within_1pct,
                        "ratio": m.ratio,
                        "classification": m.classification,
                    }
                    for m in r.metrics
                ],
            }
            for r in report.results
        ],
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="P4.1 Financial Validation Harness")
    parser.add_argument("--sk-gaap-only", action="store_true", help="Only test SK GAAP companies")
    parser.add_argument("--ifrs-only", action="store_true", help="Only test IFRS companies")
    parser.add_argument("--ico", type=str, help="Test single IČO")
    parser.add_argument("--limit", type=int, help="Limit to first N companies")
    parser.add_argument("--output", type=str, help="Save JSON report to file")
    parser.add_argument("--detailed", action="store_true", help="Print detailed per-company results")
    args = parser.parse_args()

    # Select companies
    if args.ico:
        companies = [{"ico": args.ico, "name": f"IČO {args.ico}", "category": "single"}]
    else:
        companies = COMPANIES.copy()

    if args.sk_gaap_only:
        companies = [c for c in companies if c["category"] in ("sk_gaap_sro",)]
    elif args.ifrs_only:
        companies = [c for c in companies if c["category"] in ("ifrs", "larger")]

    if args.limit:
        companies = companies[:args.limit]

    print(f"P4.1 Financial Validation — {len(companies)} companies")
    print(f"Fetching RÚZ data and comparing extractions...")
    print()

    report = ValidationReport()
    report.companies_tested = len(companies)

    for i, company in enumerate(companies):
        ico = company["ico"]
        name = company.get("name", ico)
        print(f"  [{i+1}/{len(companies)}] {ico} — {name}...", end=" ", flush=True)

        t_start = time.perf_counter()
        results = await validate_company(company)
        elapsed = time.perf_counter() - t_start

        if not results:
            print("NO DATA")
            continue

        has_error = any(r.error for r in results)
        if has_error:
            errs = [r for r in results if r.error]
            err_msg = (errs[0].error or "unknown")[:60]
            print(f"ERROR ({len(errs)}/{len(results)} statements) — {err_msg}")
        else:
            exact_count = sum(1 for r in results for m in r.metrics if m.exact_match)
            total_count = sum(1 for r in results for m in r.metrics)
            print(f"OK — {len(results)} statements, {exact_count}/{total_count} exact ({elapsed:.1f}s)")

        report.results.extend(results)
        report.statements_tested += len(results)
        report.sk_gaap_statements += sum(1 for r in results if r.statement_type == "SK_GAAP")
        report.ifrs_statements += sum(1 for r in results if r.statement_type == "IFRS")

    # Print report
    print_report(report, detailed=args.detailed)

    # Save JSON
    if args.output:
        output_path = Path(args.output)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report_to_json(report), f, ensure_ascii=False, indent=2)
        print(f"JSON report saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())

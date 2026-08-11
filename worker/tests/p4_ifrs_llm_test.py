#!/usr/bin/env python3
"""
P4.1.3 IFRS LLM Extraction Accuracy Test
=========================================

Tests the full IFRS PDF → LLM extraction pipeline:

  IFRS PDF → Gemini extract_financial_data (primary)
           → Gemini verify_critical_numbers_blind (verifier)
           → RÚZ JSON ground truth (if available)
           → COMPARE

For each statement, classifies each metric as:
  A — Primary correct (matches ground truth)
  B — Verifier correct (verifier matches, primary doesn't)
  C — Both correct (both match ground truth)
  D — Both wrong (neither matches ground truth) ← CRITICAL
  E — Disagreement (primary and verifier disagree, no ground truth)

Usage:
  cd worker/
  # Set GEMINI_API_KEY or GEMINI_API_KEYS env var first!
  python3 tests/p4_ifrs_llm_test.py                    # Full run
  python3 tests/p4_ifrs_llm_test.py --limit 5          # First 5 PDFs
  python3 tests/p4_ifrs_llm_test.py --ico 35876832     # Single company
  python3 tests/p4_ifrs_llm_test.py --output report.json

Requirements:
  - GEMINI_API_KEY env var set
  - Internet access (RÚZ API + Gemini API)
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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from src.config import settings
from src.agents.financial_analyst import extract_financial_data, verify_critical_numbers_blind
from src.agents.shared import CompanyFinancialExtraction, VerificationExtraction, FinancialMetrics
from src.ruz_api import (
    _RUZ_API, _UA, _TIMEOUT,
    _api_get, _fetch_details,
    _period_from_dict, _year_from_period, _period_sort_key, _dedup_by_period,
    _download_prilohy,
)
from src.ruz_parser import parse_zavierka_to_metrics

logger = logging.getLogger("p4_ifrs_test")
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

# ── IFRS companies to test ───────────────────────────────────────────────────
# These are companies that have IFRS (konsolidované) závierky in RÚZ.
# We need companies where:
# 1. RÚZ has structured JSON (for ground truth)
# 2. RÚZ also has PDF attachments (for LLM extraction)
# OR: companies with PDF-only IFRS where we can get ground truth from JSON

IFRS_COMPANIES = [
    # Companies with konsolidované závierky (IFRS)
    {"ico": "35876832", "name": "KIA Motors Slovakia", "category": "ifrs_large"},
    {"ico": "31637051", "name": "Mondi SCP a.s.", "category": "ifrs_large"},
    {"ico": "31733221", "name": "VOPAL s.r.o.", "category": "ifrs_small"},
    # Obce typically have konsolidované závierky
    {"ico": "00311715", "name": "Obec Krajné", "category": "ifrs_obec"},
    {"ico": "00603201", "name": "MČ Bratislava Petržalka", "category": "ifrs_obec"},
    {"ico": "00318337", "name": "Obec Nitrianske Pravno", "category": "ifrs_obec"},
    # More companies — try larger ones
    {"ico": "31637261", "name": "Slovenské elektrárne", "category": "ifrs_large"},
    {"ico": "31827216", "name": "Železnice SR", "category": "ifrs_large"},
    {"ico": "31331132", "name": "VSE Holding", "category": "ifrs_large"},
    {"ico": "35710132", "name": "Tatra banka", "category": "ifrs_bank"},
    {"ico": "31330491", "name": "Slovenská sporiteľňa", "category": "ifrs_bank"},
    {"ico": "00662110", "name": "VÚB banka", "category": "ifrs_bank"},
    # SK GAAP companies with PDF attachments (for comparison)
    {"ico": "00603783", "name": "NEOXX a.s.", "category": "sk_gaap"},
    {"ico": "00643581", "name": "TERRASTROJ", "category": "sk_gaap"},
    {"ico": "00590797", "name": "ZTS Sabinov", "category": "sk_gaap"},
]

# ── Metrics to compare ───────────────────────────────────────────────────────

VERIFY_FIELDS = [
    "celkove_aktiva",
    "trzby_z_hlavnej_cinnosti",
    "zisk_alebo_strata_po_zdaneni",
    "vlastne_imanie_celkom",
    "ciste_penazne_toky_z_prevadzkovej_cinnosti",
]

ALL_FIELDS = [
    "celkove_aktiva",
    "obezny_majetok",
    "vlastne_imanie_celkom",
    "kratkodobe_zavazky",
    "dlhodobe_zavazky",
    "trzby_z_hlavnej_cinnosti",
    "zisk_alebo_strata_po_zdaneni",
    "osobne_naklady",
    "odpisy",
    "uroky",
    "peniaze_a_penazne_ekvivalenty_k_31_12",
    "pohladavky_z_obchodneho_styku",
]

FIELD_LABELS = {
    "celkove_aktiva": "Total Assets",
    "obezny_majetok": "Current Assets",
    "vlastne_imanie_celkom": "Total Equity",
    "kratkodobe_zavazky": "ST Liabilities",
    "dlhodobe_zavazky": "LT Liabilities",
    "trzby_z_hlavnej_cinnosti": "Revenue",
    "zisk_alebo_strata_po_zdaneni": "Net Profit",
    "osobne_naklady": "Personnel Costs",
    "odpisy": "Depreciation",
    "uroky": "Interest Expense",
    "peniaze_a_penazne_ekvivalenty_k_31_12": "Cash",
    "pohladavky_z_obchodneho_styku": "Trade Receivables",
    "ciste_penazne_toky_z_prevadzkovej_cinnosti": "Operating CF",
}


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class MetricResult:
    metric: str
    label: str
    ground_truth: Optional[float]
    primary: Optional[float]
    verifier: Optional[float]
    primary_correct: bool
    verifier_correct: bool
    classification: str  # A, B, C, D, E, NO_GT, BOTH_NULL
    primary_ratio: Optional[float] = None
    verifier_ratio: Optional[float] = None


@dataclass
class StatementResult:
    ico: str
    company_name: str
    year: int
    statement_type: str
    has_pdf: bool
    has_json: bool
    pdf_path: Optional[str] = None
    metrics: list[MetricResult] = field(default_factory=list)
    error: Optional[str] = None
    extraction_time_s: float = 0.0


@dataclass
class IFRSReport:
    companies_tested: int = 0
    statements_tested: int = 0
    pdfs_extracted: int = 0
    json_ground_truth: int = 0
    results: list[StatementResult] = field(default_factory=list)


# ── Helpers ──────────────────────────────────────────────────────────────────

def values_match(a: Optional[float], b: Optional[float], tolerance: float = 0.01) -> bool:
    if a is None or b is None:
        return False
    if a == 0 and b == 0:
        return True
    return abs(a - b) / max(abs(a), abs(b)) <= tolerance


def classify(gt: Optional[float], primary: Optional[float], verifier: Optional[float]) -> tuple[str, bool, bool]:
    """Classify a metric comparison.

    Returns: (classification, primary_correct, verifier_correct)
    """
    if gt is None and primary is None and verifier is None:
        return ("BOTH_NULL", True, True)
    if gt is None:
        # No ground truth — check if primary and verifier agree
        if primary is not None and verifier is not None:
            if values_match(primary, verifier):
                return ("E_AGREE", False, False)  # Agree but no GT
            else:
                return ("E_DISAGREE", False, False)
        return ("NO_GT", False, False)

    p_correct = values_match(gt, primary)
    v_correct = values_match(gt, verifier) if verifier is not None else False

    if p_correct and v_correct:
        return ("C_BOTH_CORRECT", True, True)
    if p_correct and not v_correct:
        return ("A_PRIMARY_CORRECT", True, False)
    if not p_correct and v_correct:
        return ("B_VERIFIER_CORRECT", False, True)
    # Both wrong
    return ("D_BOTH_WRONG", False, False)


def format_number(val: Optional[float]) -> str:
    if val is None:
        return "None"
    if val == 0:
        return "0"
    abs_val = abs(val)
    if abs_val >= 1_000_000_000:
        return f"{val / 1_000_000_000:,.1f}B"
    if abs_val >= 1_000_000:
        return f"{val / 1_000_000:,.1f}M"
    if abs_val >= 1_000:
        return f"{val / 1_000:,.1f}K"
    return f"{val:.2f}"


# ── RÚZ data fetcher ─────────────────────────────────────────────────────────

async def fetch_ruz_data(ico: str, max_years: int = 3) -> list[dict]:
    """Fetch závierky with both JSON tables AND PDF attachments."""
    async with httpx.AsyncClient(headers={"User-Agent": _UA}) as client:
        entity_ids = await _api_get(client, "uctovne-jednotky", {
            "zmenene-od": "2000-01-01", "ico": ico, "max-zaznamov": 10,
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

        zavierky = await _fetch_details(client, "uctovna-zavierka", zavierka_ids)
        zavierky.sort(key=lambda z: _period_sort_key(_period_from_dict(z)), reverse=True)
        top = _dedup_by_period(zavierky, max_years)

        statements = []
        for z in top:
            vykaz_ids = z.get("idUctovnychVykazov", [])
            if not vykaz_ids:
                continue

            vykazy = await _fetch_details(client, "uctovny-vykaz", vykaz_ids)
            vykazy = [v for v in vykazy if isinstance(v, dict)]

            # Filter public
            public = []
            for v in vykazy:
                prist = v.get("pristupnostDat", "")
                if prist and "neverejn" in prist.lower():
                    continue
                public.append(v)

            if not public:
                continue

            period = _period_from_dict(z)
            year_str = _year_from_period(period)
            year = int(year_str) if year_str and year_str.isdigit() else None
            if year is None:
                continue

            kons = z.get("konsolidovana", False)

            # Check for JSON tables (ground truth)
            has_json = any(v.get("obsah", {}).get("tabulky", []) for v in public)

            # Collect prilohy from all výkazy for PDF download
            all_prilohy = []
            for v in public:
                prilohy = v.get("prilohy", [])
                if prilohy:
                    all_prilohy.extend(prilohy)

            # Download PDFs via _download_prilohy (handles PDF + ZIP)
            pdf_bytes_list = []
            if all_prilohy:
                try:
                    pdf_bytes_list = await _download_prilohy(all_prilohy)
                except Exception as e:
                    logger.warning(f"[{ico}] Prílohy download failed: {e}")

            statements.append({
                "zavierka": z,
                "vykazy": public,
                "year": year,
                "konsolidovana": kons,
                "has_json": has_json,
                "pdf_bytes_list": pdf_bytes_list,
                "prilohy_count": len(all_prilohy),
            })

        return statements


async def download_pdf(url: str, output_path: str) -> bool:
    """Download a PDF from RÚZ."""
    try:
        async with httpx.AsyncClient(headers={"User-Agent": _UA}, timeout=60) as c:
            r = await c.get(url, follow_redirects=True)
            if r.status_code == 200 and len(r.content) > 100:
                with open(output_path, "wb") as f:
                    f.write(r.content)
                return True
    except Exception as e:
        logger.error(f"PDF download failed: {url} — {e}")
    return False


# ── Main test logic ──────────────────────────────────────────────────────────

async def test_company(company: dict, assets_dir: str = "tests/output/ifrs_assets") -> list[StatementResult]:
    """Test IFRS LLM extraction for one company."""
    ico = company["ico"]
    name = company.get("name", ico)
    results = []

    # Check API key
    if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GEMINI_API_KEYS") and not os.environ.get("GOOGLE_API_KEY"):
        return [StatementResult(
            ico=ico, company_name=name, year=0,
            statement_type="ERROR", has_pdf=False, has_json=False,
            error="No GEMINI_API_KEY set",
        )]

    try:
        statements = await fetch_ruz_data(ico, max_years=2)
    except Exception as e:
        return [StatementResult(
            ico=ico, company_name=name, year=0,
            statement_type="ERROR", has_pdf=False, has_json=False,
            error=f"RÚZ API failed: {e}",
        )]

    if not statements:
        return [StatementResult(
            ico=ico, company_name=name, year=0,
            statement_type="NO_DATA", has_pdf=False, has_json=False,
            error="No statements found",
        )]

    # Create assets dir
    Path(assets_dir).mkdir(parents=True, exist_ok=True)

    for stmt in statements:
        year = stmt["year"]
        kons = stmt["konsolidovana"]
        stmt_type = "IFRS" if kons else "SK_GAAP"
        has_json = stmt["has_json"]
        pdf_bytes_list = stmt.get("pdf_bytes_list", [])

        result = StatementResult(
            ico=ico, company_name=name, year=year,
            statement_type=stmt_type,
            has_pdf=len(pdf_bytes_list) > 0,
            has_json=has_json,
        )

        # Get ground truth from JSON if available
        ground_truth = None
        if has_json:
            try:
                ground_truth = parse_zavierka_to_metrics(stmt["vykazy"], ico)
            except Exception as e:
                logger.warning(f"[{ico}] Ground truth parse failed: {e}")

        # Need a PDF for LLM extraction
        if not pdf_bytes_list:
            result.error = f"No PDF prílohy (prilohy_count={stmt.get('prilohy_count', 0)})"
            results.append(result)
            continue

        # Save first PDF to disk
        pdf_path = os.path.join(assets_dir, f"IFRS_{ico}_{year}.pdf")
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes_list[0])

        result.pdf_path = pdf_path

        # Run LLM extraction (primary + verifier in parallel)
        t_start = time.perf_counter()
        try:
            primary_data, verify_data = await asyncio.gather(
                extract_financial_data(pdf_path, model=settings.model_ifrs),
                verify_critical_numbers_blind(pdf_path, model=settings.model_fallback),
            )
        except Exception as e:
            result.error = f"LLM extraction failed: {e}"
            result.extraction_time_s = time.perf_counter() - t_start
            results.append(result)
            continue

        result.extraction_time_s = time.perf_counter() - t_start

        # Compare metrics
        for field_name in ALL_FIELDS:
            gt_val = getattr(ground_truth, field_name, None) if ground_truth else None
            p_val = getattr(primary_data.metriky, field_name, None) if primary_data else None

            # Verifier only has subset of fields
            v_val = getattr(verify_data, field_name, None) if verify_data and field_name in VERIFY_FIELDS else None

            classification, p_correct, v_correct = classify(gt_val, p_val, v_val)

            p_ratio = None
            v_ratio = None
            if gt_val and p_val and p_val != 0:
                p_ratio = gt_val / p_val
            if gt_val and v_val and v_val != 0:
                v_ratio = gt_val / v_val

            result.metrics.append(MetricResult(
                metric=field_name,
                label=FIELD_LABELS.get(field_name, field_name),
                ground_truth=gt_val,
                primary=p_val,
                verifier=v_val,
                primary_correct=p_correct,
                verifier_correct=v_correct,
                classification=classification,
                primary_ratio=p_ratio,
                verifier_ratio=v_ratio,
            ))

        results.append(result)

    return results


# ── Report formatting ────────────────────────────────────────────────────────

def print_report(report: IFRSReport):
    print()
    print("=" * 80)
    print("P4.1.3 IFRS LLM EXTRACTION ACCURACY TEST")
    print("=" * 80)
    print()
    print(f"Companies tested:       {report.companies_tested}")
    print(f"Statements tested:      {report.statements_tested}")
    print(f"PDFs extracted:         {report.pdfs_extracted}")
    print(f"JSON ground truth:      {report.json_ground_truth}")
    print()

    # Classification counts
    class_counts = {}
    for r in report.results:
        for m in r.metrics:
            class_counts[m.classification] = class_counts.get(m.classification, 0) + 1

    total = sum(class_counts.values())
    if total == 0:
        print("No metrics to compare.")
        print()
        return

    print("─" * 80)
    print(f"{'Classification':<30} {'Count':>8} {'%':>8}")
    print("─" * 80)

    class_labels = {
        "C_BOTH_CORRECT": "C — Both correct",
        "A_PRIMARY_CORRECT": "A — Primary correct only",
        "B_VERIFIER_CORRECT": "B — Verifier correct only",
        "D_BOTH_WRONG": "D — Both wrong ← CRITICAL",
        "E_AGREE": "E — Agree (no GT)",
        "E_DISAGREE": "E — Disagree (no GT)",
        "NO_GT": "— No ground truth",
        "BOTH_NULL": "— Both null",
    }

    # Print in order of importance
    for key in ["C_BOTH_CORRECT", "A_PRIMARY_CORRECT", "B_VERIFIER_CORRECT",
                "D_BOTH_WRONG", "E_AGREE", "E_DISAGREE", "NO_GT", "BOTH_NULL"]:
        if key in class_counts:
            count = class_counts[key]
            label = class_labels.get(key, key)
            pct = count / total * 100
            marker = " ←←" if key == "D_BOTH_WRONG" else ""
            print(f"  {label:<28} {count:>8} {pct:>7.1f}%{marker}")

    print("─" * 80)
    print(f"  {'TOTAL':<28} {total:>8} {100.0:>7.1f}%")
    print()

    # Per-metric accuracy (where we have ground truth)
    print("─" * 80)
    print("Per-metric accuracy (with ground truth)")
    print("─" * 80)
    print(f"{'Metric':<25} {'GT Count':>10} {'Primary':>10} {'Verifier':>10} {'Both Wrong':>12}")
    print("─" * 80)

    for field_name in ALL_FIELDS:
        gt_count = 0
        p_correct = 0
        v_correct = 0
        both_wrong = 0

        for r in report.results:
            for m in r.metrics:
                if m.metric != field_name:
                    continue
                if m.ground_truth is not None:
                    gt_count += 1
                    if m.primary_correct:
                        p_correct += 1
                    if m.verifier_correct:
                        v_correct += 1
                    if m.classification == "D_BOTH_WRONG":
                        both_wrong += 1

        if gt_count == 0:
            continue

        label = FIELD_LABELS.get(field_name, field_name)
        p_pct = p_correct / gt_count * 100 if gt_count else 0
        v_pct = v_correct / gt_count * 100 if gt_count else 0
        print(f"  {label:<23} {gt_count:>10} {p_correct:>7}/{gt_count:<2} {v_correct:>7}/{gt_count:<2} {both_wrong:>12}")

    print("─" * 80)
    print()

    # Detailed D_BOTH_WRONG cases
    d_cases = [(r, m) for r in report.results for m in r.metrics if m.classification == "D_BOTH_WRONG"]
    if d_cases:
        print("=" * 80)
        print("CRITICAL: D — BOTH WRONG cases")
        print("=" * 80)
        for r, m in d_cases:
            print()
            print(f"IČO: {r.ico}")
            print(f"Company: {r.company_name}")
            print(f"Year: {r.year} ({r.statement_type})")
            print(f"Metric: {m.label} ({m.metric})")
            print(f"  Ground truth: {format_number(m.ground_truth)}")
            print(f"  Primary:      {format_number(m.primary)}" + (f" (ratio: {m.primary_ratio:.1f}×)" if m.primary_ratio else ""))
            print(f"  Verifier:     {format_number(m.verifier)}" + (f" (ratio: {m.verifier_ratio:.1f}×)" if m.verifier_ratio else ""))
        print()

    # Detailed E_DISAGREE cases
    e_cases = [(r, m) for r in report.results for m in r.metrics if m.classification == "E_DISAGREE"]
    if e_cases:
        print("─" * 80)
        print("WARNING: E — Disagreement (no ground truth to arbitrate)")
        print("─" * 80)
        for r, m in e_cases:
            print(f"  {r.ico} {r.year} {m.label}: primary={format_number(m.primary)} verifier={format_number(m.verifier)}")
        print()

    # Errors
    errors = [r for r in report.results if r.error]
    if errors:
        print("─" * 80)
        print("ERRORS")
        print("─" * 80)
        for r in errors:
            print(f"  {r.ico} ({r.company_name}) [{r.statement_type}] year={r.year}: {r.error}")
        print()

    # Timing
    times = [r.extraction_time_s for r in report.results if r.extraction_time_s > 0]
    if times:
        print(f"Avg extraction time: {sum(times)/len(times):.1f}s")
        print(f"Max extraction time: {max(times):.1f}s")
        print()

    print("=" * 80)
    print("P4.1.3 IFRS LLM TEST COMPLETE")
    print("=" * 80)
    print()


def report_to_json(report: IFRSReport) -> dict:
    return {
        "companies_tested": report.companies_tested,
        "statements_tested": report.statements_tested,
        "pdfs_extracted": report.pdfs_extracted,
        "json_ground_truth": report.json_ground_truth,
        "results": [
            {
                "ico": r.ico,
                "company_name": r.company_name,
                "year": r.year,
                "statement_type": r.statement_type,
                "has_pdf": r.has_pdf,
                "has_json": r.has_json,
                "pdf_path": r.pdf_path,
                "error": r.error,
                "extraction_time_s": r.extraction_time_s,
                "metrics": [
                    {
                        "metric": m.metric,
                        "label": m.label,
                        "ground_truth": m.ground_truth,
                        "primary": m.primary,
                        "verifier": m.verifier,
                        "primary_correct": m.primary_correct,
                        "verifier_correct": m.verifier_correct,
                        "classification": m.classification,
                        "primary_ratio": m.primary_ratio,
                        "verifier_ratio": m.verifier_ratio,
                    }
                    for m in r.metrics
                ],
            }
            for r in report.results
        ],
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="P4.1.3 IFRS LLM Extraction Accuracy Test")
    parser.add_argument("--ico", type=str, help="Test single IČO")
    parser.add_argument("--limit", type=int, help="Limit to first N companies")
    parser.add_argument("--output", type=str, help="Save JSON report to file")
    parser.add_argument("--assets-dir", type=str, default="tests/output/ifrs_assets", help="Directory for PDF assets")
    args = parser.parse_args()

    # Check API key
    has_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEYS") or os.environ.get("GOOGLE_API_KEY")
    if not has_key:
        print("ERROR: Set GEMINI_API_KEY (or GEMINI_API_KEYS) env var before running this test.")
        print("  export GEMINI_API_KEY='your-key-here'")
        sys.exit(1)

    if args.ico:
        companies = [{"ico": args.ico, "name": f"IČO {args.ico}", "category": "single"}]
    else:
        companies = IFRS_COMPANIES.copy()

    if args.limit:
        companies = companies[:args.limit]

    print(f"P4.1.3 IFRS LLM Extraction Test — {len(companies)} companies")
    print(f"Primary model:   {settings.model_ifrs}")
    print(f"Verifier model:  {settings.model_fallback}")
    print()

    report = IFRSReport(companies_tested=len(companies))

    for i, company in enumerate(companies):
        ico = company["ico"]
        name = company.get("name", ico)
        print(f"  [{i+1}/{len(companies)}] {ico} — {name}...", end=" ", flush=True)

        t_start = time.perf_counter()
        results = await test_company(company, assets_dir=args.assets_dir)
        elapsed = time.perf_counter() - t_start

        if not results:
            print("NO DATA")
            continue

        has_error = any(r.error for r in results)
        if has_error:
            errs = [r for r in results if r.error]
            err_msg = (errs[0].error or "unknown")[:60]
            print(f"ERROR — {err_msg} ({elapsed:.1f}s)")
        else:
            pdf_count = sum(1 for r in results if r.has_pdf)
            json_count = sum(1 for r in results if r.has_json)
            d_count = sum(1 for r in results for m in r.metrics if m.classification == "D_BOTH_WRONG")
            c_count = sum(1 for r in results for m in r.metrics if m.classification == "C_BOTH_CORRECT")
            total_metrics = sum(1 for r in results for m in r.metrics)
            print(f"OK — {len(results)} stmts, {pdf_count} PDFs, {json_count} JSON, "
                  f"C={c_count} D={d_count}/{total_metrics} ({elapsed:.1f}s)")

        report.results.extend(results)
        report.statements_tested += len(results)
        report.pdfs_extracted += sum(1 for r in results if r.has_pdf and not r.error)
        report.json_ground_truth += sum(1 for r in results if r.has_json and not r.error)

    print_report(report)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report_to_json(report), f, ensure_ascii=False, indent=2)
        print(f"JSON report saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())

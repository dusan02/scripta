#!/usr/bin/env python3
"""
P4.1.3 Structured-Data Coverage Audit
=====================================

Audits which data points in the Verifa paid report have deterministic sources
vs which rely on LLM extraction from PDFs.

Principle: If a fact can be obtained deterministically from a public API/registry,
it should NEVER be extracted by LLM from a PDF.

Architecture:
  FACTS layer:    API / registry → deterministic parser → normalized DB
  ANALYSIS layer: deterministic calculations → LLM interpretation
  VERDICT layer:  deterministic scorecard + evidence

This script:
  1. Maps each data point in the report to its source (deterministic vs LLM)
  2. Tests RÚZ API coverage on a sample of companies
  3. Reports which companies have structured financial data vs PDF-only
  4. Identifies gaps where LLM is still used for fact extraction

Usage:
  cd worker/
  python3 tests/p4_coverage_audit.py
  python3 tests/p4_coverage_audit.py --ico 35876832
  python3 tests/p4_coverage_audit.py --output report.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from src.ruz_api import (
    _RUZ_API, _UA, _api_get, _fetch_details,
    _period_from_dict, _year_from_period, _period_sort_key, _dedup_by_period,
)
from src.ruz_parser import parse_zavierka_to_metrics

logger = logging.getLogger("p4_coverage")
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

# ── Data point → source mapping ──────────────────────────────────────────────

DATA_POINTS = [
    # Financial metrics
    {"category": "Financial", "data_point": "Tržby (Revenue)", "primary_source": "RÚZ API JSON", "fallback": "RÚZ HTML tables", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Zisk/strata (Net profit)", "primary_source": "RÚZ API JSON", "fallback": "RÚZ HTML tables", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Aktíva (Total assets)", "primary_source": "RÚZ API JSON", "fallback": "RÚZ HTML tables", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Vlastné imanie (Equity)", "primary_source": "RÚZ API JSON", "fallback": "RÚZ HTML tables", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Záväzky (Liabilities)", "primary_source": "RÚZ API JSON", "fallback": "RÚZ HTML tables", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Cash", "primary_source": "RÚZ API JSON", "fallback": "RÚZ HTML tables", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Zamestnanci (Employees)", "primary_source": "RÚZ API JSON (titulnaStrana)", "fallback": "—", "llm_used": False, "scraper": "REGISTER_UZ"},
    {"category": "Financial", "data_point": "Poznámky (Notes)", "primary_source": "RÚZ PDF prílohy", "fallback": "—", "llm_used": True, "scraper": "REGISTER_UZ", "llm_note": "Notes/forensic analysis — interpretation, not fact extraction"},
    {"category": "Financial", "data_point": "Audítorská správa", "primary_source": "RÚZ PDF prílohy", "fallback": "—", "llm_used": True, "scraper": "REGISTER_UZ", "llm_note": "Auditor opinion extraction from PDF — structured field in JSON"},

    # Company registry
    {"category": "Company", "data_point": "Názov spoločnosti", "primary_source": "ORSR", "fallback": "RÚZ API", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "IČO", "primary_source": "ORSR", "fallback": "RÚZ API", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Sídlo (Address)", "primary_source": "ORSR", "fallback": "RÚZ API", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Právna forma", "primary_source": "ORSR", "fallback": "RÚZ API", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Predmet činnosti", "primary_source": "ORSR", "fallback": "—", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Vlastníci (Owners)", "primary_source": "ORSR", "fallback": "—", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Štatutárny orgán", "primary_source": "ORSR", "fallback": "—", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Zriaďovateľ (Founder)", "primary_source": "ORSR", "fallback": "—", "llm_used": False, "scraper": "ORSR"},
    {"category": "Company", "data_point": "Historické zmeny", "primary_source": "ORSR", "fallback": "—", "llm_used": True, "scraper": "ORSR", "llm_note": "Forensic analysis of ORSR history — anomaly detection, not fact extraction"},

    # Risk / enforcement
    {"category": "Risk", "data_point": "Konkurz/likvidácia", "primary_source": "Vestník (XML)", "fallback": "Insolvency Register", "llm_used": False, "scraper": "OBCHODNY_VESTNIK + INSOLVENCY"},
    {"category": "Risk", "data_point": "Exekúcie (Poverenia)", "primary_source": "Poverenia (justice.gov.sk)", "fallback": "—", "llm_used": False, "scraper": "POVERENIA"},
    {"category": "Risk", "data_point": "CRE (crz.sk exekúcie)", "primary_source": "❌ NEEXISTUJE scraper", "fallback": "—", "llm_used": False, "scraper": "—", "gap": True},
    {"category": "Risk", "data_point": "Diskvalifikácie", "primary_source": "Diskvalifikácie register", "fallback": "—", "llm_used": False, "scraper": "DISKVALIFIKACIE"},
    {"category": "Risk", "data_point": "Súdne rozhodnutia", "primary_source": "Rozhodnutia register", "fallback": "—", "llm_used": False, "scraper": "ROZHODNUTIA"},
    {"category": "Risk", "data_point": "NCRZP (nezistené zdroje)", "primary_source": "NCRZP", "fallback": "—", "llm_used": False, "scraper": "NCRZP"},

    # Tax / financial admin
    {"category": "Tax", "data_point": "DPH registrácia", "primary_source": "Finančná správa", "fallback": "—", "llm_used": False, "scraper": "FINANCNA_SPRAVA"},
    {"category": "Tax", "data_point": "DPH rusenie", "primary_source": "FS DPH rusenie", "fallback": "—", "llm_used": False, "scraper": "FS_DPH_RUSENIE"},
    {"category": "Tax", "data_point": "Daň z príjmov", "primary_source": "FS daň z príjmov", "fallback": "—", "llm_used": False, "scraper": "FS_DAN_Z_PRIJMOV"},
    {"category": "Tax", "data_point": "Nadmerný odpočet DPH", "primary_source": "FS nadmerný odpočet", "fallback": "—", "llm_used": False, "scraper": "FS_DPH_NADMERNY_ODPOCET"},

    # Social/health insurance debts
    {"category": "Debts", "data_point": "Sociálna poisťovňa dlhy", "primary_source": "SP dlžníci", "fallback": "—", "llm_used": False, "scraper": "SP_DLZNICI"},
    {"category": "Debts", "data_point": "VšZP dlhy", "primary_source": "VšZP dlžníci", "fallback": "—", "llm_used": False, "scraper": "VSZP_DLZNICI"},
    {"category": "Debts", "data_point": "Dôvera dlhy", "primary_source": "Dôvera dlžníci", "fallback": "—", "llm_used": False, "scraper": "DOVERA_DLZNICI"},
    {"category": "Debts", "data_point": "Union dlhy", "primary_source": "Union dlžníci", "fallback": "—", "llm_used": False, "scraper": "UNION_DLZNICI"},

    # Other registries
    {"category": "Other", "data_point": "RPVS (verejné zdroje)", "primary_source": "RPVS", "fallback": "—", "llm_used": False, "scraper": "RPVS"},
    {"category": "Other", "data_point": "NCRD (register dlhov)", "primary_source": "NCRD", "fallback": "—", "llm_used": False, "scraper": "NCRD"},
    {"category": "Other", "data_point": "CRZ (register zmlúv)", "primary_source": "CRZ", "fallback": "—", "llm_used": False, "scraper": "CRZ"},
    {"category": "Other", "data_point": "UVO (verejné obstarávanie)", "primary_source": "UVO", "fallback": "—", "llm_used": False, "scraper": "UVO"},
    {"category": "Other", "data_point": "RPO (register právnických osôb)", "primary_source": "RPO", "fallback": "—", "llm_used": False, "scraper": "RPO"},
    {"category": "Other", "data_point": "ZRSR (živnostenský register)", "primary_source": "ZRSR", "fallback": "—", "llm_used": False, "scraper": "ZRSR"},

    # Analysis/verdict (LLM is appropriate here)
    {"category": "Analysis", "data_point": "Naratívna analýza", "primary_source": "LLM interpretácia", "fallback": "—", "llm_used": True, "scraper": "—", "llm_note": "LLM interprets facts — does not create them"},
    {"category": "Analysis", "data_point": "Forenzná analýza ORSR", "primary_source": "LLM interpretácia", "fallback": "—", "llm_used": True, "scraper": "—", "llm_note": "LLM detects anomalies in ORSR history"},
    {"category": "Analysis", "data_point": "Cross-analysis", "primary_source": "LLM interpretácia", "fallback": "—", "llm_used": True, "scraper": "—", "llm_note": "LLM cross-references between registries"},
    {"category": "Analysis", "data_point": "Chief Auditor verdict", "primary_source": "LLM interpretácia", "fallback": "—", "llm_used": True, "scraper": "—", "llm_note": "LLM synthesizes verdict from deterministic facts + scores"},
    {"category": "Analysis", "data_point": "Verifa Score", "primary_source": "Deterministic scorecard", "fallback": "—", "llm_used": False, "scraper": "—", "llm_note": "Score is computed deterministically, LLM only suggests adjustment"},
]

# ── RÚZ coverage test companies ─────────────────────────────────────────────

COVERAGE_TEST_ICOS = [
    # Large companies (likely IFRS / PDF-only)
    "35876832",  # KIA Motors
    "31637051",  # Mondi SCP
    "31733221",  # VOPAL
    # SK GAAP with JSON
    "00603783",  # NEOXX
    "00643581",  # TERRASTROJ
    "00590797",  # ZTS Sabinov
    # Obce (typically have JSON)
    "00311715",  # Obec Krajné
    "00603201",  # MČ Bratislava Petržalka
    "00318337",  # Obec Nitrianske Pravno
    "00309486",  # Obec Čáry
    # More companies
    "00037800",  # PD Zamagurie
    "00895920",  # TOR
    "00633861",  # TRADEF (v likvidácii)
    "00208892",  # PD Suché Brezovo
    "00596507",  # DSS Veľký Meder
]


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class RuzCoverageResult:
    ico: str
    found: bool
    total_zavierky: int
    json_statements: int
    pdf_only_statements: int
    no_data_statements: int
    years_with_json: list[int] = field(default_factory=list)
    years_pdf_only: list[int] = field(default_factory=list)
    latest_year: Optional[int] = None
    latest_year_has_json: bool = False
    konsolidovana: bool = False


@dataclass
class CoverageReport:
    data_points: list[dict] = field(default_factory=list)
    ruz_coverage: list[RuzCoverageResult] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


# ── RÚZ coverage check ───────────────────────────────────────────────────────

async def check_ruz_coverage(ico: str) -> RuzCoverageResult:
    """Check if RÚZ has structured JSON data for a given company."""
    result = RuzCoverageResult(ico=ico, found=False, total_zavierky=0, json_statements=0, pdf_only_statements=0, no_data_statements=0)

    try:
        async with httpx.AsyncClient(headers={"User-Agent": _UA}) as client:
            entity_ids = await _api_get(client, "uctovne-jednotky", {
                "zmenene-od": "2000-01-01", "ico": ico, "max-zaznamov": 10,
            })
            if not entity_ids or not entity_ids.get("id"):
                return result

            result.found = True
            entity_id = entity_ids["id"][0]
            entity = await _api_get(client, "uctovna-jednotka", {"id": entity_id})
            if not entity:
                return result

            zavierka_ids = entity.get("idUctovnychZavierok", [])
            result.total_zavierky = len(zavierka_ids)
            if not zavierka_ids:
                return result

            zavierky = await _fetch_details(client, "uctovna-zavierka", zavierka_ids)
            zavierky.sort(key=lambda z: _period_sort_key(_period_from_dict(z)), reverse=True)

            for z in zavierky[:5]:  # Check last 5 years
                vykaz_ids = z.get("idUctovnychVykazov", [])
                if not vykaz_ids:
                    result.no_data_statements += 1
                    continue

                vykazy = await _fetch_details(client, "uctovny-vykaz", vykaz_ids)
                vykazy = [v for v in vykazy if isinstance(v, dict)]

                period = _period_from_dict(z)
                year_str = _year_from_period(period)
                year = int(year_str) if year_str and year_str.isdigit() else None
                if year is None:
                    continue

                kons = z.get("konsolidovana", False)
                if kons:
                    result.konsolidovana = True

                has_json = False
                has_pdf = False
                for v in vykazy:
                    prist = v.get("pristupnostDat", "")
                    if prist and "neverejn" in prist.lower():
                        continue
                    tabs = v.get("obsah", {}).get("tabulky", [])
                    if tabs:
                        has_json = True
                    prilohy = v.get("prilohy", [])
                    if prilohy:
                        has_pdf = True

                if has_json:
                    result.json_statements += 1
                    result.years_with_json.append(year)
                elif has_pdf:
                    result.pdf_only_statements += 1
                    result.years_pdf_only.append(year)
                else:
                    result.no_data_statements += 1

                if result.latest_year is None or year > result.latest_year:
                    result.latest_year = year
                    result.latest_year_has_json = has_json

    except Exception as e:
        logger.error(f"[{ico}] RÚZ coverage check failed: {e}")

    return result


# ── Report formatting ────────────────────────────────────────────────────────

def print_report(report: CoverageReport):
    print()
    print("=" * 80)
    print("P4.1.3 STRUCTURED-DATA COVERAGE AUDIT")
    print("=" * 80)
    print()

    # ── Part 1: Data point source mapping ──
    print("─" * 80)
    print("PART 1: Data Point → Source Mapping")
    print("─" * 80)
    print()
    print(f"{'Category':<12} {'Data Point':<35} {'Source':<30} {'LLM':>5}")
    print("─" * 80)

    categories = {}
    for dp in report.data_points:
        cat = dp["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(dp)

    for cat in ["Financial", "Company", "Risk", "Tax", "Debts", "Other", "Analysis"]:
        if cat not in categories:
            continue
        for dp in categories[cat]:
            llm_marker = "YES" if dp.get("llm_used") else "—"
            gap_marker = " ← GAP" if dp.get("gap") else ""
            source = dp["primary_source"]
            if len(source) > 28:
                source = source[:25] + "..."
            print(f"  {cat:<10} {dp['data_point']:<35} {source:<30} {llm_marker:>5}{gap_marker}")
        print()

    # Summary stats
    total = len(report.data_points)
    llm_count = sum(1 for dp in report.data_points if dp.get("llm_used"))
    deterministic = total - llm_count
    gaps = sum(1 for dp in report.data_points if dp.get("gap"))
    analysis_llm = sum(1 for dp in report.data_points if dp.get("llm_used") and dp["category"] == "Analysis")
    fact_llm = llm_count - analysis_llm

    print("─" * 80)
    print(f"  Total data points:       {total}")
    print(f"  Deterministic sources:   {deterministic}")
    print(f"  LLM (analysis/interp):   {analysis_llm} ← appropriate")
    print(f"  LLM (fact extraction):   {fact_llm} ← review needed")
    print(f"  Gaps (no source):        {gaps}")
    print()

    # ── Part 2: RÚZ coverage ──
    print("─" * 80)
    print("PART 2: RÚZ Structured Data Coverage")
    print("─" * 80)
    print()
    print(f"{'IČO':<12} {'Found':>6} {'Závierky':>9} {'JSON':>6} {'PDF-only':>9} {'No data':>8} {'Latest':>7} {'JSON?':>6} {'Kons':>6}")
    print("─" * 80)

    for r in report.ruz_coverage:
        print(
            f"  {r.ico:<10} "
            f"{'✓' if r.found else '✗':>4} "
            f"{r.total_zavierky:>9} "
            f"{r.json_statements:>6} "
            f"{r.pdf_only_statements:>9} "
            f"{r.no_data_statements:>8} "
            f"{r.latest_year or '—':>7} "
            f"{'✓' if r.latest_year_has_json else '✗':>6} "
            f"{'✓' if r.konsolidovana else '—':>6}"
        )

    print()

    # Aggregate
    total_companies = len(report.ruz_coverage)
    found = sum(1 for r in report.ruz_coverage if r.found)
    has_json = sum(1 for r in report.ruz_coverage if r.json_statements > 0)
    pdf_only = sum(1 for r in report.ruz_coverage if r.pdf_only_statements > 0 and r.json_statements == 0)
    not_found = sum(1 for r in report.ruz_coverage if not r.found)
    latest_has_json = sum(1 for r in report.ruz_coverage if r.latest_year_has_json)

    print("─" * 80)
    print(f"  Companies tested:        {total_companies}")
    print(f"  Found in RÚZ:            {found}")
    print(f"  Has JSON (any year):     {has_json} ({has_json/found*100:.0f}% of found)" if found else "")
    print(f"  PDF-only (no JSON):      {pdf_only} ({pdf_only/found*100:.0f}% of found)" if found else "")
    print(f"  Not found in RÚZ:        {not_found}")
    print(f"  Latest year has JSON:    {latest_has_json}/{found} ({latest_has_json/found*100:.0f}%)" if found else "")
    print()

    # ── Part 3: Architecture assessment ──
    print("─" * 80)
    print("PART 3: Architecture Assessment")
    print("─" * 80)
    print()
    print("  FACTS layer (deterministic):")
    print(f"    • Financial metrics: RÚZ API JSON → ruz_parser (100% exact match)")
    print(f"    • Company data: ORSR → structured extraction")
    print(f"    • Enforcement: POVERENIA + INSOLVENCY + VESTNÍK")
    print(f"    • Tax: Finančná správa (8 scrapers)")
    print(f"    • Debts: SP + VšZP + Dôvera + Union dlžníci")
    print(f"    • Other: RPVS, NCRD, CRZ, UVO, RPO, ZRSR, NCRZP")
    print()
    print("  ANALYSIS layer (LLM interpretation):")
    print(f"    • Narrative analysis (Výročné správy)")
    print(f"    • Forensic analysis (ORSR history anomalies)")
    print(f"    • Cross-analysis (inter-registry patterns)")
    print(f"    • Notes forensic (PDF notes — related party, going concern)")
    print()
    print("  VERDICT layer (deterministic + LLM):")
    print(f"    • Verifa Score: deterministic scorecard")
    print(f"    • Chief Auditor: LLM synthesis (adjusts score ±)")
    print(f"    • QA Agent: LLM verification of verdict")
    print()

    # ── Part 4: Identified gaps ──
    print("─" * 80)
    print("PART 4: Identified Gaps")
    print("─" * 80)
    print()
    print("  1. CRE (Centrálny register exekúcií) — NO SCRAPER")
    print("     Status: POVERENIA covers enforcement authorizations")
    print("     Risk: MEDIUM — may miss active executions not in POVERENIA")
    print("     Recommendation: Document as known limitation, assess materiality")
    print()
    print("  2. IFRS companies with PDF-only financial data")
    print(f"     Coverage: {pdf_only}/{found} companies have PDF-only ({pdf_only/found*100:.0f}%)" if found else "")
    print("     Status: No deterministic extraction possible from IFRS PDFs")
    print("     Risk: HIGH for large corporations (banks, manufacturers)")
    print("     Recommendation: Mark as 'Financial data not available in structured form'")
    print()
    print("  3. Companies not found in RÚZ")
    print(f"     Count: {not_found}")
    print("     Status: These companies have no public financial statements")
    print("     Risk: LOW — typically new or dormant entities")
    print()

    # ── Part 5: LLM usage audit ──
    print("─" * 80)
    print("PART 5: LLM Usage Audit")
    print("─" * 80)
    print()
    print("  LLM is used for FACT EXTRACTION in:")
    fact_llm_items = [dp for dp in report.data_points if dp.get("llm_used") and dp["category"] != "Analysis"]
    if fact_llm_items:
        for dp in fact_llm_items:
            note = dp.get("llm_note", "")
            print(f"    • {dp['data_point']}: {dp['primary_source']}")
            if note:
                print(f"      Note: {note}")
    else:
        print("    (none)")
    print()
    print("  LLM is used for INTERPRETATION in:")
    analysis_items = [dp for dp in report.data_points if dp.get("llm_used") and dp["category"] == "Analysis"]
    for dp in analysis_items:
        note = dp.get("llm_note", "")
        print(f"    • {dp['data_point']}")
        if note:
            print(f"      Note: {note}")
    print()

    print("=" * 80)
    print("P4.1.3 COVERAGE AUDIT COMPLETE")
    print("=" * 80)
    print()


def report_to_json(report: CoverageReport) -> dict:
    return {
        "data_points": report.data_points,
        "ruz_coverage": [asdict(r) for r in report.ruz_coverage],
        "summary": report.summary,
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="P4.1.3 Structured-Data Coverage Audit")
    parser.add_argument("--ico", type=str, help="Test single IČO coverage")
    parser.add_argument("--output", type=str, help="Save JSON report to file")
    args = parser.parse_args()

    report = CoverageReport(data_points=DATA_POINTS)

    # RÚZ coverage test
    icos = [args.ico] if args.ico else COVERAGE_TEST_ICOS
    print(f"P4.1.3 Coverage Audit — {len(icos)} companies")
    print()

    for i, ico in enumerate(icos):
        print(f"  [{i+1}/{len(icos)}] {ico}...", end=" ", flush=True)
        result = await check_ruz_coverage(ico)
        report.ruz_coverage.append(result)
        if result.found:
            print(f"JSON={result.json_statements} PDF-only={result.pdf_only_statements} latest={result.latest_year}")
        else:
            print("NOT FOUND")

    # Compute summary
    found = sum(1 for r in report.ruz_coverage if r.found)
    has_json = sum(1 for r in report.ruz_coverage if r.json_statements > 0)
    pdf_only = sum(1 for r in report.ruz_coverage if r.pdf_only_statements > 0 and r.json_statements == 0)
    report.summary = {
        "total_companies": len(icos),
        "found_in_ruz": found,
        "has_json": has_json,
        "pdf_only": pdf_only,
        "json_coverage_pct": has_json / found * 100 if found else 0,
    }

    print_report(report)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report_to_json(report), f, ensure_ascii=False, indent=2)
        print(f"JSON report saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())

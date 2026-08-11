#!/usr/bin/env python3
"""
P4.1.5 CRE Materiality Assessment
=================================

Assesses whether the absence of CRE (Centrálny register exekúcií) scraper
is material for Verifa's paid report.

Compares what existing registries (POVERENIA, INSOLVENCY, VESTNÍK,
DISKVALIFIKACIE, ROZHODNUTIA) already capture vs what CRE would add.

Key question: Would CRE add significant new risk signals that existing
registries miss?

CRE contains:
  - Active (právoplatne neskončené) exekúcie against a company/person
  - Exekútor assigned, court, spisová značka
  - Vymáhaná čiastka (amount being collected)
  - Status: active, partially stopped, postponed

POVERENIA contains:
  - Poverenia na vykonanie exekúcie (court orders authorizing execution)
  - Same ECLI, same povinný, same oprávnený
  - Only ACTIVE executions (zastavené/skončené are removed)

INSOLVENCY contains:
  - Predinsolvenčné, likvidačné, insolvenčné konania
  - Bankruptcy, restructuring, liquidation

VESTNÍK contains:
  - Public notices: konkurz, likvidácia, reštrukturalizácia, zmeny v ORSR

DISKVALIFIKACIE contains:
  - Disqualified persons (banned from acting as konateľ/statutár)

ROZHODNUTIA contains:
  - Court decisions (súdne rozhodnutia) from ISU

Overlap analysis:
  - CRE ↔ POVERENIA: HIGH overlap — both track active exekúcie
    POVERENIA is the court authorization; CRE is the exekútor's register
    POVERENIA = "court authorized execution" → CRE = "exekútor is executing"
    If POVERENIA shows nothing, there is no active execution authorized by a court

  - CRE ↔ INSOLVENCY: LOW overlap — different legal procedures
    Exekúcia = enforcement of a specific claim
    Insolvency = general bankruptcy/liquidation

  - CRE ↔ VESTNÍK: LOW overlap — Vestník has public notices, not individual executions

Materiality assessment approach:
  1. Document the overlap (this script)
  2. Note that POVERENIA already covers the core use case
  3. Document CRE's limitations (paid access, no public API)
  4. Recommend: document as known limitation, defer implementation

Usage:
  cd worker/
  python3 tests/p4_cre_materiality.py
  python3 tests/p4_cre_materiality.py --output report.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── Registry comparison ──────────────────────────────────────────────────────

@dataclass
class RegistryComparison:
    registry: str
    source_url: str
    what_it_captures: str
    access_type: str  # "public_api", "public_html", "paid", "login_required"
    has_scraper: bool
    scraper_name: str
    overlaps_with_cre: str  # "HIGH", "MEDIUM", "LOW", "NONE"
    overlap_detail: str


@dataclass
class MaterialityAssessment:
    registries: list[RegistryComparison] = field(default_factory=list)
    cre_unique_data: list[str] = field(default_factory=list)
    cre_limitations: list[str] = field(default_factory=list)
    existing_coverage: list[str] = field(default_factory=list)
    recommendation: str = ""
    risk_level: str = ""  # LOW, MEDIUM, HIGH
    risk_detail: str = ""


# ── Data ─────────────────────────────────────────────────────────────────────

REGISTRIES = [
    RegistryComparison(
        registry="CRE (Centrálny register exekúcií)",
        source_url="https://www.cre.sk",
        what_it_captures="Aktívne exekúcie: povinný, exekútor, súd, vymáhaná čiastka, status",
        access_type="paid",
        has_scraper=False,
        scraper_name="—",
        overlaps_with_cre="SELF",
        overlap_detail="CRE itself — paid access, no public API, login required",
    ),
    RegistryComparison(
        registry="POVERENIA (Register poverení na vykonanie exekúcie)",
        source_url="https://obcan.justice.sk/poverenia",
        what_it_captures="Poverenia na vykonanie exekúcie: ECLI, povinný, oprávnený, súd, exekútor, dátum",
        access_type="public_html",
        has_scraper=True,
        scraper_name="PovereniaScraper",
        overlaps_with_cre="HIGH",
        overlap_detail=(
            "POVERENIA is the court authorization for execution. "
            "If POVERENIA shows nothing → no court has authorized an execution → "
            "CRE would also show nothing. POVERENIA covers the SAME legal event "
            "(exekučné konanie) from the court's perspective. "
            "CRE adds: vymáhaná čiastka (amount) and execution status details. "
            "POVERENIA does NOT show: amount being collected, partial stops, postponements."
        ),
    ),
    RegistryComparison(
        registry="INSOLVENCY (Register úpadcov)",
        source_url="https://replik.justice.sk/ru-verejnost-web/",
        what_it_captures="Predinsolvenčné, likvidačné, insolvenčné konania",
        access_type="public_html",
        has_scraper=True,
        scraper_name="InsolvencyScraper",
        overlaps_with_cre="LOW",
        overlap_detail=(
            "Different legal procedure. Insolvency = general bankruptcy/liquidation. "
            "Exekúcia = enforcement of a specific claim. "
            "A company can have exekúcie without being insolvent, and vice versa. "
            "However, insolvency is a MORE SEVERE signal than individual exekúcie."
        ),
    ),
    RegistryComparison(
        registry="VESTNÍK (Obchodný vestník)",
        source_url="https://datahub.ekosystem.slovensko.digital",
        what_it_captures="Public notices: konkurz, likvidácia, reštrukturalizácia, ORSR changes",
        access_type="public_api",
        has_scraper=True,
        scraper_name="ObchodnyVestnikXmlScraper",
        overlaps_with_cre="LOW",
        overlap_detail=(
            "Vestník publishes public notices about bankruptcy/liquidation — "
            "the most severe enforcement outcomes. Individual exekúcie are not "
            "published in Vestník, but konkurz (which terminates all exekúcie) is."
        ),
    ),
    RegistryComparison(
        registry="DISKVALIFIKACIE (Register diskvalifikácií)",
        source_url="https://www.justice.gov.sk/registre/registerDiskvalifikacii/",
        what_it_captures="Persons banned from acting as konateľ/statutár",
        access_type="public_html",
        has_scraper=True,
        scraper_name="DiskvalifikacieScraper",
        overlaps_with_cre="NONE",
        overlap_detail="Different scope — person-level bans, not company-level executions.",
    ),
    RegistryComparison(
        registry="ROZHODNUTIA (Súdne rozhodnutia)",
        source_url="https://obcan.justice.sk/pilot/api/ress-isu-service/v1/rozhodnutie",
        what_it_captures="Court decisions from ISU — including execution-related rulings",
        access_type="public_api",
        has_scraper=True,
        scraper_name="RozhodnutiaScraper",
        overlaps_with_cre="MEDIUM",
        overlap_detail=(
            "Court decisions may include execution-related rulings (uznesenia). "
            "Broader scope than CRE — includes all court decisions, not just executions. "
            "May capture execution authorizations, postponements, stops."
        ),
    ),
    RegistryComparison(
        registry="SP_DLZNICI (Sociálna poisťovňa dlžníci)",
        source_url="https://www.socpoist.sk/zoznam-dlznikov",
        what_it_captures="Debtors to Social Insurance Agency",
        access_type="public_html",
        has_scraper=True,
        scraper_name="SpDlzniciScraper",
        overlaps_with_cre="LOW",
        overlap_detail=(
            "SP debts often lead to exekúcie, but SP_DLZNICI catches the debt "
            "before it reaches execution. If SP_DLZNICI is CLEAN, SP-driven "
            "exekúcie are unlikely."
        ),
    ),
    RegistryComparison(
        registry="VSZP_DLZNICI (VšZP dlžníci)",
        source_url="https://www.vszp.sk/zoznam-dlznikov",
        what_it_captures="Debtors to health insurance",
        access_type="public_html",
        has_scraper=True,
        scraper_name="VszpDlzniciScraper",
        overlaps_with_cre="LOW",
        overlap_detail="Same logic as SP — catches debt before execution stage.",
    ),
    RegistryComparison(
        registry="DOVERA_DLZNICI (Dôvera dlžníci)",
        source_url="https://www.dovera.sk/zoznam-dlznikov",
        what_it_captures="Debtors to Dôvera health insurance",
        access_type="public_html",
        has_scraper=True,
        scraper_name="DoveraDlzniciScraper",
        overlaps_with_cre="LOW",
        overlap_detail="Same logic as SP — catches debt before execution stage.",
    ),
    RegistryComparison(
        registry="UNION_DLZNICI (Union dlžníci)",
        source_url="https://www.union.sk/zoznam-dlznikov",
        what_it_captures="Debtors to Union health insurance",
        access_type="public_html",
        has_scraper=True,
        scraper_name="UnionDlzniciScraper",
        overlaps_with_cre="LOW",
        overlap_detail="Same logic as SP — catches debt before execution stage.",
    ),
    RegistryComparison(
        registry="FINANCNA_SPRAVA (Daňové registrácie)",
        source_url="https://www.financnasprava.sk",
        what_it_captures="Tax registration status, DPH, tax debts indicators",
        access_type="public_html",
        has_scraper=True,
        scraper_name="FinancnaSpravaScraper + 7 FS sub-scrapers",
        overlaps_with_cre="LOW",
        overlap_detail="Tax debts can lead to exekúcie, but FS catches the tax issue directly.",
    ),
]


# ── Assessment ───────────────────────────────────────────────────────────────

def build_assessment() -> MaterialityAssessment:
    return MaterialityAssessment(
        registries=REGISTRIES,

        cre_unique_data=[
            "Vymáhaná čiastka (exact amount being collected) — POVERENIA does not show this",
            "Execution status: active, partially stopped, postponed",
            "Exekútor identity (which specific exekútor is handling the case)",
            "Historical executions (completed/skončené) — POVERENIA removes stopped ones",
        ],

        cre_limitations=[
            "PAID access — 1.60 EUR per search, 2.50 EUR per page (Vyhláška 355/2014)",
            "No public API — web interface only, login/registration required",
            "Maintained by Slovenská komora exekútorov (not a government open-data source)",
            "Exekútori have 7 days to register, 14 days to delete — data may be stale",
            "In practice, not all exekútori comply with registration deadlines",
            "Aggressive scraping could trigger legal/technical countermeasures",
            "Slovak government systems have heightened security post-cyberattack (2023+)",
        ],

        existing_coverage=[
            "POVERENIA: captures court-authorized active executions (HIGH overlap with CRE)",
            "INSOLVENCY: captures bankruptcy/liquidation (MORE severe than individual exekúcie)",
            "VESTNÍK: publishes konkurz/likvidácia notices (terminates all exekúcie)",
            "ROZHODNUTIA: court decisions including execution-related rulings",
            "SP/VšZP/Dôvera/Union dlžníci: catch debts BEFORE they reach execution stage",
            "FINANCNA_SPRAVA: catches tax issues BEFORE they reach execution stage",
            "DISKVALIFIKACIE: catches banned persons (different but complementary risk)",
        ],

        recommendation=(
            "DEFER CRE implementation. POVERENIA provides HIGH overlap coverage "
            "for the core use case (detecting active executions). The unique data "
            "CRE adds (exact amounts, execution status) is supplementary detail, "
            "not a new risk category. The paid access model and lack of public API "
            "make a scraper fragile and potentially legally problematic. "
            "Document CRE as a known limitation in the report: "
            "'Exekúcie are detected via Register poverení (court authorizations). "
            "Detailed execution amounts and statuses from CRE are not included.'"
        ),

        risk_level="LOW",

        risk_detail=(
            "LOW risk for most companies. POVERENIA → CRE overlap is HIGH: "
            "if no poverenie exists, no execution can be active. "
            "The main gap is: (1) exact amount being collected, "
            "(2) historical (completed) executions. Neither is critical for "
            "due-diligence risk assessment — the PRESENCE of active executions "
            "is the key signal, and POVERENIA captures that. "
            "MEDIUM risk only for edge case: exekútor who hasn't registered "
            "the poverenie in POVERENIA system but has started execution — "
            "this is a legal compliance failure by the exekútor, not a systemic gap."
        ),
    )


# ── Report ───────────────────────────────────────────────────────────────────

def print_report(assessment: MaterialityAssessment):
    print()
    print("=" * 80)
    print("P4.1.5 CRE MATERIALITY ASSESSMENT")
    print("Centrálny register exekúcií — Do we need it?")
    print("=" * 80)
    print()

    # ── Registry comparison table ──
    print("─" * 80)
    print("Registry Comparison: What each source captures")
    print("─" * 80)
    print()
    print(f"{'Registry':<35} {'Scraper':>8} {'CRE overlap':>12} {'Access':>15}")
    print("─" * 80)

    for r in assessment.registries:
        scraper = "✓" if r.has_scraper else "✗"
        overlap = r.overlaps_with_cre if r.overlaps_with_cre != "SELF" else "—"
        access = r.access_type
        print(f"  {r.registry:<33} {scraper:>8} {overlap:>12} {access:>15}")

    print()
    print("─" * 80)
    print("Detailed overlap analysis")
    print("─" * 80)
    print()

    for r in assessment.registries:
        if r.overlaps_with_cre == "SELF":
            print(f"  [{r.registry}]")
            print(f"    URL: {r.source_url}")
            print(f"    Captures: {r.what_it_captures}")
            print(f"    Access: {r.access_type}")
            print(f"    Scraper: {'YES — ' + r.scraper_name if r.has_scraper else 'NO'}")
            print()
        elif r.overlaps_with_cre in ("HIGH", "MEDIUM"):
            print(f"  [{r.registry}] — overlap: {r.overlaps_with_cre}")
            print(f"    {r.overlap_detail}")
            print()

    # ── What CRE uniquely adds ──
    print("─" * 80)
    print("What CRE uniquely adds (not in existing registries)")
    print("─" * 80)
    for item in assessment.cre_unique_data:
        print(f"  • {item}")
    print()

    # ── CRE limitations ──
    print("─" * 80)
    print("CRE limitations (why scraping is problematic)")
    print("─" * 80)
    for item in assessment.cre_limitations:
        print(f"  • {item}")
    print()

    # ── Existing coverage ──
    print("─" * 80)
    print("What existing registries already cover")
    print("─" * 80)
    for item in assessment.existing_coverage:
        print(f"  • {item}")
    print()

    # ── Verdict ──
    print("=" * 80)
    print("ASSESSMENT")
    print("=" * 80)
    print()
    print(f"  Risk level: {assessment.risk_level}")
    print()
    print(f"  {assessment.risk_detail}")
    print()
    print("─" * 80)
    print("RECOMMENDATION")
    print("─" * 80)
    print()
    # Word-wrap the recommendation
    words = assessment.recommendation.split()
    line = "  "
    for w in words:
        if len(line) + len(w) + 1 > 78:
            print(line)
            line = "  "
        line += w + " "
    if line.strip():
        print(line)
    print()

    # ── Report label for paid PDF ──
    print("─" * 80)
    print("Suggested report label (for paid PDF transparency)")
    print("─" * 80)
    print()
    print('  "Exekúcie: detekované prostredníctvom Register poverení na vykonanie')
    print('   exekúcie (justice.gov.sk). Detailné informácie o vymáhaných čiastkach')
    print('   a stave exekúcií z Centrálneho registra exekúcií (cre.sk) nie sú')
    print('   zahrnuté v reporte."')
    print()

    print("=" * 80)
    print("P4.1.5 CRE MATERIALITY ASSESSMENT COMPLETE")
    print("=" * 80)
    print()


def report_to_json(assessment: MaterialityAssessment) -> dict:
    return {
        "registries": [asdict(r) for r in assessment.registries],
        "cre_unique_data": assessment.cre_unique_data,
        "cre_limitations": assessment.cre_limitations,
        "existing_coverage": assessment.existing_coverage,
        "recommendation": assessment.recommendation,
        "risk_level": assessment.risk_level,
        "risk_detail": assessment.risk_detail,
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="P4.1.5 CRE Materiality Assessment")
    parser.add_argument("--output", type=str, help="Save JSON report to file")
    args = parser.parse_args()

    assessment = build_assessment()
    print_report(assessment)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report_to_json(assessment), f, ensure_ascii=False, indent=2)
        print(f"JSON report saved to: {output_path}")


if __name__ == "__main__":
    main()

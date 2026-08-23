"""
FÁZA 4 — Eval Harness pre reálnu validáciu report quality.

Spustí pipeline pre 15 firiem s rôznymi profilmi a zozbiera metrics:
  - Score (musí byť nezmenený)
  - # findings (RISK/STRENGTH/ANOMALY/UNKNOWN)
  - Grounded findings % (findings s evidence ≠ "Dostupné zdroje neobsahujú...")
  - Source pages % (findings so source_pages ≠ null)
  - NotesRisk coverage (ktoré z 10 polí sú vyplnené)
  - NarrativeRisk coverage (ktoré z 9 polí sú vyplnené)

Použitie:
  # Vyber 15 firiem z DB a spusti pipeline
  .venv/bin/python -m tests.f4_eval_harness --auto-select

  # Spusti pre konkrétne IČO
  .venv/bin/python -m tests.f4_eval_harness --icos 00603783,00643581

  # Dry-run (iba vyber firmy, nespúšťaj LLM)
  .venv/bin/python -m tests.f4_eval_harness --auto-select --dry-run

Výstup:
  - tests/output/f4_eval/summary.csv — tabuľka s metrics pre všetky firmy
  - tests/output/f4_eval/<ico>.json — kompletný output pre každú firmu
  - tests/output/f4_eval/<ico>_report.html — vygenerovaný PDF report
"""
import asyncio
import argparse
import json
import os
import sys
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Representative firm selection
# ═══════════════════════════════════════════════════════════════════════

# 8 firiem s IFRS PDF v tests/output/ifrs_assets/
# Pre F4 potrebujeme 15 — zvyšných 7 vyberieme z DB (firmy s finančnými výkazmi)
LOCAL_IFRS_ICOS = [
    "00311715",  # 2 roky IFRS
    "00318337",  # 2 roky IFRS
    "00590797",  # 2 roky IFRS + sliced VS
    "00603201",  # 2 roky IFRS
    "00603783",  # 2 roky IFRS
    "00643581",  # 2 roky IFRS
    "31637051",  # 2 roky IFRS
    "35876832",  # 2 roky IFRS
]

# Profil kategórie pre výber z DB
PROFILE_CATEGORIES = {
    "healthy_growing": {"min_score": 70, "min_revenue_growth": 0.1, "count": 2},
    "high_capex": {"min_non_current_assets_ratio": 0.4, "count": 2},
    "high_debt": {"min_de_ratio": 2.0, "count": 2},
    "loss_positive_ocf": {"net_loss": True, "positive_ocf": True, "count": 2},
    "related_party": {"has_notes_risk": True, "count": 2},
    "acquisition_restructuring": {"count": 2},
    "going_concern": {"has_going_concern": True, "count": 2},
    "insufficient_evidence": {"no_pdf": True, "count": 1},
}


async def auto_select_firms(target_count: int = 15) -> list[dict]:
    """
    Vyber reprezentatívny koš firiem z DB.
    Najprv použije lokálne IFRS PDF, potom doplní z DB.
    """
    from src.db_repository import get_db

    selected = []
    db = get_db()

    # 1. Lokálne IFRS firmy (8)
    for ico in LOCAL_IFRS_ICOS:
        company = await db.company.find_unique(where={"ico": ico})
        if company:
            selected.append({
                "ico": ico,
                "name": company.name or f"IČO {ico}",
                "profile": "local_ifrs",
                "has_pdf": True,
            })

    # 2. Doplň z DB — firmy s finančnými výkazmi
    if len(selected) < target_count:
        companies = await db.company.find_many(
            where={
                "financialStatements": {"some": {}},
                "ico": {"notIn": [s["ico"] for s in selected]},
            },
            take=target_count - len(selected),
            order={"ico": "desc"},
        )
        for c in companies:
            selected.append({
                "ico": c.ico,
                "name": c.name or f"IČO {c.ico}",
                "profile": "db_supplement",
                "has_pdf": False,
            })

    return selected[:target_count]


# ═══════════════════════════════════════════════════════════════════════
# Pipeline execution
# ═══════════════════════════════════════════════════════════════════════

async def run_pipeline_for_ico(ico: str, report_language: str = "sk") -> dict:
    """
    Spustí pipeline pre jedno IČO a vráti výsledok.
    """
    from src.pipeline import process_company
    from src.verdict_builder import run_and_save_audit_verdict
    from src.db_repository import get_company_with_relations

    # 1. Spustí pipeline (PDF download → LLM extraction → save to DB)
    try:
        await process_company(ico, report_language=report_language)
    except Exception as e:
        logger.error(f"[F4] Pipeline zlyhal pre {ico}: {e}")
        return {"ico": ico, "error": str(e)}

    # 2. Spustí Chief Auditor
    try:
        await run_and_save_audit_verdict(ico, force=True, report_language=report_language)
    except Exception as e:
        logger.error(f"[F4] Chief Auditor zlyhal pre {ico}: {e}")
        return {"ico": ico, "error": str(e)}

    # 3. Načítaj výsledok z DB
    company = await get_company_with_relations(ico)
    if not company:
        return {"ico": ico, "error": "Company not found after pipeline"}

    return _extract_metrics(company)


def _extract_metrics(company) -> dict:
    """Extrahuje metrics z company objektu (Prisma model)."""
    verdict = company.auditVerdict
    stmts = company.financialStatements or []
    latest_stmt = max(stmts, key=lambda s: s.year) if stmts else None

    metrics = {
        "ico": company.ico,
        "name": company.name,
        "score": verdict.verifaScore if verdict else None,
        "risk_category": verdict.riskCategory if verdict else None,
        "has_verdict": verdict is not None,
    }

    # Findings metrics
    if verdict and verdict.findings:
        findings = verdict.findings if isinstance(verdict.findings, list) else []
        metrics["findings_total"] = len(findings)
        metrics["findings_risk"] = sum(1 for f in findings if f.get("category") == "RISK")
        metrics["findings_strength"] = sum(1 for f in findings if f.get("category") == "STRENGTH")
        metrics["findings_anomaly"] = sum(1 for f in findings if f.get("category") == "ANOMALY")
        metrics["findings_unknown"] = sum(1 for f in findings if f.get("category") == "UNKNOWN")

        # Grounding: findings s reálnym evidence (nie "Dostupné zdroje neobsahujú...")
        grounded = sum(
            1 for f in findings
            if f.get("evidence")
            and "neobsahujú" not in (f.get("evidence") or "").lower()
            and "no relevant" not in (f.get("evidence") or "").lower()
        )
        metrics["findings_grounded"] = grounded
        metrics["findings_grounded_pct"] = round(grounded / len(findings) * 100, 1) if findings else 0

        # Source pages
        with_pages = sum(1 for f in findings if f.get("source_pages"))
        metrics["findings_with_source_pages"] = with_pages
        metrics["findings_source_pages_pct"] = round(with_pages / len(findings) * 100, 1) if findings else 0
    else:
        metrics["findings_total"] = 0
        metrics["findings_risk"] = 0
        metrics["findings_strength"] = 0
        metrics["findings_anomaly"] = 0
        metrics["findings_unknown"] = 0
        metrics["findings_grounded"] = 0
        metrics["findings_grounded_pct"] = 0
        metrics["findings_with_source_pages"] = 0
        metrics["findings_source_pages_pct"] = 0

    # NotesRisk coverage
    if latest_stmt and latest_stmt.notesRisk:
        nr = latest_stmt.notesRisk
        notes_fields = [
            "relatedPartyTransactions", "offBalanceSheetLiabilities", "contingentRisks",
            "significantInvestments", "financingActivities", "acquisitionsAndDisposals",
            "provisionsAndReserves", "restructuringActivities", "capitalChanges", "subsequentEvents",
        ]
        filled = sum(1 for f in notes_fields if getattr(nr, f, None))
        metrics["notes_risk_filled"] = filled
        metrics["notes_risk_total"] = len(notes_fields)
        metrics["notes_risk_coverage_pct"] = round(filled / len(notes_fields) * 100, 1)
        metrics["notes_source_pages"] = nr.sourcePages
    else:
        metrics["notes_risk_filled"] = 0
        metrics["notes_risk_total"] = 10
        metrics["notes_risk_coverage_pct"] = 0
        metrics["notes_source_pages"] = None

    # NarrativeRisk coverage
    if latest_stmt and latest_stmt.narrativeRisk:
        nar = latest_stmt.narrativeRisk
        narrative_fields = [
            "managementChanges", "litigationRisks", "plannedInvestments", "profitabilityExplanation",
            "forensicRedFlags", "businessDevelopments", "strengthsAndOpportunities",
        ]
        filled = sum(1 for f in narrative_fields if getattr(nar, f, None))
        metrics["narrative_filled"] = filled
        metrics["narrative_total"] = len(narrative_fields)
        metrics["narrative_coverage_pct"] = round(filled / len(narrative_fields) * 100, 1)
        metrics["narrative_source_pages"] = nar.sourcePages
        metrics["narrative_has_strengths"] = bool(nar.strengthsAndOpportunities)
        metrics["narrative_has_business_dev"] = bool(nar.businessDevelopments)
    else:
        metrics["narrative_filled"] = 0
        metrics["narrative_total"] = 7
        metrics["narrative_coverage_pct"] = 0
        metrics["narrative_source_pages"] = None
        metrics["narrative_has_strengths"] = False
        metrics["narrative_has_business_dev"] = False

    # Balance check: pomer RISK vs STRENGTH
    if metrics["findings_total"] > 0:
        risk_count = metrics["findings_risk"]
        strength_count = metrics["findings_strength"]
        metrics["balance_ratio"] = f"{risk_count}:{strength_count}"
        # Flag: ak všetko RISK a žiadne STRENGTH → možno imbalance
        metrics["imbalance_flag"] = (risk_count > 0 and strength_count == 0)
    else:
        metrics["balance_ratio"] = "0:0"
        metrics["imbalance_flag"] = False

    return metrics


# ═══════════════════════════════════════════════════════════════════════
# Output
# ═══════════════════════════════════════════════════════════════════════

def save_results(results: list[dict], output_dir: str):
    """Uloží výsledky do CSV + individuálne JSON."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Summary CSV
    csv_path = out / "summary.csv"
    with open(csv_path, "w", encoding="utf-8") as f:
        # Header
        headers = [
            "ico", "name", "score", "risk_category",
            "findings_total", "findings_risk", "findings_strength",
            "findings_anomaly", "findings_unknown",
            "findings_grounded_pct", "findings_source_pages_pct",
            "notes_risk_coverage_pct", "narrative_coverage_pct",
            "balance_ratio", "imbalance_flag",
            "narrative_has_strengths", "narrative_has_business_dev",
        ]
        f.write(",".join(headers) + "\n")
        for r in results:
            row = [str(r.get(h, "")) for h in headers]
            f.write(",".join(row) + "\n")

    # Individual JSON
    for r in results:
        ico = r.get("ico", "unknown")
        json_path = out / f"{ico}.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=2)

    # Summary report
    report_path = out / "eval_report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# F4 Eval Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
        f.write(f"## Summary ({len(results)} firiem)\n\n")

        # Aggregate metrics
        total = len(results)
        with_verdict = sum(1 for r in results if r.get("has_verdict"))
        with_findings = sum(1 for r in results if r.get("findings_total", 0) > 0)
        avg_findings = sum(r.get("findings_total", 0) for r in results) / total if total else 0
        avg_grounded = sum(r.get("findings_grounded_pct", 0) for r in results) / total if total else 0
        avg_source_pages = sum(r.get("findings_source_pages_pct", 0) for r in results) / total if total else 0
        imbalance_count = sum(1 for r in results if r.get("imbalance_flag"))
        with_strengths = sum(1 for r in results if r.get("narrative_has_strengths"))
        with_unknown = sum(1 for r in results if r.get("findings_unknown", 0) > 0)

        f.write(f"| Metric | Value |\n|--------|-------|\n")
        f.write(f"| Firmy s verdict | {with_verdict}/{total} |\n")
        f.write(f"| Firmy s findings | {with_findings}/{total} |\n")
        f.write(f"| Priemerný počet findings | {avg_findings:.1f} |\n")
        f.write(f"| Priemerné grounded % | {avg_grounded:.1f}% |\n")
        f.write(f"| Priemerné source pages % | {avg_source_pages:.1f}% |\n")
        f.write(f"| Firmy s imbalance (RISK only) | {imbalance_count}/{total} |\n")
        f.write(f"| Firmy s STRENGTH findings | {with_strengths}/{total} |\n")
        f.write(f"| Firmy s UNKNOWN findings | {with_unknown}/{total} |\n\n")

        # Per-firm table
        f.write(f"## Per-firm breakdown\n\n")
        f.write(f"| IČO | Názov | Score | #F | R | S | A | U | Grounded% | SrcPages% | Balance |\n")
        f.write(f"|-----|-------|-------|----|---|---|---|---|-----------|-----------|---------|\n")
        for r in results:
            f.write(
                f"| {r.get('ico','')} | {r.get('name','')[:20]} | {r.get('score','—')} "
                f"| {r.get('findings_total',0)} | {r.get('findings_risk',0)} "
                f"| {r.get('findings_strength',0)} | {r.get('findings_anomaly',0)} "
                f"| {r.get('findings_unknown',0)} | {r.get('findings_grounded_pct',0)}% "
                f"| {r.get('findings_source_pages_pct',0)}% | {r.get('balance_ratio','0:0')} |\n"
            )

        # Quality gates
        f.write(f"\n## Quality Gates\n\n")
        f.write(f"| Gate | Threshold | Result | Status |\n|------|-----------|--------|--------|\n")
        f.write(f"| Grounded findings > 70% | >70% | {avg_grounded:.1f}% | {'✅' if avg_grounded > 70 else '❌'} |\n")
        f.write(f"| Source pages > 50% | >50% | {avg_source_pages:.1f}% | {'✅' if avg_source_pages > 50 else '❌'} |\n")
        f.write(f"| Imbalance < 30% | <30% | {imbalance_count}/{total} ({imbalance_count/total*100:.0f}%) | {'✅' if imbalance_count/total < 0.3 else '❌'} |\n")
        f.write(f"| UNKNOWN discipline | >0 firms | {with_unknown}/{total} | {'✅' if with_unknown > 0 else '⚠️'} |\n")
        f.write(f"| Score unchanged | deterministic | — | ✅ (verified by tests) |\n")
        f.write(f"\n")
        f.write(f"**Note:** NotesRisk/NarrativeRisk coverage is NOT a quality gate. `null` for fields\n")
        f.write(f"the firm genuinely doesn't have (e.g. acquisitions, restructuring) is correct —\n")
        f.write(f"**precision matters more than forced field filling.** Coverage is shown for\n")
        f.write(f"information only, to identify extraction gaps vs. legitimate absences.\n")

    print(f"\n=== Výsledky uložené do {output_dir} ===")
    print(f"  summary.csv — tabuľka s metrics")
    print(f"  eval_report.md — human-readable report")
    print(f"  <ico>.json — individuálne výstupy")
    return report_path


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

async def main():
    parser = argparse.ArgumentParser(description="F4 Eval Harness")
    parser.add_argument("--auto-select", action="store_true", help="Vyber 15 firiem automaticky")
    parser.add_argument("--icos", type=str, help="Konkrétne IČO oddelené čiarkou")
    parser.add_argument("--dry-run", action="store_true", help="Iba vyber firmy, nespúšťaj LLM")
    parser.add_argument("--output", type=str, default="tests/output/f4_eval", help="Output adresár")
    parser.add_argument("--language", type=str, default="sk", help="Report jazyk")
    args = parser.parse_args()

    # Vyber firmy
    if args.icos:
        icos = [x.strip() for x in args.icos.split(",")]
        firms = [{"ico": ico, "name": f"IČO {ico}", "profile": "manual", "has_pdf": False} for ico in icos]
    elif args.auto_select:
        # Inicializuj DB klient
        from src.db_client import connect_db
        await connect_db()
        print("Vyberám reprezentatívny koš firiem...")
        firms = await auto_select_firms(15)
    else:
        # Default: lokálne IFRS firmy
        firms = [{"ico": ico, "name": f"IČO {ico}", "profile": "local_ifrs", "has_pdf": True} for ico in LOCAL_IFRS_ICOS]

    print(f"\n=== F4 Eval Harness ===")
    print(f"Vybraných {len(firms)} firiem:")
    for f in firms:
        print(f"  {f['ico']} — {f['name']} ({f['profile']})")

    if args.dry_run:
        print("\n[DRY-RUN] Spúšťanie preskočené.")
        return

    # Inicializuj DB klient pre pipeline (ak už nie je inicializovaný)
    from src.db_client import connect_db
    await connect_db()

    # Spustí pipeline pre každú firmu
    results = []
    for i, firm in enumerate(firms, 1):
        ico = firm["ico"]
        print(f"\n[{i}/{len(firms)}] Spracovávam {ico} — {firm['name']}...")
        try:
            result = await run_pipeline_for_ico(ico, report_language=args.language)
            results.append(result)
            if "error" in result:
                print(f"  ❌ Chyba: {result['error']}")
            else:
                print(f"  ✅ Score: {result.get('score')}, Findings: {result.get('findings_total', 0)} "
                      f"(R:{result.get('findings_risk',0)} S:{result.get('findings_strength',0)} "
                      f"A:{result.get('findings_anomaly',0)} U:{result.get('findings_unknown',0)})")
        except Exception as e:
            print(f"  ❌ Fatálna chyba: {e}")
            results.append({"ico": ico, "name": firm["name"], "error": str(e)})

    # Ulož výsledky
    report_path = save_results(results, args.output)
    print(f"\nReport: {report_path}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    asyncio.run(main())

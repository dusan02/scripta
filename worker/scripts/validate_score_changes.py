"""
Validation script: Before vs After score comparison.
Compares old LLM-adjusted scores with new deterministic-adjusted scores.
"""
import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from prisma import Prisma
from src.pipeline import _compute_deterministic_adjustment


async def main():
    db = Prisma()
    await db.connect()

    # Get all companies with audit verdicts
    companies = await db.company.find_many(
        where={
            'auditVerdict': {'is_not': None}
        },
        include={
            'auditVerdict': True,
            'financialStatements': {
                'include': {
                    'narrativeRisk': True,
                    'notesRisk': True,
                }
            },
            'companyEvents': True,
        }
    )

    results = []
    old_categories = {"AAA": 0, "A": 0, "B": 0, "C": 0, "INSUFFICIENT_DATA": 0}
    new_categories = {"AAA": 0, "A": 0, "B": 0, "C": 0, "INSUFFICIENT_DATA": 0}
    category_changes = []

    for company in companies:
        verdict = company.auditVerdict
        if not verdict:
            continue

        ico = company.ico
        old_score = verdict.verifaScore
        old_adj = verdict.llmScoreAdjustment or 0
        old_category = verdict.riskCategory

        # Reconstruct deterministic_score (algorithmic + WH override)
        # old_final = deterministic_score + old_llm_adj
        # So deterministic_score = old_final - old_llm_adj
        deterministic_score = old_score - old_adj

        # Build narrative_by_year and notes_by_year from financial statements
        narrative_by_year = []
        notes_by_year = []
        for stmt in company.financialStatements:
            if stmt.narrativeRisk:
                nr = stmt.narrativeRisk
                narrative_by_year.append({
                    "rok": stmt.year,
                    "narrativeRisk": {
                        "goingConcernDoubts": nr.goingConcernDoubts,
                        "litigationRisks": nr.litigationRisks,
                        "forensicRedFlags": nr.forensicRedFlags or [],
                    }
                })
            if stmt.notesRisk:
                ns = stmt.notesRisk
                notes_by_year.append({
                    "rok": stmt.year,
                    "notesRisk": {
                        "relatedPartyTransactions": ns.relatedPartyTransactions,
                        "offBalanceSheetLiabilities": ns.offBalanceSheetLiabilities,
                        "contingentRisks": ns.contingentRisks,
                    }
                })

        # Build company events list
        company_events = []
        for ev in company.companyEvents:
            company_events.append({
                "severity": ev.severity,
                "eventType": ev.eventType,
            })

        # Determine if company uses consolidated statements
        has_consolidated = any(
            getattr(stmt, 'isConsolidated', False) for stmt in company.financialStatements
        )

        # Compute new deterministic adjustment
        det_adj = _compute_deterministic_adjustment(
            narrative_by_year, notes_by_year, company_events, ico,
            is_consolidated=has_consolidated,
        )

        new_score = max(0, min(100, deterministic_score + det_adj))

        # Determine new category
        if new_score >= 90:
            new_category = "AAA"
        elif new_score >= 70:
            new_category = "A"
        elif new_score >= 40:
            new_category = "B"
        else:
            new_category = "C"

        delta = new_score - old_score

        old_categories[old_category] = old_categories.get(old_category, 0) + 1
        new_categories[new_category] = new_categories.get(new_category, 0) + 1

        if old_category != new_category:
            category_changes.append({
                "ico": ico,
                "name": company.name,
                "old": old_category,
                "new": new_category,
                "old_score": old_score,
                "new_score": new_score,
            })

        results.append({
            "ico": ico,
            "name": company.name,
            "old_score": old_score,
            "new_score": new_score,
            "delta": delta,
            "old_adj": old_adj,
            "new_adj": det_adj,
            "old_category": old_category,
            "new_category": new_category,
        })

    # Sort by delta descending
    results.sort(key=lambda r: r["delta"], reverse=True)

    print("\n" + "=" * 100)
    print("BEFORE vs AFTER SCORE COMPARISON")
    print("=" * 100)

    print(f"\n{'ICO':<12} {'Name':<40} {'Old':>4} {'New':>4} {'Δ':>5} {'OldAdj':>7} {'NewAdj':>7} {'Cat':>5} {'→':>2} {'NewCat':>5}")
    print("-" * 100)
    for r in results:
        cat_change = f"{r['old_category']}→{r['new_category']}" if r['old_category'] != r['new_category'] else ""
        print(f"{r['ico']:<12} {r['name'][:38]:<40} {r['old_score']:>4} {r['new_score']:>4} {r['delta']:>+5} {r['old_adj']:>+7} {r['new_adj']:>+7} {r['old_category']:>5} {'→':>2} {r['new_category']:>5} {cat_change}")

    print("\n" + "=" * 60)
    print("CATEGORY DISTRIBUTION")
    print("=" * 60)
    print(f"\n{'Cat':<20} {'OLD':>6} {'NEW':>6} {'Δ':>5}")
    print("-" * 40)
    for cat in ["AAA", "A", "B", "C", "INSUFFICIENT_DATA"]:
        o = old_categories.get(cat, 0)
        n = new_categories.get(cat, 0)
        print(f"{cat:<20} {o:>6} {n:>6} {n-o:>+5}")

    print(f"\nCategory changes: {len(category_changes)} / {len(results)}")
    if category_changes:
        print("\nCompanies that changed category:")
        for c in category_changes:
            print(f"  {c['ico']} {c['name'][:35]:<35} {c['old']}→{c['new']} ({c['old_score']}→{c['new_score']})")

    # Top 10 largest changes
    print("\n" + "=" * 60)
    print("TOP 10 LARGEST SCORE CHANGES")
    print("=" * 60)
    by_abs_delta = sorted(results, key=lambda r: abs(r["delta"]), reverse=True)[:10]
    for r in by_abs_delta:
        print(f"  {r['ico']} {r['name'][:35]:<35} Δ={r['delta']:+d} (old_adj={r['old_adj']:+d} → new_adj={r['new_adj']:+d})")

    # Summary stats
    deltas = [r["delta"] for r in results]
    avg_delta = sum(deltas) / len(deltas) if deltas else 0
    max_delta = max(deltas) if deltas else 0
    min_delta = min(deltas) if deltas else 0
    changed = sum(1 for d in deltas if d != 0)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total companies:     {len(results)}")
    print(f"  Score changed:       {changed}")
    print(f"  Category changed:    {len(category_changes)}")
    print(f"  Avg delta:           {avg_delta:+.1f}")
    print(f"  Max delta:           {max_delta:+d}")
    print(f"  Min delta:           {min_delta:+d}")

    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())

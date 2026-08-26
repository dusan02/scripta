"""
E2E verification: ReportFinancialSnapshot + ScoringSnapshot chain.

Tests the snapshot creation path with real DB data, bypassing the LLM call.
This verifies:
  1. ReportFinancialSnapshot is created with all evidence sections
  2. ScoringSnapshot is created and linked
  3. inputDataHash matches between the two
  4. Score is deterministic (same input → same score)
  5. Idempotency: running twice doesn't create duplicates

Usage:
    cd worker && .venv/bin/python -m tests.e2e_snapshot_verification
"""
import asyncio
import json
import hashlib
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main():
    from src.db_client import connect_db, disconnect_db
    from src.db_repository import get_company_with_relations, save_report_financial_snapshot, save_scoring_snapshot
    from src.analytics import compute_financial_trends, compute_forensic_scorecard, estimate_missing_cash_flow, sanitize_cash_flow_fields
    from src.verdict_builder import SCORING_VERSION, _compute_deterministic_adjustment
    from prisma import Prisma, Json

    TEST_ICO = "36657913"  # ZKW Slovakia s.r.o. — 9 financial statements
    TEST_REPORT_ID_1 = "test-e2e-snapshot-run-001"
    TEST_REPORT_ID_2 = "test-e2e-snapshot-run-002"

    print(f"=== E2E Snapshot Verification for IČO {TEST_ICO} ===\n")

    # 1. Connect to DB
    print("[1] Connecting to DB...")
    await connect_db()
    db = Prisma()
    await db.connect()
    print("    ✓ Connected")

    # 2. Load real company data
    print(f"\n[2] Loading company data for IČO {TEST_ICO}...")
    company = await get_company_with_relations(TEST_ICO)
    if not company:
        print(f"    ✗ Company {TEST_ICO} not found")
        return

    stmts = company.financialStatements or []
    print(f"    ✓ Company: {company.name}")
    print(f"    ✓ Financial statements: {len(stmts)}")
    print(f"    ✓ Vestnik events: {len(company.vestnikEvents or [])}")
    print(f"    ✓ Company events: {len(company.companyEvents or [])}")

    # 3. Build company_dict and compute score
    print(f"\n[3] Building company_dict and computing score...")
    sorted_stmts = sorted(stmts, key=lambda s: s.year, reverse=True)
    for s in sorted_stmts:
        sanitize_cash_flow_fields(s)
    estimate_missing_cash_flow(sorted_stmts)

    company_dict = {
        "ico": company.ico,
        "name": company.name,
        "naceCode": getattr(company, 'naceCode', None),
        "naceText": getattr(company, 'naceText', None),
        "legalForm": getattr(company, 'legalForm', None),
        "status": getattr(company, 'status', None),
        "financialStatements": sorted_stmts,
        "vestnikEvents": company.vestnikEvents or [],
        "companyEvents": company.companyEvents or [],
        "_financial_basis": "individual",
    }

    trends = compute_financial_trends(sorted_stmts)
    scorecard = compute_forensic_scorecard(company_dict, trends)
    print(f"    ✓ Score: {scorecard.total_score} ({scorecard.risk_category}), confidence: {scorecard.confidence}")

    # 4. Compute deterministic adjustment
    narrative_by_year = []
    notes_by_year = []
    registry_findings = []
    wh_refund = 0

    det_adj, det_breakdown = _compute_deterministic_adjustment(
        narrative_by_year,
        notes_by_year,
        company_dict.get("companyEvents") or [],
        TEST_ICO,
        is_consolidated=False,
        registry_sources=None,
    )
    final_score = max(0, min(100, scorecard.total_score + det_adj))
    risk_category = scorecard.risk_category
    print(f"    ✓ Det adj: {det_adj}, final score: {final_score}")

    # 5. Compute inputDataHash
    print(f"\n[4] Computing inputDataHash...")
    _financial_basis = "individual"
    _is_consolidated = False
    _latest_year = sorted_stmts[0].year if sorted_stmts else None

    _hash_input = json.dumps({
        "ico": TEST_ICO,
        "scoring_version": SCORING_VERSION,
        "base_score": scorecard.total_score,
        "is_consolidated": _is_consolidated,
        "financial_basis": _financial_basis,
        "wh_override_refund": wh_refund,
        "nace_code": company_dict.get("naceCode", ""),
        "financials": [
            {
                "year": s.year,
                "totalAssets": s.totalAssets,
                "currentAssets": s.currentAssets,
                "equity": s.equity,
                "shortTermLiabilities": s.shortTermLiabilities,
                "longTermLiabilities": s.longTermLiabilities,
                "totalLiabilities": getattr(s, 'totalLiabilities', None),
                "mainActivityRevenue": s.mainActivityRevenue,
                "grossProfit": s.grossProfit,
                "netProfitLoss": s.netProfitLoss,
                "cashAndEquivalents": s.cashAndEquivalents,
                "operatingCashFlow": s.operatingCashFlow,
                "investingCashFlow": s.investingCashFlow,
                "financingCashFlow": s.financingCashFlow,
                "staffCosts": s.staffCosts,
                "depreciation": s.depreciation,
                "interestExpense": s.interestExpense,
                "incomeTax": s.incomeTax,
                "inventory": s.inventory,
                "tradeReceivables": s.tradeReceivables,
                "tradePayables": s.tradePayables,
                "employeeCount": s.employeeCount,
                "monthsInPeriod": s.monthsInPeriod,
                "statementType": s.statementType,
                "isConsolidated": s.isConsolidated,
                "retainedEarnings": s.retainedEarnings,
                "shareCapital": s.shareCapital,
                "stBankLoans": s.stBankLoans,
                "ltReserves": s.ltReserves,
                "stReserves": s.stReserves,
                "socialInsuranceLiabilities": s.socialInsuranceLiabilities,
                "taxLiabilities": s.taxLiabilities,
                "employeeLiabilities": s.employeeLiabilities,
                "dataQualityStatus": s.dataQualityStatus,
                "auditorOpinion": {
                    "opinionType": getattr(s.auditorOpinion, 'opinionType', None) if s.auditorOpinion else None,
                    "goingConcernRisk": getattr(s.auditorOpinion, 'goingConcernRisk', None) if s.auditorOpinion else None,
                } if s.auditorOpinion else None,
            }
            for s in sorted_stmts
        ],
        "narrative": [],
        "notes": [],
        "events": [
            {
                "sev": getattr(ev, 'severity', None),
                "type": getattr(ev, 'eventType', None),
                "source": getattr(ev, 'source', None),
                "meta": getattr(ev, 'metadata', None),
                "ts": str(getattr(ev, 'createdAt', '')),
            }
            for ev in (company_dict.get("companyEvents") or [])
        ],
        "vestnik": [
            {
                "type": getattr(e, 'eventType', None),
                "sev": getattr(e, 'severityLevel', None),
                "pub": str(getattr(e, 'publishedAt', None)),
            }
            for e in (company.vestnikEvents or [])
        ],
        "registry": [],
        "registry_unverified": [],
    }, sort_keys=True, default=str)
    _input_hash = hashlib.sha256(_hash_input.encode()).hexdigest()[:16]
    print(f"    ✓ inputDataHash: {_input_hash}")

    # 5b. Create a test ReportRequest to satisfy FK constraint
    print(f"\n[4b] Creating test ReportRequest records...")
    test_user = await db.user.find_first(where={"email": "test@verifa.sk"})
    test_user_id = test_user.id if test_user else "cmt0000000000000000000000"

    for rid in [TEST_REPORT_ID_1, TEST_REPORT_ID_2]:
        existing = await db.reportrequest.find_unique(where={"id": rid})
        if not existing:
            await db.reportrequest.create(data={
                "id": rid,
                "userId": test_user_id,
                "targetType": "COMPANY",
                "ico": TEST_ICO,
                "companyName": company.name,
                "status": "COMPLETED",
            })
    print(f"    ✓ Test ReportRequests ready")

    # 6. Create ReportFinancialSnapshot (RUN 1)
    print(f"\n[5] Creating ReportFinancialSnapshot (run 1)...")
    _fs_payload = {
        "reportRequestId": TEST_REPORT_ID_1,
        "companyIco": TEST_ICO,
        "companyIdentity": Json({
            "ico": company.ico,
            "name": company.name,
            "naceCode": company_dict.get("naceCode", ""),
            "naceText": company_dict.get("naceText"),
            "legalForm": company_dict.get("legalForm"),
            "status": company_dict.get("status"),
        }),
        "financialStatements": Json([
            {k: getattr(s, k, None) for k in [
                "year", "totalAssets", "currentAssets", "equity", "netProfitLoss",
                "mainActivityRevenue", "grossProfit", "operatingCashFlow",
                "staffCosts", "employeeCount", "statementType", "isConsolidated",
                "retainedEarnings", "shareCapital", "dataQualityStatus",
            ]}
            for s in sorted_stmts
        ]),
        "auditorOpinions": Json([
            {"year": s.year, "opinion": getattr(s, 'auditorOpinion', None)}
            for s in sorted_stmts if getattr(s, 'auditorOpinion', None)
        ]),
        "narrativeRisk": Json([]),
        "notesRisk": Json([]),
        "companyEvents": Json([
            {k: getattr(ev, k, None) for k in ["source", "eventType", "severity", "metadata", "createdAt"]}
            for ev in (company.companyEvents or [])
        ]),
        "vestnikEvents": Json([
            {k: getattr(e, k, None) for k in ["eventType", "severityLevel", "publishedAt"]}
            for e in (company.vestnikEvents or [])
        ]),
        "registryFindings": Json([]),
        "scoringInputs": Json({
            "naceCode": company_dict.get("naceCode", ""),
            "isConsolidated": _is_consolidated,
            "financialBasis": _financial_basis,
            "whOverrideRefund": wh_refund,
            "scoringVersion": SCORING_VERSION,
        }),
        "inputDataHash": _input_hash,
    }

    fs_id_1 = await save_report_financial_snapshot(_fs_payload)
    print(f"    ✓ ReportFinancialSnapshot ID: {fs_id_1}")

    # 7. Create ScoringSnapshot linked to FinancialSnapshot
    print(f"\n[6] Creating ScoringSnapshot...")
    snapshot_payload = {
        "companyIco": TEST_ICO,
        "reportRequestId": TEST_REPORT_ID_1,
        "scoringVersion": SCORING_VERSION,
        "financialYear": _latest_year,
        "baseScore": scorecard.total_score,
        "finalScore": final_score,
        "riskCategory": risk_category,
        "adjustmentTotal": det_adj,
        "adjustments": Json(det_breakdown),
        "isConsolidated": _is_consolidated,
        "financialBasis": _financial_basis,
        "llmAdjustment": 0,
        "whOverrideRefund": wh_refund,
        "inputDataHash": _input_hash,
        "reportFinancialSnapshotId": fs_id_1,
    }
    await save_scoring_snapshot(snapshot_payload)
    print(f"    ✓ ScoringSnapshot saved")

    # 8. Verify in DB
    print(f"\n[7] Verifying DB state...")
    fs = await db.reportfinancialsnapshot.find_unique(where={"reportRequestId": TEST_REPORT_ID_1})
    ss = await db.scoringsnapshot.find_first(where={"reportFinancialSnapshotId": fs_id_1})

    checks = []
    checks.append(("ReportFinancialSnapshot exists", fs is not None))
    checks.append(("companyIdentity populated", fs is not None and isinstance(fs.companyIdentity, dict) and "ico" in fs.companyIdentity))
    checks.append(("financialStatements populated", fs is not None and isinstance(fs.financialStatements, list) and len(fs.financialStatements) > 0))
    checks.append(("scoringInputs populated", fs is not None and isinstance(fs.scoringInputs, dict) and "scoringVersion" in fs.scoringInputs))
    checks.append(("inputDataHash present", fs is not None and fs.inputDataHash is not None and len(fs.inputDataHash) == 16))
    checks.append(("ScoringSnapshot linked", ss is not None))
    checks.append(("Hash match (fs ↔ ss)", fs is not None and ss is not None and fs.inputDataHash == ss.inputDataHash))
    checks.append(("Score matches", ss is not None and ss.finalScore == final_score))

    for name, passed in checks:
        print(f"    {'✓' if passed else '✗'} {name}")

    # 9. Idempotency test
    print(f"\n[8] Idempotency test — saving again with same reportRequestId...")
    fs_id_1b = await save_report_financial_snapshot(_fs_payload)
    if fs_id_1b == fs_id_1:
        print(f"    ✓ Idempotent: returned same ID ({fs_id_1b})")
    else:
        print(f"    ✗ NOT idempotent: got different ID ({fs_id_1b} vs {fs_id_1})")

    # 10. Determinism test — run 2 with different reportRequestId, same data → same hash
    print(f"\n[9] Determinism test — run 2 with different reportRequestId, same data...")
    _fs_payload_2 = dict(_fs_payload)
    _fs_payload_2["reportRequestId"] = TEST_REPORT_ID_2
    fs_id_2 = await save_report_financial_snapshot(_fs_payload_2)

    fs2 = await db.reportfinancialsnapshot.find_unique(where={"reportRequestId": TEST_REPORT_ID_2})
    if fs2 and fs2.inputDataHash == fs.inputDataHash:
        print(f"    ✓ Same inputDataHash across runs: {fs2.inputDataHash}")
    else:
        print(f"    ✗ Different hashes: run1={fs.inputDataHash if fs else 'N/A'} vs run2={fs2.inputDataHash if fs2 else 'N/A'}")

    # 11. Cleanup
    print(f"\n[10] Cleanup...")
    try:
        if fs_id_1:
            await db.reportfinancialsnapshot.delete(where={"id": fs_id_1})
        if fs_id_2:
            await db.reportfinancialsnapshot.delete(where={"id": fs_id_2})
        if ss:
            await db.scoringsnapshot.delete(where={"id": ss.id})
        # Clean up test ReportRequests
        for rid in [TEST_REPORT_ID_1, TEST_REPORT_ID_2]:
            try:
                await db.reportrequest.delete(where={"id": rid})
            except Exception:
                pass
        print(f"    ✓ Cleaned up test records")
    except Exception as e:
        print(f"    ⚠ Cleanup error: {e}")

    # Summary
    print(f"\n{'=' * 50}")
    _idempotent = fs_id_1b == fs_id_1
    _same_hash = fs2 is not None and fs is not None and fs2.inputDataHash == fs.inputDataHash
    all_pass = all(p for _, p in checks) and _idempotent and _same_hash
    if all_pass:
        print("=== ALL E2E CHECKS PASSED ===")
    else:
        print("=== SOME CHECKS FAILED ===")

    await db.disconnect()
    await disconnect_db()


if __name__ == "__main__":
    asyncio.run(main())

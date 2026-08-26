---
description: Design proposal for immutable per-report financial snapshot (IMPLEMENTED)
---

# Immutable Financial Snapshot — Design Proposal (IMPLEMENTED)

## Status: IMPLEMENTED in both Prisma schemas + verdict_builder.py

## Problem

`FinancialStatement` is keyed by `(companyIco, year)` and uses `upsert`. When two reports
for the same IČO run at different times, the second report's extraction overwrites the first.
Report A's `ScoringSnapshot` still references a score, but the underlying data that produced
that score no longer exists in DB.

For a due-diligence product, this is unacceptable: a customer who buys a report today must
be able to prove what data produced their score 6 months later.

## Design

### New model: `ReportFinancialSnapshot`

```prisma
model ReportFinancialSnapshot {
  id              String   @id @default(uuid())
  reportRequestId String   @unique
  companyIco      String
  schemaVersion   String   @default("v1")
  scoringVersion  String   @default("v3-candidate")

  companyIdentity Json     // {ico, name, naceCode, naceText, legalForm, status}
  financialStatements Json  // Full financial statement data at time of report
  auditorOpinions Json?    // AuditorOpinion per year
  narrativeRisk   Json?    // NarrativeRiskAnalysis per year
  notesRisk       Json?    // NotesRiskAnalysis per year
  companyEvents   Json?    // CompanyEvent[] at time of report
  vestnikEvents   Json?    // VestnikEvent[] at time of report
  registryFindings Json?   // Registry source findings at time of report
  scoringInputs   Json?    // {naceCode, isConsolidated, financialBasis, whOverrideRefund}
  sourceMetadata  Json?    // [{source, retrievedAt, documentId, extractionHash}]
  inputDataHash   String?  // SHA-256 of all scoring inputs

  createdAt       DateTime @default(now())

  reportRequest   ReportRequest @relation(fields: [reportRequestId], references: [id], onDelete: Cascade)
  scoringSnapshot ScoringSnapshot?

  @@index([companyIco])
  @@index([createdAt])
}
```

### Key properties

1. **One per report**: `@@unique([reportRequestId])` — exactly one snapshot per report.
2. **Immutable**: Never updated after creation. `create()` only, no `upsert()`.
3. **Self-contained**: Contains all data that influenced the score, not just a reference.
4. **Hashed**: `dataHash` allows quick equality check between reports.

### When to create

At the end of `run_and_save_audit_verdict`, **after** computing the inputDataHash but
**before** saving the ScoringSnapshot. The snapshot ID is then linked to the ScoringSnapshot.

Implemented in `verdict_builder.py` lines ~1317-1361. Guarded by `if report_request_id`.
Uses `save_report_financial_snapshot` in `db_repository.py` which is idempotent (checks
for existing snapshot by reportRequestId).

### Link to ScoringSnapshot

Add `reportFinancialSnapshotId` to `ScoringSnapshot`:

```prisma
model ScoringSnapshot {
  // ... existing fields ...
  reportFinancialSnapshotId String?
  reportFinancialSnapshot   ReportFinancialSnapshot? @relation(fields: [reportFinancialSnapshotId], references: [id])
}
```

### Migration plan

1. ✅ **Add model to both Prisma schemas** (frontend + worker).
2. **Run `prisma migrate dev`** — creates table, no data changes. (PENDING)
3. ✅ **Add snapshot creation** in `run_and_save_audit_verdict` — guarded by `if report_request_id`.
4. ✅ **Populate `reportFinancialSnapshotId`** on `ScoringSnapshot` payload.
5. **Backfill**: For existing `ScoringSnapshot` records, `reportFinancialSnapshotId` stays null
   (historical snapshots don't have the link — acceptable).
6. **No changes to `FinancialStatement`** — it remains shared mutable state. The snapshot
   is the immutable copy; `FinancialStatement` is the live working set.

### What this enables

```
ReportRequest #123
    ↓
ReportFinancialSnapshot #abc (immutable, contains all scoring inputs)
    ↓
ScoringSnapshot #def (score, risk category, adjustments, inputDataHash)
    ↓
AuditVerdict (LLM verdict text, findings, executive summary)
```

You can now answer:
- "What data produced this score?" → Read ReportFinancialSnapshot
- "Did two reports use the same data?" → Compare dataHash
- "Reproduce this score" → Feed ReportFinancialSnapshot data into scoring engine

### What this does NOT change

- `FinancialStatement` remains the live working set (upsert on new extraction).
- Extraction cache remains per-PDF (not per-report).
- Scoring engine code unchanged — it reads from `company` object as before.
- No migration of existing reports (they have ScoringSnapshot but no FinancialSnapshot).

### Size estimate

A typical company has 3-5 financial statements with ~40 fields each, plus narrative/notes.
Estimated JSON size: 20-50 KB per report. At 1000 reports/year → ~50 MB/year. Negligible.

### Alternatives considered

**Option B: Add `reportRequestId` to `FinancialStatement`**
- Rejected: Breaks the "one FS per company per year" invariant.
- Would require duplicate FS records for the same year from different reports.
- Scoring engine would need to know which FS set to use — adds complexity.

**Option C: Version `FinancialStatement` with `validFrom`/`validTo`**
- Rejected: Temporal tables are complex, PostgreSQL doesn't have native support.
- All queries would need `WHERE validTo IS NULL` or `AS OF` semantics.
- Over-engineering for current needs.

**Option D: Store financial data inside `ScoringSnapshot.adjustments` JSON**
- Rejected: Mixing scoring outputs with inputs in one field.
- `ScoringSnapshot` is the score audit trail; `ReportFinancialSnapshot` is the data audit trail.
- Separation of concerns.

# P4.2 — Paid Report Product Reliability Audit

**Date:** 2026-08-11  
**Reframe:** Nie "backend reliability" — ale "keď človek zaplatí za report, dostane spoľahlivo to, čo sme mu sľúbili?"

---

## Q1: Čo presne používateľ zaplatí?

**Stripe checkout** (`/api/billing/checkout`) → credit-based system.

User kupuje **kredity** (1 credit = 1 report). Platba cez Stripe.

| Balík | Cena | Kredity | Cena/report |
|-------|------|:-:|:-:|
| payg1 | €14 | 1 | €14,00 |
| payg10 | €89 | 10 | €8,90 |
| payg50 | €349 | 50 | €6,98 |

**Source:** `@/frontend/src/lib/pricing-plans.ts:13-68`

---

## Q2: Koľko kreditov report stojí?

**1 credit = 1 report.** Potvrdené v `@/frontend/src/app/api/reports/route.ts:226`:

```typescript
const creditResult = await consumeCreditsTx(tx, user.id, 1);
```

---

## Q3: Čo presne sa spustí po zaplatení?

```text
POST /api/reports
  ↓
1. Rate limit check (20 req / 10 min)
2. Auth check
3. Credit check (non-expired batches with remaining > 0)
4. Deduplication (same IČO + PENDING/PROCESSING within 2 min → return existing)
5. Source filtering (user's defaultSources from settings)
6. Worker health check
7. Atomic transaction:
   - consumeCreditsTx(1)  ← credit deducted HERE
   - create ReportRequest (PENDING)
   - create ReportSource records (PENDING per source)
8. enqueueReportTask → ARQ Redis queue
9. Update status → PROCESSING
10. Return reportRequestId → redirect to /reports/{id}
```

**Worker pipeline** (`@/worker/src/main.py:139`):

```text
_execute_report_inner(task)
  ↓
1. Launch Playwright browser
2. Run 26 scrapers in parallel (asyncio.gather)
   - Browser-based: ORSR, ZRSR, RPO, INSOLVENCY, POVERENIA, ...
   - API-based: REGISTER_UZ, OBCHODNY_VESTNIK
   - Dependent: FINANCNA_SPRAVA, DISKVALIFIKACIE, RPO (wait for ORSR)
3. RÚZ financial data extraction (structured JSON preferred)
4. AI pipeline:
   - Financial analysis (ratios, trends, Altman, Piotroski, Beneish)
   - Forensic ORSR history
   - Cross-analysis (registry findings → risk signals)
   - Notes forensic
5. Deterministic scorecard (compute_forensic_scorecard)
6. Chief Auditor LLM (verdict synthesis, score adjustment)
7. QA Agent
8. Save AuditVerdict to DB
9. PDF compile:
   - Cover page (HTML → Playwright → PDF)
   - Merge cover + source PDFs (PdfWriter)
   - Page numbering, bookmarks, overlays
10. Upload to S3
11. Cleanup intermediate files
12. Determine final status (COMPLETED / PARTIAL / FAILED)
13. If FAILED → refund callback to frontend
14. Email notification
```

---

## Q4: Aké registry sa skutočne preveria?

**26 scrapers registered** in `@/worker/src/scrapers/registry.py:60-87`:

| Category | Sources | Count |
|----------|---------|:-:|
| Basic registries | ORSR, ZRSR, RPO, RPVS, REGISTER_UZ, OBCHODNY_VESTNIK | 6 |
| Insolvency & debts | INSOLVENCY, POVERENIA, FINANCNA_SPRAVA, SP_DLZNICI, VSZP_DLZNICI, DOVERA_DLZNICI, UNION_DLZNICI | 7 |
| Financial tax | FS_DANOVE_SUBJEKTY, FS_DPH_REGISTROVANI, FS_DPH_RUSENIE, FS_DPH_VYMAZANI, FS_DPH_NADMERNY_ODPOCET, FS_DAN_Z_PRIJMOV, FS_DAN_PRIJMOV_REG | 7 |
| Courts & sanctions | DISKVALIFIKACIE, ROZHODNUTIA | 2 |
| Assets & rights | NCRZP, NCRD | 2 |
| Contracts | CRZ, UVO | 2 |
| **Total** | | **26** |

**Registered in Prisma enum but NO scraper:**
- `CRRS` — Register restrukturalizácií
- `OCHRANNE_ZNAMKY` — Ochranné známky (disabled on frontend)
- `FS_DPH_BANKOVE_UCTY` — Bankové účty DPH

**Not in enum, not scraped:**
- `CRE` — Centrálny register exekúcií (deferred per P4.1.5)

**Frontend default:** 25 enabled sources (OCHRANNE_ZNAMKY disabled). User can customize via Settings.

---

## Q5: Čo sa stane pri nedostupnom registri?

```text
Scraper fails / registry down
  ↓
Source status = FAILED or UNAVAILABLE
  ↓
Source is marked in DB (ReportSource.status)
  ↓
Source PDF is NOT included in evidence binder
  ↓
Cover page semaphore shows: ✗ N FAILED, ? N UNAVAILABLE
  ↓
TOC section shows per-source status with colored dots
  ↓
_determine_final_status():
  - ALL SUCCESS → COMPLETED
  - ANY non-SUCCESS → PARTIAL
  - No sources → FAILED
  ↓
User gets PDF with whatever sources succeeded
  ↓
User pays full price (1 credit, no refund)
```

**🟠 P1: No "completeness" label on cover page.** User sees semaphore counts (e.g. "✓ 24, ⚠ 1, ✗ 1") but no aggregate "Úplnosť preverenia: 92%".

**🟠 P1: No "not included" indicator.** Sources without scrapers (CRE, CRRS, OCHRANNE_ZNAMKY) are silently absent. User doesn't know they were never checked.

---

## Q6: Čo presne obsahuje PDF?

**Structure** (from `@/worker/src/templates/report_template.html`):

```text
PDF
├── COVER PAGE (_cover.html)
│   ├── Verifa logo
│   ├── Company name + IČO
│   ├── NACE code + description
│   ├── Verifa Score stamp (circular gauge, color-coded)
│   ├── Metadata: IČO, generated date, page count
│   └── Semaphore pills: ✓ N OK, ⚠ N warning, i N info, ? N unavailable, ✗ N failed
│
├── EXECUTIVE SUMMARY (_summary.html)
│   ├── Chief Auditor's executive summary
│   ├── Analysis reliability gauge (confidence score %)
│   ├── Confidence factors checklist
│   ├── Risk heatmap (fraud heatmap matrix)
│   ├── Final verdict
│   ├── Key risk
│   └── Recommendations
│
├── FINANCIAL ANALYSIS (_financials.html)
│   ├── Financial statements table (5 years)
│   ├── Profit & loss summary
│   ├── Balance sheet summary
│   ├── Cash flow statement
│   ├── Financial ratios (ROA, ROE, EBITDA, current ratio, etc.)
│   ├── Altman Z'' score
│   ├── Piotroski F-score
│   ├── Beneish M-score
│   ├── Trend charts (revenue, profit, equity)
│   ├── Going concern assessment
│   └── Audit opinion check
│
├── LEGAL RISKS (_legal.html)
│   ├── Vestník events risk matrix
│   ├── Events timeline
│   └── Detailed event cards
│
├── REGISTRY SOURCES (_table_of_contents.html)
│   ├── Critical legal findings warning box
│   └── Per-source grid with:
│       ├── Source name
│       ├── Status dot (green/red/blue/yellow/grey)
│       ├── Findings summary (truncated)
│       └── Page reference in evidence binder
│
├── GLOSSARY + METHODOLOGY
│   ├── Financial terms glossary
│   ├── Verifa Score model explanation
│   ├── 5-pillar scorecard description
│   └── Score scale (AAA/A/B/C/D)
│
├── DIVIDER PAGE ("PRÍLOHY - ZDROJOVÉ DÁTA")
│
└── EVIDENCE BINDER (Part B)
    └── Source PDFs (only sources with records, sorted by category)
```

**Verdict:** PDF je komplexny due-diligence dokument. Obsahuje analýzu, scoring, evidence. **To je reálny produkt.**

---

## Q7: Je v PDF jasne uvedené, čo bolo a nebolo skontrolované?

**Čo funguje:**
- ✅ Cover page shows semaphore counts (N OK, N warning, N unavailable, N failed)
- ✅ TOC section shows per-source status with colored dots + findings summary
- ✅ Generated date is on cover page
- ✅ Critical findings are highlighted in red warning box

**Čo chýba:**
- 🔴 **No aggregate completeness %** — user sees "✓ 24, ⚠ 1, ✗ 1" but not "Úplnosť: 92%"
- 🔴 **No "not included" row** — CRE, CRRS, OCHRANNE_ZNAMKY are absent without explanation
- 🟠 **No source criticality indicator** — ORSR failure looks the same as CRZ failure in the grid

**Honest due-diligence requires:** User by mal vidieť:
```
Úplnosť preverenia: 92% (24 z 26 zdrojov)
CRE: ⚪ Nie je súčasťou automatického preverenia
```

---

## Q8: Dostane používateľ PDF vždy, keď zaplatí?

| Status | PDF? | Credit charged? | Refund? |
|--------|:----:|:---------------:|:-------:|
| COMPLETED | ✅ Yes | 1 credit | ❌ No |
| PARTIAL | ✅ Yes (partial sources) | 1 credit | ❌ No |
| FAILED (worker crash) | ❌ No | 1 credit | ✅ Full refund |
| FAILED (S3 upload) | ❌ No | 1 credit | ✅ Full refund |
| FAILED (all sources fail) | ❌ No* | 1 credit | ✅ Full refund |

*Actually: if all sources fail but worker doesn't crash, `_determine_final_status` returns PARTIAL (not FAILED) unless `not sources`. So the user might get a nearly-empty PDF.

**🟠 P1 EDGE CASE:** If all 26 scrapers fail but the worker doesn't crash, status = PARTIAL. User gets a cover page with score 0 and no evidence binder. This is technically "a PDF" but not a useful product.

---

## Q9: Čo sa stane pri PARTIAL?

**Current behavior:**
- User pays 1 credit (full price)
- User gets PDF with whatever sources succeeded
- No refund
- No warning email about partial completeness
- PDF cover page shows semaphore counts but no aggregate completeness %

**User experience:** User sees "PARTIAL" status badge on `/reports/{id}` page. Can download PDF. PDF contains a cover page with semaphore pills showing how many sources failed.

**Is this OK?** Per user's reframe: **Yes, mostly.** A report with 24/26 sources is still valuable. The issue is transparency — user should clearly see what's missing, not just a count.

**Recommended:** Add completeness tier label to cover page:
- 🟢 Complete (90-100% relevant sources OK)
- 🟡 Substantially complete (75-89%)
- 🟠 Limited (critical source missing)
- 🔴 Failed → refund

---

## Q10: Čo sa stane pri FAILED?

**Flow:**
```text
Worker crash / exception / S3 upload failure
  ↓
update_report_status(FAILED)
  ↓
Worker calls POST /api/reports/{id}/refund (x-worker-secret)
  ↓
Refund route checks: report.status === "FAILED" → refundCredits(1)
  ↓
refundCreditsTx:
  1. Lock wallet row (SELECT FOR UPDATE)
  2. Find original CHARGE transaction
  3. Check if REFUND already exists → idempotent
  4. Restore credit to batches (LIFO)
  5. Create REFUND transaction
  6. Increment wallet balance
  ↓
Credit restored ✅
```

**Fallback paths:**
1. **ARQ retry exhaustion** (`worker_arq.py:102-117`): Marks FAILED in DB, but does NOT call refund endpoint. Relies on cron.
2. **Frontend cron** (`/api/reports/recover-stuck`): Every 15 min, catches stuck PROCESSING > 30 min → FAILED + refund. Also catches FAILED reports without REFUND transaction (last 24h).
3. **Worker in-process** (`cleanup.py:143-175`): `recover_stale_reports()` marks PROCESSING > 20 min as FAILED.

**🟢 Double-refund prevention: 3 layers**
1. `refundCreditsTx` checks for existing REFUND transaction
2. Refund route checks `report.status !== "FAILED"` → 422
3. DB `@@unique([reportRequestId, type])` on WalletTransaction

**🟠 P2: ARQ retry path doesn't call refund directly.** If worker completely dies (OOM, container restart), refund depends on cron running within 15 min. Not a double-refund risk, but a delay.

---

## Q11: Je výsledok reprodukovateľný?

**Each report is a fresh scrape.** No caching, no reuse of previous results.

- Same IČO, same user, 2nd report = new scrape, new credit charge
- Same IČO, different user = independent scrape
- Score may differ between runs if:
  - Registry data changed (new Vestník event, new insolvency filing)
  - LLM produces different interpretation (temperature=0.0, but non-deterministic)
  - Different sources selected

**🟢 OK for due-diligence:** Fresh data is a feature, not a bug. User gets current state of registries.

**🟠 P2: Score reproducibility.** The deterministic scorecard is reproducible. But Chief Auditor LLM adjustment (±points) may vary between runs. The `inputDataHash` in AuditVerdict provides traceability but not reproducibility.

---

## Q12: Je report dostatočne hodnotný, aby zaň človek reálne zaplatil?

**What the user gets for 1 credit (€6.98–€14):**

1. **26 registry checks** — automated, parallel, with evidence PDFs
2. **Financial analysis** — 5-year statements, ratios, Altman, Piotroski, Beneish, cash flow, going concern
3. **AI Chief Auditor verdict** — executive summary, risk assessment, recommendations
4. **Verifa Score** — deterministic 5-pillar scorecard with breakdown
5. **Evidence binder** — all source PDFs merged with cover page, page numbers, bookmarks
6. **Legal risk timeline** — Vestník events with severity classification
7. **Methodology & glossary** — transparent scoring explanation

**Manual equivalent:** A lawyer doing this manually would spend 2-4 hours checking 26 registries, downloading PDFs, analyzing financials, and writing a summary.

**Verdict:** **Yes, the report is valuable enough.** The product delivers real time savings and structured due-diligence output.

---

## Summary

### Product-level findings

| # | Question | Answer | Status |
|---|----------|--------|--------|
| 1 | What does user pay? | Credits via Stripe (€6.98–€14/report) | ✅ |
| 2 | How many credits? | 1 credit = 1 report | ✅ |
| 3 | What happens after payment? | 26 scrapers → AI pipeline → PDF → S3 | ✅ |
| 4 | Which registries? | 26 active scrapers, 3 registered but no scraper | ✅ |
| 5 | Unavailable registry? | Source marked FAILED, report = PARTIAL | 🟠 |
| 6 | What's in the PDF? | Cover + analysis + score + evidence binder | ✅ |
| 7 | Is coverage transparent? | Partially — counts but no %, no "not included" | 🔴 |
| 8 | Always gets PDF? | Yes for COMPLETED/PARTIAL, no for FAILED | 🟠 |
| 9 | What on PARTIAL? | Full charge, PDF with partial sources | ✅* |
| 10 | What on FAILED? | Full refund, 3-layer idempotency | ✅ |
| 11 | Reproducible? | Fresh scrape each time, deterministic score | ✅ |
| 12 | Worth paying for? | Yes — saves 2-4h manual work | ✅ |

*OK per user's reframe: PARTIAL with 24/26 sources is still valuable. Transparency is the gap, not refund.

### Issues to fix

| Priority | Issue | Fix |
|----------|-------|-----|
| 🔴 P0 | Report deleted after 30 days (DB + S3) | Change `cleanup.py` to keep DB record + S3 PDF, only delete intermediate artifacts |
| 🔴 P0 | No completeness % or "not included" on cover | Add aggregate completeness metric + missing source rows to PDF cover |
| 🟠 P1 | No source criticality in status logic | If ORSR/REGISTER_UZ/VESTNÍK/INSOLVENCY/POVERENIA fails → add "critical source warning" to PDF |
| 🟠 P1 | All sources fail → PARTIAL (not FAILED) | Add threshold: if <3 sources succeed → FAILED → refund |
| 🟡 P2 | ARQ retry doesn't call refund | Add refund callback in `worker_arq.py` retry exhaustion |

### What's NOT needed (per user's reframe)

- ❌ Pro-rata partial refund — report value is not linear per source
- ❌ Report caching — fresh data is a feature for due diligence
- ❌ "New events since last report" detection — separate alerting feature

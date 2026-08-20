# DOMAIN RULES — SOURCE OF TRUTH

These rules define Verifa's business logic.

Do NOT infer, reinterpret, simplify, or replace these rules
based on coding conventions, external examples, or personal assumptions.

If implementation requirements conflict with these rules:
STOP and request clarification.

If the task intentionally changes a domain rule:
the change must be explicitly documented in the Task Contract
and reviewed before implementation.

If implementation reveals a business rule not covered by existing domain rules:
do NOT silently add it to this file. Mark it as UNVERIFIED ASSUMPTION in the
handoff and escalate for human review.
Domain rules must have authority over AI, but AI must not have authority
to create domain rules without approval.

---

## Data Invariants

### DATA-001: Missing data is not zero

Missing data is not equivalent to zero unless explicitly specified by the rule.
NULL, 0, N/A, not available, and not applicable are five different states, not one value.
Never coerce NULL to 0 in financial calculations without an explicit rule permitting it.

### DATA-002: Fallback values must be explicitly recorded

Never silently substitute a fallback value without recording that the fallback was used.
If equity is computed from assets minus liabilities, log it.
If gross margin falls back to Pridaná hodnota, log it.
If a field is approximated, mark it as low-confidence.

### DATA-003: Source provenance is preserved

RÚZ source IDs (ruzZavierkaId, ruzVykazId, ruzEntityId) must be persisted with every financial record.
When data is re-seeded, source IDs must be updated to reflect the current source.

### DATA-004: Statement type consistency

When a company has both consolidated and individual financial statements:
- Consolidated preferred if ≥ 3 years available
- Otherwise individual statements used
- Mixing statement types within a trend analysis is explicitly forbidden

Rationale: mixing consolidated and individual statements produces inconsistent
trends (different scopes, different subsidiary inclusion).

---

## Financial Calculations

### FIN-001: Gross Margin (SK GAAP)

Gross margin = Revenue (r.1) - (Material consumption (r.12) + Services (r.14)).

Row 10 (operating costs total) must NOT be used as COGS — it includes wages, depreciation, and services.

Decision tree:

1. If revenue + material_consumption + services are available:
   → use primary formula: revenue - (material_consumption + services)

2. Otherwise, if added_value (r.28) is available:
   → use added_value as proxy

3. Otherwise:
   → return None

Never:
- substitute missing cost components with zero
- use operating_costs (r.10) as COGS
- manufacture a value from unrelated fields

### FIN-002: DIO (Days Inventory Outstanding)

DIO = (Inventory / material_consumption) × 365.

Material consumption (r.12) is the ONLY valid COGS proxy for DIO.
Operating costs (r.10) must NOT be used — it includes wages, depreciation, and services.

Rules:
- If material_consumption is None or 0, and inventory > 0 → DIO = None (not division by zero)
- If inventory = 0 → DIO = 0
- If DIO > 730 days → set to None (economically impossible — likely data error)
- Anualize COGS for shortened periods: cogs_proxy × (12 / months_in_period)

### FIN-003: Equity Fallback

When vlastne_imanie_celkom is missing, compute from:

equity = celkove_aktiva - (kratkodobe_zavazky + dlhodobe_zavazky + dlhodobe_rezervy + kratkodobe_rezervy + bezne_bankove_uvery)

Rules:
- If result ≤ 0 → skip (do not apply negative equity)
- Do not overwrite if vlastne_imanie_celkom already exists
- Do not overwrite if field is in low_confidence_fields
- Fallback equity MUST be distinguishable from reported equity.

Current implementation:
- fallback calculation exists and is logged
- explicit equity_source field does NOT currently exist in FinancialMetrics

TODO:
Add provenance field (equity_source = "calculated_fallback" vs "reported") in a dedicated task.
Do not add the field as part of an unrelated task.

### FIN-004: Cash Flow Sanitization

Cash-flow values must not be sanitized solely because they are negative.
Negative cash flow with positive net income is economically possible
and must not automatically be treated as invalid.

Sanitization is allowed only when an explicit validation rule identifies
the value as structurally invalid or demonstrably corrupted.

Any sanitization must:
- be deterministic (not based on "suspicious" or "extreme" heuristics)
- be logged
- preserve the original value
- record the reason

Source-specific zero handling:
- RÚZ JSON: 0 is a legitimate value — do NOT coerce to None.
- LLM extraction: 0 in cash-flow fields may be an artefact of old LLM prompts
  that instructed "fill zero for missing data". Convert 0 → None for CF fields
  (operatingCashFlow, investingCashFlow, financingCashFlow) from LLM source only.

Specific sanitization rules (deterministic):
- operatingCashFlow == 0 (from LLM source) → None
- abs(investingCashFlow) > 1.5 × totalAssets → None (structurally implausible)
- abs(financingCashFlow) > 1.5 × totalAssets → None (structurally implausible)

---

## Financial Formulas

### FIN-005: Altman Z''-Score

Model: Altman Z'' (1995) for private / non-manufacturing firms.

Formula:
Z'' = 6.56×X1 + 3.26×X2 + 6.72×X3 + 1.05×X4

Inputs:
- X1 = Working Capital / Total Assets
- X2 = Equity / Total Assets (retained earnings approximation)
- X3 = EBIT / Total Assets (EBIT = net profit + |interest expense|)
- X4 = Equity / Total Liabilities

Missing data:
- If totalAssets, netProfit, equity, or shortTermLiabilities is None → return N/A
- If currentAssets is None (not 0): fallback to 60% of totalAssets for working capital
- If currentAssets is 0 (legitimate): use 0 — do NOT apply fallback
- If longTermLiabilities is None: use 0
- Total liabilities: shortTerm + longTerm if > 0, else balance sheet identity (totalAssets - equity)

Zones:
- Z'' > 2.6: SAFE (Bezpečná zóna)
- 1.1 ≤ Z'' ≤ 2.6: GREY (Šedá zóna)
- Z'' < 1.1: DISTRESS (Núdzová zóna)

Sector exclusions:
- Financial institutions (banks, insurance): return N/A — not applicable
- If force_financial_inst=True: skip heuristic, return N/A directly

Version: Z'' (1995). Coefficients must not be changed.

### FIN-006: Piotroski F-Score

8-criteria model (9th criterion — shares outstanding — omitted).
Scale: 0-8.

Missing-data behavior:
- Missing data for a criterion → 0.5 points (neutral), NOT 0 (fail)
- This prevents systematic penalization of firms with incomplete statements

Criteria:
1. ROA > 0 (net profit / total assets)
2. Operating cash flow > 0
3. ΔROA > 0 (current ROA > previous ROA)
4. CFO > Net Income
5. ΔLeverage < 0 (long-term debt / total assets decreasing)
6. ΔLiquidity > 0 (current ratio increasing)
7. ΔMargin > 0 (gross margin increasing) — skip if grossProfit missing
8. ΔTurnover > 0 (asset turnover increasing)

Sector handling:
- Financial institutions: dLev, dLiq, dMargin are sector-neutralized (0.5)
- Requires minimum 2 years of data

### FIN-007: Beneish M-Score

Earnings manipulation detection model.
Threshold: M > -1.78 → manipulation indicator.

Formula:
M = -4.84 + 0.92×DSRI + 0.528×GMI + 0.404×AQI + 0.892×SGI
    + 0.115×DEPI - 0.172×SGAI + 4.679×TATA - 0.327×LVGI

Component definitions:
- DSRI = Days Sales in Receivables Index
- GMI = Gross Margin Index
- AQI = Asset Quality Index
- SGI = Sales Growth Index
- DEPI = Depreciation Index
- SGAI = SG&A Index
- TATA = Total Accruals to Total Assets
- LVGI = Leverage Index

Neutralization rules (when data missing, use neutral value, not 0):
- grossProfit missing → GMI = 1.0 (neutral)
- No PP&E field → DEPI = 1.0 (neutral)
- staffCosts missing → SGAI = 1.0 (neutral)
- operatingCashFlow missing → TATA = 0.0 (neutral)
  Rationale: without CF, accruals = netProfit - 0 would falsely flag profitable firms.

Guard: if revenue ≤ 0 or assets ≤ 0 → return N/A.

### FIN-008: EBIT and EBITDA

EBIT:
- Primary: profitBeforeTax + |interestExpense| (if PBT available)
- Fallback: netProfit + |interestExpense| + incomeTax (if PBT missing)
- If both missing → None

EBITDA:
- Formula: netProfit + incomeTax + |interestExpense| + depreciation
- If netProfit is None → EBITDA = None (NOT 0)
  Rationale: 0 would be misleading for firms with revenue but missing P&L detail.

### FIN-009: Revenue annualization for shortened periods

For DSO, DPO, and YoY comparisons when monthsInPeriod < 12:
annualized_revenue = revenue × (12 / monthsInPeriod)

Applied to:
- DSO = (tradeReceivables / annualized_revenue) × 365
- DPO = (tradePayables / annualized_revenue) × 365
- YoY revenue growth: both years annualized before comparison

If monthsInPeriod is None or 0 → use 12 (full year).

### FIN-010: White Horse Indicator (forensic anomaly)

Detects companies with reduced substance (schránkové firmy).

Triggers:
1. Revenue > 100,000 AND consistently zero staff costs for ≥ 3 years
   AND assets > 0 AND NOT IFRS → penalty: 15 points
   Rationale: large revenue with zero wages is a strong shell company signal.
   IFRS excluded because staff costs are often in notes (not parsed).

2. tradeReceivables / totalAssets > 0.90 → penalty: 10 points
   Rationale: receivables dominating assets = risk of uncollectible receivables.

### FIN-011: Financial institution detection

Heuristic detection based on balance sheet structure (no NACE code required).

Conditions (all must be true):
- totalAssets > 10,000,000
- equity > 0
- totalLiabilities (totalAssets - equity) > 50% of totalAssets

AND either:
- shortTermLiabilities ≤ 1% of totalAssets (bank/insurance: liabilities not classified as short-term)
  OR
- currentAssets ≤ 1% of totalAssets AND shortTermLiabilities ≤ 5% of totalAssets

Effects:
- Altman Z'': return N/A
- Piotroski dLev, dLiq, dMargin: sector-neutralized
- Scoring: current_ratio set to neutral, equity checked directly

### FIN-012: Startup profile detection

Criteria (all must be true):
- revenue ≤ 100,000 (or None)
- equity ≥ 500,000
- totalAssets > 0
- ≤ 2 financial statements (young firm)

Effects:
- Altman Z'' not penalized (X3=EBIT/Assets is negative due to investments)
- DQ multiplier floored at 0.8 (V2)
- Scoring: Altman component set to neutral, not 0

---

## Scoring & Risk

### SCORE-001: Scoring version

Production scoring: V2 (compute_forensic_scorecard).
V3 (compute_forensic_scorecard_v3) exists as an internal prototype and MUST NOT
be treated as production scoring.

Scoring version must be explicitly identified in persisted results.

Any transition from V2 → V3 requires:
- explicit approval
- new scoring version
- regression comparison against previous version
- distribution impact analysis
- explicit production activation

An agent MUST NOT activate V3 simply because it appears newer or more complete.

### SCORE-002: Scoring change control

A change to scoring logic requires:
- explicit approval
- new scoring version
- regression comparison against previous version
- documentation of expected score distribution impact

### SCORE-003: LLM must not redefine scoring

LLM must not independently redefine deterministic scoring logic.
Piotroski F-Score, Altman Z-Score, and White Horse Indicator have fixed weights.

### SCORE-004: NACE sector weights (V2)

5 pillars weighted differently by NACE sector prefix (first 2 digits).
Weights are calibrated and must not be changed without regression analysis.

Sectors and weights (P1/P2/P3/P4/P5):
- Manufacturing (10-33): 20/30/25/15/10
- Construction (41-43): 25/25/15/15/20
- Wholesale/Retail (46-47): 25/20/20/15/20
- Transport (49-53): 20/25/25/15/15
- IT services (62-63): 20/20/30/20/10
- Agriculture (01-03): 25/25/20/15/15
- Accommodation/Food (55-56): 25/20/20/15/20
- Default (all other): 30/25/20/15/10

### SCORE-005: Hard stop conditions

Vestník events with eventType containing any of these keywords trigger a hard stop:
- "konkurz"
- "likvidáci"
- "reštrukturalizáci"

Hard stop effects:
- total_score = 0
- risk_level = CRITICAL
- All pillar scores set to 0

Keyword matching must use Unicode NFC normalization before comparison.

### SCORE-006: Vestník event degradation timeline

Penalty weight decays over time from publication date:
- ≤ 365 days: 1.0 (full penalty)
- ≤ 3 years (1095 days): 0.7
- ≤ 5 years (1825 days): 0.4
- > 5 years: 0.1

### SCORE-007: Risk category thresholds

Risk categories based on total financial score:
- ≥ 90: AAA
- ≥ 70: A
- ≥ 40: B
- < 40: C

Risk levels (V2):
- Hard stop triggered: CRITICAL
- Any CRITICAL/HIGH vestník event: HIGH
- Score < 40: HIGH
- Score < 60: MEDIUM
- Score ≥ 60: LOW

### SCORE-008: DQ multiplier (V2)

Data quality multiplier applied to total score in V2:
- ≥ 5 years of statements: 1.0
- ≥ 3 years: 0.9
- ≥ 1 year: 0.7
- 0 years: 0.5

Adjustments:
- Startup profile: floor at 0.8 (do not penalize young firms below 0.8)
- No audit opinion found: × 0.85

### SCORE-009: DQ score (V3)

Separate data quality score (0-100), NOT a multiplier:
- ≥ 5 years: 40 points
- ≥ 3 years: 30 points
- ≥ 2 years: 20 points
- ≥ 1 year: 10 points
- P&L available: +25
- Cash flow available: +20
- Audit opinion available: +15

Max: 100. Not applied to financial score — reported independently.

### SCORE-010: Insolvency score model

5-factor predictive insolvency model (0-100, higher = worse):
- Equity trend declining: up to 25 points (8 per consecutive year)
- Revenue trend declining: up to 20 points (7 per consecutive year)
- Debt ratio growing: up to 20 points (7 per consecutive year)
- Consecutive loss years: up to 25 points (10 per year)
- Altman Z'' declining: up to 10 points (5 per year, min 2 if trend is declining)

Bonus reduction: 3+ consecutive profitable years → score - 10 (min 0).

Risk levels:
- ≥ 60: critical
- ≥ 40: high
- ≥ 20: medium
- < 20: low

Trend detection: linear regression slope with 1% of mean magnitude as sensitivity threshold.

_(Data void threshold is defined in DQ-003.)_

---

## Data Quality

### DQ-001: Balance sheet equality

When re-seeding or parsing financial statements, verify:
- NCA + CA ≈ totalAssets (left side)
- equity + shortTermLiabilities + longTermLiabilities ≈ totalAssets (right side)

Tolerance:
- < 5% difference: OK (may be other liabilities not captured)
- 5-15%: warning (minor gap)
- > 15%: error (large mismatch — investigate)

### DQ-002: No NULL-to-zero for financial metrics

Missing data from RÚZ = None, not 0 (except explicit zeros in JSON source).
Never substitute NULL with 0 in financial calculations.
(DQ-002 is the specific application of DATA-001 to RÚZ data.)

### DQ-003: Data void threshold

If < 30% of key metrics (totalAssets, equity, netProfitLoss, shortTermLiabilities,
mainActivityRevenue) are available for the latest statement → data_void.

Data void effects:
- Neutral scores (not 0) for unavailable components
- V2: pillar raw scores set to neutral values, not 0
- V3: unavailable components excluded from renormalization

---

## Entity Classification

### ENT-001: ICO validation

ICO must be 8 digits. Exclude "" and "00000000" from all queries and seeds.

### ENT-002: Template 699 guard

Consolidated statements (idSablony != 699) — extended fields are not parsed.
Template 699 = standard SK GAAP statement with full tables.

### ENT-003: Entity type classification

Legal forms are classified into:
- public: Obec, Rozpočtová org. štátu, Príspevková org., Štátny podnik, Štátny fond, Zariadenie štátu
- nonprofit: Nadácia, Občianske združenie, Záujmové združenie FO, Politická strana, Európske združenie, Neinvestičný fond, Fond, NOPS
- commercial: s.r.o., Akciová spol., Ver. obch. spol., v.o.s., Družstvo, Európske družstvo, Európska spol., Organiz. zahr. investora, Spoločný podnik
- other: anything not in the above sets

Effects on scoring:
- public: Altman N/A, Piotroski N/A, equity ratio used instead
- nonprofit: Altman N/A, Piotroski relevant
- commercial: full Altman + Piotroski
- other: treated as commercial

---

## Source Priority

### SRC-001: Priority order

1. RÚZ JSON (parsed) — primary source for SK GAAP
2. LLM extraction from PDF — for IFRS and fallback
3. ORSR — obchodný register (legal entity data)
4. Obchodný vestník — events

At conflict: RÚZ JSON > LLM extraction.

---

## DB Migrations

### DB-001: Additive by default

Migrations must be backward-compatible (additive only) unless Task Contract specifies otherwise.
Never use DROP COLUMN without backup and explicit approval.

### DB-002: Migration impact check

Before schema changes, check existing data and migration impact.
Verify no data loss occurs.

---

## Historical Data

### HIST-001: No deletion

Historical financial data must not be deleted.
Re-seed updates existing records, does not create duplicates.

### HIST-002: Checkpointing

Bulk operations must use checkpointing (output/*.json) to support resume after failure.

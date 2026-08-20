---
description: Post-task verification checklist before marking task as DONE
---

# POST-TASK CHECK

Before marking the task DONE:

- [ ] Implementation matches the Task Contract.
- [ ] Tests cover the changed behavior.
- [ ] Existing tests were reviewed for changed assumptions.
- [ ] Tests were not weakened merely to hide failures.
- [ ] Build passes.
- [ ] Typecheck passes.
- [ ] Lint passes where applicable.
- [ ] DB migrations are backward-compatible where required.
- [ ] API compatibility was checked.
- [ ] No unrelated files were modified.
- [ ] No unrelated refactoring was introduced.
- [ ] Final diff was reviewed.

## For HIGH-RISK tasks additionally:

- [ ] Fresh-session review completed.
- [ ] No business rule was changed without explicit approval.

### Domain Rules Verified

Which specific domain rules were relevant to this task and were checked?
List by ID from `.windsurf/rules/domain-rules.md`.

- [ ] DATA-001: Missing data is not zero
- [ ] DATA-002: Fallback values must be explicitly recorded
- [ ] DATA-003: Source provenance is preserved
- [ ] DATA-004: Statement type consistency
- [ ] FIN-001: Gross Margin (SK GAAP)
- [ ] FIN-002: DIO (Days Inventory Outstanding)
- [ ] FIN-003: Equity Fallback
- [ ] FIN-004: Cash Flow Sanitization
- [ ] FIN-005: Altman Z''-Score
- [ ] FIN-006: Piotroski F-Score
- [ ] FIN-007: Beneish M-Score
- [ ] FIN-008: EBIT and EBITDA
- [ ] FIN-009: Revenue annualization
- [ ] FIN-010: White Horse Indicator
- [ ] FIN-011: Financial institution detection
- [ ] FIN-012: Startup profile detection
- [ ] SCORE-001: Scoring version (V2 production, V3 prototype)
- [ ] SCORE-002: Scoring change control
- [ ] SCORE-003: LLM must not redefine scoring
- [ ] SCORE-004: NACE sector weights
- [ ] SCORE-005: Hard stop conditions
- [ ] SCORE-006: Vestník event degradation
- [ ] SCORE-007: Risk category thresholds
- [ ] SCORE-008: DQ multiplier (V2)
- [ ] SCORE-009: DQ score (V3)
- [ ] SCORE-010: Insolvency score model
- [ ] DQ-001: Balance sheet equality
- [ ] DQ-002: No NULL-to-zero for financial metrics
- [ ] DQ-003: Data void threshold
- [ ] ENT-001: ICO validation
- [ ] ENT-002: Template 699 guard
- [ ] ENT-003: Entity type classification
- [ ] SRC-001: Source priority order
- [ ] DB-001: Additive migrations by default
- [ ] DB-002: Migration impact check
- [ ] HIST-001: No deletion of historical data
- [ ] HIST-002: Checkpointing for bulk operations

Mark only the rules that were relevant. If a rule was not affected, leave unchecked.
If a rule was relevant but not verified, this is a **blocking issue**.
Domain rules must have been identified BEFORE implementation (in pre-task check).

## Test Modification Rule

Tests may be modified when the intended behavior has legitimately changed.
The implementation and test change must be consistent with the Task Contract.
**Never weaken, delete or alter an assertion solely to hide an implementation defect.**

## If any check fails

→ Do not mark as DONE. Fix the issue or escalate.

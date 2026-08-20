# TASK CONTRACT

## Goal
What exactly must change?

## Scope
What is included?

## Out of Scope
What must NOT change?

## Affected Components
Which files/modules/services are expected to change?

## Business Rules
What existing rules must remain true?

## Domain Rules Affected
List by ID from `.windsurf/rules/domain-rules.md`:
- FIN-001
- DATA-002

## Data/API Impact
Does this affect:
- DB schema?
- migrations?
- API contracts?
- external integrations?

## Risk Classification

LOW
- isolated implementation
- no business logic

MEDIUM
- multiple components
- API/DB interaction

HIGH
- financial calculations
- scoring
- risk
- billing
- authentication
- migrations
- business rules

## Acceptance Criteria
Explicit conditions that must be true when finished.

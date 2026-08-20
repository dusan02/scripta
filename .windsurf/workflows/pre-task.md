---
description: Pre-task decision gate — determine risk level and required path
---

# PRE-TASK CHECK

Before implementation determine:

- [ ] Is this LOW, MEDIUM or HIGH risk?
- [ ] Does it change financial calculations?
- [ ] Does it change scoring or risk logic?
- [ ] Does it change business rules?
- [ ] Does it change DB schema or migration?
- [ ] Does it change an API contract?
- [ ] Does it affect historical data?
- [ ] Does it affect authentication, authorization or billing?
- [ ] Does it affect more than 3 components?

## Decision

If ANY HIGH-RISK condition is true:
→ **Architect review required.** Create Task Contract, do not implement until reviewed.

If MEDIUM risk (> 3 components, API/DB interaction):
→ **Standard Path.** Create Task Contract, then implement.

If LOW risk (1-3 files, no business logic, no DB schema, no API contract):
→ **Fast Path is allowed.** Implement directly with self-review.

## Paths

### FAST PATH
```
TASK → EXECUTOR → SELF-REVIEW → TESTS → DONE
```

### STANDARD PATH
```
TASK CONTRACT → EXECUTOR → TESTS → FRESH REVIEW → DONE
```

### CRITICAL PATH (HIGH risk)
```
ARCHITECT → TASK CONTRACT → EXECUTOR → TESTS → FRESH REVIEW → DONE
```

## Rule

Do not expand the scope without updating the Task Contract.
If scope changes during implementation, stop and re-evaluate risk level.

## Domain Rules Identification

Before implementation, identify which domain rules are relevant to this task.
List them by ID from `.windsurf/rules/domain-rules.md`:

```
DOMAIN RULES AFFECTED:
- FIN-001
- DATA-002
```

If a domain rule is relevant but not listed, this is a **blocking issue**.
Domain rules must be identified BEFORE implementation, not after.

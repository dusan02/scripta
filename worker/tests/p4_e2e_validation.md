# P4.3 — Product E2E Validation

**Cieľ:** Overiť, že free stránka → payment → scrape → analýza → PDF → evidence binder tvorí **jeden konzistentný produkt** na 3-5 reálnych firmách.

**Pravidlá:**
- Stripe test mode (žiadna reálna platba)
- Reálne IČO (nie mock dáta)
- Overiť cross-consistency medzi free stránkou a paid PDF
- Overiť matematickú konzistenciu coverage
- Overiť, že nekontrolované zdroje nie sú prezentované ako skontrolované

---

## Test firmy

| # | Názov | IČO | Typ | Prečo |
|---|-------|-----|-----|-------|
| 1 | Slovenská sporiteľňa | 00152213 | Veľká banka | IFRS PDF, veľa dát |
| 2 | Zoznam | 35847520 | IT s.r.o. | Štandardná s.r.o. |
| 3 | Malá firma | TBD | Živnostník/s.r.o. | Minimálne dáta |

---

## Cross-consistency checklist

Pre každú firmu overiť:

### A. Identita

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| A1 | IČO rovnaké všade | free = report = PDF = DB |
| A2 | Názov firmy rovnaký | free = report = PDF |
| A3 | Sídlo rovnaké | free = PDF |

### B. Osoby

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| B1 | Konatelia na free stránke | Zobrazení z CompanyPerson |
| B2 | Konatelia v PDF | Zobrazení v _persons.html |
| B3 | Zoznam osôb rovnaký | free = PDF |

### C. Finančné údaje

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| C1 | RÚZ finančné výkazy na free | Zobrazené z DB |
| C2 | Finančné výkazy v PDF | 5-ročná tabuľka |
| C3 | Čísla sa zhodujú | free = PDF |
| C4 | Altman/Piotroski len v PDF | Nie na free |

### D. Vestník udalosti

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| D1 | Vestník na free (ak existujú v DB) | Zobrazené |
| D2 | Vestník v PDF | Timeline + detail |
| D3 | Počet udalostí rovnaký | free = PDF |

### E. Score & verdict

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| E1 | Verifa Score v PDF | Zobrazený na cover |
| E2 | Score na free | NIE zobrazený |
| E3 | Scorecard breakdown v PDF | 5 pilirov |
| E4 | Score matematicky sedí | sum(pillar scores) = algorithmic_total |

### F. Source status & coverage

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| F1 | Coverage matematika | successful + failed = total scraperov spustených |
| F2 | Coverage denominator | 26 (aktívne scrapery), nie 30 |
| F3 | Uncontrolled sources | 4 (CRE, CRRS, OCHRANNE_ZNAMKY, FS_DPH_BANKOVE_UCTY) |
| F4 | Uncontrolled nie v "skontrolované" | ⚪ marker, nie 🟢 |
| F5 | Per-source timestamp | Každý zdroj má "Kontrolované: YYYY-MM-DD HH:MM" |

### G. Evidence

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| G1 | Evidence table v PDF | Tvrdenie → Dôkaz → Zdroj |
| G2 | Evidence binder | Source PDFs prítomné |
| G3 | Page refs fungujú | Cover page linky → správne strany |

### H. PDF kvalita

| # | Kontrola | Očakávaný výsledok |
|---|----------|-------------------|
| H1 | PDF sa otvorí | Valid PDF |
| H2 | Cover page rendering | Logo, score, semafory |
| H3 | Text je čitateľný | Žiadne orezanie, overflow |
| H4 | Tabuľky sa nezlomili | page-break-inside: avoid |

---

## Spôsob testovania

```bash
# 1. Stripe test mode — pridať kredity test userovi
curl -X POST http://localhost:3000/api/billing/webhook \
  -H "stripe-signature: ..." \
  -d '{"type":"payment.succeeded","data":{"object":{"metadata":{"userId":"test-user-id","credits":"5"}}}}'

# 2. Zobraziť free stránku
open http://localhost:3000/firma/00152213

# 3. Vytvoriť report (s test kreditymi)
curl -X POST http://localhost:3000/api/reports \
  -H "cookie: next-auth.session-token=..." \
  -d '{"ico":"00152213","sources":["ORSR","ZRSR","RPO",...]}'

# 4. Čakať na dokončenie (status → COMPLETED/PARTIAL)

# 5. Stiahnuť PDF
curl http://localhost:3000/api/reports/{id}/download -o report.pdf

# 6. Overiť checklist
```

---

## Úspech = P4.3 DONE

Ak všetky kontroly prejdú na 3 firmách → **P4 = Paid product ready.**

Ak kontrola zlyhá → bug report + fix + re-test.

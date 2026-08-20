---
description: Debug balance sheet discrepancies (Sankey chart, aktíva vs pasíva)
---

## Debug Balance Sheet Discrepancy

1. Identify the company ICO and year with the issue

2. Query DB for current values:
   ```sql
   SELECT year, "totalAssets", "currentAssets", "nonCurrentAssets",
          equity, "shortTermLiabilities", "longTermLiabilities",
          "ruzZavierkaId", "ruzVykazId"
   FROM "FinancialStatement"
   WHERE "companyIco" = '{ico}'
   ORDER BY year DESC;
   ```

3. Check balance sheet equality:
   - LEFT: `nonCurrentAssets + currentAssets` vs `totalAssets` (diff < 5% OK)
   - RIGHT: `equity + shortTermLiabilities + longTermLiabilities` vs `totalAssets` (diff < 5% OK)
   - If RIGHT diff > 5%, missing liabilities may include: ltReserves, stReserves, stBankLoans

4. If `nonCurrentAssets` is NULL or `totalAssets` is wrong:
   - Data was seeded by old `seed_ruz_bulk.py` without NCA extraction
   - Re-seed using `/reseed` workflow

5. If data looks correct in DB but Sankey chart is wrong:
   - Check `frontend/src/components/company-charts.tsx` → `BalanceSankeyChart`
   - Verify API response: `curl https://verifa.sk/api/financials?ico={ico}`
   - If API returns HTML instead of JSON, check Next.js API route

6. Verify on frontend:
   - Open `https://verifa.sk/firma/{ico}`
   - Check Sankey chart left vs right side
   - Compare with DB values

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| NCA = NULL | Old seed_ruz_bulk.py | Re-seed company |
| totalAssets = 0 | RÚZ vykaz has no tables (PDF only) | Skip year or use different vykaz |
| RIGHT diff > 15% | Missing reserves/loans in pasív | Check if ltReserves, stReserves, stBankLoans are populated |
| API returns HTML | Next.js route not matching | Check API route handler |
| 403 from RÚZ API | Server IP blocked for search endpoints | Use detail endpoints with known entity_id |

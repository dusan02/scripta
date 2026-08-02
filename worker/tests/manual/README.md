# Manual Test Scripts

These scripts are NOT run by pytest or CI. They require a full environment
with Playwright browsers, database access, and live API endpoints.

## Usage

```bash
# From worker/ directory
python tests/manual/manual_full_flow.py
python tests/manual/manual_pdf_compile.py
```

## Files

- `manual_full_flow.py` — End-to-end pipeline test with real IČO
- `manual_pdf_compile.py` — PDF compilation smoke test
- `manual_pdf_compile2.py` — PDF compilation with charts
- `manual_pdf_compile3.py` — PDF compilation with infographics
- `manual_pdf_full.py` — Full PDF generation flow
- `manual_pdf_playwright.py` — PDF generation via Playwright

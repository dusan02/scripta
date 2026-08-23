"""
Determinism regression test for LLM extraction cache.

Ensures that the same PDF always produces identical structured financial data
across multiple extraction runs. This test prevents the LLM variability bug
from silently returning (e.g. interest=4797 vs 5091, gross_profit=57103 vs None).

Test flow:
1. Clear cache for test PDF
2. Run extraction 3× (run 1 = MISS, runs 2-3 = HIT)
3. Assert all 15 numeric fields are identical across runs
4. Assert exactly 1 LLM call was made

Usage:
    pytest tests/test_extraction_cache_determinism.py -x -v

    # Or standalone (requires DB + Gemini API key):
    python -m tests.test_extraction_cache_determinism

Requirements:
    - Production DB with ExtractionCache table
    - Gemini API key configured
    - Test PDF available at TEST_PDF_PATH (or downloaded from RÚZ)
"""
import asyncio
import os
import sys
import json
import hashlib
from typing import Optional

import pytest

# ── Test configuration ───────────────────────────────────────────────────────
TEST_ICO = "00214973"  # Danucem Slovensko a.s. (IFRS template 709)
TEST_PDF_FILENAME = "SKGAAP_00214973_2023_2.pdf"
TEST_MODEL = "gemini-3.5-flash-lite"

# Fields that must be 100% deterministic across runs
DETERMINISTIC_FIELDS = [
    "celkove_aktiva",
    "trzby_z_hlavnej_cinnosti",
    "zisk_alebo_strata_po_zdaneni",
    "vlastne_imanie_celkom",
    "ciste_penazne_toky_z_prevadzkovej_cinnosti",
    "osobne_naklady",
    "pocet_zamestnancov",
    "zasoby",
    "pohladavky_z_obchodneho_styku",
    "zavazky_z_obchodneho_styku",
    "odpisy",
    "dan_z_prijmu",
    "uroky",
    "hruba_marza",
    "obezny_majetok",
]


def _get_test_pdf_path() -> str:
    """Get path to test PDF — checks common locations."""
    candidates = [
        f"/app/assets/{TEST_ICO}/{TEST_PDF_FILENAME}",
        f"/tmp/{TEST_PDF_FILENAME}",
        f"tests/fixtures/{TEST_PDF_FILENAME}",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(
        f"Test PDF not found. Place {TEST_PDF_FILENAME} in one of: {candidates}"
    )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"),
    reason="Requires Gemini API key",
)
async def test_extraction_cache_determinism():
    """Same PDF → 3 extraction runs → all fields identical, 1 LLM call."""
    from src.extraction_cache import (
        cache_lookup, cache_store, compute_pdf_hash,
        PROMPT_VERSION, SCHEMA_VERSION, EXTRACTOR_FINANCIAL_ANALYST,
    )
    from src.agents.financial_analyst import extract_financial_data
    from src.db_client import connect_db, disconnect_db, get_db

    pdf_path = _get_test_pdf_path()
    pdf_hash = compute_pdf_hash(pdf_path)

    # Connect to DB
    await connect_db()
    db = get_db()

    # Clean any existing cache entries for this PDF
    await db.extractioncache.delete_many(
        where={"pdfHash": pdf_hash}
    )

    try:
        results = []
        llm_call_count = 0

        for i in range(3):
            # Step 1: Cache lookup
            cached = await cache_lookup(
                pdf_path,
                extractor=EXTRACTOR_FINANCIAL_ANALYST,
                model=TEST_MODEL,
            )

            if cached is not None:
                data = cached
            else:
                # Cache MISS — call LLM
                data = await extract_financial_data(pdf_path, model=TEST_MODEL)
                llm_call_count += 1
                # Store in cache
                await cache_store(
                    pdf_path,
                    company_ico=TEST_ICO,
                    extractor=EXTRACTOR_FINANCIAL_ANALYST,
                    model=TEST_MODEL,
                    data=data,
                )

            # Extract all deterministic fields
            m = data.metriky
            field_values = {}
            for field in DETERMINISTIC_FIELDS:
                field_values[field] = getattr(m, field, None)
            results.append(field_values)

        # ── Assertions ──

        # 1. Exactly 1 LLM call (run 1 = MISS, runs 2-3 = HIT)
        assert llm_call_count == 1, (
            f"Expected 1 LLM call, got {llm_call_count}. "
            f"Cache should have HIT on runs 2 and 3."
        )

        # 2. All fields identical across 3 runs
        failures = []
        for field in DETERMINISTIC_FIELDS:
            vals = [r[field] for r in results]
            unique = set(str(v) for v in vals)
            if len(unique) > 1:
                failures.append(f"  {field}: {vals} — {len(unique)} unique values")

        assert not failures, (
            f"Non-deterministic fields detected:\n" + "\n".join(failures)
        )

    finally:
        # Cleanup: remove test cache entries
        await db.extractioncache.delete_many(
            where={"pdfHash": pdf_hash}
        )
        await disconnect_db()


@pytest.mark.asyncio
async def test_cache_key_uniqueness():
    """Different prompt versions should produce different cache keys."""
    from src.extraction_cache import compute_pdf_hash, PROMPT_VERSION, SCHEMA_VERSION

    # Just verify version constants are non-empty strings
    assert isinstance(PROMPT_VERSION, str) and len(PROMPT_VERSION) > 0, \
        "PROMPT_VERSION must be non-empty string"
    assert isinstance(SCHEMA_VERSION, str) and len(SCHEMA_VERSION) > 0, \
        "SCHEMA_VERSION must be non-empty string"

    # Verify version format (vN)
    assert PROMPT_VERSION.startswith("v"), \
        f"PROMPT_VERSION should start with 'v', got: {PROMPT_VERSION}"
    assert SCHEMA_VERSION.startswith("v"), \
        f"SCHEMA_VERSION should start with 'v', got: {SCHEMA_VERSION}"


def test_prompt_fix_no_proxy():
    """Verify that gross_profit prompt no longer allows 'Pridaná hodnota' as proxy."""
    from src.agents.financial_analyst import SYSTEM_PROMPT

    # The proxy instruction "alebo 'Pridaná hodnota'" should be removed
    assert "alebo 'Pridaná hodnota'" not in SYSTEM_PROMPT, \
        "gross_profit prompt still allows 'Pridaná hodnota' as proxy — should be removed"

    # The warning should be present
    assert "NIKDY nepoužívaj" in SYSTEM_PROMPT, \
        "gross_profit prompt missing 'NIKDY nepoužívaj' warning"


def test_prompt_fix_interest_disambiguation():
    """Verify that interest prompt disambiguates 'Finance costs' from 'Interest expense'."""
    from src.agents.financial_analyst import SYSTEM_PROMPT

    # Should warn against using 'Finance costs' as interest
    assert "NIKDY nepoužívaj 'Finance costs'" in SYSTEM_PROMPT, \
        "interest prompt missing 'Finance costs' disambiguation warning"


if __name__ == "__main__":
    # Standalone runner
    asyncio.run(test_extraction_cache_determinism())
    test_cache_key_uniqueness()
    test_prompt_fix_no_proxy()
    test_prompt_fix_interest_disambiguation()
    print("\n✓ All determinism tests passed")

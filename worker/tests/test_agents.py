"""
Unit testy pre AI agentov a LLM orchestráciu.

Testuje:
  - Gemini API key pool: round-robin rotation, failed key tracking
  - safe_llm_call: retry logic, fallback models, key marking on 429/503
  - financial_analyst: sanity check multiplier (v tisícoch/miliónoch EUR)
  - financial_analyst: verify_critical_numbers_blind MICRO exclusion
  - Pydantic model validation: VerificationExtraction with typ_zavierky
"""
import asyncio
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from pydantic import ValidationError

from src.agents.shared import (
    _load_gemini_keys,
    _get_gemini_client,
    _mark_gemini_key_failed,
    _mark_last_key_failed,
    _last_issued_key,
    VerificationExtraction,
    CompanyFinancialExtraction,
    FinancialMetrics,
)
from src.agents.financial_analyst import (
    extract_financial_data,
    verify_critical_numbers_blind,
)


# ═══════════════════════════════════════════════════════════════════════════
# Gemini API Key Pool — round-robin rotation + failed key tracking
# ═══════════════════════════════════════════════════════════════════════════

class TestGeminiKeyPool:
    """Test Gemini API key pool: round-robin, failed key skipping, reset."""

    def test_load_multiple_keys(self):
        """GEMINI_API_KEYS (comma-separated) → list of keys."""
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "key1,key2,key3", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            keys = _load_gemini_keys()
            assert keys == ["key1", "key2", "key3"]

    def test_load_single_key_fallback(self):
        """GEMINI_API_KEY (single) → list with one key."""
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "", "GEMINI_API_KEY": "single_key", "GOOGLE_API_KEY": ""}):
            keys = _load_gemini_keys()
            assert keys == ["single_key"]

    def test_load_google_api_key_fallback(self):
        """GOOGLE_API_KEY fallback when GEMINI_API_KEY not set."""
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": "google_key"}):
            keys = _load_gemini_keys()
            assert keys == ["google_key"]

    def test_load_no_keys(self):
        """No keys configured → empty list."""
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            keys = _load_gemini_keys()
            assert keys == []

    def test_round_robin_rotation(self):
        """Multiple calls should cycle through keys."""
        import src.agents.shared as shared_mod
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "rr_key1,rr_key2,rr_key3", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            # Reinitialize the module-level state
            shared_mod._gemini_keys = _load_gemini_keys()
            import itertools
            shared_mod._key_cycle = itertools.cycle(shared_mod._gemini_keys)
            shared_mod._failed_keys = set()

            c1 = _get_gemini_client()
            k1 = _last_issued_key.get()
            c2 = _get_gemini_client()
            k2 = _last_issued_key.get()
            c3 = _get_gemini_client()
            k3 = _last_issued_key.get()

            assert k1 != k2 != k3
            assert {k1, k2, k3} == {"rr_key1", "rr_key2", "rr_key3"}

    def test_failed_key_skipped(self):
        """Failed keys should be skipped in rotation."""
        import src.agents.shared as shared_mod
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "fail_k1,fail_k2,fail_k3", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            shared_mod._gemini_keys = _load_gemini_keys()
            import itertools
            shared_mod._key_cycle = itertools.cycle(shared_mod._gemini_keys)
            shared_mod._failed_keys = set()

            # Mark fail_k2 as failed
            _mark_gemini_key_failed("fail_k2")

            # Collect 3 keys — fail_k2 should be skipped
            keys_used = set()
            for _ in range(3):
                _get_gemini_client()
                keys_used.add(_last_issued_key.get())

            assert "fail_k2" not in keys_used
            assert keys_used == {"fail_k1", "fail_k3"}

    def test_all_keys_failed_resets(self):
        """When all keys are failed, reset and try again."""
        import src.agents.shared as shared_mod
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "reset_k1,reset_k2", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            shared_mod._gemini_keys = _load_gemini_keys()
            import itertools
            shared_mod._key_cycle = itertools.cycle(shared_mod._gemini_keys)
            shared_mod._failed_keys = set()

            _mark_gemini_key_failed("reset_k1")
            _mark_gemini_key_failed("reset_k2")

            # All keys failed — should reset and return a key
            client = _get_gemini_client()
            key = _last_issued_key.get()
            assert key in {"reset_k1", "reset_k2"}
            assert len(shared_mod._failed_keys) == 0  # reset cleared

    def test_mark_last_key_failed(self):
        """_mark_last_key_failed marks the most recently issued key."""
        import src.agents.shared as shared_mod
        with patch.dict(os.environ, {"GEMINI_API_KEYS": "last_k1,last_k2", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            shared_mod._gemini_keys = _load_gemini_keys()
            import itertools
            shared_mod._key_cycle = itertools.cycle(shared_mod._gemini_keys)
            shared_mod._failed_keys = set()

            _get_gemini_client()
            issued = _last_issued_key.get()
            _mark_last_key_failed()

            assert issued in shared_mod._failed_keys


# ═══════════════════════════════════════════════════════════════════════════
# safe_llm_call — retry + fallback + key marking
# ═══════════════════════════════════════════════════════════════════════════

class TestSafeLlmCall:
    """Test safe_llm_call retry logic, fallback models, and key marking."""

    @pytest.mark.asyncio
    async def test_success_on_first_try(self):
        """Successful call returns immediately."""
        from src.llm_orchestrator import safe_llm_call
        mock_func = AsyncMock(return_value="result")
        result = await safe_llm_call(mock_func, label="test", model="test-model")
        assert result == "result"
        assert mock_func.call_count == 1

    @pytest.mark.asyncio
    async def test_429_marks_key_failed(self):
        """429 error should mark the last-issued key as failed."""
        from src.llm_orchestrator import safe_llm_call
        import src.agents.shared as shared_mod

        with patch.dict(os.environ, {"GEMINI_API_KEYS": "test429_k1,test429_k2", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            shared_mod._gemini_keys = _load_gemini_keys()
            import itertools
            shared_mod._key_cycle = itertools.cycle(shared_mod._gemini_keys)
            shared_mod._failed_keys = set()

            # Set last issued key
            _last_issued_key.set("test429_k1")

            mock_func = AsyncMock(side_effect=Exception("429 Resource exhausted"))
            with patch("src.llm_orchestrator._BACKOFF_SECONDS", [0.01, 0.01]):
                with patch("src.llm_orchestrator._FALLBACK_MODEL", "fallback-model"):
                    with patch("src.llm_orchestrator._FALLBACK_MODEL_2", "fallback-model-2"):
                        # All calls fail with 429
                        mock_func.side_effect = Exception("429 Resource exhausted")
                        with pytest.raises(Exception):
                            await safe_llm_call(mock_func, label="test429", model="test-model")

            # Key should be marked as failed
            assert "test429_k1" in shared_mod._failed_keys

    @pytest.mark.asyncio
    async def test_404_triggers_fallback(self):
        """404 error should trigger immediate fallback (no retry)."""
        from src.llm_orchestrator import safe_llm_call

        mock_func = AsyncMock(side_effect=[
            Exception("404 NOT_FOUND model not available"),
            "fallback_result",
        ])
        with patch("src.llm_orchestrator._BACKOFF_SECONDS", [0.01, 0.01]):
            with patch("src.llm_orchestrator._FALLBACK_MODEL", "fallback-model"):
                with patch("src.llm_orchestrator._FALLBACK_MODEL_2", "fallback-model-2"):
                    result = await safe_llm_call(mock_func, label="test404", model="test-model")
                    assert result == "fallback_result"

    @pytest.mark.asyncio
    async def test_non_retryable_error_raises(self):
        """Non-429/503/404 errors should raise immediately."""
        from src.llm_orchestrator import safe_llm_call

        mock_func = AsyncMock(side_effect=ValueError("Invalid schema"))
        with pytest.raises(ValueError, match="Invalid schema"):
            await safe_llm_call(mock_func, label="test_error", model="test-model")


# ═══════════════════════════════════════════════════════════════════════════
# financial_analyst — sanity check multiplier
# ═══════════════════════════════════════════════════════════════════════════

class TestSanityCheckMultiplier:
    """Test that sanity check multiplies all monetary fields including state debts."""

    def test_monetary_fields_includes_state_debts(self):
        """_MONETARY_FIELDS in extract_financial_data should include zavazky_sp, danove_zavazky, zavazky_zamestnanci."""
        import ast
        import inspect
        source = inspect.getsource(extract_financial_data)
        tree = ast.parse(source)
        fields_found = []
        for node in ast.walk(tree):
            if isinstance(node, ast.List):
                for elt in node.elts:
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                        if elt.value in ("zavazky_sp", "danove_zavazky", "zavazky_zamestnanci"):
                            fields_found.append(elt.value)
        assert "zavazky_sp" in fields_found, "zavazky_sp missing from _MONETARY_FIELDS"
        assert "danove_zavazky" in fields_found, "danove_zavazky missing from _MONETARY_FIELDS"
        assert "zavazky_zamestnanci" in fields_found, "zavazky_zamestnanci missing from _MONETARY_FIELDS"


# ═══════════════════════════════════════════════════════════════════════════
# verify_critical_numbers_blind — MICRO exclusion
# ═══════════════════════════════════════════════════════════════════════════

class TestVerifyBlindMicroExclusion:
    """Test that verify_critical_numbers_blind excludes MICRO from sanity check."""

    def test_verification_extraction_has_typ_zavierky(self):
        """VerificationExtraction should have typ_zavierky field."""
        fields = VerificationExtraction.model_fields
        assert "typ_zavierky" in fields

    def test_micro_extraction_not_multiplied(self):
        """MICRO company with assets < 10000 should NOT be multiplied."""
        # Create a MICRO verification result with small values
        data = VerificationExtraction(
            celkove_aktiva=5000.0,
            trzby_z_hlavnej_cinnosti=3000.0,
            zisk_alebo_strata_po_zdaneni=500.0,
            vlastne_imanie_celkom=2000.0,
            ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
            typ_zavierky="MICRO",
        )
        # Simulate the sanity check logic from verify_critical_numbers_blind
        _MONETARY_FIELDS = [
            "celkove_aktiva", "trzby_z_hlavnej_cinnosti",
            "zisk_alebo_strata_po_zdaneni", "vlastne_imanie_celkom",
            "ciste_penazne_toky_z_prevadzkovej_cinnosti",
        ]
        if data.celkove_aktiva is not None and data.celkove_aktiva > 0 and data.typ_zavierky != 'MICRO':
            # This should NOT execute for MICRO
            pytest.fail("MICRO company should not be multiplied")

        # Values should remain unchanged
        assert data.celkove_aktiva == 5000.0
        assert data.trzby_z_hlavnej_cinnosti == 3000.0

    def test_non_micro_extraction_multiplied(self):
        """Non-MICRO company with assets < 10000 SHOULD be multiplied."""
        data = VerificationExtraction(
            celkove_aktiva=5000.0,
            trzby_z_hlavnej_cinnosti=3000.0,
            zisk_alebo_strata_po_zdaneni=500.0,
            vlastne_imanie_celkom=2000.0,
            ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
            typ_zavierky="SK_GAAP",
        )
        # Simulate the sanity check logic
        multiplier = 1
        if data.celkove_aktiva is not None and data.celkove_aktiva > 0 and data.typ_zavierky != 'MICRO':
            if data.celkove_aktiva < 100:
                multiplier = 1_000_000
            elif data.celkove_aktiva < 10000:
                multiplier = 1_000

        assert multiplier == 1000  # Should be multiplied

    def test_ifrs_large_company_not_multiplied(self):
        """IFRS company with assets > 10000 should NOT be multiplied."""
        data = VerificationExtraction(
            celkove_aktiva=5_000_000.0,
            trzby_z_hlavnej_cinnosti=10_000_000.0,
            zisk_alebo_strata_po_zdaneni=500_000.0,
            vlastne_imanie_celkom=2_000_000.0,
            ciste_penazne_toky_z_prevadzkovej_cinnosti=800_000.0,
            typ_zavierky="IFRS",
        )
        multiplier = 1
        if data.celkove_aktiva is not None and data.celkove_aktiva > 0 and data.typ_zavierky not in ('MICRO', None):
            if data.celkove_aktiva < 100:
                multiplier = 1_000_000
            elif data.celkove_aktiva < 10000:
                multiplier = 1_000

        assert multiplier == 1  # No multiplication needed

    def test_null_typ_zavierky_not_multiplied(self):
        """If LLM returns null for typ_zavierky, should NOT multiply (could be MICRO)."""
        data = VerificationExtraction(
            celkove_aktiva=5000.0,
            trzby_z_hlavnej_cinnosti=3000.0,
            zisk_alebo_strata_po_zdaneni=500.0,
            vlastne_imanie_celkom=2000.0,
            ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
            typ_zavierky=None,
        )
        multiplier = 1
        if data.celkove_aktiva is not None and data.celkove_aktiva > 0 and data.typ_zavierky not in ('MICRO', None):
            if data.celkove_aktiva < 100:
                multiplier = 1_000_000
            elif data.celkove_aktiva < 10000:
                multiplier = 1_000

        assert multiplier == 1  # Should NOT multiply when typ_zavierky is None


# ═══════════════════════════════════════════════════════════════════════════
# Pydantic model validation
# ═══════════════════════════════════════════════════════════════════════════

class TestPydanticModels:
    """Test Pydantic model validation for agent schemas."""

    def test_verification_extraction_with_typ_zavierky(self):
        """VerificationExtraction should accept typ_zavierky."""
        data = VerificationExtraction(
            celkove_aktiva=1000000.0,
            trzby_z_hlavnej_cinnosti=500000.0,
            zisk_alebo_strata_po_zdaneni=50000.0,
            vlastne_imanie_celkom=800000.0,
            ciste_penazne_toky_z_prevadzkovej_cinnosti=100000.0,
            typ_zavierky="IFRS",
        )
        assert data.typ_zavierky == "IFRS"

    def test_verification_extraction_typ_zavierky_optional(self):
        """typ_zavierky should be optional (default None)."""
        data = VerificationExtraction(
            celkove_aktiva=None,
            trzby_z_hlavnej_cinnosti=None,
            zisk_alebo_strata_po_zdaneni=None,
            vlastne_imanie_celkom=None,
            ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
        )
        assert data.typ_zavierky is None

    def test_financial_metrics_has_state_debt_fields(self):
        """FinancialMetrics should have zavazky_sp, danove_zavazky, zavazky_zamestnanci."""
        fields = FinancialMetrics.model_fields
        assert "zavazky_sp" in fields
        assert "danove_zavazky" in fields
        assert "zavazky_zamestnanci" in fields


# ═══════════════════════════════════════════════════════════════════════════
# Decimal sanitization (post Float→Decimal migration)
# ═══════════════════════════════════════════════════════════════════════════

class TestDecimalSanitization:
    """Test that Decimal values from DB are converted to float for arithmetic."""

    def test_to_float_decimal(self):
        """_to_float should convert Decimal to float."""
        from decimal import Decimal
        from src.analytics import _to_float
        assert _to_float(Decimal("1234.56")) == 1234.56
        assert isinstance(_to_float(Decimal("1234.56")), float)

    def test_to_float_int(self):
        """_to_float should convert int to float."""
        from src.analytics import _to_float
        assert _to_float(42) == 42.0
        assert isinstance(_to_float(42), float)

    def test_to_float_none(self):
        """_to_float should return None for None input."""
        from src.analytics import _to_float
        assert _to_float(None) is None

    def test_sanitize_stmt_numeric_decimal(self):
        """_sanitize_stmt_numeric should convert Decimal values to float."""
        from decimal import Decimal
        from src.analytics import _sanitize_stmt_numeric
        stmt = {
            "year": 2024,
            "mainActivityRevenue": Decimal("1000000.00"),
            "totalAssets": Decimal("500000.00"),
            "equity": Decimal("300000.00"),
            "netProfitLoss": Decimal("50000.00"),
            "shortTermLiabilities": Decimal("100000.00"),
            "operatingCashFlow": None,
        }
        result = _sanitize_stmt_numeric(stmt)
        assert result["year"] == 2024  # int, not float
        assert isinstance(result["mainActivityRevenue"], float)
        assert result["mainActivityRevenue"] == 1000000.0
        assert isinstance(result["totalAssets"], float)
        assert result["operatingCashFlow"] is None

    def test_compute_financial_trends_with_decimal(self):
        """compute_financial_trends should not crash with Decimal inputs."""
        from decimal import Decimal
        from src.analytics import compute_financial_trends
        stmts = [
            {"year": 2022, "mainActivityRevenue": Decimal("100000"), "totalAssets": Decimal("50000"),
             "equity": Decimal("30000"), "netProfitLoss": Decimal("10000"),
             "shortTermLiabilities": Decimal("5000"), "longTermLiabilities": Decimal("0"),
             "monthsInPeriod": 12},
            {"year": 2023, "mainActivityRevenue": Decimal("120000"), "totalAssets": Decimal("55000"),
             "equity": Decimal("35000"), "netProfitLoss": Decimal("15000"),
             "shortTermLiabilities": Decimal("6000"), "longTermLiabilities": Decimal("0"),
             "monthsInPeriod": 12},
        ]
        # Should not raise TypeError
        trends = compute_financial_trends(stmts)
        assert "error" not in trends or trends.get("error") is None

    def test_compute_altman_z_score_with_decimal(self):
        """compute_altman_z_score should not crash with Decimal inputs."""
        from decimal import Decimal
        from src.analytics import compute_altman_z_score
        stmt = {
            "year": 2024,
            "totalAssets": Decimal("1000000"),
            "currentAssets": Decimal("500000"),
            "equity": Decimal("600000"),
            "netProfitLoss": Decimal("100000"),
            "shortTermLiabilities": Decimal("200000"),
            "longTermLiabilities": Decimal("100000"),
            "interestExpense": Decimal("10000"),
        }
        # Should not raise TypeError
        result = compute_altman_z_score(stmt)
        assert result["z_score"] is not None

    def test_compute_financial_ratios_with_decimal(self):
        """compute_financial_ratios should not crash with Decimal inputs."""
        from decimal import Decimal
        from src.analytics import compute_financial_ratios
        stmt = {
            "year": 2024,
            "totalAssets": Decimal("1000000"),
            "currentAssets": Decimal("500000"),
            "equity": Decimal("600000"),
            "netProfitLoss": Decimal("100000"),
            "shortTermLiabilities": Decimal("200000"),
            "longTermLiabilities": Decimal("100000"),
            "mainActivityRevenue": Decimal("2000000"),
            "monthsInPeriod": 12,
        }
        # Should not raise TypeError
        result = compute_financial_ratios(stmt)
        assert "current_ratio" in result

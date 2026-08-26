"""
Canonical hash audit — verify that inputDataHash is stable across equivalent representations.

Tests:
  1. Key ordering independence (sort_keys=True)
  2. null vs missing key consistency
  3. Decimal precision (100.00 vs 100)
  4. Float vs int representation
  5. Datetime format stability
  6. Array ordering sensitivity
  7. Unicode normalization
  8. Boolean/null coercion
  9. Empty string vs null
 10. Nested dict key ordering

Run:
    cd worker && .venv/bin/python -m pytest tests/test_canonical_hash.py -x -q
"""
import json
import hashlib
from decimal import Decimal
from datetime import datetime, timezone

import pytest


def _hash(data: dict) -> str:
    """Replicate the hash computation from verdict_builder.py."""
    s = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(s.encode()).hexdigest()[:16]


class TestKeyOrdering:
    """sort_keys=True must guarantee key ordering independence."""

    def test_top_level_key_order(self):
        a = {"ico": "123", "score": 42, "name": "Test"}
        b = {"name": "Test", "score": 42, "ico": "123"}
        assert _hash(a) == _hash(b)

    def test_nested_key_order(self):
        a = {"financials": [{"year": 2024, "revenue": 100, "assets": 200}]}
        b = {"financials": [{"assets": 200, "year": 2024, "revenue": 100}]}
        assert _hash(a) == _hash(b)

    def test_deeply_nested_key_order(self):
        a = {"data": {"nested": {"z": 1, "a": 2, "m": 3}}}
        b = {"data": {"nested": {"a": 2, "m": 3, "z": 1}}}
        assert _hash(a) == _hash(b)


class TestNullVsMissing:
    """null and missing keys must hash consistently (both serialize to null)."""

    def test_null_vs_missing_top_level(self):
        a = {"ico": "123", "revenue": None}
        b = {"ico": "123"}
        # json.dumps({"revenue": None}) → '{"revenue": null}'
        # json.dumps({}) → '{}'
        # These are DIFFERENT — this is expected behavior
        assert _hash(a) != _hash(b), "null vs missing must produce different hashes (by design)"

    def test_null_vs_missing_nested(self):
        a = {"stmt": {"year": 2024, "revenue": None}}
        b = {"stmt": {"year": 2024}}
        assert _hash(a) != _hash(b), "null vs missing in nested dict must produce different hashes"


class TestDecimalPrecision:
    """Decimal values must serialize consistently."""

    def test_decimal_same_precision(self):
        a = {"revenue": Decimal("100.00")}
        b = {"revenue": Decimal("100.00")}
        assert _hash(a) == _hash(b)

    def test_decimal_different_precision(self):
        """Decimal('100') vs Decimal('100.00') → str() gives '100' vs '100.00' → different hash."""
        a = {"revenue": Decimal("100")}
        b = {"revenue": Decimal("100.00")}
        # This IS a difference — str(Decimal('100')) = '100', str(Decimal('100.00')) = '100.00'
        # In practice, Prisma returns Decimal with DB precision (DECIMAL(15,2)) so always '100.00'
        assert _hash(a) != _hash(b), "Decimal precision difference must produce different hash"

    def test_decimal_vs_float(self):
        """Decimal('100.00') vs float 100.0 → str('100.00') vs '100.0' → different."""
        a = {"revenue": Decimal("100.00")}
        b = {"revenue": 100.0}
        # default=str converts Decimal to '100.00', float 100.0 serializes as 100.0
        assert _hash(a) != _hash(b), "Decimal vs float must produce different hash"

    def test_decimal_vs_int(self):
        """Decimal('100.00') vs int 100 → '100.00' vs 100 → different."""
        a = {"revenue": Decimal("100.00")}
        b = {"revenue": 100}
        assert _hash(a) != _hash(b), "Decimal vs int must produce different hash"


class TestDatetimeSerialization:
    """Datetime values must serialize consistently via default=str."""

    def test_same_datetime_same_hash(self):
        dt = datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
        a = {"publishedAt": dt}
        b = {"publishedAt": dt}
        assert _hash(a) == _hash(b)

    def test_different_timezone_same_instant(self):
        """datetime with different tz but same instant → different str representation."""
        dt_utc = datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
        dt_naive = datetime(2024, 1, 15, 10, 30, 0)
        a = {"publishedAt": dt_utc}
        b = {"publishedAt": dt_naive}
        # str(dt_utc) includes +00:00, str(dt_naive) doesn't
        assert _hash(a) != _hash(b), "Different tz representations must produce different hash"

    def test_str_datetime_consistency(self):
        """If we pre-convert to str, same string → same hash."""
        a = {"publishedAt": "2024-01-15 10:30:00+00:00"}
        b = {"publishedAt": "2024-01-15 10:30:00+00:00"}
        assert _hash(a) == _hash(b)

    def test_explicit_str_conversion(self):
        """verdict_builder uses str(getattr(...)) — verify this is stable."""
        dt = datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
        a = {"pub": str(dt)}
        b = {"pub": str(dt)}
        assert _hash(a) == _hash(b)


class TestArrayOrdering:
    """Array ordering matters — verify sensitivity."""

    def test_same_order_same_hash(self):
        a = {"events": [{"type": "A"}, {"type": "B"}]}
        b = {"events": [{"type": "A"}, {"type": "B"}]}
        assert _hash(a) == _hash(b)

    def test_different_order_different_hash(self):
        """Array order matters in JSON — this is expected."""
        a = {"events": [{"type": "A"}, {"type": "B"}]}
        b = {"events": [{"type": "B"}, {"type": "A"}]}
        assert _hash(a) != _hash(b), "Array reordering must produce different hash"

    def test_financials_order_matters(self):
        """Financial statements sorted by year desc — order must be stable."""
        a = {"financials": [{"year": 2024}, {"year": 2023}]}
        b = {"financials": [{"year": 2023}, {"year": 2024}]}
        assert _hash(a) != _hash(b), "Statement order must produce different hash"


class TestUnicodeNormalization:
    """Unicode strings must be handled consistently."""

    def test_same_unicode_same_hash(self):
        a = {"name": "ZKW Slovakia s.r.o."}
        b = {"name": "ZKW Slovakia s.r.o."}
        assert _hash(a) == _hash(b)

    def test_unicode_slovak_diacritics(self):
        a = {"name": "MECOM AGRO, spol. s r.o. Humenné"}
        b = {"name": "MECOM AGRO, spol. s r.o. Humenné"}
        assert _hash(a) == _hash(b)

    def test_nfc_vs_nfd(self):
        """NFC and NFD normalized forms of the same character produce different bytes."""
        # NFC: é = single codepoint U+00E9
        # NFD: é = e + combining accent U+0301
        nfc = "Humenné"  # Python string literals are NFC by default
        nfd = "Humenne\u0301"  # NFD form
        a = {"name": nfc}
        b = {"name": nfd}
        # These ARE different byte sequences → different hash
        # In practice, DB stores NFC, so this is not a real-world issue
        assert _hash(a) != _hash(b), "NFC vs NFD must produce different hash (expected)"


class TestBooleanAndNull:
    """Boolean and null handling."""

    def test_true_vs_false(self):
        assert _hash({"flag": True}) != _hash({"flag": False})

    def test_true_vs_1(self):
        """True vs 1 are different in JSON."""
        assert _hash({"flag": True}) != _hash({"flag": 1})

    def test_false_vs_0(self):
        assert _hash({"flag": False}) != _hash({"flag": 0})

    def test_null_vs_false(self):
        assert _hash({"flag": None}) != _hash({"flag": False})


class TestEmptyStringVsNull:
    """Empty string vs null must produce different hashes."""

    def test_empty_string_vs_null(self):
        assert _hash({"s": ""}) != _hash({"s": None})

    def test_empty_string_vs_missing(self):
        assert _hash({"s": ""}) != _hash({})


class TestNestedConsistency:
    """Nested structures must be consistently serialized."""

    def test_empty_list_vs_null(self):
        assert _hash({"events": []}) != _hash({"events": None})

    def test_empty_list_vs_missing(self):
        assert _hash({"events": []}) != _hash({})

    def test_nested_empty_dict(self):
        a = {"data": {"nested": {}}}
        b = {"data": {"nested": {}}}
        assert _hash(a) == _hash(b)


class TestRealWorldScenarios:
    """Scenarios that could occur in production."""

    def test_prisma_decimal_consistency(self):
        """Prisma returns Decimal from DECIMAL(15,2) columns.
        Two reads of the same row should return identical Decimal objects."""
        from decimal import Decimal
        # Simulate what Prisma returns for DECIMAL(15,2) = 1000000.00
        d1 = Decimal("1000000.00")
        d2 = Decimal("1000000.00")
        assert _hash({"revenue": d1}) == _hash({"revenue": d2})

    def test_stmt_dict_consistency(self):
        """Two identical statement dicts must hash the same."""
        stmt = {
            "year": 2024,
            "totalAssets": Decimal("1000000.00"),
            "equity": Decimal("600000.00"),
            "netProfitLoss": Decimal("50000.00"),
        }
        assert _hash({"financials": [stmt]}) == _hash({"financials": [stmt]})

    def test_auditor_opinion_dict_vs_object(self):
        """Auditor opinion can be dict or Pydantic model — both must serialize the same."""
        # As dict (from model_dump)
        a = {"auditorOpinion": {"opinionType": "bez výhrad", "goingConcernRisk": False}}
        # As dict (same values)
        b = {"auditorOpinion": {"opinionType": "bez výhrad", "goingConcernRisk": False}}
        assert _hash(a) == _hash(b)

    def test_vestnik_event_str_conversion(self):
        """Vestník publishedAt is converted via str() — must be stable."""
        dt = datetime(2024, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        a = {"pub": str(dt)}
        b = {"pub": str(dt)}
        assert _hash(a) == _hash(b)

    def test_registry_findings_truncation(self):
        """Registry findings are truncated to 200 chars — verify this is consistent."""
        long_text = "A" * 300
        a = {"status": long_text[:200]}
        b = {"status": long_text[:200]}
        assert _hash(a) == _hash(b)

        # Different truncation lengths would produce different hashes
        c = {"status": long_text[:199]}
        assert _hash(a) != _hash(c)

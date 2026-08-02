"""Tests for IČO validation in worker scrapers."""
import re
import pytest

_ICO_PATTERN = re.compile(r"^\d{8}$")


def _validate_ico(ico: str) -> bool:
    """Validate IČO format — must be exactly 8 digits."""
    return bool(ico and _ICO_PATTERN.match(ico))


class TestIcoValidation:
    def test_valid_8_digit_ico(self):
        assert _validate_ico("12345678")
        assert _validate_ico("00000000")
        assert _validate_ico("99999999")
        assert _validate_ico("36064820")

    def test_rejects_non_numeric(self):
        assert not _validate_ico("abcdefgh")
        assert not _validate_ico("1234567a")
        assert not _validate_ico("1234-678")

    def test_rejects_wrong_length(self):
        assert not _validate_ico("1234567")
        assert not _validate_ico("123456789")
        assert not _validate_ico("")

    def test_rejects_none_or_empty(self):
        assert not _validate_ico(None)  # type: ignore
        assert not _validate_ico("")
        assert not _validate_ico("   ")

    def test_rejects_special_characters(self):
        assert not _validate_ico("1234567\n8")
        assert not _validate_ico("1234567\t8")
        assert not _validate_ico("12345678 ")
        assert not _validate_ico(" 12345678")
        assert not _validate_ico("+1234567")

    def test_rejects_decimal_or_negative(self):
        assert not _validate_ico("1234567.8")
        assert not _validate_ico("-1234567")
        assert not _validate_ico("12345678.0")

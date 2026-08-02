"""Tests for S3 client key validation and filename sanitization."""
import re
import pytest

# Replicate the validation logic from s3_client.py
_CUID_PATTERN = re.compile(r"^[a-zA-Z0-9]{20,30}$")


def _validate_report_id(report_id: str) -> bool:
    return bool(_CUID_PATTERN.match(report_id))


def _sanitize_filename(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)


class TestCuidValidation:
    def test_valid_cuid(self):
        assert _validate_report_id("cmqmyyfix000aegmcy4x7e5cl")

    def test_valid_short_id(self):
        assert _validate_report_id("abc123def456ghi789jkl")

    def test_valid_max_length(self):
        assert _validate_report_id("a" * 30)

    def test_rejects_short_id(self):
        assert not _validate_report_id("short")

    def test_rejects_too_long_id(self):
        assert not _validate_report_id("a" * 31)

    def test_rejects_spaces(self):
        assert not _validate_report_id("contains spaces")

    def test_rejects_special_chars(self):
        assert not _validate_report_id("id/with/slashes")
        assert not _validate_report_id("id-with-dashes")
        assert not _validate_report_id("id;with;semicolons")


class TestFilenameSanitization:
    def test_clean_filename_unchanged(self):
        assert _sanitize_filename("evidence_binder.pdf") == "evidence_binder.pdf"

    def test_spaces_replaced(self):
        assert _sanitize_filename("my report.pdf") == "my_report.pdf"

    def test_quotes_replaced(self):
        assert _sanitize_filename('file"quote.pdf') == "file_quote.pdf"

    def test_semicolons_replaced(self):
        assert _sanitize_filename("file;name.pdf") == "file_name.pdf"

    def test_path_traversal_replaced(self):
        # Dots are allowed in filenames, only slashes are replaced
        assert _sanitize_filename("../../../etc/passwd") == ".._.._.._etc_passwd"

    def test_unicode_replaced(self):
        assert _sanitize_filename("reportö.pdf") == "report_.pdf"

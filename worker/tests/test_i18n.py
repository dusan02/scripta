"""
Unit testy pre i18n (internationalization) v worker/src/i18n.py.

Testuje:
- Úplnosť kľúčov vo všetkých jazykoch (sk, en, de)
- Fallback na slovenčinu pre neznámy jazyk
- Existencia kľúčov používaných v templates a report_generator
- Žiadne prázdne hodnoty
"""

import pytest
import sys
import types

# ── Prisma mock (z conftest.py) ─────────────────────────────────────────────
if "prisma" not in sys.modules:
    _prisma_mock = types.ModuleType("prisma")
    _prisma_mock.Prisma = type("Prisma", (), {})
    sys.modules["prisma"] = _prisma_mock

if "prisma.errors" not in sys.modules:
    _prisma_errors_mock = types.ModuleType("prisma.errors")
    _prisma_errors_mock.PrismaError = type("PrismaError", (Exception,), {})
    sys.modules["prisma.errors"] = _prisma_errors_mock
    _prisma_mock.errors = _prisma_errors_mock


from src.i18n import I18N_STRINGS, get_i18n_strings


class TestI18nKeyCompleteness:
    """Verifikuje že všetky jazyky majú rovnaké kľúče."""

    def test_all_languages_have_same_keys(self):
        """sk, en, de by mali mať identické sady kľúčov."""
        sk_keys = set(I18N_STRINGS["sk"].keys())
        en_keys = set(I18N_STRINGS["en"].keys())
        de_keys = set(I18N_STRINGS["de"].keys())

        assert sk_keys == en_keys, f"en missing keys: {sk_keys - en_keys}, en extra: {en_keys - sk_keys}"
        assert sk_keys == de_keys, f"de missing keys: {sk_keys - de_keys}, de extra: {de_keys - sk_keys}"

    def test_no_empty_values(self):
        """Žiadny preklad by nemal byť prázdny string."""
        for lang, strings in I18N_STRINGS.items():
            for key, value in strings.items():
                assert value, f"Empty value for key '{key}' in language '{lang}'"

    def test_key_count_reasonable(self):
        """Každý jazyk by mať aspoň 500 kľúčov (súčasný stav ~648)."""
        for lang in ["sk", "en", "de"]:
            assert len(I18N_STRINGS[lang]) >= 500, f"Language '{lang}' has only {len(I18N_STRINGS[lang])} keys"

    def test_flag_cr_na_exists_in_all_languages(self):
        """flag_cr_na bol chýbajúci v en/de — terz by mal existovať."""
        for lang in ["sk", "en", "de"]:
            assert "flag_cr_na" in I18N_STRINGS[lang], f"flag_cr_na missing in {lang}"
            assert I18N_STRINGS[lang]["flag_cr_na"], f"flag_cr_na is empty in {lang}"


class TestGetI18nStrings:
    """Testuje get_i18n_strings fallback logiku."""

    def test_returns_sk_for_sk(self):
        """get_i18n_strings('sk') vráti slovenské strings."""
        result = get_i18n_strings("sk")
        assert result == I18N_STRINGS["sk"]

    def test_returns_en_for_en(self):
        """get_i18n_strings('en') vráti anglické strings."""
        result = get_i18n_strings("en")
        assert result == I18N_STRINGS["en"]

    def test_returns_de_for_de(self):
        """get_i18n_strings('de') vráti nemecké strings."""
        result = get_i18n_strings("de")
        assert result == I18N_STRINGS["de"]

    def test_falls_back_to_sk_for_unknown_language(self):
        """Pre neznámy jazyk by sa použiť fallback na sk."""
        result = get_i18n_strings("fr")
        assert result == I18N_STRINGS["sk"]

    def test_falls_back_to_sk_for_none(self):
        """Pre None by sa použiť fallback na sk."""
        result = get_i18n_strings(None)
        assert result == I18N_STRINGS["sk"]

    def test_default_parameter_is_sk(self):
        """Default parameter by byť 'sk'."""
        result = get_i18n_strings()
        assert result == I18N_STRINGS["sk"]


class TestTemplateRequiredKeys:
    """Verifikuje že kľúče používané v templates existujú vo všetkých jazykoch."""

    REQUIRED_KEYS = [
        # _legal.html
        "legal_risks",
        "risk_matrix",
        "low_impact",
        "medium_impact",
        "high_impact",
        "high_probability",
        "medium_probability",
        "low_probability",
        "events_timeline",
        "events",
        "no_legal_issues",
        "no_legal_issues_desc",
        # _cover.html
        "due_diligence_report",
        "identification_number",
        "ico_label",
        "page_label",
        "score",
        "generated",
        # _summary.html
        "main_assessment",
        "executive_summary",
        # _financials.html
        "balance_sheet",
        "financial_health",
        # _table_of_contents.html
        "toc_title",
    ]

    def test_required_keys_exist_in_all_languages(self):
        """Kľúče používané v templates by existovať vo všetkých jazykoch."""
        for key in self.REQUIRED_KEYS:
            for lang in ["sk", "en", "de"]:
                assert key in I18N_STRINGS[lang], f"Required key '{key}' missing in language '{lang}'"


class TestParameterInterpolation:
    """Testuje že interpolácia parametrov funguje (ak existuje)."""

    def test_flag_cr_excellent_has_placeholder(self):
        """flag_cr_excellent by obsahovať {val} placeholder."""
        for lang in ["sk", "en", "de"]:
            assert "{val}" in I18N_STRINGS[lang]["flag_cr_excellent"], \
                f"flag_cr_excellent in {lang} missing {{val}} placeholder"

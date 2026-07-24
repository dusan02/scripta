"""
Unit testy pre AttachmentFilter — logika vylúčenia príloh z PDF reportu.

Pokrýva:
- from_dict: merge s defaultmi, None config
- is_category_enabled: povolené/vylúčené kategórie
- should_include_source: mapovanie source_type → kategória
- get_excluded_categories / get_excluded_source_types
- has_red_flag_excluded: varovanie pri vylúčení red flag zdrojov
"""

import pytest
from src.attachment_filter import (
    AttachmentFilter,
    ATTACHMENT_CATEGORY_MAP,
    DEFAULT_ATTACHMENTS_CONFIG,
    RED_FLAG_SOURCE_TYPES,
)


class TestFromDict:
    def test_none_config_includes_all(self):
        f = AttachmentFilter.from_dict(None)
        assert f.config is None

    def test_empty_dict_uses_defaults(self):
        f = AttachmentFilter.from_dict({})
        assert f.config is not None
        assert f.config["obchodny_register"] is True
        assert f.config["uctovna_zavierka_a_poznámky"] is False

    def test_partial_dict_merges_with_defaults(self):
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        assert f.config["obchodny_register"] is False
        assert f.config["zivnostensky_register"] is True  # default
        assert f.config["uctovna_zavierka_a_poznámky"] is False  # default

    def test_full_dict_overrides_defaults(self):
        f = AttachmentFilter.from_dict({
            "obchodny_register": False,
            "zivnostensky_register": False,
            "auditorska_sprava": False,
            "uctovna_zavierka_a_poznámky": True,
        })
        assert f.config["uctovna_zavierka_a_poznámky"] is True


class TestIsCategoryEnabled:
    def test_none_config_all_enabled(self):
        f = AttachmentFilter.from_dict(None)
        assert f.is_category_enabled("obchodny_register") is True
        assert f.is_category_enabled("uctovna_zavierka_a_poznámky") is True

    def test_enabled_category(self):
        f = AttachmentFilter.from_dict({"obchodny_register": True})
        assert f.is_category_enabled("obchodny_register") is True

    def test_disabled_category(self):
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        assert f.is_category_enabled("obchodny_register") is False

    def test_unknown_category_defaults_true(self):
        f = AttachmentFilter.from_dict({})
        assert f.is_category_enabled("unknown_category") is True


class TestShouldIncludeSource:
    def test_none_config_includes_everything(self):
        f = AttachmentFilter.from_dict(None)
        assert f.should_include_source("ORSR") is True
        assert f.should_include_source("ZRSR") is True
        assert f.should_include_source("INSOLVENCY") is True

    def test_source_in_disabled_category_excluded(self):
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        assert f.should_include_source("ORSR") is False

    def test_source_in_enabled_category_included(self):
        f = AttachmentFilter.from_dict({"obchodny_register": True})
        assert f.should_include_source("ORSR") is True

    def test_source_without_category_always_included(self):
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        # INSOLVENCY nie je v žiadnej kategórii → vždy zahrnutý
        assert f.should_include_source("INSOLVENCY") is True
        assert f.should_include_source("SP_DLZNICI") is True

    def test_register_uz_excluded_when_category_disabled(self):
        f = AttachmentFilter.from_dict({"uctovna_zavierka_a_poznámky": False})
        assert f.should_include_source("REGISTER_UZ") is False

    def test_register_uz_included_when_category_enabled(self):
        f = AttachmentFilter.from_dict({"uctovna_zavierka_a_poznámky": True})
        assert f.should_include_source("REGISTER_UZ") is True


class TestGetExcluded:
    def test_none_config_no_exclusions(self):
        f = AttachmentFilter.from_dict(None)
        assert f.get_excluded_categories() == []
        assert f.get_excluded_source_types() == []

    def test_excluded_categories(self):
        f = AttachmentFilter.from_dict({
            "obchodny_register": False,
            "zivnostensky_register": False,
        })
        excluded = f.get_excluded_categories()
        assert "obchodny_register" in excluded
        assert "zivnostensky_register" in excluded

    def test_excluded_source_types(self):
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        excluded = f.get_excluded_source_types()
        assert "ORSR" in excluded

    def test_excluded_source_types_multiple(self):
        f = AttachmentFilter.from_dict({
            "obchodny_register": False,
            "uctovna_zavierka_a_poznámky": False,
        })
        excluded = f.get_excluded_source_types()
        assert "ORSR" in excluded
        assert "REGISTER_UZ" in excluded

    def test_empty_category_no_source_types(self):
        """auditorska_sprava má prázdny zoznam source_types — vylúčenie nepridá žiadne source_types."""
        f = AttachmentFilter.from_dict({
            "obchodny_register": True,
            "zivnostensky_register": True,
            "auditorska_sprava": False,
            "uctovna_zavierka_a_poznámky": True,
        })
        excluded = f.get_excluded_source_types()
        assert excluded == []  # auditorska_sprava nemá žiadne source_types


class TestHasRedFlagExcluded:
    def test_none_config_no_red_flags(self):
        f = AttachmentFilter.from_dict(None)
        assert f.has_red_flag_excluded(["INSOLVENCY", "SP_DLZNICI"]) is False

    def test_red_flag_source_not_excluded(self):
        """INSOLVENCY nie je v žiadnej kategórii → nie je vylúčený ani keď iné kategórie sú vypnuté."""
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        # INSOLVENCY nie je v žiadnej kategórii → nie je v excluded
        assert f.has_red_flag_excluded(["INSOLVENCY"]) is False

    def test_non_red_flag_source_excluded_still_detected(self):
        """has_red_flag_excluded kontroluje či ľubovoľný source_type s findings je vylúčený, bez ohľadu na RED_FLAG_SOURCE_TYPES."""
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        # ORSR je vylúčený → has_red_flag_excluded vráti True (ORSR je v zozname findings)
        assert f.has_red_flag_excluded(["ORSR"]) is True

    def test_no_red_flag_when_source_not_excluded(self):
        f = AttachmentFilter.from_dict({"obchodny_register": True})
        assert f.has_red_flag_excluded(["ORSR"]) is False

    def test_empty_findings_list(self):
        f = AttachmentFilter.from_dict({"obchodny_register": False})
        assert f.has_red_flag_excluded([]) is False


class TestCategoryMap:
    def test_orsr_mapped(self):
        assert "ORSR" in ATTACHMENT_CATEGORY_MAP["obchodny_register"]

    def test_zrsr_mapped(self):
        assert "ZRSR" in ATTACHMENT_CATEGORY_MAP["zivnostensky_register"]

    def test_register_uz_mapped(self):
        assert "REGISTER_UZ" in ATTACHMENT_CATEGORY_MAP["uctovna_zavierka_a_poznámky"]

    def test_auditorska_sprava_empty(self):
        assert ATTACHMENT_CATEGORY_MAP["auditorska_sprava"] == []

    def test_red_flag_types_non_empty(self):
        assert len(RED_FLAG_SOURCE_TYPES) > 0
        assert "INSOLVENCY" in RED_FLAG_SOURCE_TYPES
        assert "SP_DLZNICI" in RED_FLAG_SOURCE_TYPES

    def test_orsr_not_red_flag(self):
        assert "ORSR" not in RED_FLAG_SOURCE_TYPES

    def test_default_config_values(self):
        assert DEFAULT_ATTACHMENTS_CONFIG["obchodny_register"] is True
        assert DEFAULT_ATTACHMENTS_CONFIG["uctovna_zavierka_a_poznámky"] is False

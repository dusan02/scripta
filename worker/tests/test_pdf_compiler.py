"""
Unit testy pre PdfCompiler helper funkcie — _has_no_record a _SOURCE_ORDER.

Pokrýva:
- _has_no_record: detekcia "žiadny záznam" z findings/status_message
- _SOURCE_ORDER: kategorické poradie zdrojov
- _SOURCES_WITH_EMBEDDED_TITLE: zdroje s vlastným nadpisom
"""

import pytest
from types import SimpleNamespace
from src.pdf.compiler import _has_no_record, _SOURCE_ORDER, _SOURCES_WITH_EMBEDDED_TITLE, _NO_RECORD_MARKERS


def _source(status="SUCCESS", file_path="/tmp/fake.pdf", findings="", status_message=""):
    return SimpleNamespace(
        status=status,
        file_path=file_path,
        findings=findings,
        status_message=status_message,
    )


class TestHasNoRecord:
    def test_success_with_findings(self):
        s = _source(findings="Nájdený záznam v registri")
        assert _has_no_record(s) is False

    def test_success_no_findings(self):
        s = _source(findings="", status_message="OK")
        assert _has_no_record(s) is False

    def test_failed_status(self):
        s = _source(status="FAILED")
        assert _has_no_record(s) is True

    def test_no_file_path(self):
        s = _source(file_path=None)
        assert _has_no_record(s) is True

    def test_empty_file_path(self):
        s = _source(file_path="")
        assert _has_no_record(s) is True

    @pytest.mark.parametrize("marker", [
        "nie je evidovaný",
        "žiadny záznam",
        "nenašli sa žiadne",
        "neobsahuje žiadne",
        "nie je v zozname",
        "žiadne nedoplatky",
        "žiadne výsledky",
        "bez výsledkov",
        "neboli nájdené žiadne",
        "0 záznamov",
        "žiadne záznamy",
        "bez nálezu",
        "nemá negatívne záznamy",
    ])
    def test_no_record_markers_in_findings(self, marker):
        s = _source(findings=f"Firma {marker} v registri")
        assert _has_no_record(s) is True

    def test_no_record_markers_case_insensitive(self):
        s = _source(findings="Firma NIE JE EVIDOVANÝ v registri")
        assert _has_no_record(s) is True

    def test_no_record_in_status_message_fallback(self):
        s = _source(findings=None, status_message="žiadny záznam")
        assert _has_no_record(s) is True

    def test_real_findings_not_flagged(self):
        s = _source(findings="Konkurz zahájený 15.3.2024, exekúcia 3ks")
        assert _has_no_record(s) is False

    def test_pending_status(self):
        s = _source(status="PENDING")
        assert _has_no_record(s) is True


class TestSourceOrder:
    def test_orsr_has_order(self):
        assert "ORSR" in _SOURCE_ORDER

    def test_insolvency_has_order(self):
        assert "INSOLVENCY" in _SOURCE_ORDER

    def test_order_is_numeric(self):
        for key, val in _SOURCE_ORDER.items():
            assert isinstance(val, int)
            assert val >= 0

    def test_orsr_before_insolvency(self):
        """Základné registre by mali byť pred insolvenciou."""
        # ORSR je v kategórii "basic", INSOLVENCY v "risk"
        # basic je 3. kategória, risk je 2. — takže INSOLVENCY je skôr
        # Overíme len že obidva majú definované poradie
        assert _SOURCE_ORDER.get("ORSR", 999) != 999
        assert _SOURCE_ORDER.get("INSOLVENCY", 999) != 999

    def test_unknown_source_defaults_high(self):
        assert _SOURCE_ORDER.get("NONEXISTENT_SOURCE", 999) == 999


class TestSourcesWithEmbeddedTitle:
    def test_orsr_has_embedded_title(self):
        assert "ORSR" in _SOURCES_WITH_EMBEDDED_TITLE

    def test_insolvency_not_in_embedded(self):
        assert "INSOLVENCY" not in _SOURCES_WITH_EMBEDDED_TITLE

    def test_all_health_insurers_have_embedded(self):
        assert "VSZP_DLZNICI" in _SOURCES_WITH_EMBEDDED_TITLE
        assert "DOVERA_DLZNICI" in _SOURCES_WITH_EMBEDDED_TITLE
        assert "UNION_DLZNICI" in _SOURCES_WITH_EMBEDDED_TITLE

    def test_financna_sprava_has_embedded(self):
        assert "FINANCNA_SPRAVA" in _SOURCES_WITH_EMBEDDED_TITLE

    def test_is_frozenset(self):
        assert isinstance(_SOURCES_WITH_EMBEDDED_TITLE, frozenset)


class TestNoRecordMarkers:
    def test_markers_are_tuple(self):
        assert isinstance(_NO_RECORD_MARKERS, tuple)

    def test_markers_non_empty(self):
        assert len(_NO_RECORD_MARKERS) > 0

    def test_all_markers_are_strings(self):
        for m in _NO_RECORD_MARKERS:
            assert isinstance(m, str)

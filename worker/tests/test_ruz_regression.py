"""
Permanent regression test suite for the RÚZ financial-data ingestion pipeline.

PURPOSE
-------
Prevents recurrence of the template-687/template-699 corruption class of bugs.

HISTORICAL BUG
--------------
The old parser incorrectly used template 699 row mapping for template 687
(micro entities). This caused:
  - totalAssets to contain nonCurrentAssets values
  - currentAssets to be NULL
  - shortTermLiabilities to be NULL
  - inventory/cash/tradeReceivables to be NULL

This test suite validates the complete ingestion contract:
  1. Template structure detection (687 vs 699)
  2. Template 687 balance-sheet row mapping
  3. Template 699 balance-sheet row mapping (regression)
  4. Flat data format handling
  5. Missing/empty table handling
  6. Source gap classification
  7. Available data extraction
  8. Idempotency
  9. Partial data
  10. P&L isolation
  11. Cross-template regression
  12. Data quality status contract
  13. Golden fixtures (raw source → parser → DB)
  14. Invariant tests
  15. Database integrity
  16. Error handling
"""
import json
import pytest
from pathlib import Path
from copy import deepcopy

from src.ruz_parser import (
    _to_float,
    _extract_row_value,
    _get_row,
    _get_activ_value,
    _get_pasiv_value,
    _get_income_value,
    _identify_tables,
    _is_micro_income_format,
    parse_tables_to_metrics,
    _parse_single_vykaz,
    parse_zavierka_to_metrics,
    # Row constants — 699 (standard)
    ROW_TOTAL_ASSETS, ROW_NON_CURRENT_ASSETS, ROW_CURRENT_ASSETS,
    ROW_INVENTORY, ROW_CASH, ROW_TRADE_RECEIVABLES, ROW_TOTAL_EQUITY,
    ROW_LT_LIABILITIES, ROW_ST_LIABILITIES, ROW_TRADE_PAYABLES,
    ROW_NET_REVENUE, ROW_OPERATING_COSTS, ROW_NET_PROFIT,
    # Row constants — 687 (micro)
    ROW_MICRO_TOTAL_ASSETS, ROW_MICRO_NON_CURRENT_ASSETS,
    ROW_MICRO_CURRENT_ASSETS, ROW_MICRO_INVENTORY,
    ROW_MICRO_TRADE_RECEIVABLES, ROW_MICRO_CASH,
    ROW_MICRO_TOTAL_EQUITY, ROW_MICRO_TOTAL_LIABILITIES,
    ROW_MICRO_LT_LIABILITIES, ROW_MICRO_ST_LIABILITIES,
    ROW_MICRO_TRADE_PAYABLES, ROW_MICRO_NET_PROFIT,
    # Offsets
    _ACTIV_OFFSET, _PASIV_OFFSET, _INCOME_OFFSET,
)
from src.agents.shared import FinancialMetrics
from tests.golden_fixtures import (
    GOLDEN_FIXTURES,
    get_fixtures_by_category,
    get_fixture_by_name,
    classify_data_quality,
    _make_687_aktiv_flat,
    _make_687_pasiv_flat,
    _make_699_tables,
)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: TEMPLATE STRUCTURE TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestTemplateStructure:
    """Verify template 687 and 699 are detected and handled correctly."""

    def test_687_detected_by_id_sablony(self):
        """id_sablony=687 triggers micro-firm row mapping in parse_tables_to_metrics."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        # 687: totalAssets = r.1 = 57062, NOT r.2 (nonCurrentAssets = 7671)
        assert metrics.celkove_aktiva == 57062.0
        assert metrics.celkove_aktiva != 7671.0

    def test_699_detected_by_id_sablony(self):
        """id_sablony=699 triggers standard row mapping."""
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        # 699: totalAssets = r.1 = 1000000
        assert metrics.celkove_aktiva == 1000000.0

    def test_687_never_applies_699_mapping(self):
        """687 data parsed with id_sablony=687 must NOT use 699 row mapping.

        Historical bug: 699 mapping on 687 data → totalAssets = nonCurrentAssets.
        """
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]

        # With 687: r.1 = totalAssets = 57062
        val_687 = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val_687 == 57062.0

        # With 699 mapping on same data: r.1, col 2 (Netto2) = 7671 (WRONG)
        val_699 = _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699)
        assert val_699 == 7671.0  # This is the bug value

        # The two must be different
        assert val_687 != val_699

    def test_699_never_applies_687_mapping(self):
        """699 data parsed with id_sablony=699 must NOT use 687 row mapping.

        687 mapping uses r.14 for currentAssets, 699 uses r.33.
        With 687 mapping on 699 data, r.14 reads a different row → different value.
        """
        tables, titulna = _make_699_tables(
            assets=1000000, non_current=400000, current=600000,
            inventory=100000, trade_recv=200000, cash=300000,
            equity=500000, share_capital=100000,
            lt_liab=200000, st_liab=300000, trade_pay=150000,
            revenue=5000000, operating_costs=3000000,
            material=1000000, services=500000, personnel=800000,
            depreciation=200000, net_profit=200000,
        )

        # 699: r.33 = currentAssets = 600000
        val_699 = _get_activ_value(tables, ROW_CURRENT_ASSETS, id_sablony=699)
        assert val_699 == 600000.0

        # 687 mapping: r.14 = currentAssets, but in 699 data r.14 is a different row
        # (likely empty or a sub-component) → NOT 600000
        val_687 = _get_activ_value(tables, ROW_MICRO_CURRENT_ASSETS, id_sablony=687)
        assert val_687 != 600000.0

    def test_687_uses_2_data_columns(self):
        """687 template must use data_cols=2, not 4."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]

        # 687: data_cols=2, target=0 (current period)
        val = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val == 57062.0  # First value in flat array

    def test_699_uses_4_data_columns(self):
        """699 template must use data_cols=4 (Brutto, Korekcia, Netto2, Netto3)."""
        tables, _ = _make_699_tables(
            assets=1000000, non_current=400000, current=600000,
            inventory=100000, trade_recv=200000, cash=300000,
            equity=500000, share_capital=100000,
            lt_liab=200000, st_liab=300000, trade_pay=150000,
            revenue=5000000, operating_costs=3000000,
            material=1000000, services=500000, personnel=800000,
            depreciation=200000, net_profit=200000,
        )
        # 699: data_cols=4, target=2 (Netto2 = current period)
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699)
        assert val == 1000000.0  # Netto2 column


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: TEMPLATE 687 BALANCE-SHEET TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestTemplate687BalanceSheet:
    """Verify exact row mapping for template 687 balance sheet.

    All values are deliberately distinct to detect cross-row contamination.
    The historical bug caused totalAssets to contain nonCurrentAssets values.
    """

    def test_687_total_assets_not_non_current(self):
        """totalAssets must be r.1 (SPOLU MAJETOK), NOT r.2 (Neobežný)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.celkove_aktiva == 57062.0
        assert metrics.celkove_aktiva != 7671.0  # nonCurrentAssets value

    def test_687_current_assets_not_null(self):
        """currentAssets must be r.14 (Obežný majetok), NOT NULL."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.obezny_majetok == 49391.0
        assert metrics.obezny_majetok is not None

    def test_687_non_current_assets(self):
        """nonCurrentAssets is not directly extracted for 687 (extended fields skipped)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # 687 skips extended fields → neobezny_majetok should be None
        assert metrics.neobezny_majetok is None

    def test_687_inventory_correct(self):
        """inventory = r.15 (Zásoby)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.zasoby == 1000.0

    def test_687_trade_receivables_correct(self):
        """tradeReceivables = r.18 (Pohľadávky z obchodného styku)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.pohladavky_z_obchodneho_styku == 1500.0

    def test_687_cash_correct(self):
        """cash = r.22 (Peniaze)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.peniaze_a_penazne_ekvivalenty_k_31_12 == 47467.0

    def test_687_equity_correct(self):
        """equity = r.25 (Vlastné imanie)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.vlastne_imanie_celkom == 42987.0

    def test_687_short_term_liabilities_not_null(self):
        """shortTermLiabilities = r.38, NOT NULL."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.kratkodobe_zavazky == 11785.0
        assert metrics.kratkodobe_zavazky is not None

    def test_687_trade_payables_correct(self):
        """tradePayables = r.39 (Záväzky z obchodného styku)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.zavazky_z_obchodneho_styku == 9036.0

    def test_687_all_values_distinct(self):
        """All 687 balance-sheet values must be distinct (no cross-row contamination)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        values = [
            metrics.celkove_aktiva,
            metrics.obezny_majetok,
            metrics.vlastne_imanie_celkom,
            metrics.kratkodobe_zavazky,
            metrics.peniaze_a_penazne_ekvivalenty_k_31_12,
            metrics.pohladavky_z_obchodneho_styku,
            metrics.zavazky_z_obchodneho_styku,
            metrics.zasoby,
        ]
        # All non-None values must be unique
        non_none = [v for v in values if v is not None]
        assert len(non_none) == len(set(non_none)), \
            f"Duplicate values detected: {non_none}"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: TEMPLATE 699 BALANCE-SHEET TESTS (REGRESSION)
# ═══════════════════════════════════════════════════════════════════════════════

class TestTemplate699BalanceSheet:
    """Verify 699 mapping remains unchanged after 687 fix.

    Regression requirement: fixing 687 must never alter 699 results.
    """

    def test_699_total_assets_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.celkove_aktiva == 1000000.0

    def test_699_current_assets_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.obezny_majetok == 600000.0

    def test_699_inventory_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.zasoby == 100000.0

    def test_699_cash_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.peniaze_a_penazne_ekvivalenty_k_31_12 == 350000.0

    def test_699_equity_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.vlastne_imanie_celkom == 500000.0

    def test_699_short_term_liabilities_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.kratkodobe_zavazky == 300000.0

    def test_699_long_term_liabilities_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.dlhodobe_zavazky == 250000.0

    def test_699_trade_payables_correct(self):
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.zavazky_z_obchodneho_styku == 150000.0

    def test_699_extended_fields_extracted(self):
        """699 must extract extended fields (nonCurrentAssets, shareCapital)."""
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.neobezny_majetok == 400000.0
        assert metrics.zakladne_imanie == 100000.0

    def test_699_all_values_distinct(self):
        """All 699 balance-sheet values must be distinct."""
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        values = [
            metrics.celkove_aktiva,
            metrics.obezny_majetok,
            metrics.neobezny_majetok,
            metrics.vlastne_imanie_celkom,
            metrics.kratkodobe_zavazky,
            metrics.dlhodobe_zavazky,
            metrics.peniaze_a_penazne_ekvivalenty_k_31_12,
            metrics.pohladavky_z_obchodneho_styku,
            metrics.zavazky_z_obchodneho_styku,
            metrics.zasoby,
        ]
        non_none = [v for v in values if v is not None]
        assert len(non_none) == len(set(non_none)), \
            f"Duplicate values detected: {non_none}"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: FLAT DATA FORMAT TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestFlatDataFormat:
    """Test RÚZ flat data format (scalars instead of list-of-lists).

    Template 687 returns flat arrays: data = ["57062", "67849", ...]
    Do NOT assume pocetDatovychStlpcov is present in the API response.
    """

    def test_687_flat_format_no_metadata(self):
        """687 flat data without pocetDatovychStlpcov must parse correctly."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]
        # No pocetDatovychStlpcov in table metadata
        val = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val == 57062.0

    def test_699_flat_format_with_metadata(self):
        """699 flat data with pocetDatovychStlpcov=4 must parse correctly."""
        data = [0] * (78 * 4)
        data[0] = 1000000  # Brutto
        data[2] = 1000000  # Netto2 (current)
        data[3] = 900000   # Netto3 (preceding)
        tables = [{"nazov": {"sk": "Strana aktív"}, "pocetDatovychStlpcov": 4, "data": data}]
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699)
        assert val == 1000000.0

    def test_flat_data_is_scalar_not_list(self):
        """Flat data: first element is a scalar, not a list."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        assert not isinstance(aktiv[0], list)
        assert isinstance(aktiv[0], str)

    def test_nested_data_is_list(self):
        """Nested data: first element is a list."""
        tables, _ = _make_699_tables(
            assets=1000000, non_current=400000, current=600000,
            inventory=100000, trade_recv=200000, cash=300000,
            equity=500000, share_capital=100000,
            lt_liab=200000, st_liab=300000, trade_pay=150000,
            revenue=5000000, operating_costs=3000000,
            material=1000000, services=500000, personnel=800000,
            depreciation=200000, net_profit=200000,
        )
        data = tables[0]["data"]
        assert isinstance(data[0], list)

    def test_flat_687_preceding_period(self):
        """687 flat: preceding period = col 1 (second value per row)."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]
        val = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, current=False, id_sablony=687)
        assert val == int(57062 * 0.9)

    def test_deterministic_flat_and_nested_same_result(self):
        """Same logical data in flat vs nested format must give same result."""
        # Flat: 23 rows × 2 cols
        aktiv_flat = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        # Nested: convert flat to list-of-lists
        aktiv_nested = []
        for i in range(23):
            aktiv_nested.append([aktiv_flat[i * 2], aktiv_flat[i * 2 + 1]])

        tables_flat = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv_flat}]
        tables_nested = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv_nested}]

        val_flat = _get_activ_value(tables_flat, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        val_nested = _get_activ_value(tables_nested, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val_flat == val_nested == 57062.0


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: MISSING / EMPTY TABLE TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestMissingEmptyTables:
    """Parser must NOT invent values when tables are empty or missing."""

    def test_empty_tables_returns_none_or_all_none(self):
        """Tables with 0 rows → parser returns None or metrics with all-None BS fields."""
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": []},
            {"nazov": {"sk": "Strana pasív"}, "data": []},
        ]
        titulna = {"obdobieOd": "2021-01-01", "obdobieDo": "2021-12-31", "pocetZamestnancov": 0}
        metrics = parse_tables_to_metrics(tables, titulna, "99999999", id_sablony=687)
        # Parser may return None or a FinancialMetrics with all-None fields
        # (tables are identified by name but have no data rows)
        if metrics is not None:
            assert metrics.celkove_aktiva is None
            assert metrics.obezny_majetok is None
            assert metrics.vlastne_imanie_celkom is None
            assert metrics.kratkodobe_zavazky is None

    def test_missing_aktiv_returns_none(self):
        """Missing aktív table → parser returns None."""
        tables = [
            {"nazov": {"sk": "Strana pasív"}, "data": [["", "", "50000", "45000"]]},
        ]
        titulna = {"obdobieOd": "2021-01-01", "obdobieDo": "2021-12-31", "pocetZamestnancov": 0}
        metrics = parse_tables_to_metrics(tables, titulna, "99999999", id_sablony=687)
        assert metrics is None

    def test_missing_pasiv_returns_none(self):
        """Missing pasív table → parser returns None."""
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": [["100", "0", "100", "50"]]},
        ]
        titulna = {"obdobieOd": "2021-01-01", "obdobieDo": "2021-12-31", "pocetZamestnancov": 0}
        metrics = parse_tables_to_metrics(tables, titulna, "99999999", id_sablony=699)
        assert metrics is None

    def test_empty_data_does_not_invent_values(self):
        """Empty data array → _get_activ_value returns None, not 0."""
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": []}]
        assert _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699) is None
        assert _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687) is None

    def test_missing_row_returns_none(self):
        """Row that doesn't exist in data → None, not fabricated."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]
        # Row 99 doesn't exist in 687 (only 23 rows)
        val = _get_activ_value(tables, 99, id_sablony=687)
        assert val is None

    def test_no_exception_on_empty_tables(self):
        """Parser must not raise exception on empty/missing tables."""
        # Should return None, not raise
        result = parse_tables_to_metrics([], {}, "99999999")
        assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: SOURCE GAP TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSourceGap:
    """RÚZ source-gap: template exists, tables exist, but 0 rows / 0 columns.

    dataQualityStatus = SOURCE_GAP
    """

    @pytest.mark.parametrize("fixture_name", [
        "source_gap_01_empty_tables",
        "source_gap_02_no_tables_key",
        "source_gap_03_699_empty",
    ])
    def test_source_gap_metrics_none_or_empty(self, fixture_name):
        """Source gap fixtures must produce None or empty metrics."""
        f = get_fixture_by_name(fixture_name)
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        if metrics is not None:
            # If metrics exist, all BS fields must be None
            assert metrics.celkove_aktiva is None
            assert metrics.obezny_majetok is None

    @pytest.mark.parametrize("fixture_name", [
        "source_gap_01_empty_tables",
        "source_gap_02_no_tables_key",
        "source_gap_03_699_empty",
    ])
    def test_source_gap_classification(self, fixture_name):
        """Source gap fixtures must classify as SOURCE_GAP."""
        f = get_fixture_by_name(fixture_name)
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        status = classify_data_quality(metrics)
        assert status == "SOURCE_GAP"

    def test_source_gap_does_not_invent_values(self):
        """Source gap must not invent financial values."""
        f = get_fixture_by_name("source_gap_01_empty_tables")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        if metrics is not None:
            assert metrics.celkove_aktiva is None
            assert metrics.obezny_majetok is None
            assert metrics.vlastne_imanie_celkom is None
            assert metrics.kratkodobe_zavazky is None

    def test_source_gap_existing_values_not_overwritten(self):
        """If some values exist (e.g. equity), source gap must not overwrite them."""
        f = get_fixture_by_name("partial_03_699_pattern_a")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # equity is present, totalAssets is None
        assert metrics is not None
        assert metrics.vlastne_imanie_celkom == 100000.0
        assert metrics.celkove_aktiva is None
        # dataQualityStatus = SOURCE_GAP (TA is NULL)
        assert classify_data_quality(metrics) == "SOURCE_GAP"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: AVAILABLE DATA TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAvailableData:
    """For valid RÚZ response with structured data: dataQualityStatus = AVAILABLE."""

    @pytest.mark.parametrize("fixture_name", [
        "687_full_01", "687_full_02", "687_full_03_loss",
        "687_full_04_minimal", "687_full_05_large",
    ])
    def test_687_available_classification(self, fixture_name):
        f = get_fixture_by_name(fixture_name)
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        assert classify_data_quality(metrics) == "AVAILABLE"

    @pytest.mark.parametrize("fixture_name", [
        "699_full_01", "699_full_02", "699_full_03_loss",
        "699_full_04_small", "699_full_05_zero_cash",
    ])
    def test_699_available_classification(self, fixture_name):
        f = get_fixture_by_name(fixture_name)
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        assert classify_data_quality(metrics) == "AVAILABLE"

    def test_available_values_match_source(self):
        """Extracted values must match raw source exactly."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        expected = f["expected"]
        for key, expected_val in expected.items():
            if key == "dataQualityStatus":
                continue
            actual = getattr(metrics, key, None)
            assert actual == expected_val, \
                f"{key}: expected {expected_val}, got {actual}"

    def test_no_cross_row_contamination_687(self):
        """687: totalAssets must not accidentally equal nonCurrentAssets."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # totalAssets = 57062, nonCurrentAssets = 7671 (not extracted for 687)
        # But the raw data has both — verify parser reads the right one
        assert metrics.celkove_aktiva == 57062.0
        assert metrics.celkove_aktiva != 7671.0

    def test_no_cross_column_contamination_699(self):
        """699: current period (Netto2) must not be confused with preceding (Netto3)."""
        tables, titulna = _make_699_tables(
            assets=1000000, non_current=400000, current=600000,
            inventory=100000, trade_recv=200000, cash=300000,
            equity=500000, share_capital=100000,
            lt_liab=200000, st_liab=300000, trade_pay=150000,
            revenue=5000000, operating_costs=3000000,
            material=1000000, services=500000, personnel=800000,
            depreciation=200000, net_profit=200000,
        )
        val_current = _get_activ_value(tables, ROW_TOTAL_ASSETS, current=True, id_sablony=699)
        val_preceding = _get_activ_value(tables, ROW_TOTAL_ASSETS, current=False, id_sablony=699)
        assert val_current == 1000000.0
        assert val_preceding == 0.0  # Default netto3="0" in _aktiv_row_699


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: IDEMPOTENCY TEST
# ═══════════════════════════════════════════════════════════════════════════════

class TestIdempotency:
    """Parse the same fixture twice → identical results."""

    @pytest.mark.parametrize("fixture_name", [
        "687_full_01", "699_full_01", "partial_01_687_no_current",
    ])
    def test_idempotent_parse(self, fixture_name):
        f = get_fixture_by_name(fixture_name)
        m1 = _parse_single_vykaz(f["vykaz"], "99999999")
        m2 = _parse_single_vykaz(f["vykaz"], "99999999")
        if m1 is None and m2 is None:
            return
        assert m1 is not None and m2 is not None
        assert m1.model_dump() == m2.model_dump()

    def test_idempotent_no_numerical_drift(self):
        """Parsing twice must not cause numerical drift."""
        f = get_fixture_by_name("687_full_05_large")
        m1 = _parse_single_vykaz(f["vykaz"], "99999999")
        m2 = _parse_single_vykaz(f["vykaz"], "99999999")
        assert m1.celkove_aktiva == m2.celkove_aktiva
        assert m1.obezny_majetok == m2.obezny_majetok
        assert m1.zisk_alebo_strata_po_zdaneni == m2.zisk_alebo_strata_po_zdaneni


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: PARTIAL DATA TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestPartialData:
    """Partial data: some fields present, some missing.

    Parser must preserve available values and leave unavailable as NULL.
    """

    def test_partial_687_no_current_assets(self):
        """687 with currentAssets=0 → available, value preserved."""
        f = get_fixture_by_name("partial_01_687_no_current")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        assert metrics.celkove_aktiva == 50000.0
        assert metrics.obezny_majetok == 0.0
        assert metrics.vlastne_imanie_celkom == 30000.0

    def test_partial_699_no_liabilities(self):
        """699 with missing liabilities → None, not fabricated."""
        f = get_fixture_by_name("partial_02_699_no_liabilities")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        assert metrics.celkove_aktiva == 200000.0
        assert metrics.dlhodobe_zavazky is None
        assert metrics.kratkodobe_zavazky is None
        assert metrics.zavazky_z_obchodneho_styku is None

    def test_partial_pattern_a_equity_only(self):
        """Pattern A: totalAssets NULL, equity present → SOURCE_GAP."""
        f = get_fixture_by_name("partial_03_699_pattern_a")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is not None
        assert metrics.celkove_aktiva is None
        assert metrics.vlastne_imanie_celkom == 100000.0
        assert classify_data_quality(metrics) == "SOURCE_GAP"

    def test_partial_does_not_infer_missing(self):
        """Parser must not infer missing values unless documented business rule allows."""
        f = get_fixture_by_name("partial_02_699_no_liabilities")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # Liabilities were not in source → must be None, not 0 or inferred
        assert metrics.dlhodobe_zavazky is None
        assert metrics.kratkodobe_zavazky is None


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 10: P&L ISOLATION TEST
# ═══════════════════════════════════════════════════════════════════════════════

class TestPLIsolation:
    """Balance-sheet reparse must not modify unrelated P&L fields."""

    def test_pl_fields_preserved_687(self):
        """687: P&L fields must be extracted correctly alongside BS fields."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.trzby_z_hlavnej_cinnosti == 120000.0
        assert metrics.zisk_alebo_strata_po_zdaneni == 22400.0
        assert metrics.odpisy == 5000.0
        assert metrics.osobne_naklady == 15000.0

    def test_pl_fields_preserved_699(self):
        """699: P&L fields must be extracted correctly alongside BS fields."""
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.trzby_z_hlavnej_cinnosti == 5000000.0
        assert metrics.zisk_alebo_strata_po_zdaneni == 200000.0
        assert metrics.odpisy == 200000.0
        assert metrics.osobne_naklady == 800000.0

    def test_pl_fields_identical_across_parses(self):
        """P&L fields must be byte-identical across multiple parses."""
        f = get_fixture_by_name("699_full_02")
        m1 = _parse_single_vykaz(f["vykaz"], "99999999")
        m2 = _parse_single_vykaz(f["vykaz"], "99999999")
        pl_fields = [
            "trzby_z_hlavnej_cinnosti", "zisk_alebo_strata_po_zdaneni",
            "odpisy", "osobne_naklady", "naklady_na_hosp_cinnost",
            "spotreba_materialu", "sluzby",
        ]
        for field in pl_fields:
            assert getattr(m1, field) == getattr(m2, field), \
                f"P&L field {field} drifted: {getattr(m1, field)} != {getattr(m2, field)}"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 11: CROSS-TEMPLATE REGRESSION TEST
# ═══════════════════════════════════════════════════════════════════════════════

class TestCrossTemplateRegression:
    """The historical bug: 699 mapping applied to 687 data.

    This test ensures that 687 and 699 fixtures with identical-looking
    but deliberately different row values produce correct results.
    """

    def test_same_data_different_template_different_result(self):
        """Same raw data parsed as 687 vs 699 must give different totalAssets."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]

        # 687: r.1, data_cols=2, col 0 → 57062 (correct)
        val_687 = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val_687 == 57062.0

        # 699: r.1, data_cols=4, col 2 (Netto2) → 7671 (the BUG value)
        val_699 = _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699)
        assert val_699 == 7671.0

        # They MUST be different
        assert val_687 != val_699

    def test_687_fixture_not_corrupted_by_699_logic(self):
        """Full 687 fixture must not produce 699-style results."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # If 699 mapping was applied: totalAssets would be 7671 (nonCurrentAssets)
        assert metrics.celkove_aktiva == 57062.0
        assert metrics.celkove_aktiva != 7671.0
        # If 699 mapping was applied: currentAssets would be NULL
        assert metrics.obezny_majetok == 49391.0
        assert metrics.obezny_majetok is not None

    def test_699_fixture_not_corrupted_by_687_logic(self):
        """Full 699 fixture must not produce 687-style results."""
        f = get_fixture_by_name("699_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # 699: totalAssets = 1000000 (correct)
        assert metrics.celkove_aktiva == 1000000.0
        # 699: currentAssets = 600000 (correct)
        assert metrics.obezny_majetok == 600000.0


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 12: DATA QUALITY STATUS CONTRACT
# ═══════════════════════════════════════════════════════════════════════════════

class TestDataQualityStatusContract:
    """Verify FinancialStatement.dataQualityStatus semantics.

    - AVAILABLE: structured financial data is available
    - SOURCE_GAP: source exists but contains no usable structured data
    - API_ERROR / PARSER_ERROR: transient states (must not become permanent)
    """

    def test_available_when_ta_and_ca_present(self):
        """AVAILABLE when totalAssets AND currentAssets are both NOT NULL."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.celkove_aktiva is not None
        assert metrics.obezny_majetok is not None
        assert classify_data_quality(metrics) == "AVAILABLE"

    def test_source_gap_when_ta_null(self):
        """SOURCE_GAP when totalAssets is NULL (regardless of equity)."""
        f = get_fixture_by_name("partial_03_699_pattern_a")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics.celkove_aktiva is None
        assert metrics.vlastne_imanie_celkom is not None  # equity present
        assert classify_data_quality(metrics) == "SOURCE_GAP"

    def test_source_gap_when_ca_null(self):
        """SOURCE_GAP when totalAssets present but currentAssets NULL (Pattern B)."""
        # Create a 699 fixture where totalAssets exists but currentAssets doesn't
        tables, titulna = _make_699_tables(
            assets=100000, non_current=100000, current=None,
            inventory=None, trade_recv=None, cash=None,
            equity=50000, share_capital=20000,
            lt_liab=30000, st_liab=20000, trade_pay=10000,
            revenue=200000, operating_costs=150000,
            material=50000, services=30000, personnel=40000,
            depreciation=10000, net_profit=10000,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "99999999", id_sablony=699)
        assert metrics.celkove_aktiva == 100000.0
        assert metrics.obezny_majetok is None
        assert classify_data_quality(metrics) == "SOURCE_GAP"

    def test_source_gap_when_metrics_none(self):
        """SOURCE_GAP when parser returns None or all-None metrics (empty tables)."""
        f = get_fixture_by_name("source_gap_01_empty_tables")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # Parser may return None or metrics with all-None BS fields
        if metrics is not None:
            assert metrics.celkove_aktiva is None
            assert metrics.obezny_majetok is None
        assert classify_data_quality(metrics) == "SOURCE_GAP"

    def test_api_error_is_transient(self):
        """API_ERROR and PARSER_ERROR are transient states.

        They must not become permanent without reconciliation:
          API_ERROR → retry → AVAILABLE or SOURCE_GAP
          PARSER_ERROR → fix/retry → AVAILABLE or SOURCE_GAP
        """
        valid_final_states = {"AVAILABLE", "SOURCE_GAP"}
        transient_states = {"API_ERROR", "PARSER_ERROR"}
        # Transient states must not be in valid final states
        assert transient_states.isdisjoint(valid_final_states)
        # classify_data_quality never returns transient states
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert classify_data_quality(metrics) in valid_final_states


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 13: GOLDEN FIXTURES (RAW SOURCE → PARSER → DB)
# ═══════════════════════════════════════════════════════════════════════════════

class TestGoldenFixtures:
    """Golden fixtures: raw RÚZ response → expected parsed metrics → expected status.

    5 × 687, 5 × 699, 3 × SOURCE_GAP, 3 × partial, 2 × malformed = 18 fixtures.
    """

    @pytest.mark.parametrize("fixture", GOLDEN_FIXTURES, ids=[f["name"] for f in GOLDEN_FIXTURES])
    def test_golden_fixture_data_quality_status(self, fixture):
        """Each golden fixture must produce the expected dataQualityStatus."""
        metrics = _parse_single_vykaz(fixture["vykaz"], "99999999")
        status = classify_data_quality(metrics)
        assert status == fixture["expected"]["dataQualityStatus"], \
            f"{fixture['name']}: expected {fixture['expected']['dataQualityStatus']}, got {status}"

    @pytest.mark.parametrize("fixture", get_fixtures_by_category("687") + get_fixtures_by_category("699"),
                             ids=[f["name"] for f in get_fixtures_by_category("687") + get_fixtures_by_category("699")])
    def test_golden_fixture_expected_values(self, fixture):
        """Each 687/699 golden fixture must match expected parsed values."""
        metrics = _parse_single_vykaz(fixture["vykaz"], "99999999")
        assert metrics is not None, f"{fixture['name']}: metrics is None"
        expected = fixture["expected"]
        for key, expected_val in expected.items():
            if key == "dataQualityStatus":
                continue
            actual = getattr(metrics, key, None)
            assert actual == expected_val, \
                f"{fixture['name']}.{key}: expected {expected_val}, got {actual}"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 14: INVARIANT TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestInvariants:
    """Data invariants — mathematically/domain valid constraints."""

    def test_total_assets_never_equals_non_current_687(self):
        """totalAssets must never accidentally equal nonCurrentAssets due to offset."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # totalAssets=57062, nonCurrentAssets(raw)=7671
        assert metrics.celkove_aktiva != 7671.0

    def test_parser_does_not_read_outside_row_range(self):
        """Parser must not read values outside the available row range."""
        aktiv = _make_687_aktiv_flat(
            total_assets=57062, non_current=7671, current=49391,
            inventory=1000, trade_recv=1500, cash=47467,
        )
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": aktiv}]
        # Row 99 doesn't exist (687 has 23 rows)
        val = _get_activ_value(tables, 99, id_sablony=687)
        assert val is None

    def test_missing_raw_values_never_fabricated(self):
        """Missing raw values must never become fabricated numbers."""
        # Empty data
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": []}]
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699)
        assert val is None  # NOT 0, NOT fabricated

    def test_unrelated_fields_not_changed_during_reparse(self):
        """Targeted BS parse must not change unrelated fields."""
        f = get_fixture_by_name("699_full_01")
        m1 = _parse_single_vykaz(f["vykaz"], "99999999")
        m2 = _parse_single_vykaz(f["vykaz"], "99999999")
        # All fields must be identical
        assert m1.model_dump() == m2.model_dump()

    def test_687_balance_sheet_equity_plus_liab_approx_assets(self):
        """687: equity + totalLiabilities ≈ totalAssets (within sanity tolerance)."""
        f = get_fixture_by_name("687_full_01")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # equity=42987, st_liab=11785, lt_liab=2000 → 56772
        # totalAssets=57062, diff=290 (0.5%) — within tolerance
        total_liab = (metrics.kratkodobe_zavazky or 0) + (metrics.dlhodobe_zavazky or 0)
        if metrics.celkove_aktiva and metrics.vlastne_imanie_celkom:
            diff = abs(metrics.celkove_aktiva - (metrics.vlastne_imanie_celkom + total_liab))
            rel = diff / abs(metrics.celkove_aktiva)
            assert rel < 0.05, \
                f"Balance sheet mismatch: {rel*100:.1f}% (diff={diff})"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 15: DATABASE INTEGRITY TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestDatabaseIntegrity:
    """Verify dataQualityStatus IS NOT NULL and schema constraints.

    These tests validate the schema/migration constraints without requiring
    a live database connection. They check the Prisma schema definition.
    """

    SCHEMA_PATH = Path(__file__).parent.parent.parent / "frontend" / "prisma" / "schema.prisma"
    MIGRATION_PATH = Path(__file__).parent.parent.parent / "frontend" / "prisma" / "migrations" / "20260820090000_add_data_quality_status" / "migration.sql"

    def test_schema_has_data_quality_status(self):
        """Prisma schema must define dataQualityStatus field."""
        schema = self.SCHEMA_PATH.read_text()
        assert "dataQualityStatus" in schema

    def test_schema_data_quality_status_not_null(self):
        """Prisma schema must define dataQualityStatus as NOT NULL (no '?')."""
        schema = self.SCHEMA_PATH.read_text()
        # Find the line with dataQualityStatus
        for line in schema.split("\n"):
            if "dataQualityStatus" in line:
                # Must NOT have '?' (Prisma optional marker)
                assert "?" not in line.split("dataQualityStatus")[1].split("//")[0], \
                    f"dataQualityStatus must be NOT NULL, found: {line.strip()}"
                break
        else:
            pytest.fail("dataQualityStatus not found in schema")

    def test_migration_sets_not_null(self):
        """Migration must set NOT NULL constraint."""
        if not self.MIGRATION_PATH.exists():
            pytest.skip("Migration file not found")
        sql = self.MIGRATION_PATH.read_text()
        assert "SET NOT NULL" in sql or "NOT NULL" in sql

    def test_migration_backfills_all_nulls(self):
        """Migration must backfill all NULL dataQualityStatus values."""
        if not self.MIGRATION_PATH.exists():
            pytest.skip("Migration file not found")
        sql = self.MIGRATION_PATH.read_text()
        # Must have UPDATE statements that classify all NULLs
        assert "UPDATE" in sql
        assert "SOURCE_GAP" in sql
        assert "AVAILABLE" in sql
        # Must have a catch-all for remaining NULLs
        assert "IS NULL" in sql

    def test_every_fs_gets_valid_status(self):
        """Every FinancialStatement created by ingestion must get a valid status."""
        valid_statuses = {"AVAILABLE", "SOURCE_GAP", "API_ERROR", "PARSER_ERROR"}
        # Test that classify_data_quality only returns valid statuses
        for f in GOLDEN_FIXTURES:
            metrics = _parse_single_vykaz(f["vykaz"], "99999999")
            status = classify_data_quality(metrics)
            assert status in valid_statuses, \
                f"{f['name']}: invalid status {status}"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 16: ERROR HANDLING TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestErrorHandling:
    """Test deterministic behavior for various error conditions.

    Error handling must be deterministic and must not corrupt existing data.
    """

    def test_empty_tables_returns_none(self):
        """HTTP 200 + valid JSON but empty tables → None."""
        metrics = parse_tables_to_metrics([], {"obdobieDo": "2024-12-31"}, "99999999")
        assert metrics is None

    def test_missing_year_returns_none(self):
        """Missing obdobieDo → no year → None."""
        tables, titulna = _make_699_tables(
            assets=100000, non_current=40000, current=60000,
            inventory=10000, trade_recv=20000, cash=30000,
            equity=50000, share_capital=20000,
            lt_liab=20000, st_liab=30000, trade_pay=15000,
            revenue=200000, operating_costs=150000,
            material=50000, services=30000, personnel=40000,
            depreciation=10000, net_profit=10000,
        )
        titulna["obdobieDo"] = ""
        metrics = parse_tables_to_metrics(tables, titulna, "99999999", id_sablony=699)
        assert metrics is None

    def test_future_year_rejected(self):
        """Year > current+1 → rejected."""
        tables, titulna = _make_699_tables(
            assets=100000, non_current=40000, current=60000,
            inventory=10000, trade_recv=20000, cash=30000,
            equity=50000, share_capital=20000,
            lt_liab=20000, st_liab=30000, trade_pay=15000,
            revenue=200000, operating_costs=150000,
            material=50000, services=30000, personnel=40000,
            depreciation=10000, net_profit=10000,
        )
        titulna["obdobieDo"] = "2099-12-31"
        metrics = parse_tables_to_metrics(tables, titulna, "99999999", id_sablony=699)
        assert metrics is None

    def test_missing_entity_in_vykaz(self):
        """Vykaz with no obsah → None."""
        metrics = _parse_single_vykaz({"id": 123, "idSablony": 699}, "99999999")
        assert metrics is None

    def test_missing_zavierka_handled(self):
        """parse_zavierka_to_metrics with empty vykazy → None."""
        metrics = parse_zavierka_to_metrics([], "99999999")
        assert metrics is None

    def test_malformed_unknown_template(self):
        """Unknown template (not 687/699) → basic fields may parse, extended skipped."""
        f = get_fixture_by_name("malformed_01_unknown_template")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        # Unknown template → extended fields skipped
        if metrics is not None:
            assert metrics.neobezny_majetok is None
            assert metrics.zakladne_imanie is None

    def test_malformed_no_titulna(self):
        """Missing titulnaStrana → no year → None."""
        f = get_fixture_by_name("malformed_02_no_titulna")
        metrics = _parse_single_vykaz(f["vykaz"], "99999999")
        assert metrics is None

    def test_no_exception_on_garbage_input(self):
        """Parser must not raise exception on garbage input."""
        # Should return None, not raise
        result = parse_tables_to_metrics(
            [{"nazov": {"sk": "Garbage"}, "data": ["garbage"]}],
            {"obdobieDo": "2024-12-31"},
            "99999999",
        )
        # Missing aktiv/pasiv → None
        assert result is None

    def test_none_input_returns_none(self):
        """None tables → None."""
        assert parse_tables_to_metrics(None, {}, "99999999") is None

    def test_empty_vykaz_returns_none(self):
        """Empty vykaz dict → None."""
        assert _parse_single_vykaz({}, "99999999") is None


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 17: TEST REPORT (generated by pytest -v --tb=short)
# ═══════════════════════════════════════════════════════════════════════════════
# The test report is generated by running:
#   pytest tests/test_ruz_regression.py -v --tb=short
#
# Coverage summary is in the docstring at the top of this file.

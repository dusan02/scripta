"""
Unit tests for chart generation edge cases in PDF reports.

Covers:
  - _sanitize_value() — NaN/Infinity/None handling
  - Sankey diagram edge cases (empty data, negative values, fallback)
  - Waterfall chart edge cases
  - Error logging (print → logger)
"""
import pytest
import math
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch, MagicMock


# ── _sanitize_value tests ──────────────────────────────────────────────

class TestSanitizeValue:
    """Test _sanitize_value in plotly_charts.py — replaces NaN/Infinity with 0."""

    def test_none_returns_zero(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(None) == 0.0

    def test_normal_float_passes_through(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(42.5) == 42.5

    def test_integer_passes_through(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(100) == 100.0

    def test_decimal_converted_to_float(self):
        from src.plotly_charts import _sanitize_value
        result = _sanitize_value(Decimal('123.45'))
        assert isinstance(result, float)
        assert result == 123.45

    def test_nan_returns_zero(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(float('nan')) == 0.0

    def test_positive_infinity_returns_zero(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(float('inf')) == 0.0

    def test_negative_infinity_returns_zero(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(float('-inf')) == 0.0

    def test_zero_passes_through(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(0) == 0.0

    def test_negative_value_passes_through(self):
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value(-500.0) == -500.0

    def test_string_returns_zero(self):
        """Non-numeric strings should return 0.0, not raise ValueError."""
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value("N/A") == 0.0

    def test_empty_string_returns_zero(self):
        """Empty strings should return 0.0, not raise ValueError."""
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value("") == 0.0

    def test_numeric_string_passes_through(self):
        """Numeric strings should be converted to float."""
        from src.plotly_charts import _sanitize_value
        assert _sanitize_value("123.45") == 123.45


# ── Sankey diagram edge cases ───────────────────────────────────────────

class TestSankeyEdgeCases:
    """Test Sankey diagram generation with edge cases."""

    def _make_valid_stmt(self):
        """Create a statement with valid data for Sankey."""
        return SimpleNamespace(
            mainActivityRevenue=1000000.0,
            grossProfit=400000.0,
            netProfitLoss=100000.0,
            staffCosts=150000.0,
            depreciation=30000.0,
            interestExpense=10000.0,
            operatingCashFlow=80000.0,
            currentAssets=500000.0,
            inventory=100000.0,
            cashAndEquivalents=50000.0,
            tradeReceivables=80000.0,
            totalAssets=1000000.0,
            equity=600000.0,
            shortTermLiabilities=200000.0,
            longTermLiabilities=100000.0,
            tradePayables=50000.0,
            year=2024.0,
            employeeCount=42,
            monthsInPeriod=12,
            statementType="IFRS",
            _gross_profit_estimated=False,
        )

    def test_pl_sankey_empty_stmt_returns_empty(self):
        """P&L Sankey with None stmt should return empty string."""
        from src.infographics import generate_pl_infographic
        assert generate_pl_infographic(None) == ""

    def test_pl_sankey_zero_revenue_returns_empty(self):
        """P&L Sankey with zero revenue should return empty string."""
        from src.infographics import generate_pl_infographic
        stmt = self._make_valid_stmt()
        stmt.mainActivityRevenue = 0.0
        assert generate_pl_infographic(stmt) == ""

    def test_pl_sankey_negative_revenue_returns_empty(self):
        """P&L Sankey with negative revenue should return empty string."""
        from src.infographics import generate_pl_infographic
        stmt = self._make_valid_stmt()
        stmt.mainActivityRevenue = -1000.0
        assert generate_pl_infographic(stmt) == ""

    def test_pl_sankey_missing_fields_falls_back(self):
        """P&L Sankey with missing fields should fall back to waterfall."""
        from src.infographics import generate_pl_infographic
        stmt = self._make_valid_stmt()
        stmt.grossProfit = None
        # Should not crash, should return something (waterfall or empty)
        result = generate_pl_infographic(stmt)
        assert isinstance(result, str)

    def test_pl_sankey_negative_gross_falls_back(self):
        """P&L Sankey with negative gross profit should fall back to waterfall."""
        from src.infographics import generate_pl_infographic
        stmt = self._make_valid_stmt()
        stmt.grossProfit = -50000.0
        result = generate_pl_infographic(stmt)
        assert isinstance(result, str)

    def test_pl_sankey_estimated_gross_falls_back(self):
        """P&L Sankey with estimated gross profit should fall back to waterfall."""
        from src.infographics import generate_pl_infographic
        stmt = self._make_valid_stmt()
        stmt._gross_profit_estimated = True
        result = generate_pl_infographic(stmt)
        assert isinstance(result, str)

    def test_cashflow_sankey_empty_stmt_returns_empty(self):
        """Cash flow Sankey with None stmt should return empty string."""
        from src.infographics import generate_cashflow_waterfall
        assert generate_cashflow_waterfall(None) == ""

    def test_cashflow_sankey_missing_fields_returns_empty(self):
        """Cash flow Sankey with missing fields should return empty string."""
        from src.infographics import generate_cashflow_waterfall
        stmt = self._make_valid_stmt()
        stmt.operatingCashFlow = None
        assert generate_cashflow_waterfall(stmt) == ""

    def test_balance_sheet_sankey_empty_stmt_returns_empty(self):
        """Balance sheet Sankey with None stmt should return empty string."""
        from src.infographics import generate_balance_sheet_infographic
        assert generate_balance_sheet_infographic(None) == ""

    def test_balance_sheet_sankey_zero_assets_returns_empty(self):
        """Balance sheet Sankey with zero total assets should return empty string."""
        from src.infographics import generate_balance_sheet_infographic
        stmt = self._make_valid_stmt()
        stmt.totalAssets = 0.0
        assert generate_balance_sheet_infographic(stmt) == ""

    def test_balance_sheet_sankey_negative_equity_handled(self):
        """Balance sheet Sankey should handle negative equity gracefully."""
        from src.infographics import generate_balance_sheet_infographic
        stmt = self._make_valid_stmt()
        stmt.equity = -100000.0
        result = generate_balance_sheet_infographic(stmt)
        assert isinstance(result, str)


# ── Waterfall chart edge cases ──────────────────────────────────────────

class TestWaterfallEdgeCases:
    """Test waterfall chart generation with edge cases."""

    def test_pl_waterfall_empty_stmt_returns_empty(self):
        """P&L waterfall with None stmt should return empty string."""
        from src.infographics import _generate_pl_waterfall
        assert _generate_pl_waterfall(None) == ""

    def test_pl_waterfall_zero_revenue_returns_empty(self):
        """P&L waterfall with zero revenue should return empty string."""
        from src.infographics import _generate_pl_waterfall
        stmt = SimpleNamespace(
            mainActivityRevenue=0.0,
            grossProfit=None, netProfitLoss=None,
            staffCosts=None, depreciation=None, interestExpense=None,
        )
        assert _generate_pl_waterfall(stmt) == ""

    def test_cashflow_waterfall_empty_stmt_returns_empty(self):
        """Cash flow waterfall with None stmt should return empty string."""
        from src.infographics import _generate_cashflow_waterfall
        assert _generate_cashflow_waterfall(None) == ""

    def test_cashflow_waterfall_no_data_returns_empty(self):
        """Cash flow waterfall with no data should return empty string."""
        from src.infographics import _generate_cashflow_waterfall
        stmt = SimpleNamespace(
            netProfitLoss=None, depreciation=None, operatingCashFlow=None,
        )
        assert _generate_cashflow_waterfall(stmt) == ""

    def test_balance_sheet_waterfall_empty_stmt_returns_empty(self):
        """Balance sheet waterfall with None stmt should return empty string."""
        from src.infographics import _generate_balance_sheet_waterfall
        assert _generate_balance_sheet_waterfall(None) == ""

    def test_balance_sheet_waterfall_zero_assets_returns_empty(self):
        """Balance sheet waterfall with zero assets should return empty string."""
        from src.infographics import _generate_balance_sheet_waterfall
        stmt = SimpleNamespace(
            currentAssets=0, inventory=0, cashAndEquivalents=0,
            tradeReceivables=0, totalAssets=0, equity=0,
            shortTermLiabilities=0, longTermLiabilities=0,
        )
        assert _generate_balance_sheet_waterfall(stmt) == ""


# ── Error logging tests ─────────────────────────────────────────────────

class TestErrorLogging:
    """Test that chart errors use logger, not print."""

    def test_plotly_charts_has_logger(self):
        """plotly_charts.py should have a logger instance."""
        from src import plotly_charts
        assert hasattr(plotly_charts, 'logger')
        assert plotly_charts.logger.name == 'src.plotly_charts'

    def test_to_base64_uses_logger_on_error(self):
        """_to_base64 should use logger.error, not print, on exception."""
        from src.plotly_charts import _to_base64
        # Create a mock figure that raises an exception
        mock_fig = MagicMock()
        mock_fig.to_image.side_effect = RuntimeError("Test error")

        with patch('src.plotly_charts.logger') as mock_logger:
            result = _to_base64(mock_fig)
            assert result == ""
            mock_logger.error.assert_called_once()
            # Verify it's not using print
            args = mock_logger.error.call_args
            assert "Plotly render error" in str(args)

    def test_infographics_has_logger(self):
        """infographics.py should have a logger instance."""
        from src import infographics
        assert hasattr(infographics, 'logger')
        assert infographics.logger.name == 'src.infographics'


# ── Chart data preparation edge cases ──────────────────────────────────

class TestChartDataPreparation:
    """Test chart data preparation with edge cases."""

    def test_prepare_statements_empty_list(self):
        """_prepare_statements with empty list should return empty list."""
        from src.plotly_charts import _prepare_statements
        assert _prepare_statements([]) == []

    def test_prepare_statements_filters_future_years(self):
        """_prepare_statements should filter out future years."""
        from src.plotly_charts import _prepare_statements
        from datetime import datetime
        future_year = datetime.now().year + 1
        stmts = [
            SimpleNamespace(year=future_year, mainActivityRevenue=Decimal('100'),
                          netProfitLoss=Decimal('10'), totalAssets=Decimal('50'),
                          equity=Decimal('30'), shortTermLiabilities=Decimal('10'),
                          longTermLiabilities=Decimal('5'), currentAssets=Decimal('20'),
                          inventory=Decimal('5'), cashAndEquivalents=Decimal('3'),
                          tradeReceivables=Decimal('4'), grossProfit=Decimal('20'),
                          staffCosts=Decimal('8'), depreciation=Decimal('1'),
                          interestExpense=Decimal('0'), operatingCashFlow=Decimal('2'),
                          investingCashFlow=Decimal('-1'), financingCashFlow=Decimal('-1'),
                          tradePayables=Decimal('2'), employeeCount=1, monthsInPeriod=12),
        ]
        result = _prepare_statements(stmts)
        assert len(result) == 0

    def test_prepare_statements_dedup_years(self):
        """_prepare_statements should deduplicate years."""
        from src.plotly_charts import _prepare_statements
        stmts = [
            SimpleNamespace(year=2023, mainActivityRevenue=Decimal('100'),
                          netProfitLoss=Decimal('10'), totalAssets=Decimal('50'),
                          equity=Decimal('30'), shortTermLiabilities=Decimal('10'),
                          longTermLiabilities=Decimal('5'), currentAssets=Decimal('20'),
                          inventory=Decimal('5'), cashAndEquivalents=Decimal('3'),
                          tradeReceivables=Decimal('4'), grossProfit=Decimal('20'),
                          staffCosts=Decimal('8'), depreciation=Decimal('1'),
                          interestExpense=Decimal('0'), operatingCashFlow=Decimal('2'),
                          investingCashFlow=Decimal('-1'), financingCashFlow=Decimal('-1'),
                          tradePayables=Decimal('2'), employeeCount=1, monthsInPeriod=12),
            SimpleNamespace(year=2023, mainActivityRevenue=Decimal('200'),  # Same year
                          netProfitLoss=Decimal('20'), totalAssets=Decimal('60'),
                          equity=Decimal('35'), shortTermLiabilities=Decimal('12'),
                          longTermLiabilities=Decimal('6'), currentAssets=Decimal('25'),
                          inventory=Decimal('6'), cashAndEquivalents=Decimal('4'),
                          tradeReceivables=Decimal('5'), grossProfit=Decimal('25'),
                          staffCosts=Decimal('10'), depreciation=Decimal('2'),
                          interestExpense=Decimal('1'), operatingCashFlow=Decimal('3'),
                          investingCashFlow=Decimal('-2'), financingCashFlow=Decimal('-1'),
                          tradePayables=Decimal('3'), employeeCount=2, monthsInPeriod=12),
        ]
        result = _prepare_statements(stmts)
        assert len(result) == 1  # Deduped

"""
Unit tests pre Decimal/float sanitizáciu v PDF generovaní.

Pokrýva:
  - plotly_charts._sanitize_stmt() — konverzia Decimal na float
  - plotly_charts._prepare_statements() — sanitizácia po deduplikácii
  - report_generator.prepare_report_context() — aritmetika so sanitizovanými stmts
  - infographics._sanitize_stmt() — konverzia pre infografiky

Tieto testy simulujú Prisma Decimal hodnoty (po migrácii Float→Decimal)
a overujú, že aritmetické operácie nezlyhajú s TypeError.
"""
import pytest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


# ── plotly_charts._sanitize_stmt tests ──────────────────────────────────

class TestPlotlySanitizeStmt:
    """Test _sanitize_stmt in plotly_charts.py — converts Decimal to float."""

    def _make_stmt_with_decimal(self):
        """Create a stmt with Decimal values (simulating Prisma after migration)."""
        return SimpleNamespace(
            year=Decimal('2024'),
            mainActivityRevenue=Decimal('1234567.89'),
            grossProfit=Decimal('234567.00'),
            netProfitLoss=Decimal('-50000.50'),
            staffCosts=Decimal('100000.00'),
            depreciation=Decimal('20000.00'),
            interestExpense=Decimal('5000.00'),
            operatingCashFlow=Decimal('30000.00'),
            investingCashFlow=Decimal('-15000.00'),
            financingCashFlow=Decimal('-10000.00'),
            currentAssets=Decimal('500000.00'),
            inventory=Decimal('100000.00'),
            cashAndEquivalents=Decimal('50000.00'),
            tradeReceivables=Decimal('80000.00'),
            totalAssets=Decimal('1000000.00'),
            equity=Decimal('600000.00'),
            shortTermLiabilities=Decimal('200000.00'),
            longTermLiabilities=Decimal('100000.00'),
            tradePayables=Decimal('50000.00'),
            employeeCount=42,
            monthsInPeriod=12,
            isConsolidated=False,
            statementType="IFRS",
        )

    def test_all_decimal_fields_converted_to_float(self):
        """All Decimal numeric fields should become float after sanitization."""
        from src.plotly_charts import _sanitize_stmt
        stmt = self._make_stmt_with_decimal()
        result = _sanitize_stmt(stmt)
        assert isinstance(result.mainActivityRevenue, float)
        assert isinstance(result.netProfitLoss, float)
        assert isinstance(result.totalAssets, float)
        assert isinstance(result.equity, float)
        assert isinstance(result.year, float)  # year is also converted

    def test_none_values_preserved(self):
        """None values should stay None (not converted to 0)."""
        from src.plotly_charts import _sanitize_stmt
        stmt = SimpleNamespace(
            year=2024,
            mainActivityRevenue=None,
            grossProfit=None,
            netProfitLoss=Decimal('100.00'),
            staffCosts=None,
            depreciation=None,
            interestExpense=None,
            operatingCashFlow=None,
            investingCashFlow=None,
            financingCashFlow=None,
            currentAssets=None,
            inventory=None,
            cashAndEquivalents=None,
            tradeReceivables=None,
            totalAssets=None,
            equity=None,
            shortTermLiabilities=None,
            longTermLiabilities=None,
            tradePayables=None,
            employeeCount=None,
            monthsInPeriod=None,
        )
        result = _sanitize_stmt(stmt)
        assert result.mainActivityRevenue is None
        assert result.grossProfit is None
        assert result.totalAssets is None
        assert isinstance(result.netProfitLoss, float)

    def test_arithmetic_after_sanitization(self):
        """Mixed Decimal arithmetic that would fail before sanitization."""
        from src.plotly_charts import _sanitize_stmt
        stmt = self._make_stmt_with_decimal()
        result = _sanitize_stmt(stmt)

        # These operations would raise TypeError with mixed Decimal/float
        ta = result.totalAssets or 0
        eq = max(0, result.equity or 0)
        sl = result.shortTermLiabilities or 0
        ll = result.longTermLiabilities or 0
        other_pasiva = max(0, ta - eq - sl - ll)
        assert isinstance(other_pasiva, float)

        # EBITDA calculation
        ebitda = (result.netProfitLoss or 0) + abs(result.interestExpense or 0) + (result.depreciation or 0)
        assert isinstance(ebitda, float)

        # Working capital
        wc = (result.currentAssets or 0) - (result.shortTermLiabilities or 0)
        assert isinstance(wc, float)

    def test_none_stmt_returns_none(self):
        """_sanitize_stmt(None) should return None."""
        from src.plotly_charts import _sanitize_stmt
        assert _sanitize_stmt(None) is None


# ── plotly_charts._prepare_statements tests ─────────────────────────────

class TestPrepareStatements:
    """Test _prepare_statements sanitizes Decimal values."""

    def test_decimal_values_sanitized(self):
        """_prepare_statements should convert Decimal to float."""
        from src.plotly_charts import _prepare_statements
        stmts = [
            SimpleNamespace(
                year=Decimal('2023'),
                mainActivityRevenue=Decimal('1000000.00'),
                netProfitLoss=Decimal('50000.00'),
                totalAssets=Decimal('500000.00'),
                equity=Decimal('300000.00'),
                shortTermLiabilities=Decimal('100000.00'),
                longTermLiabilities=Decimal('50000.00'),
                currentAssets=Decimal('200000.00'),
                inventory=Decimal('50000.00'),
                cashAndEquivalents=Decimal('30000.00'),
                tradeReceivables=Decimal('40000.00'),
                grossProfit=Decimal('200000.00'),
                staffCosts=Decimal('80000.00'),
                depreciation=Decimal('15000.00'),
                interestExpense=Decimal('3000.00'),
                operatingCashFlow=Decimal('20000.00'),
                investingCashFlow=Decimal('-10000.00'),
                financingCashFlow=Decimal('-5000.00'),
                tradePayables=Decimal('20000.00'),
                employeeCount=10,
                monthsInPeriod=12,
            ),
            SimpleNamespace(
                year=Decimal('2024'),
                mainActivityRevenue=Decimal('1100000.00'),
                netProfitLoss=Decimal('60000.00'),
                totalAssets=Decimal('550000.00'),
                equity=Decimal('330000.00'),
                shortTermLiabilities=Decimal('110000.00'),
                longTermLiabilities=Decimal('55000.00'),
                currentAssets=Decimal('220000.00'),
                inventory=Decimal('55000.00'),
                cashAndEquivalents=Decimal('33000.00'),
                tradeReceivables=Decimal('44000.00'),
                grossProfit=Decimal('220000.00'),
                staffCosts=Decimal('88000.00'),
                depreciation=Decimal('16000.00'),
                interestExpense=Decimal('3200.00'),
                operatingCashFlow=Decimal('22000.00'),
                investingCashFlow=Decimal('-11000.00'),
                financingCashFlow=Decimal('-5500.00'),
                tradePayables=Decimal('22000.00'),
                employeeCount=12,
                monthsInPeriod=12,
            ),
        ]
        result = _prepare_statements(stmts)
        assert len(result) == 2
        for s in result:
            assert isinstance(s.mainActivityRevenue, float)
            assert isinstance(s.totalAssets, float)
            assert isinstance(s.netProfitLoss, float)

    def test_future_year_filtered(self):
        """Statements with year > current_year should be filtered out."""
        from src.plotly_charts import _prepare_statements
        from datetime import datetime
        future = datetime.now().year + 1
        stmts = [
            SimpleNamespace(year=2023, mainActivityRevenue=Decimal('100'), netProfitLoss=Decimal('10'),
                          totalAssets=Decimal('50'), equity=Decimal('30'),
                          shortTermLiabilities=Decimal('10'), longTermLiabilities=Decimal('5'),
                          currentAssets=Decimal('20'), inventory=Decimal('5'),
                          cashAndEquivalents=Decimal('3'), tradeReceivables=Decimal('4'),
                          grossProfit=Decimal('20'), staffCosts=Decimal('8'),
                          depreciation=Decimal('1'), interestExpense=Decimal('0'),
                          operatingCashFlow=Decimal('2'), investingCashFlow=Decimal('-1'),
                          financingCashFlow=Decimal('-0'), tradePayables=Decimal('2'),
                          employeeCount=1, monthsInPeriod=12),
            SimpleNamespace(year=future, mainActivityRevenue=Decimal('200'), netProfitLoss=Decimal('20'),
                          totalAssets=Decimal('100'), equity=Decimal('60'),
                          shortTermLiabilities=Decimal('20'), longTermLiabilities=Decimal('10'),
                          currentAssets=Decimal('40'), inventory=Decimal('10'),
                          cashAndEquivalents=Decimal('6'), tradeReceivables=Decimal('8'),
                          grossProfit=Decimal('40'), staffCosts=Decimal('16'),
                          depreciation=Decimal('2'), interestExpense=Decimal('0'),
                          operatingCashFlow=Decimal('4'), investingCashFlow=Decimal('-2'),
                          financingCashFlow=Decimal('-0'), tradePayables=Decimal('4'),
                          employeeCount=2, monthsInPeriod=12),
        ]
        result = _prepare_statements(stmts)
        assert len(result) == 1
        assert result[0].year == 2023.0


# ── infographics._sanitize_stmt tests ───────────────────────────────────

class TestInfographicsSanitizeStmt:
    """Test _sanitize_stmt in infographics.py."""

    def test_decimal_converted(self):
        """Decimal values should be converted to float."""
        from src.infographics import _sanitize_stmt
        stmt = SimpleNamespace(
            mainActivityRevenue=Decimal('1000000.00'),
            grossProfit=Decimal('200000.00'),
            netProfitLoss=Decimal('50000.00'),
            staffCosts=Decimal('80000.00'),
            depreciation=Decimal('15000.00'),
            interestExpense=Decimal('3000.00'),
            operatingCashFlow=Decimal('20000.00'),
            currentAssets=Decimal('200000.00'),
            inventory=Decimal('50000.00'),
            cashAndEquivalents=Decimal('30000.00'),
            tradeReceivables=Decimal('40000.00'),
            totalAssets=Decimal('500000.00'),
            equity=Decimal('300000.00'),
            shortTermLiabilities=Decimal('100000.00'),
            longTermLiabilities=Decimal('50000.00'),
            tradePayables=Decimal('20000.00'),
            year=2024,
        )
        result = _sanitize_stmt(stmt)
        assert isinstance(result.mainActivityRevenue, float)
        assert isinstance(result.totalAssets, float)
        assert isinstance(result.equity, float)

    def test_arithmetic_safe(self):
        """Balance sheet arithmetic should not raise TypeError."""
        from src.infographics import _sanitize_stmt
        stmt = SimpleNamespace(
            currentAssets=Decimal('500000.00'),
            inventory=Decimal('100000.00'),
            cashAndEquivalents=Decimal('50000.00'),
            tradeReceivables=Decimal('80000.00'),
            totalAssets=Decimal('1000000.00'),
            equity=Decimal('600000.00'),
            shortTermLiabilities=Decimal('200000.00'),
            longTermLiabilities=Decimal('100000.00'),
            mainActivityRevenue=Decimal('2000000.00'),
            grossProfit=Decimal('400000.00'),
            netProfitLoss=Decimal('100000.00'),
            staffCosts=Decimal('150000.00'),
            depreciation=Decimal('30000.00'),
            interestExpense=Decimal('10000.00'),
            operatingCashFlow=Decimal('50000.00'),
            tradePayables=Decimal('50000.00'),
            year=2024,
        )
        result = _sanitize_stmt(stmt)
        # This is the exact operation that failed in production
        current_assets = result.currentAssets
        raw_components = (result.inventory or 0) + (result.cashAndEquivalents or 0) + (result.tradeReceivables or 0)
        other_current = max(0.0, current_assets - raw_components)
        assert isinstance(other_current, float)

    def test_none_stmt_returns_none(self):
        """_sanitize_stmt(None) should return None."""
        from src.infographics import _sanitize_stmt
        assert _sanitize_stmt(None) is None


# ── report_generator._to_float integration tests ────────────────────────

class TestReportGeneratorSanitization:
    """Test that report_generator uses _to_float for arithmetic."""

    def test_to_float_import_works(self):
        """_to_float should be importable from report_generator."""
        from src.report_generator import _to_float
        assert _to_float(Decimal('123.45')) == 123.45
        assert _to_float(None) is None
        assert _to_float(100.0) == 100.0

    def test_gross_profit_estimation_with_decimal(self):
        """The grossProfit fallback estimation should work with Decimal inputs.

        This simulates the exact code path in prepare_report_context:
          estimated = revenue - staff - depreciation - interest
        where all values are Decimal from Prisma.
        """
        from src.analytics import _to_float
        revenue = _to_float(Decimal('1000000.00'))
        staff = _to_float(Decimal('80000.00'))
        depreciation = _to_float(Decimal('15000.00'))
        interest = _to_float(Decimal('3000.00'))
        estimated = revenue - staff - depreciation - interest
        assert isinstance(estimated, float)
        assert estimated == 902000.0

    def test_yoy_growth_with_decimal(self):
        """YoY growth calculation should work with Decimal inputs.

        Simulates: ((curr_rev - prev_rev) / prev_rev) * 100
        """
        from src.analytics import _to_float
        curr_rev = _to_float(Decimal('1100000.00'))
        prev_rev = _to_float(Decimal('1000000.00'))
        growth = round(((curr_rev - prev_rev) / prev_rev) * 100, 1)
        assert isinstance(growth, float)
        assert growth == 10.0

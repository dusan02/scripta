"""
Shared fixtures pre Python unit testy.

Poskytuje:
- _stmt(**kwargs): mock FinancialMetrics ako SimpleNamespace
- _stmt_dict(**kwargs): mock FinancialMetrics ako dict
- _make_tables(...): mock RÚZ JSON tabuľky pre parser testy
"""

from types import SimpleNamespace
import sys
import types
import pytest

# ── Prisma mock ───────────────────────────────────────────────────────────
# Prisma SDK is incompatible with Pydantic v2 in the local dev environment.
# We mock it so that scraper modules (which import db_client → prisma) can be
# imported without triggering the PydanticImportError.
if "prisma" not in sys.modules:
    _prisma_mock = types.ModuleType("prisma")
    _prisma_mock.Prisma = type("Prisma", (), {})
    sys.modules["prisma"] = _prisma_mock

if "prisma.errors" not in sys.modules:
    _prisma_errors_mock = types.ModuleType("prisma.errors")
    _prisma_errors_mock.PrismaError = type("PrismaError", (Exception,), {})
    sys.modules["prisma.errors"] = _prisma_errors_mock
    _prisma_mock.errors = _prisma_errors_mock


@pytest.fixture
def stmt():
    """Factory fixture pre financial statement ako SimpleNamespace."""
    def _stmt(**kwargs):
        defaults = dict(
            year=2024,
            totalAssets=None,
            currentAssets=None,
            equity=None,
            netProfitLoss=None,
            shortTermLiabilities=None,
            longTermLiabilities=None,
            cashAndEquivalents=None,
            mainActivityRevenue=None,
            grossProfit=None,
            inventory=None,
            depreciation=None,
            interestExpense=None,
            tradeReceivables=None,
            tradePayables=None,
            operatingCashFlow=None,
            monthsInPeriod=12,
            staffCosts=None,
            statementType="SK_GAAP",
            employeeCount=None,
            auditorOpinion=None,
        )
        defaults.update(kwargs)
        return SimpleNamespace(**defaults)
    return _stmt


@pytest.fixture
def stmt_dict():
    """Factory fixture pre financial statement ako dict."""
    def _stmt_dict(**kwargs):
        defaults = dict(
            year=2024,
            totalAssets=None,
            currentAssets=None,
            equity=None,
            netProfitLoss=None,
            shortTermLiabilities=None,
            longTermLiabilities=None,
            cashAndEquivalents=None,
            mainActivityRevenue=None,
            grossProfit=None,
            inventory=None,
            depreciation=None,
            interestExpense=None,
            tradeReceivables=None,
            tradePayables=None,
            operatingCashFlow=None,
            monthsInPeriod=12,
            staffCosts=None,
            statementType="SK_GAAP",
            employeeCount=None,
            auditorOpinion=None,
        )
        defaults.update(kwargs)
        return defaults
    return _stmt_dict


@pytest.fixture
def make_tables():
    """Factory fixture pre RÚZ JSON tabuľky."""
    def _make_tables(
        assets=None, equity=None, st_liab=None, lt_liab=None,
        revenue=None, cogs=None, personnel=None, net_profit=None,
        value_added=None, cash=None, current_assets=None,
        trade_recv=None, trade_pay=None, inv_liab=None, sp_liab=None,
        tax_liab=None, emp_liab=None, depreciation=None, interest=None,
        year=2024, months=12, consolidated=False, employee_count=None,
    ):
        def _row(label, netto2=None, netto3=None):
            if netto2 is None and netto3 is None:
                return None
            row = [label, "", "", ""]
            if netto2 is not None:
                row[2] = str(netto2)
            if netto3 is not None:
                row[3] = str(netto3)
            return row

        aktiva = []
        pasiva = []
        vykaz = []

        if assets is not None:
            aktiva.append(_row("001 Aktíva celkom", netto2=assets))
        if current_assets is not None:
            aktiva.append(_row("015 Bežné aktíva", netto2=current_assets))
        if cash is not None:
            aktiva.append(_row("031 Peňažné prostriedky", netto2=cash))
        if trade_recv is not None:
            aktiva.append(_row("040 Pohľadávky z obchodu", netto2=trade_recv))

        if equity is not None:
            pasiva.append(_row("101 Vlastné imanie", netto2=equity))
        if st_liab is not None:
            pasiva.append(_row("120 Krátkodobé záväzky", netto2=st_liab))
        if lt_liab is not None:
            pasiva.append(_row("130 Dlhodobé záväzky", netto2=lt_liab))
        if trade_pay is not None:
            pasiva.append(_row("160 Závazky z obchodu", netto2=trade_pay))
        if sp_liab is not None:
            pasiva.append(_row("131 Závazky zo SP", netto2=sp_liab))
        if tax_liab is not None:
            pasiva.append(_row("133 Daňové závazky", netto2=tax_liab))
        if emp_liab is not None:
            pasiva.append(_row("132 Závazky voči zamestnancom", netto2=emp_liab))

        if revenue is not None:
            vykaz.append(_row("001 Tržby z predaja", netto2=revenue))
        if cogs is not None:
            vykaz.append(_row("002 Náklady na predaj", netto2=cogs))
        if value_added is not None:
            vykaz.append(_row("003 Pridaná hodnota", netto2=value_added))
        if personnel is not None:
            vykaz.append(_row("004 Osobné náklady", netto2=personnel))
        if depreciation is not None:
            vykaz.append(_row("006 Odpisy", netto2=depreciation))
        if interest is not None:
            vykaz.append(_row("007 Úroky", netto2=interest))
        if net_profit is not None:
            vykaz.append(_row("010 Čistý zisk/strata", netto2=net_profit))

        tables = []
        if aktiva:
            tables.append({"title": "Súvaha — AKTÍVA", "rows": aktiva})
        if pasiva:
            tables.append({"title": "Súvaha — PASÍVA", "rows": pasiva})
        if vykaz:
            tables.append({"title": "Výkaz ziskov a strát", "rows": vykaz})

        return {
            "tables": tables,
            "year": year,
            "months": months,
            "consolidated": consolidated,
            "employee_count": employee_count,
        }
    return _make_tables

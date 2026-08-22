import json as _json
import logging
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Dict, Any, Optional, Union

logger = logging.getLogger(__name__)


def _get(obj: Any, attr: str, default: Any = None) -> Any:
    """Safely get an attribute from either a dict or an object."""
    if isinstance(obj, dict):
        return obj.get(attr, default)
    return getattr(obj, attr, default)


def _to_float(val: Any) -> Optional[float]:
    """Convert a value to float, handling Decimal (from DB after Float→Decimal migration).
    Returns None if val is None, raises ValueError for non-numeric types."""
    if val is None:
        return None
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    return float(val)


def _sanitize_stmt_numeric(stmt: Any) -> Any:
    """Sanitize a financial statement: convert all Decimal numeric fields to float.
    Handles both dict and object (Prisma model) inputs.
    Returns a dict with float values for all numeric fields."""
    _NUMERIC_FIELDS = (
        'mainActivityRevenue', 'totalAssets', 'currentAssets', 'equity',
        'netProfitLoss', 'shortTermLiabilities', 'longTermLiabilities',
        'operatingCashFlow', 'grossProfit', 'depreciation', 'inventory',
        'tradeReceivables', 'tradePayables', 'staffCosts', 'interestExpense',
        'incomeTax', 'investingCashFlow', 'financingCashFlow',
        'cashAndEquivalents', 'socialInsuranceLiabilities', 'taxLiabilities',
        'employeeLiabilities', 'monthsInPeriod', 'year',
        # Extended fields (template 699 — asset/equity composition, income detail)
        'nonCurrentAssets', 'intangibleAssets', 'tangibleAssets',
        'ltFinancialAssets', 'ltReceivables', 'stFinancialAssets',
        'deferredAssets', 'shareCapital', 'sharePremium',
        'otherCapitalFunds', 'statutoryReserveFunds', 'otherProfitFunds',
        'retainedEarnings', 'retainedProfit', 'accumulatedLoss',
        'currentYearProfit', 'ltReserves', 'stReserves',
        'stBankLoans', 'stFinancialAssistance',
        'operatingCosts', 'materialConsumption', 'servicesCosts',
        'wageCosts', 'taxesFees', 'financialResult',
        'profitBeforeTax', 'profitTransfer',
    )
    result = {}
    for field_name in _NUMERIC_FIELDS:
        val = _get(stmt, field_name, None)
        if val is not None:
            if field_name == 'year':
                result[field_name] = int(val)
            else:
                result[field_name] = _to_float(val)
        else:
            result[field_name] = None
    # Copy any other fields that might exist
    if isinstance(stmt, dict):
        for k, v in stmt.items():
            if k not in result:
                result[k] = v
    else:
        for attr in dir(stmt):
            if not attr.startswith('_') and attr not in result:
                try:
                    result[attr] = getattr(stmt, attr)
                except Exception:
                    pass
    return result


# ── Cash Flow sanitizácia ─────────────────────────────────────────────────────
# Reálna firma nemá presne 0 prevádzkový cash flow. Hodnota 0 je artefakt
# starého LLM promptu, ktorý hovoril "doplň nulu" pre chýbajúce CF dáta.
# Táto funkita konvertuje 0 → None na jednom mieste pre všetky volajúce.

_CF_FIELDS = ("operatingCashFlow", "investingCashFlow", "financingCashFlow")


def sanitize_cash_flow_fields(stmt: Union[Dict[str, Any], Any]) -> None:
    """Konvertuje 0 → None pre cash flow polia. Funguje na dict aj Prisma objektoch.
    Volá sa in-place (modifikuje vstup).

    Bonus: sanity check pre investičný a finančný CF — ak abs(CF) > totalAssets,
    ide o podozrivú LLM extrakciu (napr. 450k investičný CF pri 220k aktívach).
    V takom prípade nastavíme na None."""
    for cf_field in _CF_FIELDS:
        if isinstance(stmt, dict):
            if stmt.get(cf_field) == 0:
                stmt[cf_field] = None
        else:
            if getattr(stmt, cf_field, None) == 0:
                setattr(stmt, cf_field, None)
    # Sanity check: investičný/finančný CF > totalAssets je podozrivý
    _total_assets = _get(stmt, 'totalAssets', None)
    if _total_assets and _total_assets > 0:
        for cf_field in ('investingCashFlow', 'financingCashFlow'):
            _cf_val = _get(stmt, cf_field, None)
            if _cf_val is not None and abs(float(_cf_val)) > float(_total_assets):
                # Pridaj len log, ale neprepisuj — môže to byť legitímne (predaj majetku)
                # Namiesto toho prepíšeme len extrémne prípady (> 1.5× totalAssets)
                if abs(float(_cf_val)) > float(_total_assets) * 1.5:
                    if isinstance(stmt, dict):
                        stmt[cf_field] = None
                    else:
                        setattr(stmt, cf_field, None)


def estimate_missing_cash_flow(stmts: list) -> bool:
    """Nepriamy odhad operatingCashFlow pre výkazy, kde chýba (zjednodušené výkazy z RÚZ).
    Operating CF ≈ Net Profit + Depreciation - ΔInventory - ΔTrade Receivables + ΔTrade Payables.
    Funguje na dict aj Prisma objektoch. Vracia True ak aspoň jednu hodnotu odhadol."""
    if not stmts:
        return False
    estimated = False
    by_year = {}
    for s in stmts:
        year = _get(s, 'year')
        if year is not None:
            by_year[year] = s
    for s in stmts:
        if _get(s, 'operatingCashFlow', None) is not None:
            continue
        year = _get(s, 'year')
        if year is None:
            continue
        prev = by_year.get(year - 1)
        if not prev:
            continue
        net_profit = _get(s, 'netProfitLoss', None)
        depreciation = _get(s, 'depreciation', None)
        inv = _get(s, 'inventory', None)
        inv_prev = _get(prev, 'inventory', None)
        recv = _get(s, 'tradeReceivables', None)
        recv_prev = _get(prev, 'tradeReceivables', None)
        pay = _get(s, 'tradePayables', None)
        pay_prev = _get(prev, 'tradePayables', None)
        if net_profit is None or depreciation is None:
            continue
        if inv is not None and inv_prev is not None and recv is not None and recv_prev is not None and pay is not None and pay_prev is not None:
            approx_cf = float(net_profit) + float(depreciation) - (float(inv) - float(inv_prev)) - (float(recv) - float(recv_prev)) + (float(pay) - float(pay_prev))
            if isinstance(s, dict):
                s['operatingCashFlow'] = approx_cf
            else:
                setattr(s, 'operatingCashFlow', approx_cf)
            estimated = True
    return estimated


# ── Altman Z-Score (modifikovaný pre ne-výrobné a súkromné firmy) ──────────────
# Model: Altman Z'' (1995) pre private / non-manufacturing
# Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
# X1 = Pracovný kapitál / Celkové aktíva
# X2 = Zadržané zisky / Celkové aktíva  (approximácia: Vlastné imanie / Celkové aktíva)
# X3 = EBIT / Celkové aktíva            (approximácia: Čistý zisk / Celkové aktíva)
# X4 = Účtovná hodnota vlastného imania / Celkové záväzky
#
# Interpretácia: Z'' > 2.6 = Bezpečná zóna | 1.1–2.6 = Šedá zóna | < 1.1 = Núdzová zóna

# ── Forenzný indikátor (Anomália v štruktúre vedenia) ────────────────────────
def compute_white_horse_indicator(statements: list) -> dict:
    """
    Vyhodnotí riziko anomálie v štruktúre vedenia (spoločnosti s redukovanou substanciou)
    na základe histórie metrík:
    osobné náklady, pohľadávky, záväzky vs tržby a aktíva.
    Očakáva zoznam výkazov utriedený od najstaršieho po najnovší.
    """
    score_penalty = 0
    flags = []

    if not statements:
        return {"penalty": 0, "flags": []}

    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    statements = [_sanitize_stmt_numeric(s) for s in statements]

    latest_stmt = statements[-1]
    revenue = _get(latest_stmt, 'mainActivityRevenue', 0) or 0
    assets = _get(latest_stmt, 'totalAssets', 0) or 0
    receivables = _get(latest_stmt, 'tradeReceivables', 0) or 0
    
    # Znak schránky: veľké tržby (> 100k), ale dlhodobo úplne 0 mzdových nákladov
    # Skontrolujeme, či je to pravda za posledné 3 dostupné roky (alebo všetky ak ich je menej)
    years_to_check = min(3, len(statements))
    recent_stmts = statements[-years_to_check:]
    
    consistently_zero_staff = True
    has_ifrs = False
    
    for stmt in recent_stmts:
        staff = _get(stmt, 'staffCosts', 0) or 0
        statement_type = str(_get(stmt, 'statementType', '') or '').upper()
        
        if 'IFRS' in statement_type:
            has_ifrs = True
            
        if staff > 0:
            consistently_zero_staff = False
            
    # Pridávame guard "assets > 0", aby sme vylúčili prípady, kedy extrakcia kompletne zlyhala
    # Taktiež preskakujeme IFRS firmy, pretože tam sú osobné náklady často v poznámkach, ktoré orežeme
    if revenue > 100000 and consistently_zero_staff and assets > 0 and not has_ifrs:
        score_penalty += 15
        rev_formatted = f"{revenue:,.0f}".replace(",", " ")
        flags.append(f"Vysoké tržby ({rev_formatted} €), ale dlhodobo NULOVÉ mzdové náklady (silný znak spoločnosti s redukovanou substanciou)")
        
    # Znak redukovanej substancie: Pohľadávky tvoria viac ako 90% celkových aktív
    if assets > 0 and (receivables / assets) > 0.9:
        score_penalty += 10
        flags.append(f"Pohľadávky z OS tvoria >90% majetku (extrémne riziko nevykonateľných pohľadávok)")
        
    return {
        "penalty": score_penalty,
        "flags": flags
    }


# ── Startup / Pre-revenue detekcia ────────────────────────────────────────────
def detect_startup_profile(statements: list) -> dict:
    """
    Detekuje 'startup' profil — firma s nulovými/nízkymi tržbami ale s významným vlastným imaním.
    Pre také firmy Altman Z-Score nie je spoľahlivý (X3=EBIT/Assets je záporné kvôli investíciám).

    Kritériá:
      - revenue <= 100_000 (alebo None)
      - equity >= 500_000
      - total_assets > 0
      - len(statements) <= 2 (mladá firma — max 2 výkazy)
    """
    if not statements:
        return {"is_startup": False}

    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    statements = [_sanitize_stmt_numeric(s) for s in statements]

    latest = statements[-1]
    revenue = _get(latest, 'mainActivityRevenue', None)
    equity = _get(latest, 'equity', None)
    assets = _get(latest, 'totalAssets', None)
    n_stmts = len(statements)

    if assets is None or assets <= 0:
        return {"is_startup": False}
    if equity is None or equity < 500_000:
        return {"is_startup": False}
    if revenue is not None and revenue > 100_000:
        return {"is_startup": False}
    if n_stmts > 2:
        return {"is_startup": False}

    return {
        "is_startup": True,
        "revenue": revenue,
        "equity": equity,
        "assets": assets,
        "n_years": n_stmts,
    }


def _is_financial_institution(stmt: Any) -> bool:
    """
    Detekuje finančnú inštitúciu (poisťovňu/banku) zo štruktúry súvahy —
    bez potreby NACE kódu.

    Signatúra IFRS súvahy finančnej inštitúcie:
    - currentAssets chýba (None) alebo je zanedbateľné (< 1% aktív)
      — IFRS súvaha nemá štandardnú klasifikáciu obežného majetku
    - shortTermLiabilities je takmer 0 (< 5% aktív)
      — technické rezervy/pojistné záväzky nie sú klasifikované ako krátkodobé
    - Skutočné záväzky (totalAssets - equity) sú veľké (> 50% aktív)
      — poisťovne držia obrovské technické rezervy
    - equity je kladné (solventná inštitúcia)
    - totalAssets > 10M (významná inštitúcia, nie malá firma s chýbajúcimi dátami)

    Výnimka: banky a poisťovne majú často výrazné cashAndEquivalents
    (hotovostné rezervy, pohľadávky), ktoré sa mapujú do currentAssets.
    Preto ak shortTermLiabilities ≈ 0 a leverage > 50%, považujeme to za
    finančnú inštitúciu aj napriek vyššiemu currentAssets.
    Bežné nefinančné firmy vždy majú nejaké krátkodobé záväzky (dodávatelia,
    accrued expenses, dane), takže shortTermLiabilities = 0 pri veľkej
    firme je silný signál IFRS finančnej inštitúcie.
    """
    stmt = _sanitize_stmt_numeric(stmt)
    total_assets = _get(stmt, 'totalAssets')
    current_assets = _get(stmt, 'currentAssets')
    equity = _get(stmt, 'equity')
    short_liab = _get(stmt, 'shortTermLiabilities')

    if total_assets is None or total_assets <= 10_000_000:
        return False
    if equity is None or equity <= 0:
        return False

    # Skutočné záväzky (totalAssets - equity)
    total_liabilities = total_assets - equity
    if total_liabilities <= 0:
        return False

    # Výnimka pre banky a poisťovne: shortTermLiabilities ≈ 0 a leverage > 50%
    # Bežné firmy majú vždy krátkodobé záväzky (dodávatelia, dane, accruals).
    # Ak sú ≈ 0 pri veľkej firme s vysokým leverage, ide o IFRS finančnú
    # inštitúciu kde záväzky (vklady, technické rezervy) nie sú klasifikované
    # ako krátkodobé. currentAssets môže byť nenulové (hotovosť, pohľadávky).
    if (short_liab is not None and short_liab <= total_assets * 0.01
            and total_liabilities > total_assets * 0.50):
        return True

    # currentAssets chýba alebo je zanedbateľné
    if current_assets is not None and current_assets > total_assets * 0.01:
        return False

    # shortTermLiabilities je takmer 0 (technické rezervy nie sú krátkodobé)
    if short_liab is not None and short_liab > total_assets * 0.05:
        return False

    return total_liabilities > total_assets * 0.5


def compute_altman_z_score(stmt: Any, force_financial_inst: bool = False) -> Dict[str, Any]:
    """
    Vypočíta Altman Z''-score pre jedno účtovné obdobie.
    Vráti skóre, zónu a komponentné hodnoty.

    Pre finančné inštitúcie (poisťovne, banky) vráti N/A — Altman Z''
    nie je aplikovateľný, pretože IFRS súvahy týchto inštitúcií nemajú
    štandardnú klasifikáciu obežného majetku a krátkodobých záväzkov.

    force_financial_inst: ak True, preskočí heuristiku a vráti N/A priamo
    (používa sa keď najnovší rok bol detekovaný ako finančná inštitúcia
    a chceme aplikovať výnimku na všetky historické roky).
    """
    try:
        # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
        stmt = _sanitize_stmt_numeric(stmt)

        # Sektorová detekcia: finančné inštitúcie
        if force_financial_inst or _is_financial_institution(stmt):
            return {
                "z_score": None,
                "zone": "N/A",
                "zone_label": "N/A — finančná inštitúcia",
                "reason": "Altman Z'' nie je aplikovateľný pre finančné inštitúcie (poisťovne/banky) — IFRS súvaha bez štandardnej klasifikácie obežného majetku",
            }

        total_assets = _get(stmt, 'totalAssets')
        current_assets = _get(stmt, 'currentAssets')
        equity = _get(stmt, 'equity')
        retained_earnings = _get(stmt, 'retainedEarnings')
        net_profit = _get(stmt, 'netProfitLoss')
        interest_expense = _get(stmt, 'interestExpense')
        short_liabilities = _get(stmt, 'shortTermLiabilities')
        long_liabilities = _get(stmt, 'longTermLiabilities')

        if total_assets is None or total_assets <= 0 or net_profit is None or equity is None or short_liabilities is None:
            return {"z_score": None, "zone": "N/A", "reason": "Nedostatok dát pre výpočet"}

        # Distinguish missing data (None) from legitimately zero.
        # If currentAssets is None, use fallback estimate (60% of total assets).
        # If currentAssets is 0 (legitimate), use 0 — not the fallback.
        has_current_assets = current_assets is not None
        current_assets = current_assets if has_current_assets else 0
        long_liabilities = long_liabilities if long_liabilities is not None else 0

        # Working capital = Obežný majetok - Krátkodobé záväzky
        # Ak máme currentAssets z DB, použijeme ho. Inak fallback na hrubý odhad.
        if has_current_assets:
            working_capital = current_assets - short_liabilities
        else:
            working_capital = (total_assets * 0.6) - short_liabilities

        # Presné total_liabilities: shortTerm + longTerm ak máme oba, inak bilančná rovnica
        raw_liabilities = short_liabilities + long_liabilities
        if raw_liabilities < 0:
            total_liabilities = max(total_assets - equity, 1)  # fallback
        elif short_liabilities > 0 or long_liabilities > 0:
            total_liabilities = max(raw_liabilities, 1)
        else:
            total_liabilities = max(total_assets - equity, 1)  # fallback bilančná rovnica

        # EBIT approx: net profit + interest expense (absolute value, since it may be stored negative)
        ebit = net_profit + abs(interest_expense) if interest_expense is not None else net_profit

        x1 = working_capital / total_assets
        # X2: Retained earnings / total assets (original Altman 2005).
        # DB has retainedEarnings field — use it when available.
        # Fallback to equity/TA only when retainedEarnings is None (legacy data).
        if retained_earnings is not None:
            x2 = retained_earnings / total_assets
        else:
            x2 = equity / total_assets               # fallback: equity as proxy
        x3 = ebit / total_assets                  # EBIT approx (not just net profit)
        # Cap X4 at 10.0 — prevents Z'' explosion when total_liabilities ≈ 0
        # (e.g. new company with equity ≈ totalAssets, fallback total_liabilities=1).
        # X4=10 means equity is 10× total liabilities — extremely strong but sane.
        x4 = min(equity / total_liabilities, 10.0)

        z = round(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, 2)

        if z > 2.6:
            zone = "SAFE"
            zone_label = "Bezpečná zóna"
        elif z >= 1.1:
            zone = "GREY"
            zone_label = "Šedá zóna"
        else:
            zone = "DISTRESS"
            zone_label = "Núdzová zóna — spoločnosť je pod finančným stresom"

        return {
            "z_score": z,
            "zone": zone,
            "zone_label": zone_label,
            "components": {
                "x1_working_capital_ratio": round(x1, 4),
                "x2_retained_earnings_ratio": round(x2, 4),
                "x3_ebit_ratio": round(x3, 4),
                "x4_equity_to_debt": round(x4, 4),
            }
        }
    except Exception as e:
        return {"z_score": None, "zone": "N/A", "reason": str(e)}


def _safe_div(numerator: float, denominator: float, decimals: int = 2) -> Optional[float]:
    """Bezpečné delenie — vráti None ak je menovateľ 0 alebo záporný."""
    if denominator > 0:
        return round(numerator / denominator, decimals)
    return None


def _safe_pct(numerator: float, denominator: float, decimals: int = 2) -> Optional[float]:
    """Bezpečné percento — vráti None ak je menovateľ 0."""
    if denominator > 0:
        return round((numerator / denominator) * 100, decimals)
    return None


def compute_financial_ratios(stmt: Any) -> Dict[str, Any]:
    """
    Vypočíta kľúčové finančné ukazovatele pre jedno obdobie.
    """
    try:
        # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
        stmt = _sanitize_stmt_numeric(stmt)
        total_assets = _get(stmt, 'totalAssets', 0) or 0
        current_assets = _get(stmt, 'currentAssets', 0) or 0
        equity = _get(stmt, 'equity', 0) or 0
        net_profit = _get(stmt, 'netProfitLoss', 0) or 0
        short_liabilities = _get(stmt, 'shortTermLiabilities', 0) or 0
        long_liabilities = _get(stmt, 'longTermLiabilities', 0) or 0
        cash = _get(stmt, 'cashAndEquivalents', 0) or 0
        revenue = _get(stmt, 'mainActivityRevenue', 0) or 0
        sanitize_cash_flow_fields(stmt)
        op_cashflow_raw = _get(stmt, 'operatingCashFlow', None)
        op_cashflow = op_cashflow_raw if op_cashflow_raw is not None else 0
        # Anualizácia tržieb pre DSO/DPO pri skrátených obdobiach (napr. 3-mes. závierka)
        months_in_period = _get(stmt, 'monthsInPeriod', 12) or 12
        revenue = float(revenue)
        annualized_revenue = revenue * (12 / months_in_period) if months_in_period > 0 else revenue
        gross_profit = _get(stmt, 'grossProfit', 0) or 0
        inventory = _get(stmt, 'inventory', 0) or 0
        depreciation = _get(stmt, 'depreciation', 0) or 0
        interest = _get(stmt, 'interestExpense', 0) or 0
        trade_receivables = _get(stmt, 'tradeReceivables', 0) or 0
        trade_payables = _get(stmt, 'tradePayables', 0) or 0

        # ── Extended fields (template 699 — asset/equity composition) ──
        non_current_assets = _get(stmt, 'nonCurrentAssets', None)
        intangible_assets = _get(stmt, 'intangibleAssets', None)
        tangible_assets = _get(stmt, 'tangibleAssets', None)
        share_capital = _get(stmt, 'shareCapital', None)
        retained_earnings = _get(stmt, 'retainedEarnings', None)
        current_year_profit = _get(stmt, 'currentYearProfit', None)
        lt_reserves = _get(stmt, 'ltReserves', None)
        st_reserves = _get(stmt, 'stReserves', None)
        operating_costs = _get(stmt, 'operatingCosts', None)  # Náklady na hosp. činnosť spolu (r.10)
        material_consumption = _get(stmt, 'materialConsumption', None)  # Spotreba materiálu (r.12)
        profit_before_tax = _get(stmt, 'profitBeforeTax', None)  # Zisk pred zdanenim (r.56)
        financial_result = _get(stmt, 'financialResult', None)  # Výsledok z fin. činnosti (r.55)
        income_tax = _get(stmt, 'incomeTax', None)

        # Total liabilities: shortTerm + longTerm ak dostupné, inak bilančná rovnica
        computed_liabilities = total_assets - equity
        if short_liabilities > 0 or long_liabilities > 0 or computed_liabilities < 0:
            total_liabilities = max(short_liabilities + long_liabilities, 1)
        else:
            total_liabilities = max(computed_liabilities, 1)

        # ── Likvidita ──
        ratios = {
            "current_ratio": _safe_div(current_assets, short_liabilities),
            "cash_ratio": _safe_div(cash, short_liabilities),
            "quick_ratio": _safe_div(current_assets - inventory, short_liabilities),
            "working_capital": round(current_assets - short_liabilities, 0) if (current_assets > 0 or short_liabilities > 0) else None,
        }

        # ── Zadlženosť ──
        ratios["debt_to_equity"] = _safe_div(total_liabilities, equity)
        # Záporné vlastné imanie (predĺženie) → D/E je nedefinované (None). Explicitný flag,
        # aby najhorší prípad nezostal skrytý v tabuľke ukazovateľov.
        ratios["negative_equity"] = equity < 0
        # Equity Ratio (samofinancovací pomer) — % aktív financovaných vlastným kapitálom.
        # Na rozdiel od D/E je zrozumiteľnejší pre nefinanciera.
        # Sanitizácia: ak equity > total_assets (účtovne nemožné — súvaha sa nevyrovnáva),
        # equity ratio je nonsensical. Typicky ide o chybu v RÚZ dátach (nekonzistentné
        # jednotky alebo chýbajúce položky aktív). Namiesto 3477% zobrazujeme None.
        # Tiež ak aktíva ≠ pasíva (equity + liabilities) o viac ako 5%, súvaha je nevyrovnaná
        # a ratio výpočty sú nespoľahlivé.
        _balance_diff = abs(total_assets - (equity + total_liabilities)) if total_assets > 0 else 0
        _balance_imbalance_pct = _balance_diff / total_assets if total_assets > 0 else 0
        if total_assets > 0 and equity > total_assets:
            ratios["equity_ratio_pct"] = None
            ratios["balance_sheet_anomaly"] = True
        elif _balance_imbalance_pct > 0.05:
            ratios["equity_ratio_pct"] = None
            ratios["balance_sheet_anomaly"] = True
        else:
            ratios["equity_ratio_pct"] = _safe_pct(equity, total_assets) if total_assets > 0 else None
            ratios["balance_sheet_anomaly"] = False

        # ── Rentabilita ──
        ratios["net_profit_margin_pct"] = _safe_pct(net_profit, revenue)
        # Hrubá marža: zobraz aj zápornú (strata na úrovni hrubej marže), None len ak grossProfit chýba.
        gross_profit_raw = _get(stmt, 'grossProfit', None)
        ratios["gross_profit_margin_pct"] = _safe_pct(gross_profit_raw, revenue) if gross_profit_raw is not None else None
        ratios["roa_pct"] = _safe_pct(net_profit, total_assets)
        if equity > 0:
            ratios["roe_pct"] = round((net_profit / equity) * 100, 2)
        else:
            ratios["roe_pct"] = None

        # ── EBIT & EBITDA ──
        # EBIT = zisk_pred_zdanenim + |úroky| (ak máme profit_before_tax z RUZ)
        # Fallback: net_profit + |úroky| (ak profit_before_tax chýba)
        ebit = None
        if profit_before_tax is not None:
            ebit = profit_before_tax + abs(interest)
        elif net_profit is not None:
            ebit = net_profit + abs(interest) + (_get(stmt, 'incomeTax', 0) or 0)
        ratios["ebit"] = round(ebit, 0) if ebit is not None else None

        # EBITDA = net_profit + tax + |interest| + depreciation
        # Daň z príjmov sa musí prirátať (EBITDA je pred zdanením).
        # Náklady na úroky (interest) môžu byť v DB uložené ako záporné — prirátavame absolútnu hodnotu.
        # Bug fix: ak netProfitLoss chýba (None), EBITDA nie je 0 — je neznáma (None).
        # Bez tejto ochrany by EBITDA = 0+0+0+0 = 0, čo je mätúce pre firmy s tržbami.
        income_tax = _get(stmt, 'incomeTax', 0) or 0
        _net_profit_raw = _get(stmt, 'netProfitLoss', None)
        if _net_profit_raw is not None:
            ratios["ebitda"] = round(net_profit + income_tax + abs(interest) + depreciation, 0)
        else:
            ratios["ebitda"] = None
        if ratios["ebitda"] is not None and revenue > 0:
            ratios["ebitda_margin_pct"] = round((ratios["ebitda"] / revenue) * 100, 2)
        else:
            ratios["ebitda_margin_pct"] = None

        # ── Interest Coverage Ratio (Krytie úrokov) ──
        # EBIT / |úroky|. Kritický ukazovateľ pre bankrot-predikciu.
        # Ak úroky = 0 → firma nemá externé financovanie → None (nie 0, nie infinity).
        if ebit is not None and abs(interest) > 0:
            ratios["interest_coverage"] = round(ebit / abs(interest), 2)
        else:
            ratios["interest_coverage"] = None

        # ── Cash Flow divergencia ──
        # Ak je operatingCashFlow None (nedostupné v RÚZ), vrátiť None — nie 0.0
        ratios["cashflow_to_profit"] = _safe_div(op_cashflow, abs(net_profit)) if (net_profit != 0 and op_cashflow_raw is not None) else None

        # ── Dni obratu ── (anualizované tržby pre korektnosť pri skrátených obdobiach)
        ratios["dso_days"] = round((trade_receivables / annualized_revenue) * 365, 0) if annualized_revenue > 0 and trade_receivables > 0 else None
        ratios["dpo_days"] = round((trade_payables / annualized_revenue) * 365, 0) if annualized_revenue > 0 and trade_payables > 0 else None

        # ── DIO (Days Inventory Outstanding) ──
        # (Zásoby / COGS) × 365. Pre IT/služobné firmy s COGS ≈ 0 → None (nie delenie nulou).
        # COGS proxy: material_consumption (r.12 = spotreba materiálu) — nie operating_costs (r.10),
        # ktorý zahŕňa aj mzdy, odpisy a služby, čo by umelo znížilo DIO.
        cogs_proxy = None
        if material_consumption is not None and material_consumption > 0:
            cogs_proxy = material_consumption
        # Anualizácia COGS pre skrátené obdobia
        if cogs_proxy is not None and months_in_period > 0 and months_in_period != 12:
            cogs_proxy = cogs_proxy * (12 / months_in_period)
        if cogs_proxy is not None and cogs_proxy > 0 and inventory is not None and inventory > 0:
            _dio = round((inventory / cogs_proxy) * 365, 0)
            # Sanity clamp: DIO > 730 dní (2 roky zásob) je ekonomicky nemožné —
            # takmer isto chyba v zdrojových dátach (napr. COGS v tisícoch EUR).
            if _dio > 730:
                logger.warning(
                    f"DIO {_dio} dní je nepravdepodobné (inventory={inventory}, cogs_proxy={cogs_proxy}) — nastavujem None"
                )
                ratios["dio_days"] = None
            else:
                ratios["dio_days"] = _dio
        elif inventory is not None and inventory == 0:
            ratios["dio_days"] = 0  # Žiadne zásoby → 0 dní
        else:
            ratios["dio_days"] = None

        # ── Cash Conversion Cycle (CCC) ──
        # CCC = DSO + DIO − DPO. Kompletný cyklus hotovosti.
        # Ak je hociktorý komponent None, CCC je None (nemožno spoľahlivo vypočítať).
        dso = ratios.get("dso_days")
        dio = ratios.get("dio_days")
        dpo = ratios.get("dpo_days")
        if dso is not None and dio is not None and dpo is not None:
            _ccc = round(dso + dio - dpo, 0)
            # Sanity clamp: |CCC| > 1095 dní (3 roky) je nezmysel — chyba vstupných dát
            if abs(_ccc) > 1095:
                logger.warning(
                    f"CCC {_ccc} dní je nepravdepodobné (dso={dso}, dio={dio}, dpo={dpo}) — nastavujem None"
                )
                ratios["ccc_days"] = None
            else:
                ratios["ccc_days"] = _ccc
        else:
            ratios["ccc_days"] = None

        # ── Asset Turnover (Obrat aktív) ──
        # Tržby / Celkové aktíva. Efektivita využitia majetku.
        ratios["asset_turnover"] = _safe_div(annualized_revenue, total_assets)

        # ── Asset Structure ──
        # Podiel nehmotného a hmotného majetku na celkových aktívach.
        if intangible_assets is not None and total_assets > 0:
            ratios["intangible_asset_ratio_pct"] = round((intangible_assets / total_assets) * 100, 2)
        else:
            ratios["intangible_asset_ratio_pct"] = None
        if tangible_assets is not None and total_assets > 0:
            ratios["tangible_asset_ratio_pct"] = round((tangible_assets / total_assets) * 100, 2)
        else:
            ratios["tangible_asset_ratio_pct"] = None

        # ── Equity Composition ──
        # Nerozdelený zisk / vlastné imanie — ukazuje, či firma reinvestuje alebo vypláca.
        # Vysoký podiel = organická tvorba hodnôt; nízky = nafúknutý základný kapitál bez reinvestície.
        if retained_earnings is not None and equity > 0:
            ratios["retained_earnings_ratio_pct"] = round((retained_earnings / equity) * 100, 2)
        else:
            ratios["retained_earnings_ratio_pct"] = None
        # Základné imanie / vlastné imanie — ak je blízko 100%, firma nereinwestuje zisk.
        if share_capital is not None and equity > 0:
            ratios["share_capital_ratio_pct"] = round((share_capital / equity) * 100, 2)
        else:
            ratios["share_capital_ratio_pct"] = None

        # ── Reserves Ratio ──
        # (LT + ST rezervy) / celkové záväzky. Ukazuje, ako veľmi sa firma chráni pred rizikami.
        total_reserves = (lt_reserves or 0) + (st_reserves or 0)
        if total_reserves > 0 and total_liabilities > 0:
            ratios["reserves_ratio_pct"] = round((total_reserves / total_liabilities) * 100, 2)
        else:
            ratios["reserves_ratio_pct"] = None

        # ── Effective Tax Rate ──
        # Daň / zisk pred zdanením. Odchýlka od sadzby (15/21%) signalizuje daňové optimalizácie.
        if income_tax is not None and profit_before_tax is not None and profit_before_tax > 0:
            ratios["effective_tax_rate_pct"] = round((income_tax / profit_before_tax) * 100, 2)
        else:
            ratios["effective_tax_rate_pct"] = None

        return ratios
    except Exception as e:
        logger.error(f"compute_financial_ratios failed: {e}", exc_info=True)
        return {}



@dataclass
class ScorecardPillar:
    """Výsledok jedného piliera scorecardу."""
    name: str
    score: int           # Dosiahnuté body
    max_score: int       # Maximum za pilier
    detail: str          # Ľudsky čitateľný popis
    flags: list = field(default_factory=list)  # Zoznam konkrétnych nálezov


@dataclass
class ScorecardResult:
    """Komplexný výsledok 5-pilierového scorecardу."""
    total_score: int
    pillars: list  # list[ScorecardPillar]
    risk_category: str   # AAA / A / B / C
    hard_stop: bool = False  # True = konkurz / likvidácia
    score_version: str = "v3-frozen"
    confidence: int = 100  # 0-100, ako spoľahlivé je skóre (nižšie pri N/A fallback)


@dataclass
class ScorecardResultV3:
    """V3 výsledok — Financial Score, Data Quality a Risk oddelené."""
    financial_score: int          # 0-100, čisto finančné zdravie (bez DQ penalizácie)
    data_quality_score: int       # 0-100, kvalita dostupných dát
    risk_category: str            # AAA / A / B / C (z financial_score)
    risk_level: str               # LOW / MEDIUM / HIGH / CRITICAL
    entity_type: str              # commercial / public / nonprofit / other
    hard_stop: bool = False
    pillars: list = field(default_factory=list)          # list[ScorecardPillar]
    availability_mask: dict = field(default_factory=dict)  # {component: True/False}
    score_version: str = "v3"


_PUBLIC_FORMS = {"Obec", "Rozpočtová org. štátu", "Príspevková org.", "Príspevková org. štátu",
                 "Štátny podnik", "Štátny fond", "Zariadenie štátu"}
_NONPROFIT_FORMS = {"Nadácia", "Nadácia v zriaďovateľskej fáze", "Občianske združenie",
                    "Záujmové združenie FO", "Politická strana", "Európske združenie",
                    "Neinvestičný fond", "Fond", "NOPS"}
_COMMERCIAL_FORMS = {"s.r.o.", "Akciová spol.", "Ver. obch. spol.", "v.o.s.", "Družstvo",
                     "Európske družstvo", "Európska spol.", "Organiz. zahr. investora",
                     "Spoločný podnik"}


def classify_entity_type(legal_form: str) -> str:
    """Rozdelí entity na commercial / public / nonprofit / other podľa legal form."""
    if legal_form in _PUBLIC_FORMS:
        return "public"
    elif legal_form in _NONPROFIT_FORMS:
        return "nonprofit"
    elif legal_form in _COMMERCIAL_FORMS:
        return "commercial"
    return "other"


def _risk_category(score: int) -> str:
    if score >= 90:
        return "AAA"
    elif score >= 70:
        return "A"
    elif score >= 40:
        return "B"
    else:
        return "C"



def compute_piotroski_f_score(statements: list) -> dict:
    """
    Vypočíta Piotroski F-score na základe 8 kritérií (9. kritérium shares outstanding je vynechané).
    Škála: 0-8. Chýbajúce dáta pre konkrétne kritérium sa hodnotia ako neutral (0.5 bodu),
    nie ako 0 (fail) — aby firmy s neúplnými výkazmi (napr. IFRS bez grossProfit)
    neboli systematicky penalizované.
    Očakáva chronologicky zoradené statements.
    """
    if not statements or len(statements) < 2:
        return {"score": None, "flags": ["Nedostatok dát pre Piotroski F-score (min. 2 roky)"]}

    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    curr = _sanitize_stmt_numeric(statements[-1])
    prev = _sanitize_stmt_numeric(statements[-2])

    c_net_profit = _get(curr, 'netProfitLoss', None)
    c_assets = _get(curr, 'totalAssets', None)
    p_net_profit = _get(prev, 'netProfitLoss', None)
    p_assets = _get(prev, 'totalAssets', None)
    c_cf = _get(curr, 'operatingCashFlow', None)

    c_long_debt = _get(curr, 'longTermLiabilities', None)
    p_long_debt = _get(prev, 'longTermLiabilities', None)

    c_curr_assets = _get(curr, 'currentAssets', None)
    c_curr_liab = _get(curr, 'shortTermLiabilities', None)
    p_curr_assets = _get(prev, 'currentAssets', None)
    p_curr_liab = _get(prev, 'shortTermLiabilities', None)

    c_gross = _get(curr, 'grossProfit', None)
    c_rev = _get(curr, 'mainActivityRevenue', None)
    p_gross = _get(prev, 'grossProfit', None)
    p_rev = _get(prev, 'mainActivityRevenue', None)

    score = 0.0
    earned = 0.0
    skipped = []

    # 1. ROA > 0
    if c_net_profit is not None and c_assets is not None and c_assets > 0:
        if c_net_profit / c_assets > 0: score += 1; earned += 1
    else:
        skipped.append("ROA")

    # 2. CFO > 0
    if c_cf is not None:
        if c_cf > 0: score += 1; earned += 1
    else:
        skipped.append("CFO>0")

    # 3. dROA > 0
    if (c_net_profit is not None and c_assets and c_assets > 0 and
            p_net_profit is not None and p_assets is not None and p_assets > 0):
        if (c_net_profit / c_assets) > (p_net_profit / p_assets): score += 1; earned += 1
    else:
        skipped.append("dROA")

    # 4. CFO > Net Income
    if c_cf is not None and c_net_profit is not None:
        if c_cf > c_net_profit: score += 1; earned += 1
    else:
        skipped.append("CFO>NI")

    # 5. dLeverage < 0
    if (c_long_debt is not None and c_assets and c_assets > 0 and
            p_long_debt is not None and p_assets is not None and p_assets > 0):
        c_lev = c_long_debt / c_assets
        p_lev = p_long_debt / p_assets
        if c_lev < p_lev: score += 1; earned += 1
    else:
        skipped.append("dLev")

    # 6. dLiquidity > 0
    if (c_curr_assets is not None and c_curr_liab is not None and c_curr_liab > 0 and
            p_curr_assets is not None and p_curr_liab is not None and p_curr_liab > 0):
        if (c_curr_assets / c_curr_liab) > (p_curr_assets / p_curr_liab): score += 1; earned += 1
    else:
        skipped.append("dLiq")

    # 7. dMargin > 0 — gross margin; skip if grossProfit missing (common for IFRS by-function)
    if (c_gross is not None and c_rev and c_rev > 0 and
            p_gross is not None and p_rev and p_rev > 0):
        if (c_gross / c_rev) > (p_gross / p_rev): score += 1; earned += 1
    else:
        skipped.append("dMargin")

    # 8. dTurnover > 0
    if (c_rev is not None and c_assets and c_assets > 0 and
            p_rev is not None and p_assets is not None and p_assets > 0):
        if (c_rev / c_assets) > (p_rev / p_assets): score += 1; earned += 1
    else:
        skipped.append("dTurn")

    # Renormalization: if too many criteria are missing (>4 of 8, i.e. less than
    # half available), Piotroski is not meaningful — return N/A.
    # Otherwise, renormalize to 0-8 scale: score = earned / available * 8.
    # This replaces the old 0.5-per-missing approach which inflated scores for
    # firms with incomplete data (e.g. IFRS without grossProfit/currentAssets).
    n_skipped = len(skipped)
    n_available = 8 - n_skipped
    if n_available < 4:
        return {
            "score": None,
            "flags": [f"Piotroski F-score: N/A — príliš mnoho chýbajúcich kritérií ({n_skipped}/8, potrebné min. 4)"],
            "skipped_criteria": skipped,
        }

    final_score = int(round(earned / n_available * 8)) if n_available > 0 else 0
    flags = [f"Piotroski F-score: {final_score} z 8 (renormalizované z {earned}/{n_available} dostupných kritérií)"]

    # Sektorovo-špecifická poznámka pre finančné inštitúcie
    is_fin_inst = _is_financial_institution(curr) or _is_financial_institution(prev)
    if is_fin_inst:
        sector_skipped = [s for s in skipped if s in ("dLev", "dLiq", "dMargin")]
        if sector_skipped:
            flags.append(f"Sektorovo neutralizované (finančná inštitúcia — IFRS): {', '.join(sector_skipped)}")
        data_skipped = [s for s in skipped if s not in ("dLev", "dLiq", "dMargin")]
        if data_skipped:
            flags.append(f"Neutralizované kritériá (chýbajúce dáta): {', '.join(data_skipped)}")
    elif skipped:
        flags.append(f"Neutralizované kritériá (chýbajúce dáta): {', '.join(skipped)}")

    return {"score": final_score, "flags": flags, "skipped_criteria": skipped}


def compute_beneish_m_score(statements: list) -> dict:
    """
    Vypočíta Beneish M-score — detekcia manipulácie s výkazníctvom (earnings manipulation).
    M > -1.78 = indikácia manipulácie s výkazníctvom.
    Očakáva chronologicky zoradené statements (min. 2 roky).
    """
    if not statements or len(statements) < 2:
        return {"m_score": None, "flags": ["Nedostatok dát pre Beneish M-score (min. 2 roky)"]}

    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    curr = _sanitize_stmt_numeric(statements[-1])
    prev = _sanitize_stmt_numeric(statements[-2])

    c_rev = _get(curr, 'mainActivityRevenue', 0) or 0
    p_rev = _get(prev, 'mainActivityRevenue', 0) or 0
    c_recv = _get(curr, 'tradeReceivables', 0) or 0
    p_recv = _get(prev, 'tradeReceivables', 0) or 0
    c_gross = _get(curr, 'grossProfit', None)
    p_gross = _get(prev, 'grossProfit', None)
    c_assets = _get(curr, 'totalAssets', 0) or 0
    p_assets = _get(prev, 'totalAssets', 0) or 0
    c_curr_assets = _get(curr, 'currentAssets', 0) or 0
    p_curr_assets = _get(prev, 'currentAssets', 0) or 0
    c_dep = _get(curr, 'depreciation', 0) or 0
    p_dep = _get(prev, 'depreciation', 0) or 0
    c_sga = _get(curr, 'staffCosts', None)
    p_sga = _get(prev, 'staffCosts', None)
    c_short_liab = _get(curr, 'shortTermLiabilities', 0) or 0
    p_short_liab = _get(prev, 'shortTermLiabilities', 0) or 0
    c_long_liab = _get(curr, 'longTermLiabilities', 0) or 0
    p_long_liab = _get(prev, 'longTermLiabilities', 0) or 0
    c_net_profit = _get(curr, 'netProfitLoss', 0) or 0
    c_op_cf_raw = _get(curr, 'operatingCashFlow', None)
    c_op_cf = c_op_cf_raw if c_op_cf_raw is not None else 0
    has_op_cf = c_op_cf_raw is not None

    flags = []

    # Guard: need positive revenue and assets for meaningful calculation
    if c_rev <= 0 or p_rev <= 0 or c_assets <= 0 or p_assets <= 0:
        return {"m_score": None, "flags": ["Nedostatok dát pre Beneish M-score (nulové tržby/aktíva)"]}

    # DSRI = Days Sales in Receivables Index
    c_dsr = (c_recv / c_rev) if c_rev > 0 else 0
    p_dsr = (p_recv / p_rev) if p_rev > 0 else 0
    dsri = (c_dsr / p_dsr) if p_dsr > 0 else 1.0

    # GMI = Gross Margin Index — neutral (1.0) when grossProfit missing (common for IFRS by-function)
    if c_gross is not None and p_gross is not None:
        c_gm = (c_gross / c_rev) if c_rev > 0 else 0
        p_gm = (p_gross / p_rev) if p_rev > 0 else 0
        gmi = (p_gm / c_gm) if c_gm > 0 else 1.0
    else:
        gmi = 1.0

    # AQI = Asset Quality Index
    c_aq = ((c_curr_assets - c_recv) / c_assets) if c_assets > 0 else 0
    p_aq = ((p_curr_assets - p_recv) / p_assets) if p_assets > 0 else 0
    aqi = (c_aq / p_aq) if p_aq > 0 else 1.0

    # SGI = Sales Growth Index
    sgi = (c_rev / p_rev) if p_rev > 0 else 1.0

    # DEPI = Depreciation Index — neutral (1.0) when no separate PP&E field available
    # Using totalAssets as PP&E proxy produces meaningless results, so we skip it.
    depi = 1.0

    # SGAI = SG&A Index — neutral (1.0) when staffCosts missing (staff costs ≠ SG&A)
    if c_sga is not None and p_sga is not None:
        c_sga_ratio = (c_sga / c_rev) if c_rev > 0 else 0
        p_sga_ratio = (p_sga / p_rev) if p_rev > 0 else 0
        sgai = (c_sga_ratio / p_sga_ratio) if p_sga_ratio > 0 else 1.0
    else:
        sgai = 1.0

    # TATA = Total Accruals to Total Assets
    # If operatingCashFlow is missing (common in RÚZ simplified statements),
    # TATA is meaningless — use neutral 0 instead of (net_profit - 0) / assets
    # which would falsely flag profitable companies as manipulators.
    if has_op_cf:
        total_accruals = c_net_profit - c_op_cf
        tata = (total_accruals / c_assets) if c_assets > 0 else 0
    else:
        tata = 0.0

    # LVGI = Leverage Index
    c_lev = ((c_short_liab + c_long_liab) / c_assets) if c_assets > 0 else 0
    p_lev = ((p_short_liab + p_long_liab) / p_assets) if p_assets > 0 else 0
    lvgi = (c_lev / p_lev) if p_lev > 0 else 1.0

    m = (-4.84
         + 0.92 * dsri
         + 0.528 * gmi
         + 0.404 * aqi
         + 0.892 * sgi
         + 0.115 * depi
         - 0.172 * sgai
         + 4.679 * tata
         - 0.327 * lvgi)

    m = round(m, 3)
    is_manipulator = m > -1.78

    if is_manipulator:
        flags.append(f"Beneish M-score = {m:.3f} — Vyššie riziko (M > -1.78)")
    else:
        flags.append(f"Beneish M-score = {m:.3f} — Bez znám manipulácie (M ≤ -1.78)")

    if not has_op_cf:
        flags.append("Pozn.: TATA neutralizované (prevádzkový cash flow chýba) — M-score je menej spoľahlivý")

    return {
        "m_score": m,
        "is_manipulator": is_manipulator,
        "threshold": -1.78,
        "components": {
            "dsri": round(dsri, 4),
            "gmi": round(gmi, 4),
            "aqi": round(aqi, 4),
            "sgi": round(sgi, 4),
            "depi": round(depi, 4),
            "sgai": round(sgai, 4),
            "tata": round(tata, 4),
            "lvgi": round(lvgi, 4),
        },
        "flags": flags,
    }


def get_nace_weights(nace_code: str) -> dict:
    prefix = nace_code[:2] if nace_code else ""
    # Výroba
    if prefix in [str(i) for i in range(10, 34)]:
        return {"P1": 20, "P2": 30, "P3": 25, "P4": 15, "P5": 10}
    # Stavebníctvo
    if prefix in ["41", "42", "43"]:
        return {"P1": 25, "P2": 25, "P3": 15, "P4": 15, "P5": 20}
    # Veľkoobchod, Maloobchod
    if prefix in ["46", "47"]:
        return {"P1": 25, "P2": 20, "P3": 20, "P4": 15, "P5": 20}
    # Doprava
    if prefix in ["49", "50", "51", "52", "53"]:
        return {"P1": 20, "P2": 25, "P3": 25, "P4": 15, "P5": 15}
    # IT služby
    if prefix in ["62", "63"]:
        return {"P1": 20, "P2": 20, "P3": 30, "P4": 20, "P5": 10}
    # Poľnohospodárstvo
    if prefix in ["01", "02", "03"]:
        return {"P1": 25, "P2": 25, "P3": 20, "P4": 15, "P5": 15}
    # Ubytovanie/reštaurácie
    if prefix in ["55", "56"]:
        return {"P1": 25, "P2": 20, "P3": 20, "P4": 15, "P5": 20}
    
    return {"P1": 30, "P2": 25, "P3": 20, "P4": 15, "P5": 10}

def compute_vestnik_degradation(event, current_date=None) -> float:
    import datetime
    if current_date is None:
        current_date = datetime.datetime.now(datetime.timezone.utc)
    
    pub_at = _get(event, "publishedAt")
    if not pub_at:
        return 1.0
        
    if isinstance(pub_at, str):
        try:
            pub_at = datetime.datetime.fromisoformat(pub_at.replace("Z", "+00:00"))
        except:
            return 1.0
            
    if getattr(pub_at, "tzinfo", None) is None:
        pub_at = pub_at.replace(tzinfo=datetime.timezone.utc)
        
    diff_days = (current_date - pub_at).days
    
    if diff_days <= 365:
        return 1.0
    elif diff_days <= 3*365:
        return 0.7
    elif diff_days <= 5*365:
        return 0.4
    else:
        return 0.1

def _get_latest_revenue(financial_statements: list) -> Optional[float]:
    """Extract latest year's revenue from financial statements."""
    if not financial_statements:
        return None
    try:
        latest = max(financial_statements, key=lambda s: getattr(s, "year", 0) or (s.get("year", 0) if isinstance(s, dict) else 0))
        rev = getattr(latest, "mainActivityRevenue", 0) or (latest.get("mainActivityRevenue", 0) if isinstance(latest, dict) else 0)
        return _to_float(rev) or None
    except Exception:
        return None


def compute_forensic_scorecard(company_dict: dict, trends: dict) -> "ScorecardResult":

    """
    5-pilierový vážený scoring model (0–100) V2.
    """
    pillars = []
    
    vestnik_events = company_dict.get("vestnikEvents", [])
    nace_code = company_dict.get("naceCode", "") or ""
    nace_w = get_nace_weights(nace_code)

    # ── HARD STOP: Konkurz / Likvidácia ───────────────────────────────────────
    hard_stop_triggered = False
    for event in vestnik_events:
        event_type = (
            event.get("eventType", "").lower()
            if isinstance(event, dict)
            else getattr(event, "eventType", "").lower()
        )
        event_type_norm = unicodedata.normalize("NFC", event_type)
        if any(kw in event_type_norm for kw in ("konkurz", "likvidáci", "reštrukturalizáci")):
            hard_stop_triggered = True
            break

    # ── Startup detekcia ─────────────────────────────────────────────────────
    stmts_raw = company_dict.get("financialStatements", [])
    sorted_stmts_raw = sorted(stmts_raw, key=lambda x: x.year if hasattr(x, "year") else x.get("year", 0))
    startup_info = detect_startup_profile(sorted_stmts_raw)

    # ── Sektorová detekcia: finančné inštitúcie (poisťovne, banky) ──────────
    # Altman Z'', bežná likvidita a Piotroski dLiq/dMargin nie sú aplikovateľné
    # pre IFRS súvahy finančných inštitúcií bez štandardnej klasifikácie obežného majetku.
    is_financial_inst = False
    if sorted_stmts_raw:
        is_financial_inst = _is_financial_institution(sorted_stmts_raw[-1])

    # Use the most recent year with valid data, not blindly [-1]
    # (the newest year may have partial data — e.g. shortTermLiabilities missing)
    all_ratios = trends.get("ratios_by_year") or [{}]
    all_z = trends.get("altman_z_scores") or [{}]
    last_ratios = next((r for r in reversed(all_ratios) if r.get("current_ratio") is not None), all_ratios[-1] if all_ratios else {})
    last_z = next((z for z in reversed(all_z) if z.get("z_score") is not None and z.get("components")), all_z[-1] if all_z else {})
    consecutive_losses = trends.get("consecutive_losses", 0)

    _KEY_METRICS = ["totalAssets", "equity", "netProfitLoss", "shortTermLiabilities", "mainActivityRevenue"]
    if sorted_stmts_raw:
        last_stmt = sorted_stmts_raw[-1]
        available = sum(1 for m in _KEY_METRICS if _get(last_stmt, m) is not None)
        data_availability_pct = available / len(_KEY_METRICS)
    else:
        data_availability_pct = 0.0
    data_void = data_availability_pct < 0.3

    # Piotroski F-score
    piotroski = compute_piotroski_f_score(sorted_stmts_raw)

    # DATA QUALITY MULTIPLIER (DQ)
    dq_mult = 1.0
    if len(sorted_stmts_raw) >= 5: dq_mult = 1.0
    elif len(sorted_stmts_raw) >= 3: dq_mult = 0.9
    elif len(sorted_stmts_raw) >= 1: dq_mult = 0.7
    else: dq_mult = 0.5
    
    if startup_info.get("is_startup"):
        dq_mult = max(dq_mult, 0.8)
        
    has_audit = False
    for stmt in reversed(sorted_stmts_raw):
        op = getattr(stmt, "auditorOpinion", None) or (stmt.get("auditorOpinion") if isinstance(stmt, dict) else None)
        if op:
            op_type = getattr(op, "opinionType", "") or (op.get("opinionType", "") if isinstance(op, dict) else "")
            if op_type and str(op_type).lower() != "null":
                has_audit = True
                break
    if not has_audit and len(sorted_stmts_raw) > 0:
        dq_mult *= 0.85

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 1 — Platobná schopnosť & Exekúcie (raw max 30)
    # ══════════════════════════════════════════════════════════════════════════
    p1_raw = 0
    p1_flags = []

    cr = last_ratios.get("current_ratio")
    if is_financial_inst:
        # Finančné inštitúcie (poisťovne, banky): bežná likvidita nie je relevantná
        # — IFRS súvaha nemá štandardnú klasifikáciu obežného majetku.
        # Namiesto penalizácie priradíme neutrálne skóre a hodnotíme solventnosť
        # cez equity_to_debt (vlastné imanie vs. záväzky).
        p1_raw += 12
        p1_flags.append("Current ratio: N/A — finančná inštitúcia (likvidita sa nehodnotí cez bežný pomer)")
    elif cr is None:
        p1_raw += 7
        p1_flags.append("Current ratio: N/A (bez dát)")
    elif cr >= 1.5:
        p1_raw += 15
        p1_flags.append(f"Current ratio: {cr:.2f} — výborná likvidita (≥1.5)")
    elif cr >= 1.0:
        p1_raw += 10
        p1_flags.append(f"Current ratio: {cr:.2f} — dostatočná likvidita (1.0–1.5)")
    elif cr >= 0.5:
        p1_raw += 5
        p1_flags.append(f"Current ratio: {cr:.2f} — problematická likvidita (0.5–1.0)")
    else:
        p1_flags.append(f"Current ratio: {cr:.2f} — kritická likvidita (<0.5)")

    equity_to_debt = last_z.get("components", {}).get("x4_equity_to_debt", None)
    debt_to_equity = last_ratios.get("debt_to_equity", None)
    # Pre finančné inštitúcie Altman Z'' vracia N/A (bez komponentov),
    # ale vlastné imanie môže byť kladné — overíme priamo z DB dát.
    if is_financial_inst:
        _eq = _get(sorted_stmts_raw[-1], "equity", None)
        if _eq is not None and _eq > 0:
            p1_raw += 15
            de_str = f"{debt_to_equity:.2f}" if debt_to_equity is not None else "N/A"
            p1_flags.append(f"Vlastné imanie: kladné (D/E = {de_str})")
        elif _eq is not None and _eq < 0:
            p1_flags.append(f"Vlastné imanie: ZÁPORNÉ — predĺženie")
        else:
            p1_raw += 8
            p1_flags.append("Vlastné imanie: N/A")
    elif equity_to_debt is None:
        p1_raw += 8
        p1_flags.append("Vlastné imanie: N/A")
    elif equity_to_debt > 0:
        p1_raw += 15
        de_str = f"{debt_to_equity:.2f}" if debt_to_equity is not None else "N/A"
        p1_flags.append(f"Vlastné imanie: kladné (D/E = {de_str})")
    else:
        p1_flags.append(f"Vlastné imanie: ZÁPORNÉ — predĺženie")

    # Vestnik events were previously penalized here AND in P5 (double-counting).
    # Removed from P1 — vestnik penalization is now exclusively in P5 (Právna bezúhonnosť).
    # The 6 raw points were redistributed: current ratio 12→15, equity 12→15.

    p1_raw = max(0, min(30, p1_raw))
    p1_score = int(round((p1_raw / 30.0) * nace_w["P1"]))
    if hard_stop_triggered:
        pillars.append(ScorecardPillar(
            name="Platobná schopnosť & Exekúcie",
            score=0, max_score=nace_w["P1"],
            detail="HARD STOP — Firma je v konkurze, likvidácii alebo reštrukturalizácii.",
            flags=["Konkurz / Likvidácia / Reštrukturalizácia"]
        ))
    else:
        pillars.append(ScorecardPillar(
            name="Platobná schopnosť & Exekúcie",
            score=p1_score, max_score=nace_w["P1"],
            detail=" | ".join(p1_flags[:2]) if p1_flags else "", flags=p1_flags
        ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 2 — Finančné zdravie — hierarchický scoring (raw max 30)
    # ══════════════════════════════════════════════════════════════════════════
    # Architektúra:
    #   Tier 1: Altman Z'' + Piotroski (keď sú oba dostupné)
    #   Tier 2: Ratio-based fallback (keď Altman N/A ale máme ratios)
    #   Tier 3: Data void (minimum)
    #
    # N/A znamená "nevieme posúdiť", nie "firma je zlá".
    # Confidence sa znižuje pri fallback, nie score.
    p2_raw = 0
    p2_flags = []
    p2_method = "altman_piotroski"  # sleduje, ktorá metóda sa použila

    z_score_val = last_z.get("z_score")
    z_zone = last_z.get("zone", "N/A")
    pio_score = piotroski.get("score")

    if startup_info.get("is_startup"):
        p2_raw += 15
        eq = startup_info.get("equity", 0)
        p2_flags.append(f"STARTUP profil: Altman Z'' neaplikovateľné (pre-revenue firma s imaním {eq:,.0f} €)".replace(",", " "))
        p2_method = "startup"
    elif is_financial_inst:
        # Finančné inštitúcie: Altman Z'' a Piotroski dLiq/dMargin nie sú aplikovateľné.
        # Hodnotíme len ROA, ziskovosť a solventnosť (equity ratio).
        p2_raw += 15  # neutrálne — Altman sa nehodnotí
        p2_flags.append("Altman Z'': N/A — finančná inštitúcia (model nie je aplikovateľný pre IFRS súvahy poisťovní/bankovníctva)")

        if pio_score is not None:
            p2_raw += min(10, int((pio_score / 8.0) * 10))
            p2_flags.extend(piotroski.get("flags", []))
            p2_flags.append("Pozn.: Piotroski obmedzene aplikovateľný — dLiq/dMargin neutralizované (IFRS súvaha bez obežného majetku/hrubej marže)")
        else:
            p2_flags.append("Piotroski F-score: N/A")
        p2_method = "financial_institution"
    elif data_void:
        p2_raw = 0
        p2_flags.append("DATA VOID: Kľúčové finančné metriky nedostupné")
        p2_method = "data_void"
    elif z_score_val is not None and pio_score is not None:
        # ── Tier 1: Altman + Piotroski (plné dáta) ──
        if z_zone == "SAFE":
            p2_raw += min(20, int(15 + (z_score_val - 2.6) / (5.0 - 2.6) * 5))
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Bezpečná zóna ✓")
        elif z_zone == "GREY":
            p2_raw += min(14, int(7 + (z_score_val - 1.1) / (2.6 - 1.1) * 7))
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Šedá zóna ⚠")
        else:
            p2_raw += max(0, min(4, int((z_score_val / 1.1) * 4)))
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Núdzová zóna ✗")

        p2_raw += min(10, int((pio_score / 8.0) * 10))
        p2_flags.extend(piotroski.get("flags", []))
        if pio_score <= 4:
            p2_flags.append(f"Pozn.: Piotroski {pio_score}/8 indikuje stagnáciu v niektorých oblastiach, ale celkové skóre odráža silné fundamentals (Altman, likvidita, zadlženosť)")
        p2_method = "altman_piotroski"
    else:
        # ── Tier 2: Ratio-based fallback (Altman N/A alebo Piotroski N/A) ──
        # N/A znamená "nevieme posúdiť", nie "firma je zlá".
        # Použijeme dostupné ratios na ratio-based financial health assessment.
        p2_raw_fallback = 0
        fallback_components = []

        # ROA (max 6 raw)
        roa = last_ratios.get("roa_pct")
        if roa is not None:
            if roa >= 10: p2_raw_fallback += 6
            elif roa >= 5: p2_raw_fallback += 5
            elif roa >= 2: p2_raw_fallback += 4
            elif roa >= 0: p2_raw_fallback += 3
            elif roa >= -5: p2_raw_fallback += 1
            # else: 0 (strata)
            fallback_components.append(f"ROA {roa:.1f}%")
        else:
            fallback_components.append("ROA N/A")

        # Equity / Total Assets (max 6 raw)
        _eq = _get(sorted_stmts_raw[-1], "equity") if sorted_stmts_raw else None
        _ta = _get(sorted_stmts_raw[-1], "totalAssets") if sorted_stmts_raw else None
        if _eq is not None and _ta is not None and _ta > 0:
            eq_ratio = _eq / _ta
            if eq_ratio >= 0.5: p2_raw_fallback += 6
            elif eq_ratio >= 0.3: p2_raw_fallback += 5
            elif eq_ratio >= 0.15: p2_raw_fallback += 4
            elif eq_ratio >= 0.05: p2_raw_fallback += 3
            elif eq_ratio >= 0: p2_raw_fallback += 2
            # else: 0 (záporné equity)
            fallback_components.append(f"Equity/TA {eq_ratio:.0%}")
        else:
            fallback_components.append("Equity/TA N/A")

        # Debt-to-Equity (max 6 raw)
        de = last_ratios.get("debt_to_equity")
        if de is not None and _eq is not None and _eq > 0:
            if de <= 0.5: p2_raw_fallback += 6
            elif de <= 1.0: p2_raw_fallback += 5
            elif de <= 2.0: p2_raw_fallback += 4
            elif de <= 3.0: p2_raw_fallback += 3
            elif de <= 5.0: p2_raw_fallback += 2
            else: p2_raw_fallback += 1
            fallback_components.append(f"D/E {de:.1f}")
        elif _eq is not None and _eq <= 0:
            p2_raw_fallback += 0  # záporné equity = 0 bodov
            fallback_components.append("D/E: záporné equity")
        else:
            fallback_components.append("D/E N/A")

        # Current ratio (max 6 raw)
        cr = last_ratios.get("current_ratio")
        if cr is not None:
            if cr >= 2.0: p2_raw_fallback += 6
            elif cr >= 1.5: p2_raw_fallback += 5
            elif cr >= 1.0: p2_raw_fallback += 4
            elif cr >= 0.5: p2_raw_fallback += 2
            # else: 0
            fallback_components.append(f"CR {cr:.2f}")
        else:
            fallback_components.append("CR N/A")

        # Profitability / CF stability (max 6 raw)
        _np = _get(sorted_stmts_raw[-1], "netProfitLoss") if sorted_stmts_raw else None
        _cf = _get(sorted_stmts_raw[-1], "operatingCashFlow") if sorted_stmts_raw else None
        if _np is not None and _cf is not None:
            if _np > 0 and _cf > 0:
                p2_raw_fallback += 6
                fallback_components.append("Zisk+CF kladný")
            elif _np > 0 and _cf is not None and _cf <= 0:
                p2_raw_fallback += 3
                fallback_components.append("Zisk ale CF záporný")
            elif _np <= 0 and _cf > 0:
                p2_raw_fallback += 2
                fallback_components.append("Strata ale CF kladný")
            else:
                p2_raw_fallback += 0
                fallback_components.append("Strata+CF záporný")
        elif _np is not None:
            if _np > 0:
                p2_raw_fallback += 4
                fallback_components.append("Zisk (CF N/A)")
            else:
                p2_raw_fallback += 0
                fallback_components.append("Strata (CF N/A)")
        else:
            fallback_components.append("Zisk/CF N/A")

        p2_raw = p2_raw_fallback
        p2_flags.append(f"P2 Fallback (ratio-based): {' | '.join(fallback_components)}")
        if z_score_val is None:
            p2_flags.append("Altman Z'': N/A — použitý ratio-based fallback")
        if pio_score is None:
            p2_flags.append("Piotroski F-score: N/A — použitý ratio-based fallback")
        p2_method = "ratio_fallback"

    p2_raw = max(0, min(30, p2_raw))
    p2_score = int(round((p2_raw / 30.0) * nace_w["P2"]))
    p2_detail = f"[{p2_method}] " + (" | ".join(p2_flags[:2]) if p2_flags else "")
    pillars.append(ScorecardPillar(
        name="Finančné zdravie",
        score=p2_score, max_score=nace_w["P2"],
        detail=p2_detail, flags=p2_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 3 — Ziskovosť & Stabilita & CF (raw max 30)
    # ══════════════════════════════════════════════════════════════════════════
    p3_raw = 0
    p3_flags = []
    n_years = len(sorted_stmts_raw)
    
    if n_years == 0:
        p3_raw = 0
        p3_flags.append("DATA VOID")
    else:
        # Ziskovosť (max 10)
        profitable_years = sum(
            1 for s in sorted_stmts_raw
            if ((getattr(s, "netProfitLoss", 0) if hasattr(s, "netProfitLoss") else s.get("netProfitLoss", 0)) or 0) > 0
        )
        if profitable_years >= 5: p3_raw += 10
        elif profitable_years >= 3: p3_raw += 7
        elif profitable_years >= 1: p3_raw += 4
        
        p3_flags.append(f"Ziskovosť: {profitable_years}/{n_years} rokov v zisku")

        # Marža a ROA (max 5)
        npm = last_ratios.get("net_profit_margin_pct")
        if npm is not None and npm >= 10: p3_raw += 3
        roa = last_ratios.get("roa_pct")
        if roa is not None and roa >= 5: p3_raw += 2

        if consecutive_losses >= 3:
            p3_raw = max(0, p3_raw - min(10, consecutive_losses * 3))
            p3_flags.append(f"Penalizácia: {consecutive_losses} roky strata")

        # Cash Flow (max 15) — jeden integrovaný mechanizmus
        # Finančné inštitúcie (banky, poisťovne): záporný prevádzkový CF je štandardný
        # — vyplýva z financovania úverového portfólia a IFRS vykazovania.
        # Neutralizujeme len penalizáciu za záporný CF, nie hodnotenie kladného CF.
        op_cf_raw = _get(sorted_stmts_raw[-1], "operatingCashFlow", None)
        rev = _get(sorted_stmts_raw[-1], "mainActivityRevenue", 0) or 0
        _dso = last_ratios.get("dso_days")
        if is_financial_inst and op_cf_raw is not None and op_cf_raw < 0:
            # Záporný CF u banky/poisťovne = štandardný, nehodnotíme
            p3_raw += 12
            p3_flags.append(f"Cash Flow: N/A — finančná inštitúcia (záporný CF je štandardný pre bankový sektor)")
        elif op_cf_raw is not None:
            op_cf = op_cf_raw
            if op_cf > 0:
                p3_raw += 7
                if rev > 0 and (op_cf / rev) > 0.10:
                    p3_raw += 8
                    p3_flags.append(f"Cash Flow: Silný (CF/Rev > 10%)")
                else:
                    p3_flags.append(f"Cash Flow: Kladný")
            else:
                # Záporný CF — 0 bodov (už bez +7)
                p3_flags.append(f"Cash Flow: Záporný (riziko)")
                # F7 fix: DSO >150 + záporný CF = stronger penalty (integrované, nie samostatný pillar)
                if _dso is not None and _dso > 150:
                    p3_raw = max(0, p3_raw - 5)
                    p3_flags.append(f"⚠ Záporný CF + DSO {_dso:.0f} dní = papierový zisk (−5b)")
        else:
            p3_raw += 7
            p3_flags.append("Cash Flow: N/A")

        # CF/Zisk divergencia — len pre nefinančné inštitúcie
        # (pre finančné inštitúcie so záporným CF je divergencia očakávaná)
        if not (is_financial_inst and op_cf_raw is not None and op_cf_raw < 0):
            cf_ratio = last_ratios.get("cashflow_to_profit")
            if cf_ratio is not None and profitable_years > 0 and cf_ratio < 0:
                p3_raw = max(0, p3_raw - 5)
                p3_flags.append(f"⚠ Divergencia CF/Zisk: Záporný CF pri zisku")
            elif cf_ratio is not None and profitable_years > 0 and 0 < cf_ratio < 1:
                p3_flags.append(f"Pozn.: CF/Zisk = {cf_ratio:.1f}× — prevádzkové peňažné toky nepokrývajú čistý zisk v plnej miere (možný vplyv zmien pracovného kapitálu alebo odpisov)")

    p3_raw = max(0, min(30, p3_raw))
    p3_score = int(round((p3_raw / 30.0) * nace_w["P3"]))
    pillars.append(ScorecardPillar(
        name="Ziskovosť, Stabilita a Cash Flow",
        score=p3_score, max_score=nace_w["P3"],
        detail=" | ".join(p3_flags[:2]) if p3_flags else "", flags=p3_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 4 — Rast & Trendová sila (raw max 15)
    # ══════════════════════════════════════════════════════════════════════════
    p4_raw = 0
    p4_flags = []
    
    cagr = trends.get("cagr_revenue")
    if cagr is None:
        p4_raw = 0 if data_void else 5
        p4_flags.append("CAGR tržieb: N/A")
    elif cagr >= 15: p4_raw += 15; p4_flags.append(f"CAGR: +{cagr:.1f}%")
    elif cagr >= 10: p4_raw += 12; p4_flags.append(f"CAGR: +{cagr:.1f}%")
    elif cagr >= 5: p4_raw += 9; p4_flags.append(f"CAGR: +{cagr:.1f}%")
    elif cagr >= 0: p4_raw += 5; p4_flags.append(f"CAGR: stagnácia")
    else: p4_raw += max(0, int(5 + cagr/5)); p4_flags.append(f"CAGR: pokles")

    equity_trend = trends.get("equity_trend", [])
    if equity_trend:
        last_eq_change = equity_trend[-1].get("yoy_pct")
        if last_eq_change is not None and last_eq_change > 5:
            p4_raw = min(15, p4_raw + 2)
            p4_flags.append(f"Vlastné imanie rastie YoY: +{last_eq_change:.1f}%")

    rev_trend = trends.get("revenue_trend", [])
    if len(rev_trend) >= 3:
        last3 = [r.get("growth_percent", 0) for r in rev_trend[-3:]]
        if all(g < 0 for g in last3):
            p4_raw = max(0, p4_raw - 4)
            p4_flags.append("Tržby klesajú 3 roky po sebe (−4 body)")

    # YoY penalizácia: ak posledný rok vykazuje prudký pokles, neutralizuj CAGR
    if rev_trend and len(rev_trend) >= 1:
        last_rev_yoy = rev_trend[-1].get("growth_percent")
        if last_rev_yoy is not None and last_rev_yoy < -10:
            p4_raw = max(0, p4_raw - 5)
            p4_flags.append(f"YoY tržby −{abs(last_rev_yoy):.1f}% v poslednom roku (−5 bodov)")

    profit_trend = trends.get("profit_trend", [])
    if profit_trend and len(profit_trend) >= 1:
        last_profit_yoy = profit_trend[-1].get("growth_percent")
        if last_profit_yoy is not None and last_profit_yoy < -50:
            p4_raw = max(0, p4_raw - 3)
            p4_flags.append(f"YoY zisk −{abs(last_profit_yoy):.1f}% v poslednom roku (−3 body)")

    p4_raw = max(0, min(15, p4_raw))
    p4_score = int(round((p4_raw / 15.0) * nace_w["P4"]))
    pillars.append(ScorecardPillar(
        name="Rast & Trendová sila",
        score=p4_score, max_score=nace_w["P4"],
        detail=" | ".join(p4_flags[:2]) if p4_flags else "", flags=p4_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 5 — Právna bezúhonnosť (raw max 10)
    # ══════════════════════════════════════════════════════════════════════════
    p5_raw = 10
    p5_flags = []

    pen_critical = 0
    pen_high = 0
    pen_med = 0

    for e in vestnik_events:
        sev = e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "LOW")
        deg = compute_vestnik_degradation(e)
        if sev == "CRITICAL": pen_critical += 10 * deg
        elif sev == "HIGH": pen_high += 4 * deg
        elif sev == "MEDIUM": pen_med += 2 * deg

    if pen_critical >= 5:
        p5_raw = 0
        p5_flags.append("KRITICKÉ udalosti vo Vestníku")
    elif pen_high >= 2:
        p5_raw = max(0, 6 - int(pen_high))
        p5_flags.append("VYSOKÉ udalosti vo Vestníku")
    elif pen_med >= 1:
        p5_raw = max(0, 8 - int(pen_med))
        p5_flags.append("STREDNÉ udalosti vo Vestníku")
    elif vestnik_events:
        p5_raw = 9
        p5_flags.append("Len nízko-rizikové záznamy vo Vestníku")
    else:
        p5_flags.append("Bez záznamu v Obchodnom vestníku ✓")

    for stmt in reversed(sorted_stmts_raw):
        op = getattr(stmt, "auditorOpinion", None) or (stmt.get("auditorOpinion") if isinstance(stmt, dict) else {})
        op_type = getattr(op, "opinionType", "") or (op.get("opinionType", "") if isinstance(op, dict) else "")
        if op_type and str(op_type).lower() != "null":
            op_lower = str(op_type).lower()
            if "bez výhrad" in op_lower or "unqualified" in op_lower or "ohne vorbehalt" in op_lower:
                p5_flags.append("Audítorský posudok: bez výhrad ✓")
            else:
                p5_raw = max(0, p5_raw - 3)
                p5_flags.append(f"Audítorský posudok: {op_type} (−3b)")
            break

    p5_raw = max(0, min(10, p5_raw))
    p5_score = int(round((p5_raw / 10.0) * nace_w["P5"]))
    pillars.append(ScorecardPillar(
        name="Právna bezúhonnosť",
        score=p5_score, max_score=nace_w["P5"],
        detail=" | ".join(p5_flags[:2]) if p5_flags else "", flags=p5_flags
    ))

    # ── Finálny súčet a úpravy ──────────────────────────────────────────────
    total_score = p1_score + p2_score + p3_score + p4_score + p5_score

    if financial_statements := company_dict.get("financialStatements", []):
        def _get_year(s): return getattr(s, "year", 0) or (s.get("year", 0) if isinstance(s, dict) else 0)
        wh = compute_white_horse_indicator(sorted(financial_statements, key=_get_year))
        if wh["penalty"] > 0:
            pillars.append(ScorecardPillar(
                name="Forenzný indikátor: Anomália v štruktúre vedenia", score=-wh["penalty"], max_score=0,
                detail="Boli detekované kritické znaky spoločnosti s redukovanou substanciou.", flags=wh["flags"]
            ))
            total_score = max(0, total_score - wh["penalty"])

    # ── ORSR Forenzná penalizácia ────────────────────────────────────────────
    # ORSR Forensic Agent ukladá CompanyEvent so source=ORSR, eventType=FORENSIC_ANALYSIS
    # Tieto obsahujú statutory_changes_count, high_turnover_risk, has_virtual_seat, has_foreign_statutory
    # Scorecard ich musí započítať — inak firma s 102 zmenami štatutárov dostane AAA.
    orsr_events = company_dict.get("companyEvents", [])
    orsr_forensic_penalty = 0
    orsr_forensic_flags = []
    # Použi najnovší ORSR FORENSIC_ANALYSIS event — pri reprocessoch ich môže byť viac
    def _orsr_event_ts(ev):
        ts = ev.get("createdAt") if isinstance(ev, dict) else getattr(ev, "createdAt", None)
        return ts or ""
    forensic_events = [
        ev for ev in orsr_events
        if (ev.get("source", "") if isinstance(ev, dict) else getattr(ev, "source", "")) == "ORSR"
        and (ev.get("eventType", "") if isinstance(ev, dict) else getattr(ev, "eventType", "")) == "FORENSIC_ANALYSIS"
    ]
    if forensic_events:
        forensic_events.sort(key=_orsr_event_ts, reverse=True)
        ev = forensic_events[0]
        ev_sev = ev.get("severity", "INFO") if isinstance(ev, dict) else getattr(ev, "severity", "INFO")
        ev_meta = ev.get("metadata", {}) if isinstance(ev, dict) else getattr(ev, "metadata", {})
        if isinstance(ev_meta, str):
            try:
                ev_meta = _json.loads(ev_meta)
            except Exception:
                ev_meta = {}
        stat_changes = int(ev_meta.get("statutory_changes_count", 0) or 0)
        has_virtual = bool(ev_meta.get("has_virtual_seat", False))
        has_foreign = bool(ev_meta.get("has_foreign_statutory", False))

        is_big_corp = False
        latest_rev = _get_latest_revenue(financial_statements)
        if latest_rev and latest_rev > 10_000_000:
            is_big_corp = True

        if is_big_corp and stat_changes > 0:
            if ev_sev in ["CRITICAL", "HIGH"]:
                ev_sev = "INFO"
            # Big corp (>10M revenue) with many statutory changes is normal
            # corporate rotation — skip threshold-based penalty entirely
            stat_changes = 0

        if ev_sev == "CRITICAL":
            orsr_forensic_penalty += 3
            orsr_forensic_flags.append(f"ORSR CRITICAL: {stat_changes} zmien štatutárov, vysoké riziko bieleho koňa (−3b)")
        elif ev_sev == "HIGH":
            orsr_forensic_penalty += 2
            orsr_forensic_flags.append(f"ORSR HIGH: zvýšené riziko z ORSR histórie (−2b)")

        # Mierna penalizácia za vysoký počet zmien — threshold závisí od veľkosti firmy
        # Malá firma (<2M tržieb): >10 zmien je podozrivé
        # Stredná firma (2-10M): >25 zmien
        # Veľká firma (>10M): >50 zmien (už bežná)
        is_small_corp = False
        is_medium_corp = False
        if latest_rev and latest_rev <= 2_000_000:
            is_small_corp = True
        elif latest_rev and latest_rev <= 10_000_000:
            is_medium_corp = True

        if is_small_corp and stat_changes > 10:
            orsr_forensic_penalty += 2
            orsr_forensic_flags.append(f"Vysoký počet zmien štatutárov ({stat_changes}) pre malú firmu: −2b")
        elif is_medium_corp and stat_changes > 25:
            orsr_forensic_penalty += 2
            orsr_forensic_flags.append(f"Vysoký počet zmien štatutárov ({stat_changes}) pre strednú firmu: −2b")
        elif stat_changes > 50:
            orsr_forensic_penalty += 2
            orsr_forensic_flags.append(f"Vysoký počet zmien štatutárov ({stat_changes}): −2b")

        if has_virtual and has_foreign:
            orsr_forensic_penalty += 1
            orsr_forensic_flags.append("Virtuálne sídlo + zahraničný štatutár (−1b)")

    if orsr_forensic_penalty > 0:
        orsr_forensic_penalty = min(orsr_forensic_penalty, 5)  # Cap at 5
        pillars.append(ScorecardPillar(
            name="ORSR Forenzná penalizácia", score=-orsr_forensic_penalty, max_score=0,
            detail="Penalizácia za forenzné anomálie z ORSR histórie.", flags=orsr_forensic_flags
        ))
        total_score = max(0, total_score - orsr_forensic_penalty)

    # F7 fix: CF/DSO Stress penalizácia bola integrovaná do P3 (jeden mechanizmus).
    # Samostatný pillar bol odstránený — zabránilo sa double-counting.

    if dq_mult < 1.0:
        pillars.append(ScorecardPillar(
            name="Data Quality Multiplier",
            score=int(round(total_score * dq_mult)) - total_score, max_score=0,
            detail=f"Skóre ponížené (koeficient {dq_mult:.2f}) pre chýbajúce dáta, históriu alebo audit.",
            flags=[]
        ))
        total_score = int(round(total_score * dq_mult))

    # Ak bol hard_stop triggered (konkurz/likvidácia), vynuluj total_score
    # ale zachovaj všetky piliere pre zobrazenie v tabuľke
    if hard_stop_triggered:
        total_score = 0

    # ── Confidence calculation ──
    # Confidence = ako spoľahlivé je skóre (nižšie pri N/A fallback).
    # N/A znamená "nevieme posúdiť", nie "firma je zlá".
    # Confidence sa znižuje pri:
    #   - P2 ratio_fallback (Altman alebo Piotroski N/A)
    #   - DQ multiplier < 1.0 (málo výkazov, bez auditu)
    #   - Piotroski N/A
    confidence = 100
    if p2_method == "ratio_fallback":
        confidence -= 20  # P2 fallback = nižšia confidence
    elif p2_method == "data_void":
        confidence -= 40  # data void = veľmi nízka confidence
    elif p2_method == "startup":
        confidence -= 15  # startup = obmedzená confidence
    if pio_score is None and p2_method != "data_void":
        confidence -= 10  # Piotroski N/A
    if z_score_val is None and p2_method not in ("ratio_fallback", "data_void", "startup", "financial_institution"):
        confidence -= 10  # Altman N/A (v Tier 1 kontexte)
    if dq_mult < 1.0:
        confidence -= int((1.0 - dq_mult) * 30)  # DQ penalizácia znižuje confidence
    confidence = max(20, min(100, confidence))

    return ScorecardResult(
        total_score=total_score,
        pillars=pillars,
        risk_category=_risk_category(total_score),
        hard_stop=hard_stop_triggered,
        score_version="v3-frozen",
        confidence=confidence,
    )


# ══════════════════════════════════════════════════════════════════════════════════════════
# V3 SCORING — Availability Mask + Renormalization + Entity Classifier + DQ Separation
# ══════════════════════════════════════════════════════════════════════════════════════════

def _compute_data_quality_score(stmts_raw, has_pnl, has_cf, has_audit, entity_type):
    """Vypočíta Data Quality Score (0-100) ako samostatný výstup."""
    score = 0
    # Počet rokov výkazov (max 40 bodov)
    n = len(stmts_raw)
    if n >= 5: score += 40
    elif n >= 3: score += 30
    elif n >= 2: score += 20
    elif n >= 1: score += 10

    # P&L dostupnosť (max 25 bodov)
    if has_pnl: score += 25

    # Cash Flow dostupnosť (max 20 bodov)
    if has_cf: score += 20

    # Audit opinion (max 15 bodov)
    if has_audit: score += 15

    return min(100, score)


def _risk_level(hard_stop, financial_score, vestnik_events):
    """Určí risk level na základe hard stop, financial score a vestník events."""
    if hard_stop:
        return "CRITICAL"
    # Check for critical/high vestnik events
    crit_count = sum(1 for e in vestnik_events
                     if (e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "")) in ("CRITICAL", "HIGH"))
    if crit_count > 0:
        return "HIGH"
    if financial_score < 40:
        return "HIGH"
    if financial_score < 60:
        return "MEDIUM"
    return "LOW"


def compute_forensic_scorecard_v3(company_dict: dict, trends: dict) -> "ScorecardResultV3":
    """
    Scoring V3 / Risk Engine Candidate — interný prototyp, nie finálny Verifa Score.

    STATUS: internal prototype — nepoužívať v produkčnom UI ani ako verejný score.
    Finálny Verifa Risk Engine bude navrhnutý až s kompletnou dátovou vrstvou
    (RÚZ + ORSR + Vestník + auditorské správy + poznámky k závierkám + deep-data).

    5-pilierový model s availability mask a renormalizáciou.

    Kľúčové zmeny oproti V2:
    1. N/A ≠ 0 — chýbajúce dáta sa nerátajú ako 0, váhy sa renormalizujú
    2. Entity classifier — commercial/public/nonprofit/other
    3. DQ je samostatný score (0-100), nie multiplier na financial score
    4. Altman/Piotroski len pre commercial entity
    5. Hard stops zachované
    """
    vestnik_events = company_dict.get("vestnikEvents", [])
    legal_form = company_dict.get("legalForm", "") or ""
    entity_type = classify_entity_type(legal_form)
    nace_code = company_dict.get("naceCode", "") or ""
    nace_w = get_nace_weights(nace_code)

    # ── HARD STOP ──────────────────────────────────────────────────────────────
    hard_stop_triggered = False
    for event in vestnik_events:
        event_type = (
            event.get("eventType", "").lower()
            if isinstance(event, dict)
            else getattr(event, "eventType", "").lower()
        )
        event_type_norm = unicodedata.normalize("NFC", event_type)
        if any(kw in event_type_norm for kw in ("konkurz", "likvidáci", "reštrukturalizáci")):
            hard_stop_triggered = True
            break

    # ── Data preparation ───────────────────────────────────────────────────────
    stmts_raw = company_dict.get("financialStatements", [])
    sorted_stmts_raw = sorted(stmts_raw, key=lambda x: x.year if hasattr(x, "year") else x.get("year", 0))
    startup_info = detect_startup_profile(sorted_stmts_raw)
    is_financial_inst = _is_financial_institution(sorted_stmts_raw[-1]) if sorted_stmts_raw else False

    all_ratios = trends.get("ratios_by_year") or [{}]
    all_z = trends.get("altman_z_scores") or [{}]
    last_ratios = next((r for r in reversed(all_ratios) if r.get("current_ratio") is not None), all_ratios[-1] if all_ratios else {})
    last_z = next((z for z in reversed(all_z) if z.get("z_score") is not None and z.get("components")), all_z[-1] if all_z else {})
    consecutive_losses = trends.get("consecutive_losses", 0)

    # ── Availability mask ──────────────────────────────────────────────────────
    has_pnl = any(
        _get(s, "mainActivityRevenue", None) is not None or _get(s, "netProfitLoss", None) is not None
        for s in sorted_stmts_raw
    ) if sorted_stmts_raw else False
    has_cf = any(_get(s, "operatingCashFlow", None) is not None for s in sorted_stmts_raw) if sorted_stmts_raw else False
    has_audit = False
    for stmt in reversed(sorted_stmts_raw):
        op = getattr(stmt, "auditorOpinion", None) or (stmt.get("auditorOpinion") if isinstance(stmt, dict) else None)
        if op:
            op_type = getattr(op, "opinionType", "") or (op.get("opinionType", "") if isinstance(op, dict) else "")
            if op_type and str(op_type).lower() != "null":
                has_audit = True
                break

    has_balance = any(
        _get(s, "totalAssets", None) is not None and _get(s, "equity", None) is not None
        for s in sorted_stmts_raw
    ) if sorted_stmts_raw else False
    has_revenue_trend = trends.get("cagr_revenue") is not None
    has_equity_trend = bool(trends.get("equity_trend", []))

    availability = {
        "balance_sheet": has_balance,
        "pnl": has_pnl,
        "cash_flow": has_cf,
        "audit": has_audit,
        "revenue_trend": has_revenue_trend,
        "equity_trend": has_equity_trend,
    }

    # ── DQ Score (samostatný, nie multiplier) ──────────────────────────────────
    dq_score = _compute_data_quality_score(sorted_stmts_raw, has_pnl, has_cf, has_audit, entity_type)

    # Piotroski (computed once, used conditionally)
    piotroski = compute_piotroski_f_score(sorted_stmts_raw)

    pillars = []

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 1 — Platobná schopnosť & Exekúcie
    # Komponenty: current_ratio (12), equity_to_debt (12), vestník events (6)
    # Available pre všetky entity types (súvaha je zvyčajne dostupná)
    # ══════════════════════════════════════════════════════════════════════════
    p1_components = {}  # {name: (score, max, available)}
    p1_flags = []

    cr = last_ratios.get("current_ratio")
    if is_financial_inst:
        p1_components["current_ratio"] = (10, 12, True)
        p1_flags.append("Current ratio: N/A — finančná inštitúcia")
    elif cr is None:
        p1_components["current_ratio"] = (None, 12, False)
        p1_flags.append("Current ratio: N/A")
    elif cr >= 1.5:
        p1_components["current_ratio"] = (12, 12, True)
        p1_flags.append(f"Current ratio: {cr:.2f} — výborná likvidita")
    elif cr >= 1.0:
        p1_components["current_ratio"] = (8, 12, True)
        p1_flags.append(f"Current ratio: {cr:.2f} — dostatočná likvidita")
    elif cr >= 0.5:
        p1_components["current_ratio"] = (4, 12, True)
        p1_flags.append(f"Current ratio: {cr:.2f} — problematická likvidita")
    else:
        p1_components["current_ratio"] = (0, 12, True)
        p1_flags.append(f"Current ratio: {cr:.2f} — kritická likvidita")

    equity_to_debt = last_z.get("components", {}).get("x4_equity_to_debt", None)
    if is_financial_inst:
        _eq = _get(sorted_stmts_raw[-1], "equity", None) if sorted_stmts_raw else None
        if _eq is not None and _eq > 0:
            p1_components["equity"] = (12, 12, True)
            p1_flags.append("Vlastné imanie: kladné")
        elif _eq is not None and _eq < 0:
            p1_components["equity"] = (0, 12, True)
            p1_flags.append("Vlastné imanie: ZÁPORNÉ")
        else:
            p1_components["equity"] = (None, 12, False)
            p1_flags.append("Vlastné imanie: N/A")
    elif equity_to_debt is None:
        # Try direct equity check
        _eq = _get(sorted_stmts_raw[-1], "equity", None) if sorted_stmts_raw else None
        if _eq is not None:
            if _eq > 0:
                p1_components["equity"] = (12, 12, True)
                p1_flags.append("Vlastné imanie: kladné")
            else:
                p1_components["equity"] = (0, 12, True)
                p1_flags.append("Vlastné imanie: ZÁPORNÉ")
        else:
            p1_components["equity"] = (None, 12, False)
            p1_flags.append("Vlastné imanie: N/A")
    elif equity_to_debt > 0:
        p1_components["equity"] = (12, 12, True)
        p1_flags.append("Vlastné imanie: kladné")
    else:
        p1_components["equity"] = (0, 12, True)
        p1_flags.append("Vlastné imanie: ZÁPORNÉ")

    # Vestník events
    crit_events_penalty = 0
    for e in vestnik_events:
        sev = e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "")
        if sev in ("CRITICAL", "HIGH"):
            crit_events_penalty += compute_vestnik_degradation(e)
    if crit_events_penalty == 0:
        p1_components["vestnik"] = (6, 6, True)
        p1_flags.append("Vestník: žiadne kritické udalosti")
    elif crit_events_penalty < 1.0:
        p1_components["vestnik"] = (3, 6, True)
        p1_flags.append("Vestník: staré kritické udalosti")
    else:
        p1_components["vestnik"] = (0, 6, True)
        p1_flags.append(f"Vestník: aktívne kritické udalosti")

    # Renormalize P1
    p1_avail = [(s, m) for s, m, a in p1_components.values() if a]
    p1_total_avail = sum(m for _, m in p1_avail)
    p1_score_avail = sum(s for s, _ in p1_avail)
    p1_raw = int(round((p1_score_avail / p1_total_avail * 30) if p1_total_avail > 0 else 0))
    p1_score = int(round((p1_raw / 30.0) * nace_w["P1"]))

    if hard_stop_triggered:
        p1_score = 0
        p1_flags = ["HARD STOP — Konkurz/Likvidácia/Reštrukturalizácia"]

    pillars.append(ScorecardPillar(
        name="Platobná schopnosť & Exekúcie",
        score=p1_score, max_score=nace_w["P1"],
        detail=" | ".join(p1_flags[:2]), flags=p1_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 2 — Finančné zdravie
    # Commercial: Altman Z'' (20) + Piotroski (10)
    # Public/Nonprofit: Equity ratio (15) + Piotroski (15) [bez Altman]
    # Komponenty sa renormalizujú podľa dostupnosti
    # ══════════════════════════════════════════════════════════════════════════
    p2_components = {}
    p2_flags = []

    if startup_info.get("is_startup"):
        p2_components["altman"] = (15, 20, True)
        p2_flags.append(f"STARTUP profil (Altman neaplikovateľné)")
    elif is_financial_inst:
        p2_components["altman"] = (15, 20, True)
        p2_flags.append("Altman Z'': N/A — finančná inštitúcia")
    elif entity_type != "commercial":
        # Pre public/nonprofit: Altman nie je aplikovateľný — použijeme equity ratio
        p2_components["altman"] = (None, 20, False)
        p2_flags.append("Altman Z'': N/A — neaplikovateľné pre tento typ entity")
        # Equity ratio ako náhrada — dostupné z BS (totalAssets, equity)
        _eq = _get(sorted_stmts_raw[-1], "equity", None) if sorted_stmts_raw else None
        _ta = _get(sorted_stmts_raw[-1], "totalAssets", None) if sorted_stmts_raw else None
        if _eq is not None and _ta is not None and _ta > 0:
            eq_ratio = _eq / _ta
            if eq_ratio >= 0.5:
                p2_components["equity_ratio"] = (15, 15, True)
                p2_flags.append(f"Equity ratio: {eq_ratio:.1%} — silná kapitalizácia")
            elif eq_ratio >= 0.3:
                p2_components["equity_ratio"] = (10, 15, True)
                p2_flags.append(f"Equity ratio: {eq_ratio:.1%} — adekvátna")
            elif eq_ratio >= 0.1:
                p2_components["equity_ratio"] = (5, 15, True)
                p2_flags.append(f"Equity ratio: {eq_ratio:.1%} — nízka")
            else:
                p2_components["equity_ratio"] = (0, 15, True)
                p2_flags.append(f"Equity ratio: {eq_ratio:.1%} — kritická")
        else:
            p2_components["equity_ratio"] = (None, 15, False)
            p2_flags.append("Equity ratio: N/A — chýba súvaha")
    else:
        z_score_val = last_z.get("z_score")
        z_zone = last_z.get("zone", "N/A")
        if z_score_val is None:
            # Altman nedá sa vypočítať — N/A
            p2_components["altman"] = (None, 20, False)
            p2_flags.append("Altman Z'': N/A — nedostatok dát")
        elif z_zone == "SAFE":
            p2_components["altman"] = (min(20, int(15 + (z_score_val - 2.6) / (5.0 - 2.6) * 5)), 20, True)
            p2_flags.append(f"Altman Z'': {z_score_val:.2f} — safe zone")
        elif z_zone == "GREY":
            p2_components["altman"] = (min(14, int(7 + (z_score_val - 1.1) / (2.6 - 1.1) * 7)), 20, True)
            p2_flags.append(f"Altman Z'': {z_score_val:.2f} — grey zone")
        else:
            p2_components["altman"] = (max(0, min(4, int((z_score_val / 1.1) * 4))), 20, True)
            p2_flags.append(f"Altman Z'': {z_score_val:.2f} — distress zone")

    # Piotroski — relevantný pre commercial a nonprofit, obmedzene pre public
    if entity_type == "public":
        p2_components["piotroski"] = (None, 10, False)
        p2_flags.append("Piotroski: N/A — verejný sektor")
    else:
        pio_score = piotroski.get("score")
        if pio_score is not None:
            p2_components["piotroski"] = (min(10, int((pio_score / 8.0) * 10)), 10, True)
            p2_flags.append(f"Piotroski F-score: {pio_score}/8")
        else:
            p2_components["piotroski"] = (None, 10, False)
            p2_flags.append("Piotroski: N/A")

    # Renormalize P2
    p2_avail = [(s, m) for s, m, a in p2_components.values() if a]
    p2_total_avail = sum(m for _, m in p2_avail)
    p2_score_avail = sum(s for s, _ in p2_avail)
    if p2_total_avail > 0:
        p2_raw = int(round(p2_score_avail / p2_total_avail * 30))
    else:
        # All components N/A — neutral, nie 0
        p2_raw = 5
    p2_score = int(round((p2_raw / 30.0) * nace_w["P2"]))

    pillars.append(ScorecardPillar(
        name="Finančné zdravie",
        score=p2_score, max_score=nace_w["P2"],
        detail=" | ".join(p2_flags[:2]), flags=p2_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 3 — Ziskovosť & Stabilita & CF
    # Komponenty: profitability (10), margins/ROA (5), cash flow (15)
    # Pre public/nonprofit: profitability a CF sú N/A (často nemajú P&L)
    # ══════════════════════════════════════════════════════════════════════════
    p3_components = {}
    p3_flags = []
    n_years = len(sorted_stmts_raw)

    if n_years == 0:
        p3_components["profitability"] = (None, 10, False)
        p3_components["margins"] = (None, 5, False)
        p3_components["cash_flow"] = (None, 15, False)
        p3_flags.append("DATA VOID")
    else:
        # Profitability — available len ak máme netProfitLoss
        has_profit_data = any(_get(s, "netProfitLoss", None) is not None for s in sorted_stmts_raw)
        if not has_profit_data:
            p3_components["profitability"] = (None, 10, False)
            p3_flags.append("Ziskovosť: N/A — chýba P&L")
        else:
            profitable_years = sum(
                1 for s in sorted_stmts_raw
                if (_get(s, "netProfitLoss", 0) or 0) > 0
            )
            if profitable_years >= 5: p3_components["profitability"] = (10, 10, True)
            elif profitable_years >= 3: p3_components["profitability"] = (7, 10, True)
            elif profitable_years >= 1: p3_components["profitability"] = (4, 10, True)
            else: p3_components["profitability"] = (0, 10, True)
            p3_flags.append(f"Ziskovosť: {profitable_years}/{n_years} rokov v zisku")

        # Margins/ROA — available len ak máme netProfitLoss v dátach
        has_npl = any(_get(s, "netProfitLoss", None) is not None for s in sorted_stmts_raw)
        if not has_npl:
            p3_components["margins"] = (None, 5, False)
            p3_flags.append("Marže/ROA: N/A — chýba P&L")
        else:
            npm = last_ratios.get("net_profit_margin_pct")
            roa = last_ratios.get("roa_pct")
            if npm is None and roa is None:
                p3_components["margins"] = (None, 5, False)
                p3_flags.append("Marže/ROA: N/A — chýba P&L")
            else:
                m_score = 0
                if npm is not None and npm >= 10: m_score += 3
                if roa is not None and roa >= 5: m_score += 2
                p3_components["margins"] = (m_score, 5, True)

        if consecutive_losses >= 3 and has_profit_data:
            cur_s, cur_m, _ = p3_components.get("profitability", (0, 10, True))
            p3_components["profitability"] = (max(0, cur_s - min(10, consecutive_losses * 3)), cur_m, True)
            p3_flags.append(f"Penalizácia: {consecutive_losses} roky strata")

        # Cash Flow
        op_cf_raw = _get(sorted_stmts_raw[-1], "operatingCashFlow", None) if sorted_stmts_raw else None
        rev = _get(sorted_stmts_raw[-1], "mainActivityRevenue", 0) or 0
        if is_financial_inst and op_cf_raw is not None and op_cf_raw < 0:
            p3_components["cash_flow"] = (12, 15, True)
            p3_flags.append("Cash Flow: N/A — finančná inštitúcia")
        elif op_cf_raw is not None:
            op_cf = op_cf_raw
            if op_cf > 0:
                if rev > 0 and (op_cf / rev) > 0.10:
                    p3_components["cash_flow"] = (15, 15, True)
                    p3_flags.append("Cash Flow: Silný (CF/Rev > 10%)")
                else:
                    p3_components["cash_flow"] = (7, 15, True)
                    p3_flags.append("Cash Flow: Kladný")
            else:
                p3_components["cash_flow"] = (0, 15, True)
                p3_flags.append("Cash Flow: Záporný (riziko)")
        else:
            p3_components["cash_flow"] = (None, 15, False)
            p3_flags.append("Cash Flow: N/A")

    # Renormalize P3
    p3_avail = [(s, m) for s, m, a in p3_components.values() if a]
    p3_total_avail = sum(m for _, m in p3_avail)
    p3_score_avail = sum(s for s, _ in p3_avail)
    if p3_total_avail > 0:
        p3_raw = int(round(p3_score_avail / p3_total_avail * 30))
    else:
        # All components N/A — neutral, nie 0 (chýbajúce dáta != riziko)
        p3_raw = 5
    p3_score = int(round((p3_raw / 30.0) * nace_w["P3"]))

    pillars.append(ScorecardPillar(
        name="Ziskovosť, Stabilita a Cash Flow",
        score=p3_score, max_score=nace_w["P3"],
        detail=" | ".join(p3_flags[:2]), flags=p3_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 4 — Rast & Trendová sila
    # Komponenty: CAGR (10), equity trend (5), revenue decline (penalty)
    # CAGR je N/A ak nemáme revenue dáta, equity trend z BS
    # ══════════════════════════════════════════════════════════════════════════
    p4_components = {}
    p4_flags = []

    cagr = trends.get("cagr_revenue")
    if cagr is None:
        p4_components["cagr"] = (None, 10, False)
        p4_flags.append("CAGR tržieb: N/A")
    elif cagr >= 15:
        p4_components["cagr"] = (10, 10, True)
        p4_flags.append(f"CAGR: +{cagr:.1f}%")
    elif cagr >= 10:
        p4_components["cagr"] = (8, 10, True)
        p4_flags.append(f"CAGR: +{cagr:.1f}%")
    elif cagr >= 5:
        p4_components["cagr"] = (6, 10, True)
        p4_flags.append(f"CAGR: +{cagr:.1f}%")
    elif cagr >= 0:
        p4_components["cagr"] = (3, 10, True)
        p4_flags.append("CAGR: stagnácia")
    else:
        p4_components["cagr"] = (max(0, int(3 + cagr/5)), 10, True)
        p4_flags.append("CAGR: pokles")

    # Equity trend — samostatný komponent, dostupný z BS (netreba revenue)
    equity_trend = trends.get("equity_trend", [])
    if equity_trend:
        last_eq_change = equity_trend[-1].get("yoy_pct")
        if last_eq_change is not None:
            if last_eq_change > 10:
                p4_components["equity_trend"] = (5, 5, True)
                p4_flags.append(f"Vlastné imanie rastie: +{last_eq_change:.1f}%")
            elif last_eq_change > 0:
                p4_components["equity_trend"] = (3, 5, True)
                p4_flags.append(f"Vlastné imanie: +{last_eq_change:.1f}%")
            elif last_eq_change == 0:
                p4_components["equity_trend"] = (2, 5, True)
                p4_flags.append("Vlastné imanie: stabilné")
            else:
                p4_components["equity_trend"] = (0, 5, True)
                p4_flags.append(f"Vlastné imanie klesá: {last_eq_change:.1f}%")
        else:
            p4_components["equity_trend"] = (None, 5, False)
            p4_flags.append("Equity trend: N/A")
    else:
        p4_components["equity_trend"] = (None, 5, False)
        if not p4_flags or "N/A" not in p4_flags[-1]:
            p4_flags.append("Equity trend: N/A")

    # Revenue decline penalty — applies to CAGR component
    rev_trend = trends.get("revenue_trend", [])
    if len(rev_trend) >= 3:
        last3 = [r.get("growth_percent", 0) for r in rev_trend[-3:]]
        if all(g < 0 for g in last3):
            cur_s, cur_m, cur_a = p4_components.get("cagr", (0, 10, True))
            cur_s = cur_s if cur_s is not None else 0
            p4_components["cagr"] = (max(0, cur_s - 3), cur_m, cur_a)
            p4_flags.append("Tržby klesajú 3 roky (−3 body)")

    # Renormalize P4
    p4_avail = [(s, m) for s, m, a in p4_components.values() if a]
    p4_total_avail = sum(m for _, m in p4_avail)
    p4_score_avail = sum(s for s, _ in p4_avail)
    if p4_total_avail > 0:
        p4_raw = int(round(p4_score_avail / p4_total_avail * 15))
    else:
        # All components N/A — neutral, nie 0
        p4_raw = 3
    p4_score = int(round((p4_raw / 15.0) * nace_w["P4"]))

    pillars.append(ScorecardPillar(
        name="Rast & Trendová sila",
        score=p4_score, max_score=nace_w["P4"],
        detail=" | ".join(p4_flags[:2]), flags=p4_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 5 — Právna bezúhonnosť (rovnaká ako V2)
    # ══════════════════════════════════════════════════════════════════════════
    p5_raw = 10
    p5_flags = []

    pen_critical = 0
    pen_high = 0
    pen_med = 0
    for e in vestnik_events:
        sev = e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "LOW")
        deg = compute_vestnik_degradation(e)
        if sev == "CRITICAL": pen_critical += 10 * deg
        elif sev == "HIGH": pen_high += 4 * deg
        elif sev == "MEDIUM": pen_med += 2 * deg

    if pen_critical >= 5:
        p5_raw = 0
        p5_flags.append("KRITICKÉ udalosti vo Vestníku")
    elif pen_high >= 2:
        p5_raw = max(0, 6 - int(pen_high))
        p5_flags.append("VYSOKÉ udalosti vo Vestníku")
    elif pen_med >= 1:
        p5_raw = max(0, 8 - int(pen_med))
        p5_flags.append("STREDNÉ udalosti vo Vestníku")
    elif vestnik_events:
        p5_raw = 9
        p5_flags.append("Len nízko-rizikové záznamy vo Vestníku")
    else:
        p5_flags.append("Bez záznamu v Obchodnom vestníku ✓")

    # Audit opinion v P5 (ak je dostupný)
    for stmt in reversed(sorted_stmts_raw):
        op = getattr(stmt, "auditorOpinion", None) or (stmt.get("auditorOpinion") if isinstance(stmt, dict) else None)
        if op:
            op_type = getattr(op, "opinionType", "") or (op.get("opinionType", "") if isinstance(op, dict) else "")
            if op_type and str(op_type).lower() != "null":
                op_lower = str(op_type).lower()
                if "bez výhrad" in op_lower or "unqualified" in op_lower or "ohne vorbehalt" in op_lower:
                    p5_flags.append("Audítorský posudok: bez výhrad ✓")
                else:
                    p5_raw = max(0, p5_raw - 3)
                    p5_flags.append(f"Audítorský posudok: {op_type} (−3b)")
                break

    p5_raw = max(0, min(10, p5_raw))
    p5_score = int(round((p5_raw / 10.0) * nace_w["P5"]))
    pillars.append(ScorecardPillar(
        name="Právna bezúhonnosť",
        score=p5_score, max_score=nace_w["P5"],
        detail=" | ".join(p5_flags[:2]), flags=p5_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # FINANCIAL SCORE — súčet pilierov (bez DQ multiplier!)
    # ══════════════════════════════════════════════════════════════════════════
    financial_score = sum(p.score for p in pillars)
    financial_score = max(0, min(100, financial_score))

    if hard_stop_triggered:
        financial_score = 0

    risk_cat = _risk_category(financial_score)
    risk_lvl = _risk_level(hard_stop_triggered, financial_score, vestnik_events)

    return ScorecardResultV3(
        financial_score=financial_score,
        data_quality_score=dq_score,
        risk_category=risk_cat,
        risk_level=risk_lvl,
        entity_type=entity_type,
        hard_stop=hard_stop_triggered,
        pillars=pillars,
        availability_mask=availability,
        score_version="v3"
    )

def compute_financial_trends(statements: List[Any]) -> Dict[str, Any]:
    """
    Vypočíta 5-ročné trendy (CAGR, rast, stabilita, Altman Z-score, ratios) z finančných výkazov.
    Statements musia byť zoradené chronologicky (od najstaršieho po najnovšie).
    """
    if not statements:
        return {"error": "Žiadne dáta na výpočet trendov."}

    # Sanitizácia: konverzia Decimal (z DB po migrácii Float→Decimal) na float.
    # Toto zabezpečí že všetky aritmetické operácie v downstream funkciách budú
    # pracovať s float hodnotami, nie Decimal (ktorý nepodporuje * float).
    sanitized = [_sanitize_stmt_numeric(s) for s in statements]

    # Zoradiť vzostupne podľa roku (najstaršie prvé)
    sorted_stmts = sorted(sanitized, key=lambda x: _get(x, 'year', 0) or 0)

    # Filter: pre trend/CAGR analýzu používať len ročné výkazy (monthsInPeriod=12).
    # Krátke obdobia (3-mesačné, PARTIAL) sa nesmú použiť ako ročné dáta —
    # CAGR z 3M revenue by bol nesprávny (napr. 100M Q1 × 4 ≠ 400M FY).
    # Balance sheet ratios (Altman, likvidita) môžu použiť všetky výkazy
    # (súvaha je stav k dátumu, nie prietok).
    annual_stmts = [s for s in sorted_stmts if (_get(s, 'monthsInPeriod', 12) or 12) == 12]

    # Ak nemáme aspoň 2 ročné výkazy, použijeme všetky (fallback) —
    # ale CAGR bude None (nespoľahlivé).
    trend_stmts = annual_stmts if len(annual_stmts) >= 2 else sorted_stmts

    first = trend_stmts[0]
    last = trend_stmts[-1]
    first_year = _get(first, 'year', 0)
    last_year = _get(last, 'year', 0)
    years_span = last_year - first_year
    
    trends = {
        "analyzed_years": [_get(s, 'year', 0) for s in sorted_stmts],
        "revenue_trend": [],
        "profit_trend": [],
        "equity_trend": [],
        "cagr_revenue": None,
        "average_profit": sum((_get(s, 'netProfitLoss', 0) or 0) for s in annual_stmts) / len(annual_stmts) if annual_stmts else 0,
        "consecutive_losses": 0,
        "bankruptcy_risk_indicators": [],
        # Nové: Altman Z-score pre každý rok
        "altman_z_scores": [],
        # Nové: Finančné ukazovatele pre každý rok
        "ratios_by_year": [],
        "algorithmic_prescore": None
    }
    
    # Výpočet CAGR (Zložená ročná miera rastu) pre Tržby
    # CAGR sa počíta IBA z ročných výkazov (monthsInPeriod=12).
    # Ak nemáme aspoň 2 ročné výkazy, CAGR = None (UNKNOWN).
    if len(annual_stmts) >= 2 and years_span > 0:
        first_rev = _get(first, 'mainActivityRevenue', None) or 0
        last_rev = _get(last, 'mainActivityRevenue', None) or 0
        if first_rev > 0 and last_rev > 0:
            cagr = ((last_rev / first_rev) ** (1 / years_span)) - 1
            trends["cagr_revenue"] = round(cagr * 100, 2)
        
    # Počet po sebe idúcich strát od konca (iba ročné výkazy — 3M strata ≠ FY strata)
    losses = 0
    for s in reversed(annual_stmts if annual_stmts else sorted_stmts):
        if (_get(s, 'netProfitLoss', 0) or 0) < 0:
            losses += 1
        else:
            break
    trends["consecutive_losses"] = losses
    
    # Indikátory finančného stresu
    last_equity = _get(last, 'equity', 0) or 0
    if last_equity < 0:
        trends["bankruptcy_risk_indicators"].append("Záporné vlastné imanie (Spoločnosť je pod finančným stresom)")
    if losses >= 3:
        trends["bankruptcy_risk_indicators"].append(f"{losses} roky po sebe idúcej čistej straty")
        
    last_liabilities = _get(last, 'shortTermLiabilities', 0) or 0
    last_assets = _get(last, 'totalAssets', 0) or 0
    if last_liabilities > last_assets and last_assets > 0:
        trends["bankruptcy_risk_indicators"].append("Krátkodobé záväzky prevyšujú celkové aktíva (Riziko insolvencie)")
    
    # Altman Z-score a finančné ukazovatele pre každý rok
    # Ak najnovší rok je finančná inštitúcia, aplikuj výnimku na všetky roky
    # (staršie roky mohli mať currentAssets vyplnené, ale entita je stále F.I.)
    is_financial_inst_all = _is_financial_institution(last)
    for s in sorted_stmts:
        yr = _get(s, 'year', 0)
        z = compute_altman_z_score(s, force_financial_inst=is_financial_inst_all)
        ratios = compute_financial_ratios(s)
        trends["altman_z_scores"].append({"year": yr, **z})
        trends["ratios_by_year"].append({"year": yr, **ratios})

        # Altman varovanie ako indikátor finančného stresu
        if z.get("zone") == "DISTRESS":
            trends["bankruptcy_risk_indicators"].append(
                f"Altman Z-score {yr}: {z['z_score']} — {z['zone_label']}"
            )

    # Beneish M-score (earnings manipulation detection)
    beneish = compute_beneish_m_score(sorted_stmts)
    trends["beneish_m_score"] = beneish
    if beneish.get("is_manipulator"):
        trends["bankruptcy_risk_indicators"].append(beneish["flags"][0])
        
    # Medziročné zmeny (YoY)
    for i in range(1, len(sorted_stmts)):
        prev = sorted_stmts[i-1]
        curr = sorted_stmts[i]
        curr_year = _get(curr, 'year', 0)
        
        prev_rev = _get(prev, 'mainActivityRevenue', 0) or 0
        curr_rev = _get(curr, 'mainActivityRevenue', 0) or 0
        
        # Anualizácia tržieb pre korektný YoY výpočet pri posunutých hospodárskych rokoch
        prev_months = _get(prev, 'monthsInPeriod', 12) or 12
        curr_months = _get(curr, 'monthsInPeriod', 12) or 12

        # Konverzia na float — hodnoty z DB môžu byť Decimal (po migrácii Float→Decimal)
        prev_rev = float(prev_rev)
        curr_rev = float(curr_rev)

        ann_prev_rev = prev_rev * (12 / prev_months) if prev_months > 0 else prev_rev
        ann_curr_rev = curr_rev * (12 / curr_months) if curr_months > 0 else curr_rev
        
        prev_profit = _get(prev, 'netProfitLoss', 0) or 0
        curr_profit = _get(curr, 'netProfitLoss', 0) or 0
        prev_equity = _get(prev, 'equity', 0) or 0
        curr_equity = _get(curr, 'equity', 0) or 0
        
        rev_growth = ((ann_curr_rev - ann_prev_rev) / ann_prev_rev * 100) if ann_prev_rev != 0 else (100.0 if ann_curr_rev > 0 else 0.0)
        profit_delta_pct = ((curr_profit - prev_profit) / abs(prev_profit) * 100) if prev_profit != 0 else None
        equity_delta_pct = ((curr_equity - prev_equity) / abs(prev_equity) * 100) if prev_equity != 0 else None

        trends["revenue_trend"].append({
            "year": curr_year,
            "growth_percent": round(rev_growth, 2)
        })
        trends["profit_trend"].append({
            "year": curr_year,
            "value": curr_profit,
            "yoy_pct": round(profit_delta_pct, 2) if profit_delta_pct is not None else None
        })
        trends["equity_trend"].append({
            "year": curr_year,
            "value": curr_equity,
            "yoy_pct": round(equity_delta_pct, 2) if equity_delta_pct is not None else None
        })
        
    # (Skóre sa teraz počíta v pipeline.py volaním compute_forensic_scorecard)
        
    return trends


# ── Štátne záväzky — rizikový alert ──────────────────────────────────────────

def compute_state_liabilities_alert(statements: list, scraper_results: dict = None) -> dict:
    """
    Detekuje záväzky voči zamestnancom, SP a štátu z RÚZ dát.

    Toto sú záväzky z riadkov 131-133 šablóny Úč POD (SK GAAP), ktoré LLM
    extrahuje zo sekcie 'ZÁVÄZKY VOČI ŠTÁTU A SP (RIZIKOVÉ INDIKÁTORY)' v .txt.

    Pozor: tieto sú bežné ročné accruals v súvahu — nepotvrdzujú automaticky
    že firma je v registri dlžníkov. Cross-referencujeme s výsledkami scraperov
    (SP_DLZNICI, FINANCNA_SPRAVA) — ak scraper nenašiel záznam, downgradneme
    severity z CRITICAL na WARNING a zmeníme messaging.

    Rizikové prahy:
    - SP záväzky > 5 000 EUR → amber, > 20 000 EUR → red (ak v registri dlžníkov)
    - Daňové záväzky > 10 000 EUR → amber, > 50 000 EUR → red (ak v registri dlžníkov)
    - Záväzky voči zamestnancom > 10 000 EUR → amber (nevyplatené mzdy)

    Vracia slovník s:
      alerts: list[dict(field, value, severity, message)]
      has_critical: bool
    """
    if not statements:
        return {"alerts": [], "has_critical": False}

    latest = _sanitize_stmt_numeric(statements[-1])
    alerts = []
    has_critical = False

    sp = _get(latest, "stateLiabilitiesSP", None) or _get(latest, "socialInsuranceLiabilities", None)
    dan = _get(latest, "stateLiabilitiesTax", None) or _get(latest, "taxLiabilities", None)
    zam = _get(latest, "employeeLiabilities", None)
    year = _get(latest, "year", "?")

    def _fmt(v: float) -> str:
        return f"{int(v):,} EUR".replace(",", " ")

    # Cross-referencia s registrami dlžníkov
    _sp_in_registry = False
    _tax_in_registry = False
    if scraper_results:
        sp_src = scraper_results.get("SP_DLZNICI")
        if sp_src and sp_src.get("has_record"):
            _sp_in_registry = True
        tax_src = scraper_results.get("FINANCNA_SPRAVA")
        if tax_src and tax_src.get("has_record"):
            _tax_in_registry = True

    if sp is not None and sp > 0:
        if sp > 20_000 and _sp_in_registry:
            alerts.append({
                "field": "socialInsuranceLiabilities",
                "value": sp,
                "severity": "CRITICAL",
                "message": f"KRITICKÉ: Firma je v registri dlžníkov SP a súvaha ukazuje záväzky {_fmt(sp)} (rok {year}). "
                           f"Môže súvisieť s povinnosťami štatutára podľa §278 TZ SR.",
            })
            has_critical = True
        elif sp > 20_000 and not _sp_in_registry:
            alerts.append({
                "field": "socialInsuranceLiabilities",
                "value": sp,
                "severity": "INFO",
                "message": f"INFO: Súvaha ukazuje záväzky zo sociálneho poistenia {_fmt(sp)} (rok {year}). "
                           f"Firma nie je v registri dlžníkov SP — ide o bežné ročné accruals.",
            })
        elif sp > 5_000 and _sp_in_registry:
            alerts.append({
                "field": "socialInsuranceLiabilities",
                "value": sp,
                "severity": "WARNING",
                "message": f"Záväzky zo sociálneho poistenia {_fmt(sp)} (rok {year}) — firma je v registri dlžníkov SP, monitorovať.",
            })
        elif sp > 5_000:
            alerts.append({
                "field": "socialInsuranceLiabilities",
                "value": sp,
                "severity": "INFO",
                "message": f"Záväzky zo sociálneho poistenia {_fmt(sp)} (rok {year}) — firma nie je v registri dlžníkov SP.",
            })

    if dan is not None and dan > 0:
        if dan > 50_000 and _tax_in_registry:
            alerts.append({
                "field": "taxLiabilities",
                "value": dan,
                "severity": "CRITICAL",
                "message": f"KRITICKÉ: Firma je v zozname daňových dlžníkov a súvaha ukazuje daňové záväzky {_fmt(dan)} (rok {year}). "
                           f"Riziko daňovej exekúcie a záložného práva na majetok.",
            })
            has_critical = True
        elif dan > 50_000 and not _tax_in_registry:
            alerts.append({
                "field": "taxLiabilities",
                "value": dan,
                "severity": "INFO",
                "message": f"INFO: Súvaha ukazuje daňové záväzky {_fmt(dan)} (rok {year}). "
                           f"Firma nie je v zozname daňových dlžníkov FS — ide o bežné ročné accruals.",
            })
        elif dan > 10_000 and _tax_in_registry:
            alerts.append({
                "field": "taxLiabilities",
                "value": dan,
                "severity": "WARNING",
                "message": f"Daňové záväzky {_fmt(dan)} (rok {year}) — firma je v zozname daňových dlžníkov FS, preveriť stav.",
            })
        elif dan > 10_000:
            alerts.append({
                "field": "taxLiabilities",
                "value": dan,
                "severity": "INFO",
                "message": f"Daňové záväzky {_fmt(dan)} (rok {year}) — firma nie je v zozname daňových dlžníkov FS.",
            })

    if zam is not None and zam > 10_000:
        alerts.append({
            "field": "employeeLiabilities",
            "value": zam,
            "severity": "WARNING",
            "message": f"Záväzky voči zamestnancom {_fmt(zam)} (rok {year}).",
        })

    return {"alerts": alerts, "has_critical": has_critical}


# ── Revenue per Employee — detekcia redukovanej substancie ────────────────────

def compute_revenue_per_employee_alert(statements: list) -> dict:
    """
    Vypočíta tržby na zamestnanca z najnovšieho výkazu.
    Ak nie je k dispozícii počet zamestnancov z titulnej strany, odhadne ho
    z mzdových nákladov (staffCosts / priemerná mzda 18 000 EUR/rok).

    Vracia slovník s:
      revenue_per_employee: float | None
      employee_count: int | None
      source: 'reported' | 'estimated' | None
      alert: dict | None  — ak je nepomer extrémny
    """
    if not statements:
        return {"revenue_per_employee": None, "employee_count": None, "source": None, "alert": None}

    latest = _sanitize_stmt_numeric(statements[-1])
    revenue = _get(latest, "mainActivityRevenue", None) or 0
    emp_count = _get(latest, "employeeCount", None)
    source = None

    if emp_count is not None and emp_count > 0:
        source = "reported"
    else:
        # Odhad z mzdových nákladov: staffCosts / 18 000 EUR (priemerná hrubá mzda SK)
        staff_costs = _get(latest, "staffCosts", None)
        if staff_costs and staff_costs > 0:
            emp_count = max(1, round(staff_costs / 18_000))
            source = "estimated"

    if emp_count is None or emp_count <= 0 or revenue <= 0:
        return {"revenue_per_employee": None, "employee_count": emp_count, "source": source, "alert": None}

    rpe = revenue / emp_count
    year = _get(latest, "year", "?")
    alert = None

    # Extrémny nepomer: tržby > 500k EUR ale 0-1 zamestnancov (reálnych)
    if emp_count <= 1 and revenue > 500_000:
        alert = {
            "severity": "CRITICAL",
            "message": (
                f"VYSOKÉ RIZIKO SCHRÁNKOVEJ ŠTRUKTÚRY: Tržby {int(revenue):,} EUR pri ≤1 zamestnancovi (rok {year}). "
                f"Prepoj s detektorom Bieleho koňa.".replace(",", " ")
            ),
        }
    elif rpe > 2_000_000:
        alert = {
            "severity": "WARNING",
            "message": (
                f"Extrémny nepomer: {int(rpe):,} EUR/zamestnanec (rok {year}). "
                f"Priemer SK: 80 000–200 000 EUR. Prever skutočnú pracovnú silu.".replace(",", " ")
            ),
        }

    return {
        "revenue_per_employee": round(rpe, 0),
        "employee_count": emp_count,
        "source": source,
        "alert": alert,
    }


# ── YoY súhrnná tabuľka ───────────────────────────────────────────────────────

def compute_yoy_summary_table(statements: list, i18n_strings: dict = None) -> dict:
    """
    Zostaví kompaktnú YoY tabuľku kľúčových ukazovateľov pre posledné roky.

    Vracia:
      headers: list[str]  — napr. ['Ukazovateľ', '2022', '2023', '2024', 'Δ% (YoY)']
      rows: list[dict]    — každý riadok: {label, values: list[str], delta_pct: str, flag: str}
      years: list[int]
    """
    _i = i18n_strings or {}
    if not statements:
        return {"headers": [], "rows": [], "years": []}

    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    statements = [_sanitize_stmt_numeric(s) for s in statements]

    sorted_stmts = sorted(statements, key=lambda s: _get(s, "year", 0) or 0)
    years = [_get(s, "year", "?") for s in sorted_stmts]

    def _pct(curr, prev) -> Optional[float]:
        if curr is None or prev is None or prev == 0:
            return None
        # Materiality threshold: ak obe hodnoty sú < 1000 €, YoY % je nezmyselné
        # (napr. 100→263 EUR = +163%, ale obe sa zobrazujú ako 0,00 mil. €)
        if abs(curr) < 1000 and abs(prev) < 1000:
            return None
        return round(((curr - prev) / abs(prev)) * 100, 1)

    def _fmt_eur(v) -> str:
        if v is None:
            return "—"
        try:
            val = float(v)
            return f"{val / 1_000_000:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ")
        except (ValueError, TypeError):
            return "—"

    def _fmt_pct(v) -> str:
        if v is None:
            return "—"
        sign = "+" if v > 0 else ""
        return f"{sign}{v:.1f} %"

    def _flag(delta: Optional[float], field: str) -> str:
        """Semafórová ikonka podľa smeru zmeny a kontextu."""
        if delta is None:
            return ""
        # Záporný čistý zisk, tržby, aktíva, vlastné imanie = červená
        negative_is_bad = field in ("revenue", "profit", "assets", "equity", "ebitda")
        if negative_is_bad:
            if delta <= -20:
                return "🔴"
            elif delta <= -5:
                return "🟡"
            elif delta >= 20:
                return "🟢"
        else:
            # Záväzky a náklady: rast = červená, pokles = zelená
            if delta >= 20:
                return "🔴"
            elif delta >= 5:
                return "🟡"
            elif delta <= -20:
                return "🟢"
        return ""

    _METRICS = [
        ("yoy_revenue", "mainActivityRevenue", "revenue"),
        ("yoy_net_profit", "netProfitLoss", "profit"),
        ("yoy_total_assets", "totalAssets", "assets"),
        ("yoy_equity", "equity", "equity"),
        ("yoy_short_liab", "shortTermLiabilities", "liab"),
        ("yoy_social_ins_liab", "socialInsuranceLiabilities", "liab"),
        ("yoy_tax_liab", "taxLiabilities", "liab"),
        ("yoy_staff_costs", "staffCosts", "cost"),
        ("yoy_depreciation", "depreciation", "cost"),
        ("yoy_interest_expense", "interestExpense", "cost"),
        ("yoy_income_tax", "incomeTax", "cost"),
        ("yoy_profit_before_tax", "profitBeforeTax", "profit"),
    ]

    rows = []
    for i18n_key, field, ftype in _METRICS:
        values_raw = [_get(s, field, None) for s in sorted_stmts]

        # Posledná YoY zmena
        last = values_raw[-1] if values_raw else None
        prev = values_raw[-2] if len(values_raw) >= 2 else None
        delta = _pct(last, prev)

        # Preskočiť riadok ak sú všetky hodnoty None
        if all(v is None for v in values_raw):
            continue

        rows.append({
            "label": _i.get(i18n_key, i18n_key),
            "field": field,
            "vals": [_fmt_eur(v) for v in values_raw],
            "delta_pct": _fmt_pct(delta),
            "delta_raw": delta,
            "flag": _flag(delta, ftype),
        })

    headers = [_i.get("yoy_indicator", "Ukazovateľ")] + [str(y) for y in years] + [_i.get("yoy_delta", "Δ% (posl. rok)")]
    return {"headers": headers, "rows": rows, "years": years}


from typing import List, Dict, Any, Optional


# ── Altman Z-Score (modifikovaný pre ne-výrobné a súkromné firmy) ──────────────
# Model: Altman Z'' (1995) pre private / non-manufacturing
# Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
# X1 = Pracovný kapitál / Celkové aktíva
# X2 = Zadržané zisky / Celkové aktíva  (approximácia: Vlastné imanie / Celkové aktíva)
# X3 = EBIT / Celkové aktíva            (approximácia: Čistý zisk / Celkové aktíva)
# X4 = Účtovná hodnota vlastného imania / Celkové záväzky
#
# Interpretácia: Z'' > 2.6 = Bezpečná zóna | 1.1–2.6 = Šedá zóna | < 1.1 = Núdzová zóna

def compute_altman_z_score(stmt: Any) -> Dict[str, Any]:
    """
    Vypočíta Altman Z''-score pre jedno účtovné obdobie.
    Vráti skóre, zónu a komponentné hodnoty.
    """
    try:
        total_assets = getattr(stmt, 'totalAssets', 0) or 0
        current_assets = getattr(stmt, 'currentAssets', 0) or 0
        equity = getattr(stmt, 'equity', 0) or 0
        net_profit = getattr(stmt, 'netProfitLoss', 0) or 0
        short_liabilities = getattr(stmt, 'shortTermLiabilities', 0) or 0
        cash = getattr(stmt, 'cashAndEquivalents', 0) or 0

        if total_assets <= 0:
            return {"z_score": None, "zone": "N/A", "reason": "Nedostatok dát"}

        # Working capital = Obežný majetok - Krátkodobé záväzky
        # Ak máme currentAssets z DB, použijeme ho. Inak fallback na hrubý odhad.
        if current_assets > 0:
            working_capital = current_assets - short_liabilities
        else:
            working_capital = (total_assets * 0.6) - short_liabilities
        total_liabilities = total_assets - equity    # z bilančnej rovnice: A = E + L
        total_liabilities = max(total_liabilities, 1)  # ochrana pred delením nulou

        x1 = working_capital / total_assets
        x2 = equity / total_assets               # retained earnings approx
        x3 = net_profit / total_assets           # EBIT approx
        x4 = equity / total_liabilities

        z = round(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, 3)

        if z > 2.6:
            zone = "SAFE"
            zone_label = "Bezpečná zóna"
        elif z >= 1.1:
            zone = "GREY"
            zone_label = "Šedá zóna"
        else:
            zone = "DISTRESS"
            zone_label = "Núdzová zóna — riziko bankrotu"

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


def compute_financial_ratios(stmt: Any) -> Dict[str, Any]:
    """
    Vypočíta kľúčové finančné ukazovatele pre jedno obdobie.
    """
    try:
        total_assets = getattr(stmt, 'totalAssets', 0) or 0
        equity = getattr(stmt, 'equity', 0) or 0
        net_profit = getattr(stmt, 'netProfitLoss', 0) or 0
        short_liabilities = getattr(stmt, 'shortTermLiabilities', 0) or 0
        cash = getattr(stmt, 'cashAndEquivalents', 0) or 0
        revenue = getattr(stmt, 'mainActivityRevenue', 0) or 0
        op_cashflow = getattr(stmt, 'operatingCashFlow', 0) or 0
        total_liabilities = max(total_assets - equity, 1)

        ratios = {}

        # 1. Current Ratio (Likvidita) — krátkodobé krytie
        if short_liabilities > 0:
            ratios["current_ratio"] = round(cash / short_liabilities, 2)
        else:
            ratios["current_ratio"] = None

        # 2. Debt-to-Equity (Zadlženosť)
        if equity > 0:
            ratios["debt_to_equity"] = round(total_liabilities / equity, 2)
        else:
            ratios["debt_to_equity"] = None

        # 3. Net Profit Margin (Čistá marža)
        if revenue > 0:
            ratios["net_profit_margin_pct"] = round((net_profit / revenue) * 100, 2)
        else:
            ratios["net_profit_margin_pct"] = None

        # 4. Return on Assets — ROA
        if total_assets > 0:
            ratios["roa_pct"] = round((net_profit / total_assets) * 100, 2)
        else:
            ratios["roa_pct"] = None

        # 5. Operating Cash Flow / Net Profit — divergencia (červená vlajka ak záporné)
        if net_profit != 0:
            ratios["cashflow_to_profit"] = round(op_cashflow / net_profit, 2)
        else:
            ratios["cashflow_to_profit"] = None

        return ratios
    except Exception:
        return {}


def compute_financial_trends(statements: List[Any]) -> Dict[str, Any]:
    """
    Vypočíta 5-ročné trendy (CAGR, rast, stabilita, Altman Z-score, ratios) z finančných výkazov.
    Statements musia byť zoradené chronologicky (od najstaršieho po najnovšie).
    """
    if not statements:
        return {"error": "Žiadne dáta na výpočet trendov."}
        
    # Zoradiť vzostupne podľa roku (najstaršie prvé)
    sorted_stmts = sorted(statements, key=lambda x: getattr(x, 'year', 0))
    
    first = sorted_stmts[0]
    last = sorted_stmts[-1]
    first_year = getattr(first, 'year', 0)
    last_year = getattr(last, 'year', 0)
    years_span = last_year - first_year
    
    trends = {
        "analyzed_years": [getattr(s, 'year', 0) for s in sorted_stmts],
        "revenue_trend": [],
        "profit_trend": [],
        "equity_trend": [],
        "cagr_revenue": None,
        "average_profit": sum(getattr(s, 'netProfitLoss', 0) for s in sorted_stmts) / len(sorted_stmts) if sorted_stmts else 0,
        "consecutive_losses": 0,
        "bankruptcy_risk_indicators": [],
        # Nové: Altman Z-score pre každý rok
        "altman_z_scores": [],
        # Nové: Finančné ukazovatele pre každý rok
        "ratios_by_year": [],
    }
    
    # Výpočet CAGR (Zložená ročná miera rastu) pre Tržby
    first_rev = getattr(first, 'mainActivityRevenue', 0)
    last_rev = getattr(last, 'mainActivityRevenue', 0)
    if years_span > 0 and first_rev > 0 and last_rev > 0:
        cagr = ((last_rev / first_rev) ** (1 / years_span)) - 1
        trends["cagr_revenue"] = round(cagr * 100, 2)
        
    # Počet po sebe idúcich strát od konca
    losses = 0
    for s in reversed(sorted_stmts):
        if getattr(s, 'netProfitLoss', 0) < 0:
            losses += 1
        else:
            break
    trends["consecutive_losses"] = losses
    
    # Indikátory rizika úpadku
    last_equity = getattr(last, 'equity', 0)
    if last_equity < 0:
        trends["bankruptcy_risk_indicators"].append("Záporné vlastné imanie (Firma v kríze / Predĺženie)")
    if losses >= 3:
        trends["bankruptcy_risk_indicators"].append(f"{losses} roky po sebe idúcej čistej straty")
        
    last_liabilities = getattr(last, 'shortTermLiabilities', 0)
    last_assets = getattr(last, 'totalAssets', 0)
    if last_liabilities > last_assets and last_assets > 0:
        trends["bankruptcy_risk_indicators"].append("Krátkodobé záväzky prevyšujú celkové aktíva (Riziko insolvencie)")
    
    # Altman Z-score a finančné ukazovatele pre každý rok
    for s in sorted_stmts:
        yr = getattr(s, 'year', 0)
        z = compute_altman_z_score(s)
        ratios = compute_financial_ratios(s)
        trends["altman_z_scores"].append({"year": yr, **z})
        trends["ratios_by_year"].append({"year": yr, **ratios})

        # Altman varovanie ako bankrotový indikátor
        if z.get("zone") == "DISTRESS":
            trends["bankruptcy_risk_indicators"].append(
                f"Altman Z-score {yr}: {z['z_score']} — {z['zone_label']}"
            )
        
    # Medziročné zmeny (YoY) — teraz vrátane delta stĺpcov
    for i in range(1, len(sorted_stmts)):
        prev = sorted_stmts[i-1]
        curr = sorted_stmts[i]
        curr_year = getattr(curr, 'year', 0)
        
        prev_rev = getattr(prev, 'mainActivityRevenue', 0)
        curr_rev = getattr(curr, 'mainActivityRevenue', 0)
        prev_profit = getattr(prev, 'netProfitLoss', 0)
        curr_profit = getattr(curr, 'netProfitLoss', 0)
        prev_equity = getattr(prev, 'equity', 0)
        curr_equity = getattr(curr, 'equity', 0)
        
        rev_growth = ((curr_rev - prev_rev) / prev_rev * 100) if prev_rev != 0 else (100.0 if curr_rev > 0 else 0.0)
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
        
    return trends


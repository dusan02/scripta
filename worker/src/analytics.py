from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Union


def _get(obj: Any, attr: str, default: Any = None) -> Any:
    """Safely get an attribute from either a dict or an object."""
    if isinstance(obj, dict):
        return obj.get(attr, default)
    return getattr(obj, attr, default)


# ── Cash Flow sanitizácia ─────────────────────────────────────────────────────
# Reálna firma nemá presne 0 prevádzkový cash flow. Hodnota 0 je artefakt
# starého LLM promptu, ktorý hovoril "doplň nulu" pre chýbajúce CF dáta.
# Táto funkita konvertuje 0 → None na jednom mieste pre všetky volajúce.

_CF_FIELDS = ("operatingCashFlow", "investingCashFlow", "financingCashFlow")


def sanitize_cash_flow_fields(stmt: Union[Dict[str, Any], Any]) -> None:
    """Konvertuje 0 → None pre cash flow polia. Funguje na dict aj Prisma objektoch.
    Volá sa in-place (modifikuje vstup)."""
    for cf_field in _CF_FIELDS:
        if isinstance(stmt, dict):
            if stmt.get(cf_field) == 0:
                stmt[cf_field] = None
        else:
            if getattr(stmt, cf_field, None) == 0:
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
            approx_cf = net_profit + depreciation - (inv - inv_prev) - (recv - recv_prev) + (pay - pay_prev)
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

# ── Forenzný indikátor (Biely Kôň) ───────────────────────────────────────────
def compute_white_horse_indicator(statements: list) -> dict:
    """
    Vyhodnotí riziko 'Bieleho koňa' (Schránkovej firmy) na základe histórie metrík:
    osobné náklady, pohľadávky, záväzky vs tržby a aktíva.
    Očakáva zoznam výkazov utriedený od najstaršieho po najnovší.
    """
    score_penalty = 0
    flags = []

    if not statements:
        return {"penalty": 0, "flags": []}

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
        flags.append(f"Vysoké tržby ({rev_formatted} €), ale dlhodobo NULOVÉ mzdové náklady (silný znak schránkovej firmy)")
        
    # Znak fiktívneho účtovníctva: Pohľadávky tvoria viac ako 90% celkových aktív
    if assets > 0 and (receivables / assets) > 0.9:
        score_penalty += 10
        flags.append(f"Pohľadávky z OS tvoria >90% majetku (extrémne riziko nevykonateľných fiktívnych faktúr)")
        
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


def compute_altman_z_score(stmt: Any) -> Dict[str, Any]:
    """
    Vypočíta Altman Z''-score pre jedno účtovné obdobie.
    Vráti skóre, zónu a komponentné hodnoty.
    """
    try:
        total_assets = _get(stmt, 'totalAssets')
        current_assets = _get(stmt, 'currentAssets')
        equity = _get(stmt, 'equity')
        net_profit = _get(stmt, 'netProfitLoss')
        short_liabilities = _get(stmt, 'shortTermLiabilities')
        long_liabilities = _get(stmt, 'longTermLiabilities')

        if total_assets is None or total_assets <= 0 or net_profit is None or equity is None or short_liabilities is None:
            return {"z_score": None, "zone": "N/A", "reason": "Nedostatok dát pre výpočet"}

        current_assets = current_assets if current_assets is not None else 0
        long_liabilities = long_liabilities if long_liabilities is not None else 0

        # Working capital = Obežný majetok - Krátkodobé záväzky
        # Ak máme currentAssets z DB, použijeme ho. Inak fallback na hrubý odhad.
        if current_assets > 0:
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
        annualized_revenue = revenue * (12 / months_in_period) if months_in_period > 0 else revenue
        gross_profit = _get(stmt, 'grossProfit', 0) or 0
        inventory = _get(stmt, 'inventory', 0) or 0
        depreciation = _get(stmt, 'depreciation', 0) or 0
        interest = _get(stmt, 'interestExpense', 0) or 0
        trade_receivables = _get(stmt, 'tradeReceivables', 0) or 0
        trade_payables = _get(stmt, 'tradePayables', 0) or 0

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

        # ── EBITDA (approx: net_profit + interest + depreciation) ──
        # Náklady na úroky (interest) môžu byť v DB uložené ako záporné — prirátavame absolútnu hodnotu.
        ratios["ebitda"] = round(net_profit + abs(interest) + depreciation, 0)
        if ratios["ebitda"] is not None and revenue > 0:
            ratios["ebitda_margin_pct"] = round((ratios["ebitda"] / revenue) * 100, 2)
        else:
            ratios["ebitda_margin_pct"] = None

        # ── Cash Flow divergencia ──
        # Ak je operatingCashFlow None (nedostupné v RÚZ), vrátiť None — nie 0.0
        ratios["cashflow_to_profit"] = _safe_div(op_cashflow, abs(net_profit)) if (net_profit != 0 and op_cashflow_raw is not None) else None

        # ── Dni obratu ── (anualizované tržby pre korektnosť pri skrátených obdobiach)
        ratios["dso_days"] = round((trade_receivables / annualized_revenue) * 365, 0) if annualized_revenue > 0 and trade_receivables > 0 else None
        ratios["dpo_days"] = round((trade_payables / annualized_revenue) * 365, 0) if annualized_revenue > 0 and trade_payables > 0 else None

        return ratios
    except Exception:
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
    score_version: str = "v2"


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
    Škála: 0-8.
    Očakáva chronologicky zoradené statements.
    """
    if not statements or len(statements) < 2:
        return {"score": None, "flags": ["Nedostatok dát pre Piotroski F-score (min. 2 roky)"]}

    curr = statements[-1]
    prev = statements[-2]

    c_net_profit = _get(curr, 'netProfitLoss', 0) or 0
    c_assets = _get(curr, 'totalAssets', 0) or 0
    p_net_profit = _get(prev, 'netProfitLoss', 0) or 0
    p_assets = _get(prev, 'totalAssets', 0) or 0
    c_cf = _get(curr, 'operatingCashFlow', None)
    c_cf = c_cf if c_cf is not None else 0

    c_long_debt = _get(curr, 'longTermLiabilities', 0) or 0
    p_long_debt = _get(prev, 'longTermLiabilities', 0) or 0

    c_curr_assets = _get(curr, 'currentAssets', 0) or 0
    c_curr_liab = _get(curr, 'shortTermLiabilities', 0) or 0
    p_curr_assets = _get(prev, 'currentAssets', 0) or 0
    p_curr_liab = _get(prev, 'shortTermLiabilities', 0) or 0

    c_gross = _get(curr, 'grossProfit', 0) or 0
    c_rev = _get(curr, 'mainActivityRevenue', 0) or 0
    p_gross = _get(prev, 'grossProfit', 0) or 0
    p_rev = _get(prev, 'mainActivityRevenue', 0) or 0

    score = 0

    # 1. ROA > 0
    c_roa = c_net_profit / c_assets if c_assets > 0 else 0
    if c_roa > 0: score += 1

    # 2. CFO > 0
    if c_cf > 0: score += 1

    # 3. dROA > 0
    p_roa = p_net_profit / p_assets if p_assets > 0 else 0
    if c_roa > p_roa: score += 1

    # 4. CFO > Net Income
    if c_cf > c_net_profit: score += 1

    # 5. dLeverage < 0
    c_lev = c_long_debt / c_assets if c_assets > 0 else 0
    p_lev = p_long_debt / p_assets if p_assets > 0 else 0
    if c_lev < p_lev: score += 1

    # 6. dLiquidity > 0
    c_cr = c_curr_assets / c_curr_liab if c_curr_liab > 0 else 0
    p_cr = p_curr_assets / p_curr_liab if p_curr_liab > 0 else 0
    if c_cr > p_cr: score += 1

    # 7. dMargin > 0
    c_gm = c_gross / c_rev if c_rev > 0 else 0
    p_gm = p_gross / p_rev if p_rev > 0 else 0
    if c_gm > p_gm: score += 1

    # 8. dTurnover > 0
    c_at = c_rev / c_assets if c_assets > 0 else 0
    p_at = p_rev / p_assets if p_assets > 0 else 0
    if c_at > p_at: score += 1

    return {"score": score, "flags": [f"Piotroski F-score: {score} z 8"]}

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

def compute_forensic_scorecard(company_dict: dict, trends: dict) -> "ScorecardResult":

    """
    5-pilierový vážený scoring model (0–100) V2.
    """
    pillars = []
    
    vestnik_events = company_dict.get("vestnikEvents", [])
    nace_code = company_dict.get("naceCode", "") or ""
    nace_w = get_nace_weights(nace_code)

    # ── HARD STOP: Konkurz / Likvidácia ───────────────────────────────────────
    for event in vestnik_events:
        event_type = (
            event.get("eventType", "").lower()
            if isinstance(event, dict)
            else getattr(event, "eventType", "").lower()
        )
        import unicodedata
        event_type_norm = unicodedata.normalize("NFC", event_type)
        if any(kw in event_type_norm for kw in ("konkurz", "likvidáci", "reštrukturalizáci")):
            pillars.append(ScorecardPillar(
                name="Platobná schopnosť & Exekúcie",
                score=0, max_score=nace_w["P1"],
                detail="HARD STOP — Firma je v konkurze, likvidácii alebo reštrukturalizácii.",
                flags=["Konkurz / Likvidácia / Reštrukturalizácia"]
            ))
            return ScorecardResult(total_score=0, pillars=pillars, risk_category="C", hard_stop=True, score_version="v2")

    # ── Startup detekcia ─────────────────────────────────────────────────────
    stmts_raw = company_dict.get("financialStatements", [])
    sorted_stmts_raw = sorted(stmts_raw, key=lambda x: x.year if hasattr(x, "year") else x.get("year", 0))
    startup_info = detect_startup_profile(sorted_stmts_raw)

    last_ratios = (trends.get("ratios_by_year") or [{}])[-1]
    last_z = (trends.get("altman_z_scores") or [{}])[-1]
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
    if cr is None:
        p1_raw += 6
        p1_flags.append("Current ratio: N/A (bez dát)")
    elif cr >= 1.5:
        p1_raw += 12
        p1_flags.append(f"Current ratio: {cr:.2f} — výborná likvidita (≥1.5)")
    elif cr >= 1.0:
        p1_raw += 8
        p1_flags.append(f"Current ratio: {cr:.2f} — dostatočná likvidita (1.0–1.5)")
    elif cr >= 0.5:
        p1_raw += 4
        p1_flags.append(f"Current ratio: {cr:.2f} — problematická likvidita (0.5–1.0)")
    else:
        p1_flags.append(f"Current ratio: {cr:.2f} — kritická likvidita (<0.5)")

    equity_to_debt = last_z.get("components", {}).get("x4_equity_to_debt", None)
    debt_to_equity = last_ratios.get("debt_to_equity", None)
    if equity_to_debt is None:
        p1_raw += 6
        p1_flags.append("Vlastné imanie: N/A")
    elif equity_to_debt > 0:
        p1_raw += 12
        de_str = f"{debt_to_equity:.2f}" if debt_to_equity is not None else "N/A"
        p1_flags.append(f"Vlastné imanie: kladné (D/E = {de_str})")
    else:
        p1_flags.append(f"Vlastné imanie: ZÁPORNÉ — predĺženie")

    # Exekúcie degradované
    crit_events_penalty = 0
    for e in vestnik_events:
        sev = e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "")
        if sev in ("CRITICAL", "HIGH"):
            crit_events_penalty += compute_vestnik_degradation(e)
            
    if crit_events_penalty == 0:
        p1_raw += 6
        p1_flags.append("Vestník: žiadne kritické udalosti")
    elif crit_events_penalty < 1.0:
        p1_raw += 3
        p1_flags.append("Vestník: staré kritické/vysoké udalosti (znížená váha)")
    else:
        p1_flags.append(f"Vestník: aktívne kritické/vysoké udalosti (penalizácia {crit_events_penalty:.1f}x)")

    p1_raw = max(0, min(30, p1_raw))
    p1_score = int(round((p1_raw / 30.0) * nace_w["P1"]))
    pillars.append(ScorecardPillar(
        name="Platobná schopnosť & Exekúcie",
        score=p1_score, max_score=nace_w["P1"],
        detail=" | ".join(p1_flags[:2]) if p1_flags else "", flags=p1_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 2 — Finančné zdravie — Altman Z'' & Piotroski (raw max 30)
    # ══════════════════════════════════════════════════════════════════════════
    p2_raw = 0
    p2_flags = []

    z_score_val = last_z.get("z_score")
    z_zone = last_z.get("zone", "N/A")

    if startup_info.get("is_startup"):
        p2_raw += 15
        eq = startup_info.get("equity", 0)
        p2_flags.append(f"STARTUP profil: Altman Z'' neaplikovateľné (pre-revenue firma s imaním {eq:,.0f} €)".replace(",", " "))
    elif data_void:
        p2_raw = 0
        p2_flags.append("DATA VOID: Kľúčové finančné metriky nedostupné")
    else:
        # Altman Z'' (max 20 raw)
        if z_score_val is None:
            p2_raw += 5
            p2_flags.append("Altman Z'': N/A")
        elif z_zone == "SAFE":
            p2_raw += min(20, int(15 + (z_score_val - 2.6) / (5.0 - 2.6) * 5))
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Bezpečná zóna ✓")
        elif z_zone == "GREY":
            p2_raw += min(14, int(7 + (z_score_val - 1.1) / (2.6 - 1.1) * 7))
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Šedá zóna ⚠")
        else:
            p2_raw += max(0, min(4, int((z_score_val / 1.1) * 4))) if z_score_val is not None else 0
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Núdzová zóna ✗")

        # Piotroski F-score (max 10 raw)
        pio_score = piotroski.get("score")
        if pio_score is not None:
            p2_raw += min(10, int((pio_score / 8.0) * 10))
            p2_flags.extend(piotroski.get("flags", []))
        else:
            p2_flags.append("Piotroski F-score: N/A")

    p2_raw = max(0, min(30, p2_raw))
    p2_score = int(round((p2_raw / 30.0) * nace_w["P2"]))
    pillars.append(ScorecardPillar(
        name="Finančné zdravie",
        score=p2_score, max_score=nace_w["P2"],
        detail=" | ".join(p2_flags[:2]) if p2_flags else "", flags=p2_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 3 — Ziskovosť & Stabilita & CF (raw max 30)
    # ══════════════════════════════════════════════════════════════════════════
    p3_raw = 0
    p3_flags = []
    n_years = len(sorted_stmts_raw)
    
    if n_years == 0:
        p3_raw = 0 if data_void else 15
        p3_flags.append("DATA VOID" if data_void else "Nová firma / chýbajúce výkazy")
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

        # Cash Flow (max 15)
        op_cf_raw = _get(sorted_stmts_raw[-1], "operatingCashFlow", None)
        rev = _get(sorted_stmts_raw[-1], "mainActivityRevenue", 0) or 0
        if op_cf_raw is not None:
            op_cf = op_cf_raw
            if op_cf > 0:
                p3_raw += 7
                if rev > 0 and (op_cf / rev) > 0.10:
                    p3_raw += 8
                    p3_flags.append(f"Cash Flow: Silný (CF/Rev > 10%)")
                else:
                    p3_flags.append(f"Cash Flow: Kladný")
            else:
                p3_flags.append(f"Cash Flow: Záporný (riziko)")
        else:
            p3_raw += 7
            p3_flags.append("Cash Flow: N/A")
            
        cf_ratio = last_ratios.get("cashflow_to_profit")
        if cf_ratio is not None and profitable_years > 0 and cf_ratio < 0:
            p3_raw = max(0, p3_raw - 5)
            p3_flags.append(f"⚠ Divergencia CF/Zisk: Záporný CF pri zisku")

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
                name="Forenzný indikátor: Biely Kôň", score=-wh["penalty"], max_score=0,
                detail="Boli detekované kritické znaky schránkovej firmy.", flags=wh["flags"]
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
            import json as _json
            try:
                ev_meta = _json.loads(ev_meta)
            except Exception:
                ev_meta = {}
        stat_changes = int(ev_meta.get("statutory_changes_count", 0) or 0)
        high_turnover = bool(ev_meta.get("high_turnover_risk", False))
        has_virtual = bool(ev_meta.get("has_virtual_seat", False))
        has_foreign = bool(ev_meta.get("has_foreign_statutory", False))

        is_big_corp = False
        if financial_statements:
            try:
                latest_stmt = max(financial_statements, key=lambda s: getattr(s, "year", 0) or (s.get("year", 0) if isinstance(s, dict) else 0))
                rev = getattr(latest_stmt, "mainActivityRevenue", 0) or (latest_stmt.get("mainActivityRevenue", 0) if isinstance(latest_stmt, dict) else 0)
                if rev and rev > 10_000_000:
                    is_big_corp = True
            except Exception:
                pass
                
        if is_big_corp and stat_changes > 0:
            if ev_sev in ["CRITICAL", "HIGH"]:
                ev_sev = "INFO"

        if ev_sev == "CRITICAL":
            orsr_forensic_penalty += 3
            orsr_forensic_flags.append(f"ORSR CRITICAL: {stat_changes} zmien štatutárov, vysoké riziko bieleho koňa (−3b)")
        elif ev_sev == "HIGH":
            orsr_forensic_penalty += 2
            orsr_forensic_flags.append(f"ORSR HIGH: zvýšené riziko z ORSR histórie (−2b)")

        # Mierna penalizácia za extrémny počet zmien (>50)
        if stat_changes > 50:
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

    if dq_mult < 1.0:
        pillars.append(ScorecardPillar(
            name="Data Quality Multiplier",
            score=int(round(total_score * dq_mult)) - total_score, max_score=0,
            detail=f"Skóre ponížené (koeficient {dq_mult:.2f}) pre chýbajúce dáta, históriu alebo audit.",
            flags=[]
        ))
        total_score = int(round(total_score * dq_mult))

    return ScorecardResult(
        total_score=total_score,
        pillars=pillars,
        risk_category=_risk_category(total_score),
        hard_stop=False,
        score_version="v2"
    )

def compute_financial_trends(statements: List[Any]) -> Dict[str, Any]:
    """
    Vypočíta 5-ročné trendy (CAGR, rast, stabilita, Altman Z-score, ratios) z finančných výkazov.
    Statements musia byť zoradené chronologicky (od najstaršieho po najnovšie).
    """
    if not statements:
        return {"error": "Žiadne dáta na výpočet trendov."}
        
    # Zoradiť vzostupne podľa roku (najstaršie prvé)
    sorted_stmts = sorted(statements, key=lambda x: _get(x, 'year', 0))
    
    first = sorted_stmts[0]
    last = sorted_stmts[-1]
    first_year = _get(first, 'year', 0)
    last_year = _get(last, 'year', 0)
    years_span = last_year - first_year
    
    trends = {
        "analyzed_years": [_get(s, 'year', 0) for s in sorted_stmts],
        "revenue_trend": [],
        "profit_trend": [],
        "equity_trend": [],
        "cagr_revenue": None,
        "average_profit": sum((_get(s, 'netProfitLoss', 0) or 0) for s in sorted_stmts) / len(sorted_stmts) if sorted_stmts else 0,
        "consecutive_losses": 0,
        "bankruptcy_risk_indicators": [],
        # Nové: Altman Z-score pre každý rok
        "altman_z_scores": [],
        # Nové: Finančné ukazovatele pre každý rok
        "ratios_by_year": [],
        "algorithmic_prescore": None
    }
    
    # Výpočet CAGR (Zložená ročná miera rastu) pre Tržby
    first_rev = _get(first, 'mainActivityRevenue', None) or 0
    last_rev = _get(last, 'mainActivityRevenue', None) or 0
    if years_span > 0 and first_rev > 0 and last_rev > 0:
        cagr = ((last_rev / first_rev) ** (1 / years_span)) - 1
        trends["cagr_revenue"] = round(cagr * 100, 2)
        
    # Počet po sebe idúcich strát od konca
    losses = 0
    for s in reversed(sorted_stmts):
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
    for s in sorted_stmts:
        yr = getattr(s, 'year', 0)
        z = compute_altman_z_score(s)
        ratios = compute_financial_ratios(s)
        trends["altman_z_scores"].append({"year": yr, **z})
        trends["ratios_by_year"].append({"year": yr, **ratios})

        # Altman varovanie ako indikátor finančného stresu
        if z.get("zone") == "DISTRESS":
            trends["bankruptcy_risk_indicators"].append(
                f"Altman Z-score {yr}: {z['z_score']} — {z['zone_label']}"
            )
        
    # Medziročné zmeny (YoY)
    for i in range(1, len(sorted_stmts)):
        prev = sorted_stmts[i-1]
        curr = sorted_stmts[i]
        curr_year = getattr(curr, 'year', 0)
        
        prev_rev = getattr(prev, 'mainActivityRevenue', 0) or 0
        curr_rev = getattr(curr, 'mainActivityRevenue', 0) or 0
        
        # Anualizácia tržieb pre korektný YoY výpočet pri posunutých hospodárskych rokoch
        prev_months = getattr(prev, 'monthsInPeriod', 12) or 12
        curr_months = getattr(curr, 'monthsInPeriod', 12) or 12
        
        ann_prev_rev = prev_rev * (12 / prev_months) if prev_months > 0 else prev_rev
        ann_curr_rev = curr_rev * (12 / curr_months) if curr_months > 0 else curr_rev
        
        prev_profit = getattr(prev, 'netProfitLoss', 0) or 0
        curr_profit = getattr(curr, 'netProfitLoss', 0) or 0
        prev_equity = getattr(prev, 'equity', 0) or 0
        curr_equity = getattr(curr, 'equity', 0) or 0
        
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

    latest = statements[-1]
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
                           f"Môže zakladať trestnú zodpovednosť štatutára (§278 TZ SR).",
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


# ── Revenue per Employee — detekcia schránkovej štruktúry ────────────────────

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

    latest = statements[-1]
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

def compute_yoy_summary_table(statements: list) -> dict:
    """
    Zostaví kompaktnú YoY tabuľku kľúčových ukazovateľov pre posledné roky.

    Vracia:
      headers: list[str]  — napr. ['Ukazovateľ', '2022', '2023', '2024', 'Δ% (YoY)']
      rows: list[dict]    — každý riadok: {label, values: list[str], delta_pct: str, flag: str}
      years: list[int]
    """
    if not statements:
        return {"headers": [], "rows": [], "years": []}

    sorted_stmts = sorted(statements, key=lambda s: _get(s, "year", 0) or 0)
    years = [_get(s, "year", "?") for s in sorted_stmts]

    def _pct(curr, prev) -> Optional[float]:
        if curr is None or prev is None or prev == 0:
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
        positive_is_bad = field in ("liab", "cost")
        if negative_is_bad:
            if delta <= -20:
                return "🔴"
            elif delta <= -5:
                return "🟡"
            elif delta >= 20:
                return "🟢"
        else:
            # Záväzky a náklady: rast = červená
            if delta >= 20:
                return "🔴"
            elif delta >= 5:
                return "🟡"
        return ""

    _METRICS = [
        ("Tržby", "mainActivityRevenue", "revenue"),
        ("Čistý zisk", "netProfitLoss", "profit"),
        ("Celkové aktíva", "totalAssets", "assets"),
        ("Vlastné imanie", "equity", "equity"),
        ("Krát. záväzky", "shortTermLiabilities", "liab"),
        ("Záväzky SP", "socialInsuranceLiabilities", "liab"),
        ("Daňové záväzky", "taxLiabilities", "liab"),
        ("Osobné náklady", "staffCosts", "cost"),
        ("Odpisy", "depreciation", "cost"),
        ("Úrokové náklady", "interestExpense", "cost"),
    ]

    rows = []
    for label, field, ftype in _METRICS:
        values_raw = [_get(s, field, None) for s in sorted_stmts]

        # Posledná YoY zmena
        last = values_raw[-1] if values_raw else None
        prev = values_raw[-2] if len(values_raw) >= 2 else None
        delta = _pct(last, prev)

        # Preskočiť riadok ak sú všetky hodnoty None
        if all(v is None for v in values_raw):
            continue

        rows.append({
            "label": label,
            "field": field,
            "vals": [_fmt_eur(v) for v in values_raw],
            "delta_pct": _fmt_pct(delta),
            "delta_raw": delta,
            "flag": _flag(delta, ftype),
        })

    headers = ["Ukazovateľ"] + [str(y) for y in years] + ["Δ% (posl. rok)"]
    return {"headers": headers, "rows": rows, "years": years}


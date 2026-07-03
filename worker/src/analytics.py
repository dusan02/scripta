from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Union


# ── Cash Flow sanitizácia ─────────────────────────────────────────────────────
# Reálna firma nemá presne 0 prevádzkový cash flow. Hodnota 0 je artefakt
# starého LLM promptu, ktorý hovoril "doplň nulu" pre chýbajúce CF dáta.
# Táto funkita konvertuje 0 → None na jednom mieste pre všetky volajúce.

_CF_FIELDS = ("operatingCashFlow", "investingCashFlow", "financingCashFlow")


def sanitize_cash_flow_fields(stmt: Union[Dict[str, Any], Any]) -> None:
    """Konvertuje 0 → None pre cash flow polia. Funguje na dict aj Prisma objektoch.
    Volá sa in-place (modifikuje vstup)."""
    for field in _CF_FIELDS:
        if isinstance(stmt, dict):
            if stmt.get(field) == 0:
                stmt[field] = None
        else:
            if getattr(stmt, field, None) == 0:
                setattr(stmt, field, None)


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
    revenue = getattr(latest_stmt, 'mainActivityRevenue', 0) or 0
    assets = getattr(latest_stmt, 'totalAssets', 0) or 0
    receivables = getattr(latest_stmt, 'tradeReceivables', 0) or 0
    
    # Znak schránky: veľké tržby (> 100k), ale dlhodobo úplne 0 mzdových nákladov
    # Skontrolujeme, či je to pravda za posledné 3 dostupné roky (alebo všetky ak ich je menej)
    years_to_check = min(3, len(statements))
    recent_stmts = statements[-years_to_check:]
    
    consistently_zero_staff = True
    has_ifrs = False
    
    for stmt in recent_stmts:
        staff = getattr(stmt, 'staffCosts', 0) or 0
        statement_type = str(getattr(stmt, 'statementType', '') or '').upper()
        
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
    revenue = getattr(latest, 'mainActivityRevenue', None)
    equity = getattr(latest, 'equity', None)
    assets = getattr(latest, 'totalAssets', None)
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
        total_assets = getattr(stmt, 'totalAssets')
        current_assets = getattr(stmt, 'currentAssets')
        equity = getattr(stmt, 'equity')
        net_profit = getattr(stmt, 'netProfitLoss')
        short_liabilities = getattr(stmt, 'shortTermLiabilities')
        long_liabilities = getattr(stmt, 'longTermLiabilities')
        cash = getattr(stmt, 'cashAndEquivalents')

        if total_assets is None or total_assets <= 0 or net_profit is None or equity is None or short_liabilities is None:
            return {"z_score": None, "zone": "N/A", "reason": "Nedostatok dát pre výpočet"}

        current_assets = current_assets if current_assets is not None else 0
        long_liabilities = long_liabilities if long_liabilities is not None else 0
        cash = cash if cash is not None else 0

        # Working capital = Obežný majetok - Krátkodobé záväzky
        # Ak máme currentAssets z DB, použijeme ho. Inak fallback na hrubý odhad.
        if current_assets > 0:
            working_capital = current_assets - short_liabilities
        else:
            working_capital = (total_assets * 0.6) - short_liabilities

        # Presné total_liabilities: shortTerm + longTerm ak máme oba, inak bilančná rovnica
        if short_liabilities > 0 or long_liabilities > 0:
            total_liabilities = max(short_liabilities + long_liabilities, 1)
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
        total_assets = getattr(stmt, 'totalAssets', 0) or 0
        current_assets = getattr(stmt, 'currentAssets', 0) or 0
        equity = getattr(stmt, 'equity', 0) or 0
        net_profit = getattr(stmt, 'netProfitLoss', 0) or 0
        short_liabilities = getattr(stmt, 'shortTermLiabilities', 0) or 0
        long_liabilities = getattr(stmt, 'longTermLiabilities', 0) or 0
        cash = getattr(stmt, 'cashAndEquivalents', 0) or 0
        revenue = getattr(stmt, 'mainActivityRevenue', 0) or 0
        op_cashflow_raw = getattr(stmt, 'operatingCashFlow', None)
        sanitize_cash_flow_fields(stmt)
        op_cashflow_raw = getattr(stmt, 'operatingCashFlow', None)
        op_cashflow = op_cashflow_raw if op_cashflow_raw is not None else 0
        gross_profit = getattr(stmt, 'grossProfit', 0) or 0
        inventory = getattr(stmt, 'inventory', 0) or 0
        depreciation = getattr(stmt, 'depreciation', 0) or 0
        interest = getattr(stmt, 'interestExpense', 0) or 0
        trade_receivables = getattr(stmt, 'tradeReceivables', 0) or 0
        trade_payables = getattr(stmt, 'tradePayables', 0) or 0

        # Total liabilities: shortTerm + longTerm ak dostupné, inak bilančná rovnica
        if short_liabilities > 0 or long_liabilities > 0:
            total_liabilities = max(short_liabilities + long_liabilities, 1)
        else:
            total_liabilities = max(total_assets - equity, 1)

        # ── Likvidita ──
        ratios = {
            "current_ratio": _safe_div(current_assets, short_liabilities) if current_assets > 0 else None,
            "cash_ratio": _safe_div(cash, short_liabilities),
            "quick_ratio": _safe_div(current_assets - inventory, short_liabilities) if current_assets > 0 else None,
            "working_capital": round(current_assets - short_liabilities, 0) if (current_assets > 0 or short_liabilities > 0) else None,
        }

        # ── Zadlženosť ──
        ratios["debt_to_equity"] = _safe_div(total_liabilities, equity)

        # ── Rentabilita ──
        ratios["net_profit_margin_pct"] = _safe_pct(net_profit, revenue)
        ratios["gross_profit_margin_pct"] = _safe_pct(gross_profit, revenue) if gross_profit > 0 else None
        ratios["roa_pct"] = _safe_pct(net_profit, total_assets)
        ratios["roe_pct"] = _safe_pct(net_profit, equity)

        # ── EBITDA (approx: net_profit + interest + depreciation) ──
        # Náklady na úroky (interest) môžu byť v DB uložené ako záporné — prirátavame absolútnu hodnotu.
        ratios["ebitda"] = round(net_profit + abs(interest) + depreciation, 0) if (interest != 0 or depreciation != 0) else None

        # ── Cash Flow divergencia ──
        # Ak je operatingCashFlow None (nedostupné v RÚZ), vrátiť None — nie 0.0
        ratios["cashflow_to_profit"] = _safe_div(op_cashflow, abs(net_profit)) if (net_profit != 0 and op_cashflow_raw is not None) else None

        # ── Dni obratu ──
        ratios["dso_days"] = round((trade_receivables / revenue) * 365, 0) if revenue > 0 and trade_receivables > 0 else None
        ratios["dpo_days"] = round((trade_payables / revenue) * 365, 0) if revenue > 0 and trade_payables > 0 else None

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


def _risk_category(score: int) -> str:
    if score >= 90:
        return "AAA"
    elif score >= 70:
        return "A"
    elif score >= 40:
        return "B"
    else:
        return "C"


def compute_forensic_scorecard(company_dict: dict, trends: dict) -> "ScorecardResult":
    """
    5-pilierový vážený scoring model (0–100).

    Piliere a váhy:
      1. Platobná schopnosť & Exekúcie   — 30 bodov (30 %)
      2. Finančné zdravie (Altman Z'')   — 25 bodov (25 %)
      3. Ziskovosť & Stabilita           — 20 bodov (20 %)
      4. Rast & Trendová sila            — 15 bodov (15 %)
      5. Právna bezúhonnosť              — 10 bodov (10 %)

    Inšpirované: S&P Rating Framework, Moody's Analytical Scorecard,
                 Altman Z''-Score (1995) pre súkromné/ne-výrobné firmy.
    """
    pillars = []

    vestnik_events = company_dict.get("vestnikEvents", [])

    # ── HARD STOP: Konkurz / Likvidácia ───────────────────────────────────────
    for event in vestnik_events:
        event_type = (
            event.get("eventType", "").lower()
            if isinstance(event, dict)
            else getattr(event, "eventType", "").lower()
        )
        if any(kw in event_type for kw in ("konkurz", "likvidáci", "reštrukturalizáci")):
            pillars.append(ScorecardPillar(
                name="Platobná schopnosť & Exekúcie",
                score=0, max_score=30,
                detail="HARD STOP — Firma je v konkurze, likvidácii alebo reštrukturalizácii.",
                flags=["Konkurz / Likvidácia / Reštrukturalizácia"]
            ))
            return ScorecardResult(total_score=0, pillars=pillars, risk_category="C", hard_stop=True)

    # ── Startup detekcia ─────────────────────────────────────────────────────
    stmts_raw = company_dict.get("financialStatements", [])
    sorted_stmts_raw = sorted(stmts_raw, key=lambda x: x.year if hasattr(x, "year") else x.get("year", 0))
    startup_info = detect_startup_profile(sorted_stmts_raw)

    last_ratios = (trends.get("ratios_by_year") or [{}])[-1]
    last_z = (trends.get("altman_z_scores") or [{}])[-1]
    analyzed_years = trends.get("analyzed_years", [])
    consecutive_losses = trends.get("consecutive_losses", 0)
    average_profit = trends.get("average_profit", 0)

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 1 — Platobná schopnosť & Exekúcie (max 30 bodov)
    # ══════════════════════════════════════════════════════════════════════════
    p1_score = 0
    p1_flags = []

    # 1a. Current Ratio (max 10 bodov)
    cr = last_ratios.get("current_ratio")
    if cr is None:
        p1_score += 5
        p1_flags.append("Current ratio: N/A (bez dát)")
    elif cr >= 1.5:
        p1_score += 10
        p1_flags.append(f"Current ratio: {cr:.2f} — výborná likvidita (≥1.5)")
    elif cr >= 1.0:
        p1_score += 7
        p1_flags.append(f"Current ratio: {cr:.2f} — dostatočná likvidita (1.0–1.5)")
    elif cr >= 0.5:
        p1_score += 3
        p1_flags.append(f"Current ratio: {cr:.2f} — problematická likvidita (0.5–1.0)")
    else:
        p1_score += 0
        p1_flags.append(f"Current ratio: {cr:.2f} — kritická likvidita (<0.5)")

    # 1b. Vlastné imanie — nie záporné (max 10 bodov)
    equity_to_debt = last_z.get("components", {}).get("x4_equity_to_debt", None)
    if equity_to_debt is None:
        p1_score += 5
        p1_flags.append("Vlastné imanie: N/A")
    elif equity_to_debt > 0:
        p1_score += 10
        p1_flags.append(f"Vlastné imanie: kladné (E/D = {equity_to_debt:.2f})")
    else:
        p1_score += 0
        p1_flags.append(f"Vlastné imanie: ZÁPORNÉ (E/D = {equity_to_debt:.2f}) — predĺženie")

    # 1c. Absencia exekúcií/dlhov vo Vestníku (max 10 bodov)
    critical_events = [
        e for e in vestnik_events
        if (e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "")) in ("CRITICAL", "HIGH")
    ]
    if not critical_events:
        p1_score += 10
        p1_flags.append("Vestník: žiadne kritické udalosti")
    elif len(critical_events) == 1:
        p1_score += 4
        p1_flags.append(f"Vestník: 1 kritická/vysoká udalosť")
    else:
        p1_score += 0
        p1_flags.append(f"Vestník: {len(critical_events)} kritických/vysokých udalostí")

    p1_score = max(0, min(30, p1_score))
    p1_detail = " | ".join(p1_flags[:2])  # Skrátený popis pre tabuľku
    pillars.append(ScorecardPillar(
        name="Platobná schopnosť & Exekúcie",
        score=p1_score, max_score=30,
        detail=p1_detail, flags=p1_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 2 — Finančné zdravie — Altman Z'' & Debt/Equity (max 25 bodov)
    # ══════════════════════════════════════════════════════════════════════════
    p2_score = 0
    p2_flags = []

    z_score_val = last_z.get("z_score")
    z_zone = last_z.get("zone", "N/A")

    if startup_info.get("is_startup"):
        # Pre startupy Altman Z-Score nie je spoľahlivý — nahradíme equity-based scoring
        p2_score += 15  # Solídny základ — firma má kapitál
        eq = startup_info.get("equity", 0)
        p2_flags.append(f"STARTUP profil: Altman Z'' neaplikovateľné (pre-revenue firma s imaním {eq:,.0f} €)".replace(",", " "))
        p2_flags.append("Hodnotenie založené na kapitálovej primeranosti, nie na ziskovosti")

        # 2b. Debt-to-Equity (max 3 body) — stále relevantné
        de = last_ratios.get("debt_to_equity")
        if de is not None:
            if de < 1.0:
                p2_score += 3
                p2_flags.append(f"D/E = {de:.2f} — nízke zadlženie")
            elif de <= 2.0:
                p2_score += 1
                p2_flags.append(f"D/E = {de:.2f} — mierne zadlženie")
            else:
                p2_flags.append(f"D/E = {de:.2f} — vysoké zadlženie")
    else:
        # 2a. Altman Z''-score (max 22 bodov)
        if z_score_val is None:
            p2_score += 11  # Stred — bez dát
            p2_flags.append("Altman Z'': N/A (chýbajú fin. výkazy)")
        elif z_zone == "SAFE":
            # Lineárna škála v rámci SAFE zóny: Z=2.6 → 17, Z≥5.0 → 22
            safe_pts = int(min(22, 17 + (z_score_val - 2.6) / (5.0 - 2.6) * 5))
            p2_score += safe_pts
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Bezpečná zóna ✓")
        elif z_zone == "GREY":
            # Lineárna škála 1.1–2.6: → 8–16 bodov
            grey_pts = int(8 + (z_score_val - 1.1) / (2.6 - 1.1) * 9)
            p2_score += grey_pts
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Šedá zóna ⚠")
        else:  # DISTRESS
            p2_score += max(0, int(z_score_val * 5)) if z_score_val is not None else 0
            p2_flags.append(f"Altman Z'' = {z_score_val:.2f} — Núdzová zóna (spoločnosť je pod finančným stresom) ✗")

        # 2b. Debt-to-Equity (max 3 body)
        de = last_ratios.get("debt_to_equity")
        if de is not None:
            if de < 1.0:
                p2_score += 3
                p2_flags.append(f"D/E = {de:.2f} — nízke zadlženie")
            elif de <= 2.0:
                p2_score += 1
                p2_flags.append(f"D/E = {de:.2f} — mierne zadlženie")
            else:
                p2_flags.append(f"D/E = {de:.2f} — vysoké zadlženie")

    p2_score = max(0, min(25, p2_score))
    p2_detail = " | ".join(p2_flags[:2])
    pillars.append(ScorecardPillar(
        name="Finančné zdravie (Altman Z'')",
        score=p2_score, max_score=25,
        detail=p2_detail, flags=p2_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 3 — Ziskovosť & Stabilita (max 20 bodov)
    # ══════════════════════════════════════════════════════════════════════════
    p3_score = 0
    p3_flags = []

    stmts = company_dict.get("financialStatements", [])
    sorted_stmts = sorted(stmts, key=lambda x: x.year if hasattr(x, "year") else x.get("year", 0))
    n_years = len(sorted_stmts)

    profitable_years = 0  # default pre pripad n_years == 0 (ochrana pred NameError)
    if n_years == 0:
        p3_score = 10  # Stred — nová firma / bez dát
        p3_flags.append("Žiadne finančné výkazy — nová firma alebo bez dát")
    else:
        # 3a. Počet ziskových rokov (max 14b — rezerva pre marža 4b + ROA 2b = 20b celkom)
        profitable_years = sum(
            1 for s in sorted_stmts
            if ((s.netProfitLoss if hasattr(s, "netProfitLoss") else s.get("netProfitLoss")) or 0) > 0
        )
        if profitable_years >= 5:
            p3_score += 14
            p3_flags.append(f"Ziskovosť: {profitable_years}/{n_years} rokov v zisku (5+)")
        elif profitable_years >= 3:
            p3_score += 10
            p3_flags.append(f"Ziskovosť: {profitable_years}/{n_years} rokov v zisku (3–4)")
        elif profitable_years >= 1:
            p3_score += 5
            p3_flags.append(f"Ziskovosť: {profitable_years}/{n_years} rokov v zisku")
        else:
            p3_score += 0
            p3_flags.append(f"Ziskovosť: 0/{n_years} rokov — žiadny ziskový rok")


        # 3b. Penalizácia za po sebe idúce straty
        if consecutive_losses >= 3:
            penalty = min(10, consecutive_losses * 3)
            p3_score = max(0, p3_score - penalty)
            p3_flags.append(f"Penalizácia: {consecutive_losses} roky po sebe strata (−{penalty} bodov)")
        elif consecutive_losses >= 1:
            p3_score = max(0, p3_score - consecutive_losses * 2)
            p3_flags.append(f"Posledný rok strata (−{consecutive_losses * 2} bodov)")

        # 3c. Čistá marža bonusy (max +4 body)
        npm = last_ratios.get("net_profit_margin_pct")
        if npm is not None:
            if npm >= 15:
                p3_score += 4
                p3_flags.append(f"Čistá marža: {npm:.1f}% — výborná (≥15%)")
            elif npm >= 7:
                p3_score += 2
                p3_flags.append(f"Čistá marža: {npm:.1f}% — dobrá (7–15%)")
            elif npm > 0:
                p3_flags.append(f"Čistá marža: {npm:.1f}% — nízka (>0%)")
            else:
                p3_flags.append(f"Čistá marža: {npm:.1f}% — záporná")

        # 3d. ROA bonus (max +2 body) — pridané: predtým nevyužité
        roa = last_ratios.get("roa_pct")
        if roa is not None:
            if roa >= 10:
                p3_score += 2
                p3_flags.append(f"ROA: {roa:.1f}% — výborná (≥10%)")
            elif roa >= 5:
                p3_score += 1
                p3_flags.append(f"ROA: {roa:.1f}% — dobrá (≥5%)")

        # 3e. CF/Profit divergencia — červená vlajka pre tunelovanie
        cf_ratio = last_ratios.get("cashflow_to_profit")
        # Používame 'profitable_years' z tohto bloku — je definované vyššie v torný else bloku
        if cf_ratio is not None and profitable_years > 0:
            if cf_ratio < 0:
                p3_score = max(0, p3_score - 3)
                p3_flags.append(f"⚠ CF/Zisk divergencia: {cf_ratio:.2f} — záporný CF pri kladnom zisku (riziko tunelovania)")
            elif cf_ratio < 0.5:
                p3_score = max(0, p3_score - 1)
                p3_flags.append(f"CF/Zisk: {cf_ratio:.2f} — nízka CF konverzia")

    p3_score = max(0, min(20, p3_score))
    p3_detail = " | ".join(p3_flags[:2])
    pillars.append(ScorecardPillar(
        name="Ziskovosť & Stabilita",
        score=p3_score, max_score=20,
        detail=p3_detail, flags=p3_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 4 — Rast & Trendová sila (max 15 bodov)
    # ══════════════════════════════════════════════════════════════════════════
    p4_score = 0
    p4_flags = []

    cagr = trends.get("cagr_revenue")
    if cagr is None:
        p4_score += 7  # Stred — bez dát
        p4_flags.append("CAGR tržieb: N/A")
    elif cagr >= 15:
        p4_score += 15
        p4_flags.append(f"CAGR tržieb: +{cagr:.1f}% — silný rast (≥15%)")
    elif cagr >= 10:
        p4_score += 12
        p4_flags.append(f"CAGR tržieb: +{cagr:.1f}% — dobrý rast (10–15%)")
    elif cagr >= 5:
        p4_score += 9
        p4_flags.append(f"CAGR tržieb: +{cagr:.1f}% — mierny rast (5–10%)")
    elif cagr >= 0:
        p4_score += 5
        p4_flags.append(f"CAGR tržieb: +{cagr:.1f}% — stagnácia (0–5%)")
    else:
        p4_score += max(0, int(5 + cagr / 5))  # Postupne klesá pod 0
        p4_flags.append(f"CAGR tržieb: {cagr:.1f}% — pokles tržieb")

    # 4b. Rast vlastného imania (bonus +2)
    equity_trend = trends.get("equity_trend", [])
    if equity_trend:
        last_eq_change = equity_trend[-1].get("yoy_pct")
        if last_eq_change is not None and last_eq_change > 5:
            p4_score += 2
            p4_flags.append(f"Vlastné imanie rastie YoY: +{last_eq_change:.1f}%")

    # 4c. Pokles tržieb 3 roky po sebe (penalizácia)
    rev_trend = trends.get("revenue_trend", [])
    if len(rev_trend) >= 3:
        last3 = [r.get("growth_percent", 0) for r in rev_trend[-3:]]
        if all(g < 0 for g in last3):
            p4_score = max(0, p4_score - 4)
            p4_flags.append("Tržby klesajú 3 roky po sebe (−4 body)")

    p4_score = max(0, min(15, p4_score))
    p4_detail = " | ".join(p4_flags[:2])
    pillars.append(ScorecardPillar(
        name="Rast & Trendová sila",
        score=p4_score, max_score=15,
        detail=p4_detail, flags=p4_flags
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # PILIER 5 — Právna bezúhonnosť (max 10 bodov)
    # ══════════════════════════════════════════════════════════════════════════
    p5_score = 0
    p5_flags = []

    severity_levels = [
        (e.get("severityLevel") if isinstance(e, dict) else getattr(e, "severityLevel", "LOW"))
        for e in vestnik_events
    ]

    critical_count = severity_levels.count("CRITICAL")
    high_count = severity_levels.count("HIGH")
    medium_count = severity_levels.count("MEDIUM")

    if critical_count > 0:
        p5_score = 0
        p5_flags.append(f"{critical_count} KRITICKÉ udalosti vo Vestníku")
    elif high_count > 0:
        p5_score = max(0, 6 - high_count)
        p5_flags.append(f"{high_count} VYSOKÉ udalosti vo Vestníku")
    elif medium_count > 0:
        p5_score = 8
        p5_flags.append(f"{medium_count} STREDNÉ udalosti vo Vestníku")
    elif vestnik_events:
        p5_score = 9
        p5_flags.append("Len nízko-rizikové záznamy vo Vestníku")
    else:
        p5_score = 10
        p5_flags.append("Bez záznamu v Obchodnom vestníku ✓")

    # Bonus: audítorský posudok bez výhrad
    for stmt in reversed(sorted_stmts):
        opinion = stmt.auditorOpinion if hasattr(stmt, "auditorOpinion") else stmt.get("auditorOpinion")
        if opinion:
            op_type = (
                opinion.opinionType if hasattr(opinion, "opinionType")
                else opinion.get("opinionType", "")
            ) or ""
            if "bez výhrad" in op_type.lower():
                p5_flags.append("Audítorský posudok: bez výhrad ✓")
            else:
                p5_score = max(0, p5_score - 3)
                p5_flags.append(f"Audítorský posudok: {op_type} (−3 body)")
            break

    p5_score = max(0, min(10, p5_score))
    p5_detail = " | ".join(p5_flags[:2])
    pillars.append(ScorecardPillar(
        name="Právna bezúhonnosť",
        score=p5_score, max_score=10,
        detail=p5_detail, flags=p5_flags
    ))

    # ── Finálny súčet ────────────────────────────────────────────────────────
    total_score = max(0, p1_score + p2_score + p3_score + p4_score + p5_score)

    # ══════════════════════════════════════════════════════════════════════════
    # PENALIZÁCIA: BIELY KÔŇ
    # ══════════════════════════════════════════════════════════════════════════
    financial_statements = company_dict.get("financialStatements", [])
    if financial_statements:
        class StmtProxy:
            def __init__(self, d): self.__dict__.update(d)
            
        def _get_year(stmt):
            if hasattr(stmt, "year"):
                return getattr(stmt, "year")
            if isinstance(stmt, dict):
                return stmt.get("year", 0)
            return 0
            
        sorted_statements = sorted(financial_statements, key=_get_year)
        proxies = [StmtProxy(s) if isinstance(s, dict) else s for s in sorted_statements]
        
        wh = compute_white_horse_indicator(proxies)
        
        if wh["penalty"] > 0:
            pillars.append(ScorecardPillar(
                name="Forenzný indikátor: Biely Kôň",
                score=-wh["penalty"], max_score=0,
                detail="Boli detekované kritické znaky schránkovej firmy alebo fiktívneho účtovníctva.",
                flags=wh["flags"]
            ))
            total_score = max(0, total_score - wh["penalty"])

    # ══════════════════════════════════════════════════════════════════════════
    # NACE-AWARE SECTOR ADJUSTMENT
    # Niektoré odvetvia majú štrukturálne nízke marže a vysoké zadlženie, čo
    # Altman Z-score a D/E penalizujú, hoci firma je zdravá pre svoj segment.
    # ══════════════════════════════════════════════════════════════════════════
    nace_code = company_dict.get("naceCode", "") or ""
    sector_flags = []
    sector_bonus = 0

    if nace_code.startswith("46"):
        # Veľkoobchod (Wholesale) — vysoký obrat, nízka marža, vysoké záväzky z obch. styku
        sector_bonus = min(10, max(0, 10 - (total_score // 10)))
        sector_flags.append(f"Sektorový bonus (+{sector_bonus}b): Veľkoobchod (NACE {nace_code}) — nízke marže a vysoké D/E sú štandardom v tomto segmente")
    elif nace_code.startswith("47"):
        # Maloobchod (Retail) — podobný profil ako veľkoobchod
        sector_bonus = min(7, max(0, 7 - (total_score // 10)))
        sector_flags.append(f"Sektorový bonus (+{sector_bonus}b): Maloobchod (NACE {nace_code}) — nízke marže a vysoké D/E sú štandardom v tomto segmente")

    if sector_bonus > 0:
        total_score = min(100, total_score + sector_bonus)
        pillars.append(ScorecardPillar(
            name="Sektorová korekcia (NACE)",
            score=sector_bonus, max_score=0,
            detail=sector_flags[0],
            flags=sector_flags
        ))

    return ScorecardResult(
        total_score=total_score,
        pillars=pillars,
        risk_category=_risk_category(total_score),
        hard_stop=False,
    )



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
        "average_profit": sum((getattr(s, 'netProfitLoss', 0) or 0) for s in sorted_stmts) / len(sorted_stmts) if sorted_stmts else 0,
        "consecutive_losses": 0,
        "bankruptcy_risk_indicators": [],
        # Nové: Altman Z-score pre každý rok
        "altman_z_scores": [],
        # Nové: Finančné ukazovatele pre každý rok
        "ratios_by_year": [],
        "algorithmic_prescore": None
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
    
    # Indikátory finančného stresu
    last_equity = getattr(last, 'equity', 0)
    if last_equity < 0:
        trends["bankruptcy_risk_indicators"].append("Záporné vlastné imanie (Spoločnosť je pod finančným stresom)")
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


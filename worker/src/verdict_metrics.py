"""Metric formatting, injection, and verdict sanitization helpers."""

import re
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _format_eur(value: Optional[float]) -> str:
    if value is None:
        return "N/A"
    v = float(value)
    abs_v = abs(v)
    sign = "-" if v < 0 else ""
    if abs_v >= 1_000_000_000:
        # Miliardy: 27 995 997 000 → "28,0 mld. €"
        num = f"{abs_v / 1_000_000_000:.1f}".replace(".", ",")
        return f"{sign}{num} mld. €"
    elif abs_v >= 1_000_000:
        # Milióny: 111 607 748 → "111,6 mil. €"
        num = f"{abs_v / 1_000_000:.1f}".replace(".", ",")
        return f"{sign}{num} mil. €"
    elif abs_v >= 1_000:
        return f"{sign}{abs_v / 1_000:.0f} tis. €"
    else:
        return f"{sign}{abs_v:.0f} €"


def _format_ratio(value: Optional[float]) -> str:
    """Naformátuje pomer: 0.62 → '0,62' (slovenská čiarka)."""
    if value is None:
        return "N/A"
    return f"{float(value):.2f}".replace(".", ",")


def _format_pct(value: Optional[float]) -> str:
    """Naformátuje percento: 13.24 → '13,2 %' (slovenská čiarka, 1 desatinné)."""
    if value is None:
        return "N/A"
    return f"{float(value):.1f} %".replace(".", ",")


def _format_count(value: Optional[float]) -> str:
    """Naformátuje počet: 1292 → '1 292' (medzera ako oddeľovač tisícov)."""
    if value is None:
        return "N/A"
    v = int(float(value))
    return f"{v:,}".replace(",", " ")


def _yoy_text(curr: Optional[float], prev: Optional[float], verb_pos: str, verb_neg: str, language: str = "sk") -> str:
    """Vypočíta YoY zmenu a vráti text s slovesom: 'klesli o 13,2 %' / 'vzrástli o 5,1 %'.
    verb_pos = sloveso pre rast ('vzrástli', 'stúpol', 'vzrástlo')
    verb_neg = sloveso pre pokles ('klesli', 'klesol', 'kleslo')
    language = 'sk' (default) alebo 'en' — ovplyvňuje len spoju 'o' / 'by'
    """
    if curr is None or prev is None or prev == 0:
        return "N/A"
    pct = ((float(curr) - float(prev)) / abs(float(prev))) * 100
    connector = "by" if language == "en" else "o"
    if pct >= 0:
        return f"{verb_pos} {connector} {_format_pct(pct)}"
    else:
        return f"{verb_neg} {connector} {_format_pct(abs(pct))}"


def _altman_zone(z_score: Optional[float]) -> str:
    if z_score is None:
        return "N/A"
    z = float(z_score)
    if z < 1.1:
        return "Núdzová zóna"
    elif z < 2.6:
        return "Šedá zóna"
    else:
        return "Bezpečná zóna"


def _compute_ebitda(stmt: dict) -> Optional[float]:
    """Aproximácia EBITDA = hrubý zisk + odpisy (alebo prevádzkový zisk + odpisy)."""
    gross = stmt.get("grossProfit")
    depreciation = stmt.get("depreciation")
    if gross is not None and depreciation is not None:
        return float(gross) + float(depreciation)
    # Fallback: net profit + interest + depreciation (ak nemáme gross profit)
    net = stmt.get("netProfitLoss")
    interest = stmt.get("interestExpense") or 0
    if net is not None and depreciation is not None:
        return float(net) + float(interest) + float(depreciation)
    return None


def build_metric_placeholders(
    stmts: list[dict],
    trends: Optional[dict] = None,
    company_name: str = "",
    statutar_changes: Optional[int] = None,
    language: str = "sk",
) -> dict[str, str]:
    """Postaví slovník placeholder → formátovaná hodnota z DB dát.

    Args:
        stmts: Zoznam financial statement dictov (zoradené od najstaršieho).
        trends: Voliteľné, analyza_trendov dict (pre Altman Z, ratios).
        company_name: Názov spoločnosti.
        statutar_changes: Počet zmien štatutárov (z ORSR).
        language: Jazyk reportu ('sk', 'en', 'de', 'cz', 'hu', 'pl') — ovplyvňuje slovesá v YoY textoch.

    Returns:
        Dict placeholder → str hodnota (napr. {"{{REVENUE}}": "111,6 mil. €", ...})
    """
    if not stmts:
        return {}

    # Zoradiť podľa roku (najstarší → najnovší) — bezpečné pre akékoľvek poradie vstupu
    sorted_stmts = sorted(stmts, key=lambda s: s.get("year", 0) or 0)
    latest = sorted_stmts[-1]
    prev = sorted_stmts[-2] if len(sorted_stmts) >= 2 else {}

    # ── Jazykové slovesá pre YoY trendy ──
    # SK: "vzrástli o 8,2 %" / "klesli o 8,2 %"
    # EN: "increased by 8.2%" / "decreased by 8.2%"
    _VERBS = {
        "sk": {
            "rev_pos": "vzrástli", "rev_neg": "klesli",
            "eq_pos": "vzrástlo", "eq_neg": "kleslo",
            "ocf_pos": "stúpol", "ocf_neg": "klesol",
            "net_pos": "vzrástol", "net_neg": "klesol",
        },
        "en": {
            "rev_pos": "increased", "rev_neg": "decreased",
            "eq_pos": "grew", "eq_neg": "declined",
            "ocf_pos": "rose", "ocf_neg": "fell",
            "net_pos": "increased", "net_neg": "decreased",
        },
    }
    _v = _VERBS.get(language, _VERBS["sk"])

    # ── Finančné hodnoty (najnovší rok) ──
    ph: dict[str, str] = {}
    ph["{{REVENUE}}"] = _format_eur(latest.get("mainActivityRevenue"))
    ph["{{REVENUE_PREV}}"] = _format_eur(prev.get("mainActivityRevenue"))
    ph["{{NET_RESULT}}"] = _format_eur(latest.get("netProfitLoss"))
    ph["{{NET_RESULT_PREV}}"] = _format_eur(prev.get("netProfitLoss"))
    ph["{{ASSETS}}"] = _format_eur(latest.get("totalAssets"))
    ph["{{EQUITY}}"] = _format_eur(latest.get("equity"))
    ph["{{OCF}}"] = _format_eur(latest.get("operatingCashFlow"))
    ph["{{CASH}}"] = _format_eur(latest.get("cashAndEquivalents"))
    ph["{{ST_LIABILITIES}}"] = _format_eur(latest.get("shortTermLiabilities"))
    ph["{{LT_LIABILITIES}}"] = _format_eur(latest.get("longTermLiabilities"))
    ph["{{TRADE_RECEIVABLES}}"] = _format_eur(latest.get("tradeReceivables"))
    ph["{{TRADE_PAYABLES}}"] = _format_eur(latest.get("tradePayables"))
    ph["{{INVENTORY}}"] = _format_eur(latest.get("inventory"))
    ph["{{DEPRECIATION}}"] = _format_eur(latest.get("depreciation"))

    # ── EBITDA ──
    ebitda = _compute_ebitda(latest)
    ph["{{EBITDA}}"] = _format_eur(ebitda)
    revenue = latest.get("mainActivityRevenue")
    if ebitda is not None and revenue and float(revenue) > 0:
        ph["{{EBITDA_MARGIN}}"] = _format_pct((float(ebitda) / float(revenue)) * 100)
    else:
        ph["{{EBITDA_MARGIN}}"] = "N/A"

    # ── Trendy (YoY) ──
    ph["{{REVENUE_YOY}}"] = _yoy_text(
        latest.get("mainActivityRevenue"), prev.get("mainActivityRevenue"),
        _v["rev_pos"], _v["rev_neg"], language=language
    )
    ph["{{REVENUE_YOY_PCT}}"] = _format_pct(
        ((float(latest.get("mainActivityRevenue", 0) or 0) - float(prev.get("mainActivityRevenue", 0) or 0))
         / abs(float(prev.get("mainActivityRevenue", 0) or 1))) * 100
    ) if prev.get("mainActivityRevenue") else "N/A"
    ph["{{EQUITY_YOY}}"] = _yoy_text(
        latest.get("equity"), prev.get("equity"),
        _v["eq_pos"], _v["eq_neg"], language=language
    )
    if latest.get("equity") is not None and prev.get("equity") is not None and float(prev.get("equity", 0) or 0) != 0:
        _eq_pct = ((float(latest["equity"]) - float(prev["equity"])) / abs(float(prev["equity"]))) * 100
        ph["{{EQUITY_YOY_PCT}}"] = _format_pct(_eq_pct)
    else:
        ph["{{EQUITY_YOY_PCT}}"] = "N/A"
    ph["{{OCF_YOY}}"] = _yoy_text(
        latest.get("operatingCashFlow"), prev.get("operatingCashFlow"),
        _v["ocf_pos"], _v["ocf_neg"], language=language
    )
    # ST_LIAB_YOY: "nárast o 85,8 %" / "pokles o 10,2 %" (SK) alebo "increase of 85.8%" / "decrease of 10.2%" (EN)
    if latest.get("shortTermLiabilities") is not None and prev.get("shortTermLiabilities") is not None:
        _st_curr = float(latest["shortTermLiabilities"])
        _st_prev = float(prev["shortTermLiabilities"])
        if _st_prev != 0:
            _st_pct = ((_st_curr - _st_prev) / abs(_st_prev)) * 100
            if language == "en":
                ph["{{ST_LIAB_YOY}}"] = f"increase of {_format_pct(_st_pct)}" if _st_pct >= 0 else f"decrease of {_format_pct(abs(_st_pct))}"
            else:
                ph["{{ST_LIAB_YOY}}"] = f"nárast o {_format_pct(_st_pct)}" if _st_pct >= 0 else f"pokles o {_format_pct(abs(_st_pct))}"
        else:
            ph["{{ST_LIAB_YOY}}"] = "N/A"
    else:
        ph["{{ST_LIAB_YOY}}"] = "N/A"

    # ── NET_RESULT_YOY: špeciálny prípad (zisk→strata = "preklopenie do straty" / "swung to net loss") ──
    _net_curr = latest.get("netProfitLoss")
    _net_prev = prev.get("netProfitLoss")
    if _net_curr is not None and _net_prev is not None:
        if float(_net_prev) > 0 and float(_net_curr) < 0:
            ph["{{NET_RESULT_YOY}}"] = "swung to net loss" if language == "en" else "preklopenie do čistej straty"
        elif float(_net_prev) < 0 and float(_net_curr) >= 0:
            ph["{{NET_RESULT_YOY}}"] = "returned to profit" if language == "en" else "návrat do zisku"
        else:
            ph["{{NET_RESULT_YOY}}"] = _yoy_text(_net_curr, _net_prev, _v["net_pos"], _v["net_neg"], language=language)
    else:
        ph["{{NET_RESULT_YOY}}"] = "N/A"

    # ── NET_RESULT_YOY_PCT: percentuálna zmena čistého výsledku ──
    if _net_curr is not None and _net_prev is not None:
        _np_prev = float(_net_prev)
        _np_curr = float(_net_curr)
        if _np_prev == 0:
            if _np_curr > 0:
                ph["{{NET_RESULT_YOY_PCT}}"] = "n/a (from zero to profit)" if language == "en" else "n/a (z nulového výsledku do zisku)"
            elif _np_curr < 0:
                ph["{{NET_RESULT_YOY_PCT}}"] = "n/a (from zero to loss)" if language == "en" else "n/a (z nulového výsledku do straty)"
            else:
                ph["{{NET_RESULT_YOY_PCT}}"] = "0 %"
        elif _np_prev > 0 and _np_curr < 0:
            ph["{{NET_RESULT_YOY_PCT}}"] = "swung to loss" if language == "en" else "preklopenie do straty"
        elif _np_prev < 0 and _np_curr >= 0:
            ph["{{NET_RESULT_YOY_PCT}}"] = "returned to profit" if language == "en" else "návrat do zisku"
        else:
            ph["{{NET_RESULT_YOY_PCT}}"] = _format_pct(
                ((_np_curr - _np_prev) / abs(_np_prev)) * 100
            )
    else:
        ph["{{NET_RESULT_YOY_PCT}}"] = "N/A"

    # ── Finančné pomery ──
    # Current ratio = currentAssets / shortTermLiabilities
    _ca = latest.get("currentAssets")
    _stl = latest.get("shortTermLiabilities")
    if _ca is not None and _stl is not None and float(_stl) > 0:
        ph["{{CURRENT_RATIO}}"] = _format_ratio(float(_ca) / float(_stl))
    else:
        ph["{{CURRENT_RATIO}}"] = "N/A"

    # Altman Z z trends (ak je k dispozícii)
    if trends:
        all_z = trends.get("altman_z_scores") or []
        if all_z:
            last_z = all_z[-1]
            z_score = last_z.get("z_score")
            ph["{{ALTMAN_Z}}"] = _format_ratio(z_score)
            ph["{{ALTMAN_ZONE}}"] = _altman_zone(z_score)
        else:
            ph["{{ALTMAN_Z}}"] = "N/A"
            ph["{{ALTMAN_ZONE}}"] = "N/A"
    else:
        ph["{{ALTMAN_Z}}"] = "N/A"
        ph["{{ALTMAN_ZONE}}"] = "N/A"

    # D/E = total_liabilities / equity
    # Prefer totalLiabilities (row 101 — zahŕňa rezervy + všetky záväzky), fallback na ST+LT, potom bilančná rovnica.
    # KONZISTENTNÉ s compute_ratios() v analytics.py — inak LLM a scorecard ukazujú rozdielne D/E.
    _eq = latest.get("equity")
    if _eq is not None and float(_eq) > 0:
        _st_liab = float(latest.get("shortTermLiabilities", 0) or 0)
        _lt_liab = float(latest.get("longTermLiabilities", 0) or 0)
        _total_liab_exact = latest.get("totalLiabilities")
        _total_assets = latest.get("totalAssets")
        if _total_liab_exact is not None and float(_total_liab_exact) > 0:
            _total_liab = float(_total_liab_exact)
        elif _st_liab > 0 or _lt_liab > 0:
            _total_liab = _st_liab + _lt_liab
        elif _total_assets is not None:
            _total_liab = float(_total_assets) - float(_eq)  # bilančná rovnica
        else:
            _total_liab = 0
        ph["{{DEBT_EQUITY}}"] = _format_ratio(_total_liab / float(_eq)) if _total_liab > 0 else "N/A"
    else:
        ph["{{DEBT_EQUITY}}"] = "N/A"

    # Net margin = netProfitLoss / revenue
    if _net_curr is not None and revenue and float(revenue) > 0:
        ph["{{NET_MARGIN}}"] = _format_pct((float(_net_curr) / float(revenue)) * 100)
    else:
        ph["{{NET_MARGIN}}"] = "N/A"

    # Gross margin = grossProfit / revenue
    _gp = latest.get("grossProfit")
    if _gp is not None and revenue and float(revenue) > 0:
        ph["{{GROSS_MARGIN}}"] = _format_pct((float(_gp) / float(revenue)) * 100)
    else:
        ph["{{GROSS_MARGIN}}"] = "N/A"

    # ── Kontext ──
    ph["{{EMPLOYEE_COUNT}}"] = _format_count(latest.get("employeeCount"))
    ph["{{STATUTAR_CHANGES}}"] = str(statutar_changes) if statutar_changes is not None else "N/A"
    ph["{{COMPANY_NAME}}"] = company_name or "N/A"
    ph["{{LATEST_YEAR}}"] = str(latest.get("year", "")) if latest.get("year") else "N/A"

    # ── RPE alert (revenue per employee anomaly) ──
    # Ak employeeCount chýba, odhadneme z staffCosts / 18k EUR (priemerná mzda SK).
    # Ak RPE > 2M EUR/zamestnanec, ide o silný varovný signál (štrukturálna anomália).
    _emp = latest.get("employeeCount")
    _emp_source = "reported"
    if _emp is None or _emp <= 0:
        _staff_costs = latest.get("staffCosts")
        if _staff_costs and float(_staff_costs) > 0:
            _emp = max(1, round(float(_staff_costs) / 18_000))
            _emp_source = "estimated"
    _rev = latest.get("mainActivityRevenue")
    if _emp and _emp > 0 and _rev and float(_rev) > 0:
        _rpe = float(_rev) / float(_emp)
        if _rpe > 2_000_000:
            _emp_label = _format_count(_emp) + ("*" if _emp_source == "estimated" else "")
            ph["{{RPE_ALERT}}"] = (
                f"VAROVANIE: Extrémny nepomer — {int(_rpe):,} EUR/zamestnanec "
                f"({_emp_label} zamestnancov, odhad z mzdových nákladov). "
                f"Priemer SK: 80 000–200 000 EUR. Prever skutočnú pracovnú silu."
            ).replace(",", " ")
        else:
            ph["{{RPE_ALERT}}"] = "N/A"
    else:
        ph["{{RPE_ALERT}}"] = "N/A"

    # ── CAPEX (investing cash flow — záporné, zobrazujeme absolútnu hodnotu) ──
    _icf = latest.get("investingCashFlow")
    if _icf is not None:
        ph["{{CAPEX}}"] = _format_eur(abs(float(_icf)))
    else:
        # Fallback: extrahuj CAPEX z notesRisk.significantInvestments textu
        _capex_fallback = None
        _si = latest.get("significantInvestments")
        if _si and isinstance(_si, str):
            _m = re.search(r'(\d[\d\s]*\d)\s*(?:EUR|€)', _si, re.IGNORECASE)
            if _m:
                _val = _m.group(1).replace('\xa0', '').replace(' ', '')
                try:
                    _capex_fallback = abs(float(_val))
                except ValueError:
                    pass
        ph["{{CAPEX}}"] = _format_eur(_capex_fallback) if _capex_fallback is not None else "N/A"

    # ── Equity ratio = equity / totalAssets * 100 ──
    _ta = latest.get("totalAssets")
    if _eq is not None and _ta is not None and float(_ta) > 0:
        ph["{{EQUITY_RATIO}}"] = _format_pct((float(_eq) / float(_ta)) * 100)
    else:
        ph["{{EQUITY_RATIO}}"] = "N/A"

    # ── Working capital = currentAssets - shortTermLiabilities ──
    if _ca is not None and _stl is not None:
        _wc = float(_ca) - float(_stl)
        ph["{{WORKING_CAPITAL}}"] = _format_eur(_wc)
    else:
        ph["{{WORKING_CAPITAL}}"] = "N/A"

    # ── CAGR (compound annual growth rate) — tržby cez všetky roky ──
    _revenues = [float(s.get("mainActivityRevenue", 0) or 0) for s in sorted_stmts if s.get("mainActivityRevenue") and float(s["mainActivityRevenue"]) > 0]
    if len(_revenues) >= 2 and _revenues[0] > 0:
        _n_years = len(_revenues) - 1
        _cagr = ((_revenues[-1] / _revenues[0]) ** (1.0 / _n_years) - 1) * 100
        ph["{{CAGR}}"] = _format_pct(_cagr)
    else:
        ph["{{CAGR}}"] = "N/A"

    return ph


def inject_metrics(
    text: str,
    placeholders: dict[str, str],
    *,
    ico: str = "",
    field: str = "",
) -> str:
    """Nahradí placeholdre v texte deterministickými hodnotami z DB.

    Args:
        text: Text s placeholdermi (napr. "Tržby {{REVENUE_YOY}}...").
        placeholders: Dict z build_metric_placeholders().
        ico: Company IČO for telemetry logging.
        field: Field name (e.g. "executiveSummary") for telemetry logging.

    Returns:
        Text s nahradenými placeholdermi.
    """
    if not text:
        return text
    if placeholders:
        for placeholder, value in placeholders.items():
            text = text.replace(placeholder, value)
    # ── Unknown placeholder telemetry: log before removal ──
    _unknown = re.findall(r'\{\{[A-Z_]+\}\}', text)
    if _unknown:
        for _ph in set(_unknown):
            logger.warning(
                "UNKNOWN_PLACEHOLDER: ico=%s field=%s placeholder=%s action=remove",
                ico, field, _ph,
            )
    # ── Remove unresolved placeholders ──
    text = re.sub(r'\{\{[A-Z_]+\}\}', '', text)
    # ── CAPEX N/A repair for cached verdicts ──
    capex_val = placeholders.get("{{CAPEX}}", "")
    if capex_val and capex_val != "N/A":
        def _replace_capex_na(m):
            prefix = m.group(1)
            return f'{prefix}({capex_val})'
        text = re.sub(
            r'((?:investič|dlhodob.{0,20}majetk|CAPEX|capex|hmotn.{0,20}majetk).{0,80}?)\(N/A\)',
            _replace_capex_na,
            text,
            flags=re.IGNORECASE,
        )
    # ── Structural dangling fragment cleanup ──
    # Instead of hardcoding every possible fragment, use patterns that target
    # the grammatical structure left behind when a placeholder is removed.
    text = _cleanup_dangling_fragments(text)
    return text


def _cleanup_dangling_fragments(text: str) -> str:
    """Remove dangling sentence fragments caused by placeholder removal.

    Targets grammatical structures where a value was expected but removed,
    leaving broken prose. Uses structural patterns rather than exhaustive listing.
    """
    # Pattern: "o viac ako" / "o takmer" / "o približne" / "o nad" followed by
    # punctuation or conjunction — the value after these modifiers was removed.
    text = re.sub(
        r'\s+o\s+(?:viac\s+ako|takmer|približne|nad|cca)\s*[.,;]',
        '.',
        text,
        flags=re.IGNORECASE,
    )
    # "o viac ako a" / "o takmer a" / "o viac ako na" — missing value + conjunction/preposition
    text = re.sub(
        r'\s+o\s+(?:viac\s+ako|takmer|približne)\s+(?=(?:a\s|čo\s|pričom\s|ale\s|na\s))',
        ' ',
        text,
        flags=re.IGNORECASE,
    )
    # "klesol o," / "vzrástol o." / "stúpol o," / "prepadol o." — verb + "o" + punctuation
    text = re.sub(
        r'\s+o\s*(?=[.,;])',
        '',
        text,
    )
    # "o, čo" — missing value before comma
    text = re.sub(r'\s+o,\s*čo\b', ', čo', text)
    # "vo výške." / "vo výške," / "vo výške viac než." — missing amount
    text = re.sub(
        r'\s+vo\s+výške\s+(?:viac\s+než|takmer|nad|približne|cca)\s*[.,;]',
        '.',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r'\s+vo\s+výške\s*[.,;]', '.', text, flags=re.IGNORECASE)
    # "dosiahol." / "dosiahla." at sentence end — dangling verb without value
    text = re.sub(
        r'\s+(?:dosiahol|dosiahla|dosiahli|predstavuje|predstavoval)\s*[.,;]',
        '.',
        text,
        flags=re.IGNORECASE,
    )
    # "úveru. čo" — wrong punctuation after placeholder removal
    text = re.sub(r'úveru\.\s+čo', 'úveru, čo', text)
    # Fix double punctuation caused by cleanup
    text = re.sub(r'\.\s*\.', '.', text)
    # Fix space before punctuation
    text = re.sub(r'\s+([,.])', r'\1', text)
    # ── Missing value between prepositions (BUG 1: empty placeholders) ──
    # "representing of total assets" → "of total assets" (missing % before "of")
    text = re.sub(r'\s+representing\s+of\b', ' of', text, flags=re.IGNORECASE)
    # "ratio of and" → "ratio and" (missing value between "of" and "and")
    text = re.sub(r'\s+ratio\s+of\s+and\b', ' ratio and', text, flags=re.IGNORECASE)
    # "equity ratio of and" → "equity ratio and"
    text = re.sub(r'\s+equity\s+ratio\s+of\s+and\b', ' equity ratio and', text, flags=re.IGNORECASE)
    # "from to" → remove (missing two values, e.g. "self-sufficiency from to 60%")
    text = re.sub(r'\s+from\s+to\b', '', text, flags=re.IGNORECASE)
    # "from % to" or "from to %" — partial placeholder removal
    text = re.sub(r'\s+from\s+%\s+to\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s+from\s+to\s+%', ' to %', text, flags=re.IGNORECASE)
    # "increase ... from to" → "increase" (dangling)
    text = re.sub(r'\s+from\s+(?=(?:to\s|and\s|,\s|\.))', '', text, flags=re.IGNORECASE)
    return text


# ── Post-injection validator ──
_DANGLING_VALIDATOR_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bo\s+viac\s+ako\s*[.,;]', re.IGNORECASE), "o viac ako [punct]"),
    (re.compile(r'\bo\s+viac\s+ako\s+na\b', re.IGNORECASE), "o viac ako na [preposition]"),
    (re.compile(r'\bo\s+takmer\s*[.,;]', re.IGNORECASE), "o takmer [punct]"),
    (re.compile(r'\bo\s+takmer\s+na\b', re.IGNORECASE), "o takmer na [preposition]"),
    (re.compile(r'\bo\s+približne\s*[.,;]', re.IGNORECASE), "o približne [punct]"),
    (re.compile(r'\bo\s+približne\s+na\b', re.IGNORECASE), "o približne na [preposition]"),
    (re.compile(r'\bvo\s+výške\s*[.,;]', re.IGNORECASE), "vo výške [punct]"),
    (re.compile(r'\bvo\s+výške\s+(?:viac|takmer|nad|približne)\b', re.IGNORECASE), "vo výške modifier without value"),
    (re.compile(r'\b(?:dosiahol|dosiahla|dosiahli|predstavuje)\s*[.,;]', re.IGNORECASE), "verb [punct] without value"),
    (re.compile(r'\b(?:klesol|vzrástol|stúpol|prepadol|rástol)\s+o\s*[.,;]', re.IGNORECASE), "verb o [punct]"),
    (re.compile(r'\b(?:klesol|vzrástol|stúpol|prepadol|rástol)\s+o,\s', re.IGNORECASE), "verb o, [space]"),
    (re.compile(r'\bo,\s*čo\b', re.IGNORECASE), "o, čo"),
    (re.compile(r'\{\{[A-Z_]+\}\}'), "unresolved placeholder"),
    # BUG 1: Missing values where placeholders were removed
    (re.compile(r'\brepresenting\s+of\b', re.IGNORECASE), "representing of [missing value]"),
    (re.compile(r'\bratio\s+of\s+and\b', re.IGNORECASE), "ratio of and [missing value]"),
    (re.compile(r'\bfrom\s+to\b', re.IGNORECASE), "from to [missing values]"),
    (re.compile(r'\bfrom\s+%\s+to\b', re.IGNORECASE), "from % to [missing value]"),
]


def validate_final_text(text: str) -> list[str]:
    """Validate final text after inject_metrics. Returns list of dangling fragment descriptions.

    If the returned list is non-empty, the text contains broken prose that
    should not be saved to DB or rendered to PDF.

    Args:
        text: Final text after placeholder injection and cleanup.

    Returns:
        List of human-readable descriptions of dangling fragments. Empty = clean.
    """
    if not text:
        return []
    findings: list[str] = []
    for pattern, description in _DANGLING_VALIDATOR_PATTERNS:
        if pattern.search(text):
            findings.append(description)
    return findings


def sanitize_final_text(text: str, *, ico: str = "", field: str = "") -> str:
    """Sanitize final text: validate and replace broken sentences with safe fallback.

    If dangling fragments are found after cleanup, the affected sentences are
    removed entirely. This is a BLOCKING condition — broken prose never reaches
    DB or PDF. The rest of the text (clean sentences) is preserved.

    Args:
        text: Final text after inject_metrics + cleanup.
        ico: Company IČO for logging.
        field: Field name for logging.

    Returns:
        Clean text with broken sentences removed, or original text if no issues.
    """
    if not text:
        return text
    findings = validate_final_text(text)
    if not findings:
        return text
    logger.error(
        "DANGLING_FRAGMENT_BLOCKED: ico=%s field=%s findings=%s — removing broken sentences",
        ico, field, findings,
    )
    # Split into sentences and keep only clean ones
    _sentence_end = re.compile(r'(?<=[.!?])\s+')
    sentences = _sentence_end.split(text)
    clean_sentences: list[str] = []
    removed = 0
    for s in sentences:
        s_findings = validate_final_text(s)
        if s_findings:
            removed += 1
            logger.warning(
                "DANGLING_SENTENCE_REMOVED: ico=%s field=%s sentence=%s findings=%s",
                ico, field, s[:120], s_findings,
            )
        else:
            clean_sentences.append(s)
    if removed and not clean_sentences:
        # All sentences were broken — return safe fallback
        logger.error(
            "DANGLING_ALL_SENTENCES_REMOVED: ico=%s field=%s — no valid text remains",
            ico, field,
        )
        return ""
    return " ".join(clean_sentences)


# ── Number format normalization (US → SK) ──────────────────────────────────
# LLM občas generuje US-style čísla v texte (napr. "EUR 25.9M", "2.28") aj keď
# report je v slovenčine. Toto normalizuje formát na SK štýl (čiarka, medzera tisícov).

def _normalize_number_formats(text: str, language: str = "sk") -> str:
    """Normalizuje číselné formátovanie v texte na konzistentný štýl.

    Pre SK/CZ/HU/PL: desatinná čiarka, medzera ako oddeľovač tisícov, "mil. €" namiesto "M".
    Pre EN/DE: desatinná bodka (EN) alebo čiarka (DE).

    Args:
        text: Text s prípadne nekonzistentnými číslami.
        language: Cieľový jazyk formátovania.

    Returns:
        Text s normalizovanými číslami.
    """
    if not text:
        return text

    use_comma = language in ("sk", "cz", "hu", "pl", "de")

    # "EUR 25.9M" / "EUR 25.9 million" / "25.9M EUR" → "25,9 mil. €" (SK) alebo "25.9 mil. €" (EN)
    def _replace_eur_m(match):
        num = match.group(1)
        sep = "," if use_comma else "."
        num = num.replace(".", sep)
        curr = "€" if use_comma else "EUR"
        return f"{num} mil. {curr}"

    text = re.sub(r'EUR\s*(\d[\d.]*?)M\b', _replace_eur_m, text, flags=re.IGNORECASE)
    text = re.sub(r'EUR\s*(\d[\d.]*?)\s*million\b', _replace_eur_m, text, flags=re.IGNORECASE)
    text = re.sub(r'(\d[\d.]*?)M\s*EUR\b', _replace_eur_m, text, flags=re.IGNORECASE)
    text = re.sub(r'(\d[\d.]*?)\s*million\s*EUR\b', _replace_eur_m, text, flags=re.IGNORECASE)
    text = re.sub(r'(\d[\d.]*?)M\b(?=\s*(?:net|profit|loss|revenue|in|from|to|,|\.))',
                  lambda m: m.group(1).replace(".", ",") + " mil. €" if use_comma else m.group(1) + " mil. EUR",
                  text, flags=re.IGNORECASE)

    # "EUR 25.9B" / "25.9 billion" → "25,9 mld. €"
    def _replace_eur_b(match):
        num = match.group(1)
        sep = "," if use_comma else "."
        num = num.replace(".", sep)
        curr = "€" if use_comma else "EUR"
        return f"{num} mld. {curr}"

    text = re.sub(r'EUR\s*(\d[\d.]*?)B\b', _replace_eur_b, text, flags=re.IGNORECASE)
    text = re.sub(r'EUR\s*(\d[\d.]*?)\s*billion\b', _replace_eur_b, text, flags=re.IGNORECASE)

    # Standalone ratios: "2.28" in ratio context → "2,28" (SK)
    # Only convert when preceded by ratio keywords (avoids converting years like "2024.5")
    if use_comma:
        # "ratio of 2.28" / "ratio: 2.28" / "D/E 0.33" / "Z'' 6.36" / "current ratio 2.28"
        text = re.sub(
            r'((?:ratio|D/E|Z[\'\u2019\u2032]{0,2}|current\s+ratio|debt.to.equity)\s*(?:of\s+)?[:\s]*)\s*(\d+\.\d+)',
            lambda m: m.group(1) + m.group(2).replace(".", ","),
            text,
            flags=re.IGNORECASE,
        )

    return text



# ── Double negation fix (BUG 5) ─────────────────────────────────────────────
# LLM občas generuje "decline of -30,9 %" alebo "pokles o -13,2 %" — dvojitá negácia.
# Správne: "decline of 30,9 %" alebo "pokles o 13,2 %".

def _fix_double_negation(text: str) -> str:
    """Opraví dvojitú negáciu v texte (decline/pokles + záporné percento)."""
    if not text:
        return text
    # EN: "decline of -30,9 %" / "decline of -30.9%" → "decline of 30,9 %"
    text = re.sub(
        r'(decline\s+of|decrease\s+of|drop\s+of|fall\s+of|reduction\s+of)\s+[-−](\d[\d.,]*)\s*%',
        r'\1 \2 %',
        text,
        flags=re.IGNORECASE,
    )
    # SK: "pokles o -13,2 %" / "klesol o -5,1 %" → "pokles o 13,2 %" / "klesol o 5,1 %"
    text = re.sub(
        r'(pokles\s+o|klesol\s+o|klesli\s+o|kleslo\s+o|poklesla\s+o|zníženie\s+o)\s+[-−](\d[\d.,]*)\s*%',
        r'\1 \2 %',
        text,
        flags=re.IGNORECASE,
    )
    # CZ: "pokles o -13,2 %" → "pokles o 13,2 %"
    text = re.sub(
        r'(pokles\s+o|klesl\s+o|klesly\s+o|snížení\s+o)\s+[-−](\d[\d.,]*)\s*%',
        r'\1 \2 %',
        text,
        flags=re.IGNORECASE,
    )
    # DE: "Rückgang um -13,2 %" → "Rückgang um 13,2 %"
    text = re.sub(
        r'(Rückgang\s+um|Rückgänge\s+um|Abnahme\s+um)\s+[-−](\d[\d.,]*)\s*%',
        r'\1 \2 %',
        text,
        flags=re.IGNORECASE,
    )
    # PL: "spadek o -13,2 %" → "spadek o 13,2 %"
    text = re.sub(
        r'(spadek\s+o|spadku\s+o)\s+[-−](\d[\d.,]*)\s*%',
        r'\1 \2 %',
        text,
        flags=re.IGNORECASE,
    )
    return text


# Primárna ochrana je cez placeholder systém (build_metric_placeholders + inject_metrics).
# Tieto patterns zachytávajú prípady, keď LLM napriek inštrukciám napíše konkrétne čísla.
# Zjednodušené z 58 patterns na ~15 — väčšina dangling cleanup už nie je potrebná,
# lebo placeholdre nezanechávajú dangling fragmenty.
_METRIC_PATTERNS = [
    # ── Raw EUR hodnoty (LLM ignoroval placeholder pravidlo) ──
    # "103 miliónov EUR" / "103 mil. €" / "103 miliónov"
    (re.compile(r'\d[\d\s.,]*\s*(?:miliónov[a]?|mil\.|mld\.|miliárd[a]?)\s*(?:EUR|€|Eur)?', re.IGNORECASE), ''),
    # "1 132 711 EUR" / "15 593 EUR" / "−26 361 EUR"
    (re.compile(r'[−-]?\d[\d\s]{2,}\s*(?:EUR|€)', re.IGNORECASE), ''),
    # ── Raw percentá (LLM ignoroval placeholder pravidlo) ──
    # "17,39%" / "13,2 %" / "o 19,24 %"
    (re.compile(r'\d[\d.,]*\s*%', re.IGNORECASE), ''),
    # ── Raw finančné pomery (LLM ignoroval placeholder pravidlo) ──
    # "Altman Z'' 6,31" / "Altman Z skóre ... 6,31"
    (re.compile(r"Altman\s+Z[''\u2019\u2032]*(?:\s*skóre)?\s*[^.]{0,30}?\d[\d.,]*", re.IGNORECASE), r"Altman Z''"),
    # "Current ratio 2,50" / "D/E 0,77"
    (re.compile(r'(Current\s+ratio|D/E)\s+[^.]{0,30}?\d[\d.,]*', re.IGNORECASE), r'\1'),
    # ── Raw čísla po "záväzky" (bez EUR) ──
    (re.compile(r'(záväzky(?:\s+(?:zo\s+|voči\s+|z\s+)?[a-zA-Zäöüščťžýáíé\s]*?))\s+\d[\d\s]{3,}(?!\s*(?:EUR|€|%|\.|,))', re.IGNORECASE), r'\1'),
    # ── Základný cleanup (zachovať — funguje aj pre naratívy) ──
    # "()" → "" (leftover po "(−26 361 EUR)")
    (re.compile(r'\(\s*\)'), ''),
    # "  " → " " (double spaces)
    (re.compile(r'  +'), ' '),
    # " ," → "," a " ." → "." (medzera pred bodkou/čiarkou)
    (re.compile(r'\s+([,.])'), r'\1'),
    # " ." → "." (medzera pred bodkou)
    (re.compile(r'\s+\.'), '.'),
    # ── Dangling cleanup (pre naratívy, ktoré stále používajú starý formát) ──
    # "na úrovni" → "" (leftover po "na úroveň X mil. €")
    (re.compile(r'\s+na\s+úrovni(?=\s*[,.;]|\s+(?:ale|a|avšak|pričom|čo|ktor|v|s|na|firma|spoločnosť|prevádzkový)\b)', re.IGNORECASE), ''),
    (re.compile(r'\s+na\s+úrovni\s*$', re.IGNORECASE), ''),
    (re.compile(r'\s+na\s+úrovni\s*\.', re.IGNORECASE), '.'),
    # "na úrovni za posledné roky" (dangling CAGR — LLM nepoužil placeholder)
    (re.compile(r'\s+na\s+úrovni\s+(?:za\s+posledné\s+roky|za\s+posledných\s+rokov|v\s+posledných\s+rokoch)\b', re.IGNORECASE), ''),
    # "nad predstavuje" → "predstavuje" (leftover "nad X mil. € predstavuje")
    (re.compile(r'\s+nad\s+(?=(?:predstavuje|ukazuje|svedčí|indikuje)\b)', re.IGNORECASE), ' '),
    # "dosiahol, zatiaľ čo" → ", zatiaľ čo" (dangling "dosiahol" bez hodnoty)
    (re.compile(r'\s+dosiahol\s*,\s*(?=(?:zatiaľ|čo|pričom|ale|a)\b)', re.IGNORECASE), ', '),
    # "nárast ," → "," (dangling "nárast" bez hodnoty)
    (re.compile(r'\s+nárast\s*,(?=\s*(?:čo|a|ale|pričom)\b)', re.IGNORECASE), ','),
    # ── Dangling cleanup pre nenahradené placeholdre ──
    # "vo výške viac než." / "vo výške takmer." / "vo výške." (placeholder nebol nahradený)
    (re.compile(r'\s+vo\s+výške\s+(?:viac\s+než|takmer|nad|približne|cca)\s*[.,;]', re.IGNORECASE), '.'),
    (re.compile(r'\s+vo\s+výške\s*[.,;]', re.IGNORECASE), '.'),
    (re.compile(r'\s+vo\s+výške\s*$', re.IGNORECASE), ''),
    # "o na" (dangling — "rast tržieb o {{X}}% na..." → "rast tržieb na...")
    (re.compile(r'\s+o\s+na\s+', re.IGNORECASE), ' '),
    # "dosahuje." / "dosahuje " na konci vety (dangling CAGR placeholder)
    (re.compile(r'\s+dosahuje\s*[.,;]', re.IGNORECASE), '.'),
    (re.compile(r'\s+dosahuje\s*$', re.IGNORECASE), ''),
    # "(-)" (dangling working capital placeholder)
    (re.compile(r'\(\s*[-−]\s*\)'), ''),
    # "stratu -" / "stratu -." (dangling net loss placeholder)
    (re.compile(r'\s+stratu\s+[-−]\s*[.,;]', re.IGNORECASE), ' stratu.'),
    (re.compile(r'\s+[-−]\s+(?=v\s+roku)', re.IGNORECASE), ' '),
    # ── Dangling cleanup pre CAPEX / related-party (BUG A) ──
    # "dosiahli takmer," / "dosiahli takmer." (CAPEX placeholder nebol nahradený)
    (re.compile(r'\s+dosiahli\s+(?:takmer|približne|nad|viac\s+než|cca)\s*[.,;]', re.IGNORECASE), '.'),
    # "dosiahli takmer čo" → "čo" (dangling CAPEX + "čo smerovalo")
    (re.compile(r'\s+dosiahli\s+(?:takmer|približne|nad|viac\s+než|cca)\s+(?=čo\b)', re.IGNORECASE), ' '),
    # "Približne tržieb" / "Približne % tržieb" (related-party pct placeholder chýba)
    (re.compile(r'\s+[Pp]ribližne\s+(?=tržieb\b)', re.IGNORECASE), ' '),
    # "Approximately revenue" / "Approximately % revenue" (EN equivalent)
    (re.compile(r'\s+[Aa]pproximately\s+(?=revenue\b)', re.IGNORECASE), ' '),
    # "investície do dlhodobého majetku dosiahli takmer" → remove "takmer" at end
    (re.compile(r'\s+(?:takmer|približne|nad|viac\s+než|cca)\s*$', re.IGNORECASE), ''),
]



def _strip_narrative_financial_metrics(narrative) -> None:
    """
    Očistí naratívne textové polia od konkrétnych finančných metrík.
    Pôsobí in-place na NarrativeRiskAnalysis objekte.
    """
    text_fields = [
        'synthesis', 'management_changes', 'litigation_risks',
        'planned_investments', 'profitability_explanation',
    ]
    modified = False
    for field in text_fields:
        val = getattr(narrative, field, None)
        if not val or not isinstance(val, str):
            continue
        original = val
        for pattern, replacement in _METRIC_PATTERNS:
            val = pattern.sub(replacement, val)
        if val != original:
            setattr(narrative, field, val)
            modified = True
    # forensic_red_flags je list[str]
    flags = getattr(narrative, 'forensic_red_flags', None)
    if flags and isinstance(flags, list):
        new_flags = []
        for flag in flags:
            if not isinstance(flag, str):
                new_flags.append(flag)
                continue
            original = flag
            for pattern, replacement in _METRIC_PATTERNS:
                flag = pattern.sub(replacement, flag)
            new_flags.append(flag)
        if new_flags != flags:
            narrative.forensic_red_flags = new_flags
            modified = True
    if modified:
        logger.info(f"[NARRATIVE] Očistené konkrétne finančné metriky z naratívneho textu")


def _inject_ncrzp_findings(payload: dict, registry_findings: list[dict], ico: str, language: str = "sk") -> dict:
    """
    Deterministický inject NCRZP záložných práv do AuditVerdict justification.
    Ak NCRZP scraper našiel záložné práva a LLM ich nespomenul v executiveSummary,
    pridá štruktúrovaný záznam do tabuľky Forenzné dôkazy.
    """
    # Nájdi NCRZP findings
    ncrzp_findings = None
    for rf in (registry_findings or []):
        if rf.get("source_type") == "NCRZP":
            ncrzp_findings = rf.get("findings", "")
            break

    if not ncrzp_findings:
        return payload

    # Skontroluj či LLM už nespomenul NCRZP / záložné právo v texte
    exec_summary = payload.get("executiveSummary", "") or ""
    key_risk = payload.get("keyRisk", "") or ""
    combined_llm = (exec_summary + " " + key_risk).lower()
    if "ncrzp" in combined_llm or "záložn" in combined_llm or "zalozn" in combined_llm:
        # LLM už spomenul — nepridávaj duplicitu
        return payload

    # Parsovanie NCRZP findings — extrahuj počet a čísla záložných práv
    import re as _re
    ncrzp_numbers = _re.findall(r'NCRzp\s*\d+/\d+', ncrzp_findings, _re.IGNORECASE)
    ncrzp_count = len(ncrzp_numbers) if ncrzp_numbers else 1

    # Vytvor štruktúrovaný záznam pre justification tabuľku
    evidence_text = ncrzp_findings[:500] if isinstance(ncrzp_findings, str) else str(ncrzp_findings)[:500]
    # BUG 6: Odstráň "POZOR:" prefix — pre INFO impact je alarmistické a zavádzajúce
    evidence_text = re.sub(r'^\s*POZOR\s*[:\-—]\s*', '', evidence_text, flags=re.IGNORECASE)

    # BUG 3: Jazykovo závislé claim a source texty
    _NCRZP_LABELS = {
        "sk": {
            "claim": f"Evidované záložné práva v NCRZP ({ncrzp_count} {'záznam' if ncrzp_count == 1 else 'záznamy'})",
            "source": "Notársky centrálny register záložných práv (NCRZP)",
        },
        "en": {
            "claim": f"Registered pledge rights in NCRZP ({ncrzp_count} {'record' if ncrzp_count == 1 else 'records'})",
            "source": "Notarial Central Register of Pledge Rights (NCRZP)",
        },
        "de": {
            "claim": f"Eingetragene Pfandrechte im NCRZP ({ncrzp_count} {'Eintrag' if ncrzp_count == 1 else 'Einträge'})",
            "source": "Notarielles Zentralregister der Pfandrechte (NCRZP)",
        },
        "cz": {
            "claim": f"Evidovaná zástavní práva v NCRZP ({ncrzp_count} {'záznam' if ncrzp_count == 1 else 'záznamy'})",
            "source": "Notářský centrální registr zástavních práv (NCRZP)",
        },
        "hu": {
            "claim": f"NCRZP-ben nyilvántartott zálogjogok ({ncrzp_count} {'bejegyzés' if ncrzp_count == 1 else 'bejegyzés'})",
            "source": "Notárius Központi Zálogjogi Nyilvántartás (NCRZP)",
        },
        "pl": {
            "claim": f"Zarejestrowane prawa zastawne w NCRZP ({ncrzp_count} {'wpis' if ncrzp_count == 1 else 'wpisy'})",
            "source": "Notarialne Centralny Rejestr Praw Zastawnych (NCRZP)",
        },
    }
    _labels = _NCRZP_LABELS.get(language, _NCRZP_LABELS["sk"])

    ncrzp_entry = {
        "claim": _labels["claim"],
        "evidence": evidence_text,
        "source": _labels["source"],
        "impact": "INFO",
    }

    # Pridaj do justification (môže byť list alebo JSON string)
    just = payload.get("justification")
    if just is None:
        payload["justification"] = json.dumps([ncrzp_entry], ensure_ascii=False)
    elif isinstance(just, str):
        try:
            just_list = json.loads(just)
            if isinstance(just_list, list):
                just_list.append(ncrzp_entry)
                payload["justification"] = json.dumps(just_list, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            pass
    elif isinstance(just, list):
        just.append(ncrzp_entry)

    logger.info(f"[NCRZP INJECT] IČO {ico}: Pridaný deterministický záznam o {ncrzp_count} záložných právach do justification (LLM ich ignoroval)")

    return payload


def _strip_hallucinated_debts(payload: dict, registry_status_summary: list[str], ico: str) -> dict:
    """
    Deterministická anti-halucinácia: skenuje verdict text pre konkrétne EUR sumy
    spomenuté v kontexte dlhov voči registrom, ktoré sú CLEAN.
    Ak nájde pasáž kde LLM tvrdí konkrétny dlh voči CLEAN registru, nahradí ju.

    Tiež odstraňuje pozitívne tvrdenia ("nie je v registri dlžníkov", "nemá dlh")
    pre UNVERIFIED registre — LLM si nesmie domýšľať pozitívny výsledok keď scraper zlyhal.
    """
    clean_registries = set()
    unverified_registries = set()
    for s in (registry_status_summary or []):
        reg_name = s.split(":")[0].strip()
        if "CLEAN" in s:
            clean_registries.add(reg_name)
        elif "UNVERIFIED" in s:
            unverified_registries.add(reg_name)

    if not clean_registries and not unverified_registries:
        return payload

    # Map registry names to keywords that would appear in verdict text
    # if LLM hallucinated a debt for that registry
    registry_keywords = {
        "SP_DLZNICI": ["sociálna poisťovňa", "sociálne poistenie", "záväzky sp", "dlžoba sp", "sp dlh"],
        "DOVERA_DLZNICI": ["dôvera", "dovera"],
        "VSZP_DLZNICI": ["všzp", "všeslovenská"],
        "UNION_DLZNICI": ["union", "union poisťovňa"],
        "FINANCNA_SPRAVA": ["finančná správa", "daňové nedoplatky", "daňový dlh", "finančná správe"],
        "POVERENIA": ["exekúcia", "exekúcie", "poverenie na vykonanie exekúcie"],
    }

    # Pozitívne tvrdenia, ktoré LLM nesmie použiť pre UNVERIFIED registre
    # (napr. "Firma nie je v registri dlžníkov SP" keď SP scraper zlyhal)
    positive_claim_patterns = [
        re.compile(r'(nie\s+je\s+v\s+registri\s+dlžníkov|nemá\s+dlh|bez\s+dlhu|bez\s+záznamu\s+v\s+registri|nie\s+je\s+dlžník|bez\s+nedoplatkov)', re.IGNORECASE),
    ]

    # Pattern to find EUR amounts: "578 397,78 EUR" or "578397.78 €" or "160 000 €" etc.
    eur_pattern = re.compile(r'(\d[\d\s]*[.,]?\d*\s*(?:EUR|€|Eur))', re.IGNORECASE)

    text_fields = ['finalVerdict', 'executiveSummary', 'keyRisk']
    modified = False

    for field in text_fields:
        text = payload.get(field, "")
        if not text or not isinstance(text, str):
            continue

        original_text = text

        # ── CLEAN registries: odstráň EUR sumy blízko kľúčových slov ──
        for reg_name in clean_registries:
            keywords = registry_keywords.get(reg_name, [])
            if not keywords:
                continue

            # Check if any keyword appears near an EUR amount in the text
            for kw in keywords:
                kw_lower = kw.lower()
                text_lower = text.lower()
                kw_pos = text_lower.find(kw_lower)
                while kw_pos != -1:
                    # Look for EUR amount within 200 chars of the keyword
                    window_start = max(0, kw_pos - 200)
                    window_end = min(len(text), kw_pos + len(kw) + 200)
                    window = text[window_start:window_end]
                    matches = eur_pattern.findall(window)
                    if matches:
                        # Found EUR amount near keyword for a CLEAN registry — hallucination
                        logger.warning(
                            f"[ANTI-HALLUCINATION] IČO {ico}: Found EUR amount {matches} near "
                            f"'{kw}' (registry {reg_name} is CLEAN) — stripping from {field}"
                        )
                        # Replace the entire sentence containing the keyword
                        # Find sentence boundaries
                        sent_start = text.rfind('.', 0, kw_pos)
                        sent_start = sent_start + 1 if sent_start != -1 else max(0, kw_pos - 100)
                        sent_end = text.find('.', kw_pos + len(kw))
                        sent_end = sent_end + 1 if sent_end != -1 else min(len(text), kw_pos + 200)
                        sentence = text[sent_start:sent_end].strip()
                        # Remove the hallucinated sentence entirely — do NOT leave
                        # internal debug notes in the client-facing text
                        text = text[:sent_start] + text[sent_end:]
                        modified = True
                        break  # Don't search for more occurrences of this keyword
                    kw_pos = text_lower.find(kw_lower, kw_pos + 1)

        # ── UNVERIFIED registries: odstráň pozitívne tvrdenia ──
        # LLM nesmie tvrdiť "nie je v registri dlžníkov SP" keď SP scraper zlyhal
        for reg_name in unverified_registries:
            keywords = registry_keywords.get(reg_name, [])
            if not keywords:
                continue

            for kw in keywords:
                kw_lower = kw.lower()
                text_lower = text.lower()
                kw_pos = text_lower.find(kw_lower)
                while kw_pos != -1:
                    # Look for positive claim within 200 chars of the keyword
                    window_start = max(0, kw_pos - 200)
                    window_end = min(len(text), kw_pos + len(kw) + 200)
                    window = text[window_start:window_end]
                    for pat in positive_claim_patterns:
                        if pat.search(window):
                            logger.warning(
                                f"[ANTI-HALLUCINATION] IČO {ico}: Found positive claim near "
                                f"'{kw}' (registry {reg_name} is UNVERIFIED) — stripping from {field}"
                            )
                            sent_start = text.rfind('.', 0, kw_pos)
                            sent_start = sent_start + 1 if sent_start != -1 else max(0, kw_pos - 100)
                            sent_end = text.find('.', kw_pos + len(kw))
                            sent_end = sent_end + 1 if sent_end != -1 else min(len(text), kw_pos + 200)
                            text = text[:sent_start] + text[sent_end:]
                            modified = True
                            break
                    kw_pos = text_lower.find(kw_lower, kw_pos + 1)

        if text != original_text:
            payload[field] = text

    # Also check justification (JSON array of EvidenceItem)
    just = payload.get('justification', '')
    if just and isinstance(just, str):
        try:
            items = json.loads(just)
            for item in items:
                evidence = item.get('evidence', '')
                claim = item.get('claim', '')
                combined = f"{claim} {evidence}"
                for reg_name in clean_registries:
                    keywords = registry_keywords.get(reg_name, [])
                    for kw in keywords:
                        if kw.lower() in combined.lower():
                            matches = eur_pattern.findall(combined)
                            if matches:
                                logger.warning(
                                    f"[ANTI-HALLUCINATION] IČO {ico}: Found EUR amount {matches} in "
                                    f"justification near '{kw}' (registry {reg_name} is CLEAN) — sanitizing"
                                )
                                item['evidence'] = (
                                    f"Verejné registre ({reg_name}) neobsahujú záznam o dlhu."
                                )
                                item['impact'] = 'NEUTRAL'
                                modified = True
                                break
            if modified:
                payload['justification'] = json.dumps(items, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            pass

    if modified:
        logger.warning(f"[ANTI-HALLUCINATION] IČO {ico}: Verdict text bol upravený — odstránené halucinované dlhy/tvrdenia z registrov")

    # ── executiveSections: skenuj points v každej sekcii ──
    # Halucinácia "Firma nie je v registri dlžníkov SP" sa často objaví v executive_sections
    es = payload.get('executiveSections', '')
    if es and isinstance(es, str):
        try:
            sections = json.loads(es)
            es_modified = False
            for sec in sections:
                if not isinstance(sec, dict):
                    continue
                points = sec.get('points', [])
                if not isinstance(points, list):
                    continue
                for pi, pt in enumerate(points):
                    if not isinstance(pt, str):
                        continue
                    pt_original = pt
                    for reg_name in unverified_registries:
                        keywords = registry_keywords.get(reg_name, [])
                        for kw in keywords:
                            if kw.lower() in pt.lower():
                                for pat in positive_claim_patterns:
                                    if pat.search(pt):
                                        logger.warning(
                                            f"[ANTI-HALLUCINATION] IČO {ico}: Found positive claim in "
                                            f"executiveSections near '{kw}' (registry {reg_name} is UNVERIFIED) — stripping"
                                        )
                                        pt = pt_original.replace(
                                            re.search(pat, pt_original).group(0),
                                            "stav v registri nebol overený (scraper zlyhal)"
                                        )
                                        es_modified = True
                                        break
                    if pt != pt_original:
                        points[pi] = pt
            if es_modified:
                payload['executiveSections'] = json.dumps(sections, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            pass

    return payload



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


def _yoy_text(curr: Optional[float], prev: Optional[float], verb_pos: str, verb_neg: str) -> str:
    """Vypočíta YoY zmenu a vráti text s slovesom: 'klesli o 13,2 %' / 'vzrástli o 5,1 %'.
    verb_pos = sloveso pre rast ('vzrástli', 'stúpol', 'vzrástlo')
    verb_neg = sloveso pre pokles ('klesli', 'klesol', 'kleslo')
    """
    if curr is None or prev is None or prev == 0:
        return "N/A"
    pct = ((float(curr) - float(prev)) / abs(float(prev))) * 100
    if pct >= 0:
        return f"{verb_pos} o {_format_pct(pct)}"
    else:
        return f"{verb_neg} o {_format_pct(abs(pct))}"


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
) -> dict[str, str]:
    """Postaví slovník placeholder → formátovaná hodnota z DB dát.

    Args:
        stmts: Zoznam financial statement dictov (zoradené od najstaršieho).
        trends: Voliteľné, analyza_trendov dict (pre Altman Z, ratios).
        company_name: Názov spoločnosti.
        statutar_changes: Počet zmien štatutárov (z ORSR).

    Returns:
        Dict placeholder → str hodnota (napr. {"{{REVENUE}}": "111,6 mil. €", ...})
    """
    if not stmts:
        return {}

    # Zoradiť podľa roku (najstarší → najnovší) — bezpečné pre akékoľvek poradie vstupu
    sorted_stmts = sorted(stmts, key=lambda s: s.get("year", 0) or 0)
    latest = sorted_stmts[-1]
    prev = sorted_stmts[-2] if len(sorted_stmts) >= 2 else {}

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
        "vzrástli", "klesli"
    )
    ph["{{REVENUE_YOY_PCT}}"] = _format_pct(
        ((float(latest.get("mainActivityRevenue", 0) or 0) - float(prev.get("mainActivityRevenue", 0) or 0))
         / abs(float(prev.get("mainActivityRevenue", 0) or 1))) * 100
    ) if prev.get("mainActivityRevenue") else "N/A"
    ph["{{EQUITY_YOY}}"] = _yoy_text(
        latest.get("equity"), prev.get("equity"),
        "vzrástlo", "kleslo"
    )
    if latest.get("equity") is not None and prev.get("equity") is not None and float(prev.get("equity", 0) or 0) != 0:
        _eq_pct = ((float(latest["equity"]) - float(prev["equity"])) / abs(float(prev["equity"]))) * 100
        ph["{{EQUITY_YOY_PCT}}"] = _format_pct(_eq_pct)
    else:
        ph["{{EQUITY_YOY_PCT}}"] = "N/A"
    ph["{{OCF_YOY}}"] = _yoy_text(
        latest.get("operatingCashFlow"), prev.get("operatingCashFlow"),
        "stúpol", "klesol"
    )
    ph["{{ST_LIAB_YOY}}"] = _yoy_text(
        latest.get("shortTermLiabilities"), prev.get("shortTermLiabilities"),
        "nárast o", "pokles o"
    ).replace("nárast o ", "nárast o ").replace("pokles o ", "pokles o ")
    # ST_LIAB_YOY: "nárast o 85,8 %" alebo "pokles o 10,2 %" (bez slovesa, len smer)
    if latest.get("shortTermLiabilities") is not None and prev.get("shortTermLiabilities") is not None:
        _st_curr = float(latest["shortTermLiabilities"])
        _st_prev = float(prev["shortTermLiabilities"])
        if _st_prev != 0:
            _st_pct = ((_st_curr - _st_prev) / abs(_st_prev)) * 100
            ph["{{ST_LIAB_YOY}}"] = f"nárast o {_format_pct(_st_pct)}" if _st_pct >= 0 else f"pokles o {_format_pct(abs(_st_pct))}"
        else:
            ph["{{ST_LIAB_YOY}}"] = "N/A"
    else:
        ph["{{ST_LIAB_YOY}}"] = "N/A"

    # ── NET_RESULT_YOY: špeciálny prípad (zisk→strata = "preklopenie do straty") ──
    _net_curr = latest.get("netProfitLoss")
    _net_prev = prev.get("netProfitLoss")
    if _net_curr is not None and _net_prev is not None:
        if float(_net_prev) > 0 and float(_net_curr) < 0:
            ph["{{NET_RESULT_YOY}}"] = "preklopenie do čistej straty"
        elif float(_net_prev) < 0 and float(_net_curr) >= 0:
            ph["{{NET_RESULT_YOY}}"] = "návrat do zisku"
        else:
            ph["{{NET_RESULT_YOY}}"] = _yoy_text(_net_curr, _net_prev, "vzrástol", "klesol")
    else:
        ph["{{NET_RESULT_YOY}}"] = "N/A"

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

    # D/E = (ST + LT liabilities) / equity
    # Ak ST+LT = 0 (banky/IFRS bez klasifikácie), použiť bilančnú rovnicu
    _eq = latest.get("equity")
    if _eq is not None and float(_eq) > 0:
        _st_liab = float(latest.get("shortTermLiabilities", 0) or 0)
        _lt_liab = float(latest.get("longTermLiabilities", 0) or 0)
        _total_liab = _st_liab + _lt_liab
        if _total_liab == 0 and latest.get("totalAssets"):
            # Fallback: bilančná rovnica (totalAssets - equity = total liabilities)
            _total_liab = float(latest["totalAssets"]) - float(_eq)
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

    return ph


def inject_metrics(text: str, placeholders: dict[str, str]) -> str:
    """Nahradí placeholdre v texte deterministickými hodnotami z DB.

    Args:
        text: Text s placeholdermi (napr. "Tržby {{REVENUE_YOY}}...").
        placeholders: Dict z build_metric_placeholders().

    Returns:
        Text s nahradenými placeholdermi.
    """
    if not text or not placeholders:
        return text
    for placeholder, value in placeholders.items():
        text = text.replace(placeholder, value)
    return text


# ── Anti-halucinácia: fallback pre prípady, keď LLM ignoruje placeholder pravidlo ──
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
    # "nad predstavuje" → "predstavuje" (leftover "nad X mil. € predstavuje")
    (re.compile(r'\s+nad\s+(?=(?:predstavuje|ukazuje|svedčí|indikuje)\b)', re.IGNORECASE), ' '),
    # "dosiahol, zatiaľ čo" → ", zatiaľ čo" (dangling "dosiahol" bez hodnoty)
    (re.compile(r'\s+dosiahol\s*,\s*(?=(?:zatiaľ|čo|pričom|ale|a)\b)', re.IGNORECASE), ', '),
    # "nárast ," → "," (dangling "nárast" bez hodnoty)
    (re.compile(r'\s+nárast\s*,(?=\s*(?:čo|a|ale|pričom)\b)', re.IGNORECASE), ','),
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


def _inject_ncrzp_findings(payload: dict, registry_findings: list[dict], ico: str) -> dict:
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
    ncrzp_entry = {
        "claim": f"Evidované záložné práva v NCRZP ({ncrzp_count} {'záznam' if ncrzp_count == 1 else 'záznamy'})",
        "evidence": evidence_text,
        "source": "Notársky centrálny register záložných práv (NCRZP)",
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
    """
    clean_registries = set()
    for s in (registry_status_summary or []):
        if "CLEAN" in s:
            # Extract registry name before colon
            reg_name = s.split(":")[0].strip()
            clean_registries.add(reg_name)

    if not clean_registries:
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

    # Pattern to find EUR amounts: "578 397,78 EUR" or "578397.78 €" or "160 000 €" etc.
    eur_pattern = re.compile(r'(\d[\d\s]*[.,]?\d*\s*(?:EUR|€|Eur))', re.IGNORECASE)

    text_fields = ['finalVerdict', 'executiveSummary', 'keyRisk']
    modified = False

    for field in text_fields:
        text = payload.get(field, "")
        if not text or not isinstance(text, str):
            continue

        original_text = text
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
        logger.warning(f"[ANTI-HALLUCINATION] IČO {ico}: Verdict text bol upravený — odstránené halucinované dlhy z CLEAN registrov")

    return payload



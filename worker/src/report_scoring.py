"""Scoring computations — insolvency, fraud heatmap, strengths/weaknesses."""

import re
import json
import math
from typing import Optional

from src.i18n import sk_plural_roky, sk_plural_najdene
from src.report_translators import (
    _translate_flag,
    _translate_scorecard,
    _translate_state_liabilities_alert,
    _translate_evidence_source,
    _extract_piotroski_from_scorecard,
)
from src.analytics import (
    compute_altman_z_score,
    compute_financial_ratios,
    _is_financial_institution,
    _to_float,
)


def compute_insolvency_score(stmts, i18n_strings):
    """
    Simple predictive insolvency model based on 5-year trends.
    Analyzes: equity trend, revenue trend, debt ratio trend, profitability, Altman Z'' trend.
    Returns a dict with score (0-100, higher = worse), risk level, and trend details.
    """
    if not stmts or len(stmts) < 2:
        return {"score": None, "risk_level": "no_data", "risk_label": i18n_strings.get("insolvency_no_data"), "trends": [], "has_data": False}

    stmts_sorted = sorted(stmts, key=lambda s: s.year)

    def _trend(values):
        """Return (direction, consecutive_count). direction = 'declining'|'stable'|'growing'"""
        if len(values) < 2:
            return "stable", 0
        # Linear regression slope
        n = len(values)
        x_mean = (n - 1) / 2
        y_mean = sum(values) / n
        num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
        den = sum((i - x_mean) ** 2 for i in range(n))
        slope = num / den if den else 0

        # Sensitivity threshold: 1% of mean magnitude, or 0 if mean is zero
        threshold = 0.01 * abs(y_mean) if y_mean else 0

        # Count consecutive declining/growing years from the end
        consecutive = 0
        direction = "stable"
        if slope < -threshold:
            direction = "declining"
            for i in range(len(values) - 1, 0, -1):
                if values[i] < values[i - 1]:
                    consecutive += 1
                else:
                    break
        elif slope > threshold:
            direction = "growing"
            for i in range(len(values) - 1, 0, -1):
                if values[i] > values[i - 1]:
                    consecutive += 1
                else:
                    break
        return direction, consecutive

    def _safe_attr(s, name):
        v = getattr(s, name, None)
        if v is None:
            return None
        return float(v)

    # 1. Equity trend
    equities = [_safe_attr(s, 'equity') for s in stmts_sorted]
    eq_trend, eq_decline_years = _trend([e for e in equities if e is not None])

    # 2. Revenue trend
    revenues = [_safe_attr(s, 'mainActivityRevenue') or _safe_attr(s, 'totalRevenue') for s in stmts_sorted]
    rev_trend, rev_decline_years = _trend([r for r in revenues if r is not None])

    # 3. Debt ratio trend (totalLiabilities / totalAssets)
    debt_ratios = []
    for s in stmts_sorted:
        tl = _safe_attr(s, 'totalLiabilities') or ((_safe_attr(s, 'shortTermLiabilities') or 0) + (_safe_attr(s, 'longTermLiabilities') or 0))
        ta = _safe_attr(s, 'totalAssets')
        if tl and ta and ta > 0:
            debt_ratios.append(tl / ta)
    debt_trend, debt_grow_years = _trend(debt_ratios)

    # 4. Profitability — consecutive loss years
    profits = [_safe_attr(s, 'netProfitLoss') for s in stmts_sorted]
    loss_years = 0
    profit_years = 0
    for p in reversed(profits):
        if p is not None and p < 0:
            loss_years += 1
        elif p is not None and p > 0:
            break
    for p in reversed(profits):
        if p is not None and p > 0:
            profit_years += 1
        elif p is not None and p < 0:
            break
    profit_trend, profit_consecutive = _trend([p for p in profits if p is not None]) if len([p for p in profits if p is not None]) >= 2 else ("stable", 0)

    # 5. Altman Z'' trend (computed on-the-fly since altmanZScore is not stored in DB)
    # Pre finančné inštitúcie sa Altman nehodnotí
    _is_fi = stmts_sorted and _is_financial_institution(max(stmts_sorted, key=lambda s: s.year))
    altman_values = []
    for s in stmts_sorted:
        z_result = compute_altman_z_score(s, force_financial_inst=_is_fi)
        z = z_result.get('z_score')
        if z is not None:
            altman_values.append(float(z))
    altman_trend, altman_decline = _trend(altman_values) if len(altman_values) >= 2 else ("stable", 0)

    # --- Scoring ---
    score = 0
    # Equity decline: up to 25 points
    if eq_trend == "declining":
        score += min(25, eq_decline_years * 8)
    # Revenue decline: up to 20 points
    if rev_trend == "declining":
        score += min(20, rev_decline_years * 7)
    # Debt growing: up to 20 points
    if debt_trend == "growing":
        score += min(20, debt_grow_years * 7)
    # Consecutive losses: up to 25 points
    score += min(25, loss_years * 10)
    # Altman declining: up to 10 points
    # Bug fix: ak je trend "declining" (slope < 0) ale posledný rok stúpol,
    # altman_decline = 0 a pôvodný kód pridal 0 bodov — napriek tomu, že PDF
    # zobrazoval "↓ Klesajúci" ako negatívny trend. Minimálna penalizácia 2 body
    # zabezpečuje konzistenciu medzi zobrazeným trendom a skóre.
    if altman_trend == "declining":
        score += min(10, max(2, altman_decline * 5))

    # Bonus reduction for consistent profitability
    if profit_years >= 3:
        score = max(0, score - 10)

    score = min(100, max(0, score))

    if score >= 60:
        risk_level = "critical"
        risk_label = i18n_strings.get("insolvency_critical")
    elif score >= 40:
        risk_level = "high"
        risk_label = i18n_strings.get("insolvency_high")
    elif score >= 20:
        risk_level = "medium"
        risk_label = i18n_strings.get("insolvency_medium")
    else:
        risk_level = "low"
        risk_label = i18n_strings.get("insolvency_low")

    trend_label_map = {
        "declining": i18n_strings.get("insolvency_declining"),
        "stable": i18n_strings.get("insolvency_stable"),
        "growing": i18n_strings.get("insolvency_growing"),
    }

    def _trend_detail(detail_key: str, n: int) -> str:
        """Vráti detail text trendu so správnou pluralizáciou 'rok/roky/rokov'.
        Aplikuje sa pre SK a CS (rovnaké pravidlá). EN/DE/HU používajú format()."""
        if n <= 0:
            return ""
        tmpl = i18n_strings.get(detail_key, "")
        if not tmpl:
            return ""
        # SK/CS pluralizácia: ak template obsahuje "roky", aplikuj sk_plural_roky
        if "{n} roky" in tmpl:
            roky = sk_plural_roky(n)
            return tmpl.replace("{n} roky", f"{n} {roky}", 1)
        return tmpl.format(n=n)

    trends = []
    if any(e is not None for e in equities):
        # Bug fix: _trend() vracia consecutive roky v SMERE trendu (growing AJ declining).
        # Detail text musí zodpovedať smeru — "rastúci" pre growing, "klesajúci" pre declining.
        _eq_detail_key = "insolvency_years_growing" if eq_trend == "growing" else "insolvency_years_decline"
        trends.append({
            "label": i18n_strings.get("insolvency_equity_trend"),
            "direction": trend_label_map.get(eq_trend, eq_trend),
            "detail": _trend_detail(_eq_detail_key, eq_decline_years),
            "is_negative": eq_trend == "declining",
        })
    if any(r is not None for r in revenues):
        _rev_detail_key = "insolvency_years_growing" if rev_trend == "growing" else "insolvency_years_decline"
        trends.append({
            "label": i18n_strings.get("insolvency_revenue_trend"),
            "direction": trend_label_map.get(rev_trend, rev_trend),
            "detail": _trend_detail(_rev_detail_key, rev_decline_years),
            "is_negative": rev_trend == "declining",
        })
    if debt_ratios:
        # Pre zadlženosť: growing = zlé (is_negative=True), declining = dobré
        _debt_detail_key = "insolvency_years_growing" if debt_trend == "growing" else "insolvency_years_decline"
        trends.append({
            "label": i18n_strings.get("insolvency_debt_trend"),
            "direction": trend_label_map.get(debt_trend, debt_trend),
            "detail": _trend_detail(_debt_detail_key, debt_grow_years),
            "is_negative": debt_trend == "growing",
        })
    if any(p is not None for p in profits):
        if loss_years > 0:
            trends.append({
                "label": i18n_strings.get("insolvency_profit_trend"),
                "direction": i18n_strings.get("insolvency_declining"),
                "detail": _trend_detail("insolvency_years_loss", loss_years),
                "is_negative": True,
            })
        else:
            trends.append({
                "label": i18n_strings.get("insolvency_profit_trend"),
                "direction": trend_label_map.get(profit_trend, profit_trend),
                "detail": _trend_detail("insolvency_years_profit", profit_years),
                "is_negative": profit_trend == "declining",
            })
    if len(altman_values) >= 2:
        trends.append({
            "label": i18n_strings.get("insolvency_altman_trend"),
            "direction": trend_label_map.get(altman_trend, altman_trend),
            "detail": "",
            "is_negative": altman_trend == "declining",
        })

    return {
        "score": score,
        "risk_level": risk_level,
        "risk_label": risk_label,
        "trends": trends,
        "has_data": True,
    }


def _translate_auditor_op(o_raw, i18n_strings):
    """Translate auditor opinion type to the report language."""
    if not o_raw:
        return ""
    lo = o_raw.lower()
    if 'bez výhrad' in lo or 'unqualified' in lo or 'ohne vorbehalt' in lo:
        return i18n_strings.get("auditor_unqualified", o_raw)
    if ('výhrad' in lo and 'bez výhrad' not in lo) or ('qualified' in lo and 'unqualified' not in lo) or ('vorbehalt' in lo and 'ohne' not in lo):
        return i18n_strings.get("auditor_qualified", o_raw)
    if 'záporn' in lo or 'adverse' in lo:
        return i18n_strings.get("auditor_adverse", o_raw)
    if 'odmietnut' in lo or 'disclaimer' in lo or 'versagte' in lo:
        return i18n_strings.get("auditor_disclaimer", o_raw)
    return o_raw


def compute_fraud_heatmap(verdict, stmts, vestnik_events, i18n_strings):
    """
    Aggregate warning indicators from multiple sources into a heatmap grid.
    Categories: vestnik, forensic, narrative, notes, auditor, legal, financial.
    Each category gets a severity level (none/low/medium/high/critical) and flag count.
    """
    categories = []

    def _add(cat_key, severity, count, details=None):
        sev_map = {
            "critical": ("fraud_severity_critical", "#dc2626", "#fef2f2"),
            "high": ("fraud_severity_high", "#ea580c", "#fff7ed"),
            "medium": ("fraud_severity_medium", "#d97706", "#fffbeb"),
            "low": ("fraud_severity_low", "#059669", "#ecfdf5"),
            "none": ("fraud_severity_none", "#94a3b8", "#f8fafc"),
        }
        label_key, color, bg = sev_map.get(severity, sev_map["none"])
        # Slovak pluralization pre "nájdených" → "nájdené" pre 1-4
        count_label = i18n_strings.get("fraud_flags_found", "{n} nájdených")
        if count > 0:
            # Skúsime detekovať jazyk a aplikovať SK pluralizáciu
            if "nájdených" in count_label:
                count_label = f"{count} {sk_plural_najdene(count)}"
            else:
                count_label = count_label.replace("{n}", str(count))
        categories.append({
            "label": i18n_strings.get(cat_key, cat_key),
            "severity": severity,
            "severity_label": i18n_strings.get(label_key, severity),
            "color": color,
            "bg": bg,
            "count": count,
            "count_label": count_label,
            "details": details or [],
        })

    # 1. Vestnik events — odfiltruj insolventné eventy (z INSOLVENCY scraperu)
    # Tie patria do "Právne registre", nie do "Obchodný vestník"
    real_vestnik_events = []
    insolvency_events = []
    for e in (vestnik_events or []):
        source_id = getattr(e, 'sourceId', '') or ''
        event_type = getattr(e, 'eventType', '').lower()
        if 'INSOLVENCY' in source_id or 'konkurz' in event_type or 'likvid' in event_type:
            insolvency_events.append(e)
        else:
            real_vestnik_events.append(e)

    vestnik_critical = sum(1 for e in real_vestnik_events if getattr(e, 'severityLevel', '').lower() in ('critical', 'kriticke', 'kritisch'))
    vestnik_high = sum(1 for e in real_vestnik_events if getattr(e, 'severityLevel', '').lower() in ('high', 'vysoka', 'hoch'))
    vestnik_count = len(real_vestnik_events)
    if vestnik_critical > 0:
        _add("fraud_cat_vestnik", "critical", vestnik_count, [getattr(e, 'eventType', '') for e in real_vestnik_events[:3]])
    elif vestnik_high > 0:
        _add("fraud_cat_vestnik", "high", vestnik_count, [getattr(e, 'eventType', '') for e in real_vestnik_events[:3]])
    elif vestnik_count > 0:
        _add("fraud_cat_vestnik", "medium", vestnik_count)
    else:
        _add("fraud_cat_vestnik", "none", 0)

    # 2. Forensic (from verdict forensicRedFlags)
    forensic_flags = []
    if verdict and getattr(verdict, 'forensicRedFlags', None):
        raw = verdict.forensicRedFlags
        if isinstance(raw, str):
            try:
                forensic_flags = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                forensic_flags = [raw]
        elif isinstance(raw, list):
            forensic_flags = raw
    if len(forensic_flags) >= 3:
        _add("fraud_cat_forensic", "critical", len(forensic_flags), [(str(f)[:397] + '…') if len(str(f)) > 400 else str(f) for f in forensic_flags[:3] if not isinstance(f, bool)])
    elif len(forensic_flags) >= 1:
        _add("fraud_cat_forensic", "high", len(forensic_flags), [(str(f)[:397] + '…') if len(str(f)) > 400 else str(f) for f in forensic_flags[:3] if not isinstance(f, bool)])
    else:
        _add("fraud_cat_forensic", "none", 0)

    # 3. Narrative risks (from NarrativeRiskAnalysis — LLM-extracted from annual reports)
    narrative_flags = []
    # Related party flags z forensicRedFlags sa presúvajú do notes_flags (routing fix)
    notes_flags_routed = []
    _rp_pattern = re.compile(r'spriaznen|related\s*part|presun\s*majetk|asset\s*transfer|dcérs|subsidiar|odtok\s*kapit|capital\s*extract', re.IGNORECASE)

    for stmt in (stmts or []):
        nr = getattr(stmt, 'narrativeRisk', None)
        if nr:
            year = getattr(stmt, 'year', '')
            # Only litigationRisks is a genuine risk indicator from text fields.
            # managementChanges, plannedInvestments, profitabilityExplanation are
            # informational/positive — not risk flags that should inflate heatmap severity.
            val = getattr(nr, 'litigationRisks', None)
            if val and not isinstance(val, bool) and str(val).strip():
                raw_text = str(val).strip()
                # Skip "no risk found" statements — they are NOT risk flags
                _no_risk = re.search(
                    r'(?i)(neuvádzajú\s+sa\s+(?:žiadne|konkrétne)|nenachádzajú\s+sa\s+(?:žiadne|konkrétne)'
                    r'|neobsahuje\s+(?:žiadne|informácie\s+o)|nespomínajú\s+sa\s+(?:žiadne|konkrétne)'
                    r'|žiadne\s+(?:prebiehajúce\s+)?(?:súdne\s+spor|exekúc|právne\s+hroz|litigation)'
                    r'|no\s+litigation|no\s+legal\s+proceed|none\s+identified|not\s+mentioned)',
                    raw_text,
                )
                if _no_risk:
                    pass  # Absence of risk is NOT a risk flag — skip
                else:
                    text = raw_text
                    if year:
                        text = f"[{year}] {text}"
                    narrative_flags.append(text[:397] + '…' if len(text) > 400 else text)
            # goingConcernDoubts is a bool — if True, it's a critical flag
            if getattr(nr, 'goingConcernDoubts', None) is True:
                narrative_flags.append(f"[{year}] Going Concern pochybnosti" if year else "Going Concern pochybnosti")
            # forensicRedFlags is a list[str] — each item is a separate flag
            # BUT: related party flags are routed to notes_flags (they belong to Notes category)
            raw_flags = getattr(nr, 'forensicRedFlags', None)
            if raw_flags:
                if isinstance(raw_flags, str):
                    try:
                        raw_flags = json.loads(raw_flags)
                    except (json.JSONDecodeError, ValueError):
                        raw_flags = [raw_flags]
                for flag in raw_flags:
                    if isinstance(flag, bool):
                        continue
                    text = str(flag)
                    if year:
                        text = f"[{year}] {text}"
                    truncated = text[:797] + '…' if len(text) > 800 else text
                    if _rp_pattern.search(text):
                        notes_flags_routed.append(truncated)
                    else:
                        narrative_flags.append(truncated)
    if len(narrative_flags) >= 3:
        _add("fraud_cat_narrative", "high", len(narrative_flags), narrative_flags[:5])
    elif len(narrative_flags) >= 1:
        _add("fraud_cat_narrative", "medium", len(narrative_flags), narrative_flags[:5])
    else:
        _add("fraud_cat_narrative", "none", 0)

    # 4. Notes forensic (from NotesRiskAnalysis — structured data from financial statement notes)
    notes_flags = []
    # Pridaj routed flags z narrative forensicRedFlags (related party patterny)
    notes_flags.extend(notes_flags_routed)

    for stmt in (stmts or []):
        nr = getattr(stmt, 'notesRisk', None)
        if nr:
            year = getattr(stmt, 'year', '')
            for field in ['relatedPartyTransactions', 'offBalanceSheetLiabilities', 'contingentRisks']:
                val = getattr(nr, field, None)
                if val and not isinstance(val, bool) and str(val).strip():
                    text = str(val)
                    if year:
                        text = f"[{year}] {text}"
                    notes_flags.append(text[:797] + '…' if len(text) > 800 else text)
    if len(notes_flags) >= 2:
        _add("fraud_cat_notes", "high", len(notes_flags), notes_flags[:3])
    elif len(notes_flags) >= 1:
        _add("fraud_cat_notes", "medium", len(notes_flags), notes_flags[:3])
    else:
        _add("fraud_cat_notes", "none", 0)

    # 5. Auditor opinion
    auditor_sev = "none"
    auditor_details = []
    has_any_audit = False

    for stmt in (stmts or []):
        ao = getattr(stmt, 'auditorOpinion', None)
        if ao:
            has_any_audit = True
            op = getattr(ao, 'opinionType', '').lower() if getattr(ao, 'opinionType', None) else ''
            if 'adverse' in op or 'záporn' in op or 'odmietnut' in op:
                auditor_sev = "critical"
                auditor_details.append(f"{stmt.year}: {_translate_auditor_op(getattr(ao, 'opinionType', ''), i18n_strings)}")
            elif ('qualified' in op and 'unqualified' not in op) or ('výhrad' in op and 'bez výhrad' not in op) or ('vorbehalt' in op and 'ohne' not in op):
                if auditor_sev != "critical":
                    auditor_sev = "high"
                auditor_details.append(f"{stmt.year}: {_translate_auditor_op(getattr(ao, 'opinionType', ''), i18n_strings)}")
            if getattr(ao, 'goingConcernRisk', None):
                if auditor_sev == "none":
                    auditor_sev = "medium"
                auditor_details.append(i18n_strings.get("heatmap_going_concern_auditor", "{year}: Going Concern (auditor)").format(year=stmt.year))
            # Also check NarrativeRisk goingConcernDoubts for this statement
            nr = getattr(stmt, 'narrativeRisk', None)
            if nr and getattr(nr, 'goingConcernDoubts', None):
                if auditor_sev == "none":
                    auditor_sev = "medium"
                auditor_details.append(i18n_strings.get("heatmap_going_concern_narrative", "{year}: Going Concern (narrative)").format(year=stmt.year))

    # Ak firma má výkazy ale žiadny audit — penalizuj v heatmap ako "medium" (upozornenie)
    if auditor_sev == "none" and stmts and not has_any_audit:
        auditor_sev = "medium"
        auditor_details.append(i18n_strings.get("heatmap_no_audit", "Chýba audítorský posudok za všetky roky"))

    _add("fraud_cat_auditor", auditor_sev, len(auditor_details), auditor_details[:3])

    # 6. Legal registries (from verdict evidence + insolvency events)
    legal_flags = []
    if verdict and getattr(verdict, 'evidence', None):
        raw = verdict.evidence
        if isinstance(raw, str):
            try:
                ev_list = json.loads(raw)
                legal_flags = [e for e in ev_list if isinstance(e, dict) and e.get('impact', '').upper() in ('CRITICAL', 'WARNING')]
            except (json.JSONDecodeError, ValueError):
                pass
        elif isinstance(raw, list):
            legal_flags = [e for e in raw if isinstance(e, dict) and e.get('impact', '').upper() in ('CRITICAL', 'WARNING')]

    # Pridaj insolventné eventy (konkurz/likvidácia) do právnych registrov
    insolvency_details = [getattr(e, 'eventType', '') for e in insolvency_events[:3]]
    legal_flags.extend([{"impact": "CRITICAL", "claim": et} for et in insolvency_details])

    critical_count = sum(1 for e in legal_flags if (e.get('impact', '') if isinstance(e, dict) else '').upper() == 'CRITICAL')
    if critical_count > 0:
        _add("fraud_cat_legal", "critical", len(legal_flags), insolvency_details if insolvency_details else None)
    elif len(legal_flags) >= 2:
        _add("fraud_cat_legal", "high", len(legal_flags))
    elif len(legal_flags) >= 1:
        _add("fraud_cat_legal", "medium", len(legal_flags))
    else:
        _add("fraud_cat_legal", "none", 0)

    # 7. Financial indicators (from insolvency-relevant metrics)
    fin_sev = "none"
    fin_details = []
    if stmts and len(stmts) >= 2:
        latest = max(stmts, key=lambda s: s.year)
        _is_fi = _is_financial_institution(latest)
        altman_result = compute_altman_z_score(latest, force_financial_inst=_is_fi)
        altman = altman_result.get('z_score')
        if altman is not None and float(altman) < 1.1:
            fin_sev = "critical"
            fin_details.append(i18n_strings.get("heatmap_altman_distress", "Altman Z'' = {val} (Núdzová zóna)").format(val=f"{altman:.2f}"))
        elif altman is not None and float(altman) < 2.6:
            if fin_sev == "none":
                fin_sev = "medium"
            fin_details.append(i18n_strings.get("heatmap_altman_grey", "Altman Z'' = {val} (Šedá zóna)").format(val=f"{altman:.2f}"))
        equity = getattr(latest, 'equity', None)
        if equity is not None and float(equity) < 0:
            fin_sev = "critical"
            fin_details.append(i18n_strings.get("heatmap_negative_equity", "Záporné vlastné imanie"))
        net_profit = getattr(latest, 'netProfitLoss', None)
        if net_profit is not None and float(net_profit) < 0:
            if fin_sev == "none":
                fin_sev = "medium"
            _loss_m = abs(float(net_profit)) / 1e6
            _loss_str = f"{_loss_m:.2f} mil. €" if _loss_m >= 0.01 else f"{abs(float(net_profit)):.0f} €"
            fin_details.append(f"{i18n_strings.get('heatmap_net_loss', 'Čistá strata')}: {_loss_str}")
    _add("fraud_cat_financial", fin_sev, len(fin_details), fin_details[:3])

    # Overall risk level
    sev_order = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    max_sev = max(categories, key=lambda c: sev_order.get(c["severity"], 0))
    overall_level = max_sev["severity"]
    overall_label = max_sev["severity_label"]

    return {
        "categories": categories,
        "overall_level": overall_level,
        "overall_label": overall_label,
        "has_data": True,
    }


def compute_strengths_weaknesses(scorecard_breakdown, fraud_heatmap, insolvency_score,
                                  verdict, stmts, vestnik_events, i18n_strings):
    """
    Aggregate strengths and weaknesses from all available data sources.
    Returns a dict with 'strengths' and 'weaknesses' lists, each containing
    {'label': str, 'source': str} items.
    """
    strengths = []
    weaknesses = []

    def _strength(label, source=""):
        strengths.append({"label": label, "source": source})

    def _weakness(label, source=""):
        weaknesses.append({"label": label, "source": source})

    # 1. From scorecard pillars
    if scorecard_breakdown:
        for pillar in scorecard_breakdown:
            score = pillar.get("score", 0)
            max_score = pillar.get("max_score", 0)
            name = pillar.get("name", "")
            if max_score > 0:
                pct = (score / max_score) * 100
                if pct >= 80:
                    _strength(f"{name}: {score}/{max_score}", i18n_strings.get("sw_source_scorecard", ""))
                elif pct < 40:
                    _weakness(f"{name}: {score}/{max_score}", i18n_strings.get("sw_source_scorecard", ""))

    # 2. From fraud heatmap categories
    if fraud_heatmap and fraud_heatmap.get("has_data"):
        for cat in fraud_heatmap.get("categories", []):
            sev = cat.get("severity", "none")
            label = cat.get("label", "")
            if sev in ("none", "low"):
                _strength(f"{label}: {cat.get('severity_label', '')}", i18n_strings.get("sw_source_heatmap", ""))
            elif sev in ("high", "critical"):
                _weakness(f"{label}: {cat.get('severity_label', '')}", i18n_strings.get("sw_source_heatmap", ""))

    # 3. From insolvency score
    if insolvency_score and insolvency_score.get("has_data"):
        risk_level = insolvency_score.get("risk_level", "no_data")
        risk_label = insolvency_score.get("risk_label", "")
        if risk_level in ("low", "very_low"):
            _strength(f"{i18n_strings.get('sw_insolvency_low', 'Nízke riziko insolventnosti')}: {risk_label}",
                      i18n_strings.get("sw_source_insolvency", ""))
        elif risk_level in ("high", "critical"):
            _weakness(f"{i18n_strings.get('sw_insolvency_high', 'Vysoké riziko insolventnosti')}: {risk_label}",
                      i18n_strings.get("sw_source_insolvency", ""))

    # 4. From Vestník events
    vestnik_count = len(vestnik_events) if vestnik_events else 0
    if vestnik_count == 0:
        _strength(i18n_strings.get("sw_clean_vestnik", "Bez záznamov v Obchodnom vestníku"),
                  i18n_strings.get("sw_source_vestnik", ""))
    else:
        critical_count = sum(1 for e in vestnik_events
                             if getattr(e, 'severityLevel', '').lower() in ('critical', 'kriticke', 'kritisch'))
        if critical_count > 0:
            _weakness(f"{i18n_strings.get('sw_vestnik_critical', 'Kritické záznamy v Obchodnom vestníku')} ({critical_count})",
                      i18n_strings.get("sw_source_vestnik", ""))

    # 5. From financial statements
    if stmts and len(stmts) >= 2:
        latest = max(stmts, key=lambda s: s.year)
        _is_fi = _is_financial_institution(latest)
        altman_result = compute_altman_z_score(latest, force_financial_inst=_is_fi)
        altman = altman_result.get('z_score')
        if altman is not None:
            try:
                altman_val = float(altman)
                if altman_val >= 2.6:
                    _strength(f"Altman Z'' = {altman_val:.2f} ({i18n_strings.get('altman_safe', 'Bezpečná zóna')})",
                              i18n_strings.get("sw_source_financials", ""))
                elif altman_val < 1.1:
                    _weakness(f"Altman Z'' = {altman_val:.2f} ({i18n_strings.get('altman_distress', 'Núdzová zóna')})",
                              i18n_strings.get("sw_source_financials", ""))
            except (ValueError, TypeError):
                pass

        equity = getattr(latest, 'equity', None)
        if equity is not None:
            if float(equity) > 0:
                _strength(f"{i18n_strings.get('sw_positive_equity', 'Kladné vlastné imanie')}: {float(equity):,.0f} €".replace(",", " "),
                          i18n_strings.get("sw_source_financials", ""))
            else:
                _weakness(i18n_strings.get("sw_negative_equity", "Záporné vlastné imanie"),
                          i18n_strings.get("sw_source_financials", ""))

        op_cf = getattr(latest, 'operatingCashFlow', None)
        if op_cf is not None:
            if float(op_cf) > 0:
                _strength(i18n_strings.get("sw_positive_cf", "Kladný prevádzkový cash flow"),
                          i18n_strings.get("sw_source_financials", ""))
            else:
                _weakness(i18n_strings.get("sw_negative_cf", "Záporný prevádzkový cash flow"),
                          i18n_strings.get("sw_source_financials", ""))

        profitable_years = sum(1 for s in stmts if (getattr(s, 'netProfitLoss', 0) or 0) > 0)
        total_years = len(stmts)
        if profitable_years == total_years and total_years >= 3:
            _strength(f"{i18n_strings.get('sw_all_profitable', 'Ziskovosť všetky roky')} ({total_years}/{total_years})",
                      i18n_strings.get("sw_source_financials", ""))
        elif profitable_years == 0 and total_years >= 2:
            _weakness(i18n_strings.get("sw_all_losses", "Strata vo všetkých rokoch"),
                      i18n_strings.get("sw_source_financials", ""))

        # Pokles zisku o >50 % YoY — významný red flag aj pri kladnom zisku
        if len(stmts) >= 2:
            sorted_desc = sorted(stmts, key=lambda s: s.year, reverse=True)
            curr_profit = getattr(sorted_desc[0], 'netProfitLoss', None)
            prev_profit = getattr(sorted_desc[1], 'netProfitLoss', None)
            if curr_profit is not None and prev_profit is not None and prev_profit > 0:
                profit_drop_pct = ((prev_profit - curr_profit) / prev_profit) * 100
                if profit_drop_pct > 50:
                    _weakness(f"{i18n_strings.get('sw_profit_drop', 'Výrazný pokles zisku')}: -{profit_drop_pct:.0f}% YoY",
                              i18n_strings.get("sw_source_financials", ""))

        # Current ratio < 1.0 — krátkodobé záväzky prevyšujú obežný majetok
        latest_ratios_sw = compute_financial_ratios(latest) if latest else {}
        current_ratio = latest_ratios_sw.get('current_ratio')
        if current_ratio is not None and current_ratio < 1.0:
            _weakness(f"{i18n_strings.get('sw_low_liquidity', 'Nízka likvidita')}: Current ratio = {current_ratio:.2f}",
                      i18n_strings.get("sw_source_financials", ""))

        # Negatívny pracovný kapitál (current assets - short-term liabilities < 0)
        current_assets_sw = getattr(latest, 'currentAssets', None)
        st_liab_sw = getattr(latest, 'shortTermLiabilities', None)
        if current_assets_sw is not None and st_liab_sw is not None:
            working_capital = float(current_assets_sw) - float(st_liab_sw)
            if working_capital < 0:
                _weakness(f"{i18n_strings.get('sw_negative_wc', 'Negatívny pracovný kapitál')}: {working_capital/1e6:.1f} mil. €",
                          i18n_strings.get("sw_source_financials", ""))

        # Kriticky nízka hotovosť (< 5 000 EUR pri krátkodobých záväzkoch > 100 000 EUR)
        cash_sw = getattr(latest, 'cashAndEquivalents', None)
        if cash_sw is not None and st_liab_sw is not None:
            if float(cash_sw) < 5000 and float(st_liab_sw) > 100000:
                _weakness(f"{i18n_strings.get('sw_low_cash', 'Kriticky nízka hotovosť')}: {int(float(cash_sw)):,} €".replace(",", " "),
                          i18n_strings.get("sw_source_financials", ""))

        # Pokles tržieb o > 30 % YoY (nielen najnovší rok — kontrola všetkých rokov)
        if len(stmts) >= 2:
            sorted_rev = sorted(stmts, key=lambda s: s.year)
            for i in range(1, len(sorted_rev)):
                curr_rev = getattr(sorted_rev[i], 'mainActivityRevenue', None)
                prev_rev = getattr(sorted_rev[i-1], 'mainActivityRevenue', None)
                if curr_rev is not None and prev_rev is not None and prev_rev > 0:
                    rev_drop = ((prev_rev - curr_rev) / prev_rev) * 100
                    if rev_drop > 30:
                        _weakness(f"{i18n_strings.get('sw_revenue_drop', 'Výrazný pokles tržieb')}: -{rev_drop:.0f}% ({sorted_rev[i-1].year}→{sorted_rev[i].year})",
                                  i18n_strings.get("sw_source_financials", ""))
                        break  # len jeden záznam aj keď viac rokov pokles

        # Negatívna hrubá marža v najnovšom roku
        gross_sw = getattr(latest, 'grossProfit', None)
        if gross_sw is not None and float(gross_sw) < 0:
            _weakness(f"{i18n_strings.get('sw_negative_gross', 'Záporná hrubá marža')}: {float(gross_sw)/1e6:.2f} mil. €",
                      i18n_strings.get("sw_source_financials", ""))

    # 6. From auditor opinion
    # Ak firma nemá žiadny audit vôbec — pridaj slabú stránku
    if stmts:
        has_any_audit_sw = any(
            getattr(stmt, 'auditorOpinion', None) and
            getattr(stmt.auditorOpinion, 'opinionType', '') and
            getattr(stmt.auditorOpinion, 'opinionType', '').lower() != 'null'
            for stmt in stmts
        )
        if not has_any_audit_sw:
            _weakness(i18n_strings.get("sw_no_audit", "Chýba audítorský posudok za všetky roky"),
                      i18n_strings.get("sw_source_auditor", ""))
    if stmts:
        sorted_stmts_desc = sorted(stmts, key=lambda s: s.year, reverse=True)
        latest_year = sorted_stmts_desc[0].year
        for stmt in sorted_stmts_desc:
            ao = getattr(stmt, 'auditorOpinion', None)
            if ao:
                op_type = getattr(ao, 'opinionType', '') or ''
                op_lower = op_type.lower()
                if op_type and op_lower != 'null':
                    # Check if going concern doubts exist in narrative analysis
                    nr = getattr(stmt, 'narrativeRisk', None)
                    has_going_concern = (
                        getattr(ao, 'goingConcernRisk', None) or
                        (nr and getattr(nr, 'goingConcernDoubts', None))
                    )
                    # Ak audit je starší ako 2 roky od najnovšieho výkazu,
                    # zobraz ako varovanie (nie silnú stránku) — môže byť neaktuálny
                    audit_age = latest_year - stmt.year
                    is_stale_audit = audit_age > 2

                    if 'bez výhrad' in op_lower or 'unqualified' in op_lower:
                        if has_going_concern:
                            _weakness(f"{i18n_strings.get('sw_auditor_clean', 'Audítorský posudok bez výhrad')} ({stmt.year}) — {i18n_strings.get('sw_going_concern_doubt', 'Going Concern pochybnosti')}",
                                      i18n_strings.get("sw_source_auditor", ""))
                        elif is_stale_audit:
                            _weakness(f"{i18n_strings.get('sw_auditor_clean', 'Audítorský posudok bez výhrad')} ({stmt.year}) — {i18n_strings.get('sw_stale_audit', 'pozor: audit chýba za posledné roky')}",
                                      i18n_strings.get("sw_source_auditor", ""))
                        else:
                            _strength(f"{i18n_strings.get('sw_auditor_clean', 'Audítorský posudok bez výhrad')} ({stmt.year})",
                                      i18n_strings.get("sw_source_auditor", ""))
                    elif 'záporn' in op_lower or 'adverse' in op_lower or 'odmietnut' in op_lower:
                        _weakness(f"{i18n_strings.get('sw_auditor_adverse', 'Záporný/odmietnutý audítorský posudok')} ({stmt.year})",
                                  i18n_strings.get("sw_source_auditor", ""))
                    elif ('výhrad' in op_lower and 'bez výhrad' not in op_lower) or ('qualified' in op_lower and 'unqualified' not in op_lower):
                        _weakness(f"{i18n_strings.get('sw_auditor_qualified', 'Audítorský posudok s výhradami')} ({stmt.year})",
                                  i18n_strings.get("sw_source_auditor", ""))
                    break

    # 7. From verdict risk category
    if verdict:
        risk_cat = getattr(verdict, 'riskCategory', '')
        if risk_cat in ('AAA',):
            _strength(f"{i18n_strings.get('sw_risk_aaa', 'Rating AAA — najnižšie riziko')}",
                      i18n_strings.get("sw_source_verdict", ""))
        elif risk_cat in ('C',):
            _weakness(f"{i18n_strings.get('sw_risk_c', 'Rating C — vysoké riziko')}",
                      i18n_strings.get("sw_source_verdict", ""))

    # ── Relevance tags: static keyword → audience mapping ──
    relevance_map = [
        # (keywords_in_label, [relevance_tags])
        (["vestník", "bulletin", "handelsblatt"], [
            i18n_strings.get("rel_compliance", "Compliance"),
            i18n_strings.get("rel_procurement", "Verejné obstarávanie"),
        ]),
        (["auditor", "audit", "abschlussprü", "posudok"], [
            i18n_strings.get("rel_investor", "Investor"),
            i18n_strings.get("rel_compliance", "Compliance"),
        ]),
        (["altman", "equity", "iman", "eigenkapital"], [
            i18n_strings.get("rel_creditor", "Veriteľ"),
            i18n_strings.get("rel_investor", "Investor"),
        ]),
        (["cash flow", "cf", "liquidit", "likvid", "zahlungsfäh"], [
            i18n_strings.get("rel_creditor", "Veriteľ"),
            i18n_strings.get("rel_supplier", "Dodávateľ"),
        ]),
        (["insolven", "bankrupt", "konkurz"], [
            i18n_strings.get("rel_creditor", "Veriteľ"),
            i18n_strings.get("rel_compliance", "Compliance"),
        ]),
        (["profit", "zisk", "gewinn", "strat", "verlust", "loss"], [
            i18n_strings.get("rel_investor", "Investor"),
            i18n_strings.get("rel_supplier", "Dodávateľ"),
        ]),
        (["rating aaa", "rating c", "risk"], [
            i18n_strings.get("rel_overview", "Prehľad"),
        ]),
    ]

    def _tag_relevance(label):
        label_lower = label.lower()
        tags = set()
        for keywords, rel_tags in relevance_map:
            if any(kw in label_lower for kw in keywords):
                tags.update(rel_tags)
        return sorted(tags) if tags else []

    for item in strengths + weaknesses:
        item["relevance"] = _tag_relevance(item.get("label", ""))

    has_data = len(strengths) > 0 or len(weaknesses) > 0
    return {
        "strengths": strengths,
        "weaknesses": weaknesses,
        "has_data": has_data,
    }


def _filter_consolidation_consistency(stmts):
    """Zabezpečí konzistentný typ závierky v time-series.
    Ak firma má oba typy (konsolidovaná + individuálna), preferuje jeden typ.
    Priorita: konsolidovaná (ak ≥3 roky), inak individuálna."""
    if not stmts:
        return stmts, "individual"
    cons = [s for s in stmts if getattr(s, 'isConsolidated', False)]
    indiv = [s for s in stmts if not getattr(s, 'isConsolidated', False)]
    if cons and indiv:
        if len(cons) >= 3:
            return cons, "consolidated"
        return indiv, "individual"
    return stmts, "consolidated" if cons else "individual"



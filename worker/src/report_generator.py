import os
import re
import io
import json
import time
import math
import base64
import asyncio
import logging
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape as xml_escape

from playwright.async_api import async_playwright
from jinja2 import Environment, FileSystemLoader
from src.i18n import get_i18n_strings, sk_plural_roky, sk_plural_najdene
from src.db_client import get_db
from src.infographics import generate_pl_infographic, generate_balance_sheet_infographic, generate_cashflow_waterfall
from src.agents.shared import get_critical_fallbacks

from src.plotly_charts import (
    generate_financial_chart,
    generate_balance_sheet_chart,
    generate_pnl_chart,
    generate_cashflow_chart,
    generate_liquidity_chart,
    generate_altman_chart,
    generate_ratios_trend_chart,
    generate_radar_chart,
    generate_employee_chart,
    generate_rpe_chart,
    generate_asset_composition_donut,
    generate_equity_composition_donut
)
from src.analytics import (
    compute_altman_z_score,
    sanitize_cash_flow_fields,
    estimate_missing_cash_flow,
    compute_financial_ratios,
    compute_financial_trends,
    compute_forensic_scorecard,
    detect_startup_profile,
    compute_piotroski_f_score,
    compute_beneish_m_score,
    compute_state_liabilities_alert,
    compute_revenue_per_employee_alert,
    compute_yoy_summary_table,
    _to_float,
    _is_financial_institution,
)

logger = logging.getLogger(__name__)

SOURCE_CATEGORY_DEFS = [
    ("cat_basic_registries", ["ORSR", "ZRSR", "REGISTER_UZ", "OBCHODNY_VESTNIK", "RPO", "RPVS"]),
    ("cat_insolvency_debts", ["INSOLVENCY", "POVERENIA", "FINANCNA_SPRAVA", "SP_DLZNICI", "VSZP_DLZNICI", "DOVERA_DLZNICI", "UNION_DLZNICI"]),
    ("cat_financial_tax", ["FS_DANOVE_SUBJEKTY", "FS_DPH_REGISTROVANI", "FS_DPH_RUSENIE", "FS_DPH_VYMAZANI", "FS_DPH_NADMERNY_ODPOCET", "FS_DAN_Z_PRIJMOV", "FS_DAN_PRIJMOV_REG"]),
    ("cat_courts_sanctions", ["ROZHODNUTIA", "DISKVALIFIKACIE"]),
    ("cat_finance_procurement", ["CRZ", "UVO"]),
    ("cat_property_rights", ["NCRZP", "NCRD", "OCHRANNE_ZNAMKY"]),
]

SOURCE_LABEL_I18N_KEYS = {
    "ORSR": "source_orsr", "ZRSR": "source_zrsr", "RPO": "source_rpo", "RPVS": "source_rpvs",
    "OBCHODNY_VESTNIK": "source_obchodny_vestnik",
    "INSOLVENCY": "source_insolvency", "POVERENIA": "source_poverenia", "FINANCNA_SPRAVA": "source_financna_sprava",
    "SP_DLZNICI": "source_sp_dlznici", "VSZP_DLZNICI": "source_vszp_dlznici", "DOVERA_DLZNICI": "source_dovera_dlznici", "UNION_DLZNICI": "source_union_dlznici",
    "FS_DANOVE_SUBJEKTY": "source_fs_danove_subjekty", "FS_DPH_REGISTROVANI": "source_fs_dph",
    "FS_DPH_RUSENIE": "source_fs_dph_rusenie", "FS_DPH_VYMAZANI": "source_fs_dph_vymazani",
    "FS_DPH_NADMERNY_ODPOCET": "source_fs_dph_nadmerny_odpocet",
    "FS_DAN_Z_PRIJMOV": "source_fs_dan_z_prijmov", "FS_DAN_PRIJMOV_REG": "source_fs_dan_prijmov_reg",
    "ROZHODNUTIA": "source_rozhodnutia", "DISKVALIFIKACIE": "source_diskvalifikacie",
    "NCRZP": "source_ncrzp", "NCRD": "source_ncrd", "OCHRANNE_ZNAMKY": "source_ochranne_znamky",
    "REGISTER_UZ": "source_register_uz", "CRZ": "source_crz", "UVO": "source_uvo",
}

# Imports from extracted modules
from src.report_formatters import (
    format_currency,
    format_number,
    format_number_millions,
    format_cf_millions,
)
from src.report_sanitizers import sanitize_llm_text, _is_garbled
from src.report_translators import (
    _MANUAL_LOOKUP_URLS,
    format_findings,
    _translate_scraper_findings,
    _extract_piotroski_from_scorecard,
    _translate_flag,
    _translate_scorecard,
    _translate_state_liabilities_alert,
    _translate_evidence_source,
)
from src.report_scoring import (
    compute_insolvency_score,
    compute_fraud_heatmap,
    compute_strengths_weaknesses,
    _filter_consolidation_consistency,
    _translate_auditor_op,
)
from src.verdict_metrics import build_metric_placeholders, inject_metrics


def _build_forensic_findings(stmts_sorted, auditor_opinion, i18n_strings):
    """Build structured forensic findings from NotesRisk, NarrativeRisk, and AuditorOpinion.

    Returns a dict with sections for the 'Forensic & Audit Findings' PDF page:
    - auditor_opinion: type, going_concern, reservations, auditor_name
    - related_parties: from NotesRisk.relatedPartyTransactions
    - off_balance_sheet: from NotesRisk.offBalanceSheetLiabilities
    - litigation: from NotesRisk.contingentRisks
    - going_concern: from NarrativeRisk.goingConcernDoubts + AuditorOpinion
    - forensic_red_flags: from NarrativeRisk.forensicRedFlags (grounded only)
    Each finding includes source, confidence, and score impact.
    """
    def _clean(v):
        if v is None or (isinstance(v, str) and v.strip().lower() in ("null", "none", "nie", "no", "n/a")):
            return None
        if isinstance(v, str):
            v = v.strip()
            if not v or v.lower() in ("žiadne", "none", "null", "nie", "no", "n/a"):
                return None
        return v

    def _get_notes_risk(stmt):
        """Extract NotesRisk from a FinancialStatement (Prisma model or dict)."""
        nr = getattr(stmt, 'notesRisk', None)
        if nr is None and isinstance(stmt, dict):
            nr = stmt.get('notesRisk')
        if nr is None:
            return None
        if hasattr(nr, '__dict__'):
            return {k: getattr(nr, k) for k in dir(nr) if not k.startswith('_')}
        return nr if isinstance(nr, dict) else None

    def _get_narrative_risk(stmt):
        nr = getattr(stmt, 'narrativeRisk', None)
        if nr is None and isinstance(stmt, dict):
            nr = stmt.get('narrativeRisk')
        if nr is None:
            return None
        if hasattr(nr, '__dict__'):
            return {k: getattr(nr, k) for k in dir(nr) if not k.startswith('_')}
        return nr if isinstance(nr, dict) else None

    # Use latest 2 years for notes, latest for narrative
    sorted_desc = sorted(stmts_sorted, key=lambda s: getattr(s, 'year', s.get('year', 0) if isinstance(s, dict) else 0), reverse=True)
    latest = sorted_desc[0] if sorted_desc else None
    latest_year = getattr(latest, 'year', latest.get('year') if isinstance(latest, dict) else None) if latest else None

    findings = {
        "has_data": False,
        "latest_year": latest_year,
        "auditor_opinion": None,
        "related_parties": None,
        "off_balance_sheet": None,
        "litigation": None,
        "going_concern": None,
        "forensic_red_flags": [],
        "sources_available": [],
    }

    # 1. Auditor Opinion
    if auditor_opinion:
        ao = auditor_opinion
        findings["auditor_opinion"] = {
            "opinion_type": ao.get("opinion_type"),
            "going_concern_risk": _clean(ao.get("going_concern_risk")),
            "reservation_text": _clean(ao.get("reservation_text")),
            "auditor_name": _clean(ao.get("auditor_name")),
            "source": i18n_strings.get("forensic_source_audit", "Audit Report"),
            "confidence": "High",
            "score_impact": None,
        }
        findings["has_data"] = True
        findings["sources_available"].append("audit")

    # 2. NotesRisk — use latest year only (per UX spec: current due-diligence state, not archive)
    notes_by_year = []
    for stmt in sorted_desc[:1]:
        year = getattr(stmt, 'year', stmt.get('year') if isinstance(stmt, dict) else None)
        nr = _get_notes_risk(stmt)
        if nr and year:
            notes_by_year.append((year, nr))

    if notes_by_year:
        latest_notes_year, latest_notes = notes_by_year[0]

        # Related party transactions
        rpt = _clean(latest_notes.get("relatedPartyTransactions") or latest_notes.get("related_party_transactions"))
        if rpt:
            findings["related_parties"] = {
                "status": "identified",
                "evidence": rpt,
                "year": latest_notes_year,
                "source": i18n_strings.get("forensic_source_notes", "Notes to Financial Statements"),
                "confidence": "High",
                "score_impact": -2,
            }
            findings["has_data"] = True
        else:
            findings["related_parties"] = {
                "status": "none_identified",
                "evidence": None,
                "year": latest_notes_year,
                "source": i18n_strings.get("forensic_source_notes", "Notes to Financial Statements"),
                "confidence": "High",
                "score_impact": 0,
            }
            findings["has_data"] = True

        # Off-balance-sheet
        obs = _clean(latest_notes.get("offBalanceSheetLiabilities") or latest_notes.get("off_balance_sheet_liabilities"))
        if obs:
            findings["off_balance_sheet"] = {
                "status": "identified",
                "evidence": obs,
                "year": latest_notes_year,
                "source": i18n_strings.get("forensic_source_notes", "Notes to Financial Statements"),
                "confidence": "High",
                "score_impact": None,
            }
            findings["has_data"] = True

        # Litigation / contingent risks
        cr = _clean(latest_notes.get("contingentRisks") or latest_notes.get("contingent_risks"))
        if cr:
            findings["litigation"] = {
                "status": "identified",
                "evidence": cr,
                "year": latest_notes_year,
                "source": i18n_strings.get("forensic_source_notes", "Notes to Financial Statements"),
                "confidence": "High",
                "score_impact": None,
            }
            findings["has_data"] = True

        findings["sources_available"].append("notes")

        # ── Historical trend: check if going concern / related parties also appeared in previous year ──
        if len(sorted_desc) >= 2:
            prev_stmt = sorted_desc[1]
            prev_year = getattr(prev_stmt, 'year', prev_stmt.get('year') if isinstance(prev_stmt, dict) else None)
            prev_notes = _get_notes_risk(prev_stmt)
            prev_narrative = _get_narrative_risk(prev_stmt)

            # Related parties trend
            if (findings.get("related_parties") or {}).get("status") == "identified" and prev_notes:
                prev_rpt = _clean(prev_notes.get("relatedPartyTransactions") or prev_notes.get("related_party_transactions"))
                if prev_rpt:
                    findings["related_parties"]["trend_warning"] = i18n_strings.get(
                        "forensic_trend_repeated",
                        "Also identified in {prev_year}. Repeated related-party activity."
                    ).format(prev_year=prev_year)

            # Going concern trend
            if (findings.get("going_concern") or {}).get("status") == "identified":
                prev_gc = None
                if prev_narrative:
                    prev_gc = _clean(prev_narrative.get("goingConcernDoubts") or prev_narrative.get("going_concern_doubts"))
                if not prev_gc and prev_notes:
                    # Check auditor opinion for previous year
                    prev_ao = getattr(prev_stmt, 'auditorOpinion', None)
                    if prev_ao and hasattr(prev_ao, 'goingConcernRisk'):
                        prev_gc = _clean(getattr(prev_ao, 'goingConcernRisk', None))
                if prev_gc:
                    findings["going_concern"]["trend_warning"] = i18n_strings.get(
                        "forensic_trend_gc",
                        "Similar going concern warning also disclosed in {prev_year}."
                    ).format(prev_year=prev_year)

    # 3. NarrativeRisk — going concern + forensic red flags (grounded only)
    if latest:
        nr = _get_narrative_risk(latest)
        if nr:
            gc = _clean(nr.get("goingConcernDoubts") or nr.get("going_concern_doubts"))
            if gc:
                findings["going_concern"] = {
                    "status": "identified",
                    "evidence": gc,
                    "year": latest_year,
                    "source": i18n_strings.get("forensic_source_annual", "Annual Report"),
                    "confidence": "Medium",
                    "score_impact": None,
                }
                findings["has_data"] = True
            elif auditor_opinion and _clean(auditor_opinion.get("going_concern_risk")):
                findings["going_concern"] = {
                    "status": "identified",
                    "evidence": str(auditor_opinion.get("going_concern_risk")),
                    "year": latest_year,
                    "source": i18n_strings.get("forensic_source_audit", "Audit Report"),
                    "confidence": "High",
                    "score_impact": None,
                }
                findings["has_data"] = True

            # Forensic red flags — only grounded ones (filtered by verdict_builder)
            flags = nr.get("forensicRedFlags") or nr.get("forensic_red_flags")
            if flags and isinstance(flags, list):
                cleaned_flags = [_clean(f) for f in flags if _clean(f)]
                if cleaned_flags:
                    findings["forensic_red_flags"] = [{
                        "evidence": f,
                        "year": latest_year,
                        "source": i18n_strings.get("forensic_source_annual", "Annual Report"),
                        "confidence": "Medium",
                        "score_impact": None,
                    } for f in cleaned_flags[:5]]  # Max 5 flags
                    findings["has_data"] = True

            findings["sources_available"].append("narrative")

    return findings


def prepare_report_context(company, sources, start_pages_map, total_pages, generated_at, report_language="sk", vestnik_date_from=None):
    i18n_strings = get_i18n_strings(report_language)
    verdict = company.auditVerdict
    financial_basis = "individual"
    if company.financialStatements:
        # Filter out empty statements (RÚZ sometimes returns a header record
        # with all-zero values when a filing exists but has no financial data).
        # Such records create misleading "0,00" columns in tables and gaps in charts.
        def _is_empty_stmt(s):
            ta = _to_float(getattr(s, 'totalAssets', None) or 0)
            rev = _to_float(getattr(s, 'mainActivityRevenue', None) or 0)
            eq = _to_float(getattr(s, 'equity', None) or 0)
            return ta == 0 and rev == 0 and eq == 0
        company.financialStatements = [s for s in company.financialStatements if not _is_empty_stmt(s)]
        company.financialStatements = sorted(company.financialStatements, key=lambda s: s.year, reverse=True)[:5]
        # ── Statement type consistency filter ──
        company.financialStatements, financial_basis = _filter_consolidation_consistency(company.financialStatements)
    stmts = company.financialStatements
    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    # Všetky aritmetické operácie v tejto funkcii + chart funkciách vyžadujú float
    for stmt in (stmts or []):
        for field in ("mainActivityRevenue", "grossProfit", "netProfitLoss", "staffCosts",
                       "depreciation", "interestExpense", "operatingCashFlow",
                       "investingCashFlow", "financingCashFlow",
                       "currentAssets", "inventory", "cashAndEquivalents", "tradeReceivables",
                       "totalAssets", "equity", "shortTermLiabilities", "longTermLiabilities",
                       "tradePayables",
                       "materialConsumption", "servicesCosts", "operatingCosts",
                       "wageCosts", "taxesFees", "profitBeforeTax", "financialResult",
                       "incomeTax", "shareCapital", "retainedEarnings", "currentYearProfit",
                       "nonCurrentAssets", "intangibleAssets", "tangibleAssets",
                       "ltReserves", "stReserves"):
            val = getattr(stmt, field, None)
            if val is not None:
                setattr(stmt, field, _to_float(val))
    # Sanitizácia: 0 pre cash flow polia = chýbajúce dáta (artefakt starého LLM promptu)
    for stmt in (stmts or []):
        sanitize_cash_flow_fields(stmt)
    # Fallback: ak grossProfit chýba (extrakcia zlyhala), dopočítaj hrubú maržu
    # Používa sa pre IFRS/SK GAAP by-function výkazy kde gross profit nie je explicitne uvedený
    # Výpočet: revenue - (materialConsumption + servicesCosts + staffCosts + depreciation + interestExpense)
    # Pozn.: stará verzia používala len staff+dep+interest, čo pre výrobné firmy s vysokým
    # podielom materiálu dávalo hrubú maržu ~80% tržieb (nezmysel). Pridávame material a services.
    gross_profit_estimated = False
    estimated_gp_years = set()

    # Sanity check: ak LLM extrahoval zápornú hrubú maržu, ale EBITDA je kladná,
    # ide o chybu extrakcie (LLM pravdepodobne vzal "výsledok z hospodárskej činnosti"
    # namiesto skutočného gross profit). Hrubá marža by mala byť > EBITDA.
    # V takom prípade nastavíme grossProfit na None a použijeme fallback výpočet.
    for stmt in (stmts or []):
        gp = getattr(stmt, 'grossProfit', None)
        if gp is not None and gp < 0:
            revenue = getattr(stmt, 'mainActivityRevenue', None) or 0
            depreciation = getattr(stmt, 'depreciation', None) or 0
            net_profit = getattr(stmt, 'netProfitLoss', None)
            # EBITDA ≈ netProfit + interest + tax + depreciation (hrubý odhad)
            # Ak je EBITDA kladná (alebo netProfit + depreciation > 0), záporná hrubá marža je podozrivá
            ebitda_proxy = (net_profit or 0) + depreciation
            if ebitda_proxy > 0 and revenue > 0:
                # Hrubá marža by mala byť >= EBITDA (lebo EBITDA = GP - opex + dep)
                # Ak je GP < 0 a EBITDA > 0, ide o extrakčnú chybu
                setattr(stmt, 'grossProfit', None)
                stmt._gross_profit_invalidated = True

    for stmt in (stmts or []):
        if getattr(stmt, 'grossProfit', None) is None:
            revenue = getattr(stmt, 'mainActivityRevenue', None)
            material = getattr(stmt, 'materialConsumption', None)
            services = getattr(stmt, 'servicesCosts', None)
            staff = getattr(stmt, 'staffCosts', None)
            depreciation = getattr(stmt, 'depreciation', None)
            interest = getattr(stmt, 'interestExpense', None)
            if revenue and revenue > 0 and staff is not None and depreciation is not None:
                costs = staff + depreciation
                if material is not None:
                    costs += material
                if services is not None:
                    costs += services
                if interest is not None:
                    costs += interest
                estimated = revenue - costs
                # Sanity check: fallback nesmie byť záporný ani > 100% tržieb
                if 0 < estimated <= revenue:
                    stmt.grossProfit = estimated
                    stmt._gross_profit_estimated = True
                    estimated_gp_years.add(stmt.year)
                    gross_profit_estimated = True
    # Ak sú VŠETKY hodnoty grossProfit odhadnuté (žiadny rok nemá reálnu hrubú maržu),
    # môžeme premenovať celý riadok. Inak ostáva "Hrubá marža" a odhadnuté bunky sa označia.
    _gp_years = [s for s in (stmts or []) if getattr(s, 'grossProfit', None) is not None]
    gross_profit_all_estimated = bool(_gp_years) and all(s.year in estimated_gp_years for s in _gp_years)

    # Fallback: ak operatingCashFlow chýba (zjednodušený výkaz bez CF), vypočítaj nepriamou metódou
    # Operating CF ≈ Net Profit + Depreciation - ΔInventory - ΔTrade Receivables + ΔTrade Payables
    cashflow_estimated = estimate_missing_cash_flow(stmts or [])
    has_cashflow_data = any(
        getattr(s, 'operatingCashFlow', None) is not None or
        getattr(s, 'investingCashFlow', None) is not None or
        getattr(s, 'financingCashFlow', None) is not None
        for s in (stmts or [])
    )
    latest_stmt = max(stmts, key=lambda s: s.year) if stmts else None
    vestnik_events = company.vestnikEvents or []
    
    # Filter vestnik events by date — default 1 year lookback
    if vestnik_events:
        from datetime import datetime as _dt, timedelta as _td
        if vestnik_date_from:
            try:
                cutoff = _dt.fromisoformat(vestnik_date_from)
            except (ValueError, TypeError):
                cutoff = _dt.now() - _td(days=365)
        else:
            cutoff = _dt.now() - _td(days=365)
        filtered = []
        for e in vestnik_events:
            pub = getattr(e, 'publishedAt', None)
            if pub and hasattr(pub, 'year'):
                if pub.replace(tzinfo=None) >= cutoff:
                    filtered.append(e)
            else:
                filtered.append(e)
        vestnik_events = filtered
    
    # Zoradené výkazy pre tabuľky (od najstaršieho)
    stmts_sorted = sorted(stmts, key=lambda s: s.year) if stmts else []

    # EBITDA pre každý rok (pre historickú tabuľku P&L)
    # Prisma model neumožňuje arbitrary attributes, takže použijeme dict
    ebitda_by_year = {}
    for s in stmts_sorted:
        ratios_s = compute_financial_ratios(s)
        if ratios_s.get("ebitda") is not None:
            ebitda_by_year[s.year] = ratios_s["ebitda"]

    # Najnovšie finančné pomery pre karty v reporte
    latest_ratios = {}
    if latest_stmt:
        latest_ratios = compute_financial_ratios(latest_stmt)
    
    # NACE info
    nace_code = getattr(company, 'naceCode', None)
    nace_text = getattr(company, 'naceText', None)
    
    # Počet zamestnancov z najnovšieho výkazu (alebo odhad z staffCosts)
    employee_count = getattr(latest_stmt, 'employeeCount', None) if latest_stmt else None
    employee_count_estimated = False
    if not employee_count and latest_stmt:
        staff_costs = getattr(latest_stmt, 'staffCosts', 0) or 0
        if staff_costs > 0:
            employee_count = max(1, round(staff_costs / 18000))  # odhad: priemerná ročná mzda ~18k € (konzistentné s analytics.py)
            employee_count_estimated = True
    
    # Tržby na zamestnanca
    revenue_per_employee = None
    if latest_stmt and employee_count and employee_count > 0:
        rev = getattr(latest_stmt, 'mainActivityRevenue', None)
        if rev and rev > 0:
            revenue_per_employee = round(rev / employee_count)

    # Vygenerovanie grafov
    chart_base64 = ""
    balance_chart_base64 = ""
    has_mixed_consolidation = False
    has_non_standard_months = False
    has_balance_imbalance = False

    if stmts:
        is_cons_set = set(getattr(s, 'isConsolidated', False) for s in stmts)
        if len(is_cons_set) > 1:
            has_mixed_consolidation = True

        for s in stmts:
            months = getattr(s, 'monthsInPeriod', 12)
            if months is not None and months != 12:
                has_non_standard_months = True
                break

        # Detekcia súvahovej nevyrovnanosti: |Aktíva - (Equity + STL + LTL)| > 5% aktív
        for s in stmts:
            ta = _to_float(getattr(s, 'totalAssets', None))
            eq = _to_float(getattr(s, 'equity', None))
            stl = _to_float(getattr(s, 'shortTermLiabilities', None))
            ltl = _to_float(getattr(s, 'longTermLiabilities', None))
            if ta and ta > 0 and eq is not None and stl is not None and ltl is not None:
                total_liab = eq + stl + ltl
                imbalance = abs(ta - total_liab)
                if imbalance > ta * 0.05:  # > 5% of total assets = significant
                    has_balance_imbalance = True
                    logger.warning(f"[BALANCE] Súvaha nevyrovnaná pre rok {getattr(s, 'year', '?')}: "
                                   f"Aktíva={ta:.0f} vs Pasíva={total_liab:.0f} (diff={imbalance:.0f})")
                    break

    has_short_history = bool(stmts) and len(stmts) < 2

    if stmts and len(stmts) >= 2:
        chart_base64 = generate_financial_chart(stmts, lang=report_language)
        balance_chart_base64 = generate_balance_sheet_chart(stmts, lang=report_language)
        pnl_chart_base64 = generate_pnl_chart(stmts, lang=report_language)
        cashflow_chart_base64 = generate_cashflow_chart(stmts, lang=report_language)
    else:
        pnl_chart_base64 = ""
        cashflow_chart_base64 = ""
    
    # Načítanie Verifa loga — skús viacero ciest (lokálne vs Docker)
    current_dir = Path(__file__).parent
    logo_candidates = [
        current_dir.parent / "assets" / "logo-verifa.png",   # worker/assets/ (lokálne)
        Path("/app/assets/logo-verifa.png"),                   # Docker WORKDIR=/app
        Path.cwd() / "assets" / "logo-verifa.png",            # CWD-based fallback
    ]
    logo_base64 = ""
    for lp in logo_candidates:
        if lp.exists():
            with open(lp, "rb") as lf:
                logo_base64 = base64.b64encode(lf.read()).decode('utf-8')
            logger.info(f"[LOGO] Načítané z {lp}")
            break
    if not logo_base64:
        logger.warning(f"[LOGO] logo-verifa.png nenájdené v žiadnej z ciest: {[str(p) for p in logo_candidates]}")
            
    counts = {"SUCCESS": 0, "WARNING": 0, "INFO": 0, "FAILED": 0, "UNAVAILABLE": 0}
    if sources:
        for s in sources:
            findings = (s.findings or s.message or "").upper()
            if "POZOR" in findings:
                if s.source_type in {"CRZ", "RPVS", "UVO", "REGISTER_UZ"}:
                    counts["INFO"] += 1
                else:
                    counts["WARNING"] += 1
            elif s.status == "SUCCESS":
                counts["SUCCESS"] += 1
            elif s.status in counts:
                counts[s.status] += 1
            else:
                counts["FAILED"] += 1
                
    source_map = {s.source_type: s for s in sources} if sources else {}
    
    # ── Coverage stats for transparency ──
    # Active scrapers (must match _SCRAPER_REGISTRY in scrapers/registry.py)
    _ACTIVE_SCRAPER_COUNT = 26
    _SOURCES_WITHOUT_SCRAPER = {
        "CRRS": "Register restrukturalizácií",
        "OCHRANNE_ZNAMKY": "Register ochranných známok",
        "FS_DPH_BANKOVE_UCTY": "Bankové účty platiteľov DPH",
        "CRE": "Centrálny register exekúcií",
    }
    _successful_sources = sum(1 for s in (sources or []) if s.status == "SUCCESS")
    _failed_count = sum(1 for s in (sources or []) if s.status in ("FAILED", "UNAVAILABLE"))
    _uncontrolled_sources = [
        {"source_type": st, "label": label}
        for st, label in sorted(_SOURCES_WITHOUT_SCRAPER.items())
    ]
    
    # ── Company persons from ORSR ──
    company_persons = getattr(company, 'companyPersons', None) or []
    # Group by role
    _persons_statutar = [p for p in company_persons if p.role == "statutar"]
    _persons_spolocnik = [p for p in company_persons if p.role == "spolocnik"]
    
    # Sídlo (mesto) a rok vzniku z RPO findings
    company_city = None
    company_founded_year = None
    if "RPO" in source_map:
        rpo_findings = source_map["RPO"].findings or ""
        addr_match = re.search(r'Adresa sídla:\s*(.+)', rpo_findings)
        if addr_match:
            addr = addr_match.group(1).strip()
            parts = addr.split(',')
            if parts:
                last_part = parts[-1].strip()
                city = re.sub(r'^\d{3}\s?\d{2}\s*', '', last_part).strip()
                if city:
                    company_city = city
        vznik_match = re.search(r'Dátum vzniku:\s*(\d{1,2}\.\d{1,2}\.(\d{4})|\d{4})', rpo_findings)
        if vznik_match:
            year_str = vznik_match.group(2) if vznik_match.group(2) else vznik_match.group(1)
            try:
                company_founded_year = int(year_str)
            except ValueError:
                pass
    # Fallback 1: Sídlo z ORSR
    if not company_city and "ORSR" in source_map:
        orsr_findings = source_map["ORSR"].findings or ""
        addr_match = re.search(r'Sídlo:\s*([^\r\n]*)\r?\n\s*([^\r\n]+)', orsr_findings)
        if addr_match:
            line2 = addr_match.group(2).strip()
            city_part = line2.split('-')[0].split(',')[0].strip()
            city = re.sub(r'^\d{3}\s?\d{2}\s*', '', city_part)
            city = re.sub(r'\s*\d{3}\s?\d{2}\s*$', '', city).strip()
            if city:
                company_city = city

    # Fallback 2: mesto z company.name (formát "Firma s.r.o. (Bratislava)")
    if not company_city and company.name:
        name_city_match = re.search(r'\(([^)]+)\)', company.name)
        if name_city_match:
            company_city = name_city_match.group(1).strip()

    grouped_sources = []
    rendered_types = set()
    for cat_key, types in SOURCE_CATEGORY_DEFS:
        cat_sources = [source_map[t] for t in types if t in source_map]
        if cat_sources:
            cat_name = i18n_strings.get(cat_key, cat_key)
            grouped_sources.append((cat_name, cat_sources))
            rendered_types.update(types)
            
    other_sources = [s for s in (sources or []) if s.source_type not in rendered_types]
    if other_sources:
        grouped_sources.append((i18n_strings.get("cat_other", "Ostatné"), other_sources))

    # ── Critical legal findings — computed in Python (was 3 nested loops in Jinja) ──
    _CRITICAL_TYPES = {"EXECUTOR", "REGISTER_UPADCOV", "SUDY", "ORSR_LIKVIDACIA", "ORSR_KONKURZ"}
    _INFO_TYPES = {"FS_DPH_REGISTROVANI", "FS_DPH_VYMAZANI", "FS_DAN_PRIJMOV_REG", "CRZ", "RPVS", "UVO", "REGISTER_UZ", "ROZHODNUTIA"}
    critical_sources = []
    for _cat_name, _cat_sources in grouped_sources:
        for _src in _cat_sources:
            _has_pozor = bool(_src.findings) and "POZOR" in (_src.findings or "").upper()
            _is_critical_type = _src.source_type in _CRITICAL_TYPES
            if _src.status == "SUCCESS" and _has_pozor and _src.source_type not in _INFO_TYPES:
                critical_sources.append(_src)
            elif _is_critical_type and _src.status == "SUCCESS" and _has_pozor:
                critical_sources.append(_src)
        
    evidence_list = []
    try:
        if verdict and verdict.justification:
            raw_list = json.loads(verdict.justification)
            for item in raw_list:
                # Premapuj anglické kľúče z DB na slovenské, ktoré šablóny očakávajú
                if "claim" in item and "tvrdenie" not in item:
                    item["tvrdenie"] = item["claim"]
                if "evidence" in item and "dokaz" not in item:
                    item["dokaz"] = item["evidence"]
                if "source" in item and "zdroj" not in item:
                    item["zdroj"] = item["source"]
                z = item.get("zdroj", "")
                if "profit_trend" in z: z = i18n_strings.get("evidence_profit_trend", z)
                elif "ratios_by_year" in z: z = i18n_strings.get("evidence_ratios", z)
                elif "altman_z_scores" in z: z = i18n_strings.get("evidence_altman", z)
                elif "financialStatements" in z: z = i18n_strings.get("evidence_financials", z)
                elif "sp_dlznici" in z: z = i18n_strings.get("evidence_sp_dlznici", z)
                elif "vszp_dlznici" in z or "union_dlznici" in z: z = i18n_strings.get("evidence_health_insurance", z)
                elif "fs_danove" in z: z = i18n_strings.get("evidence_fs_danove", z)
                elif "insolvency" in z: z = i18n_strings.get("evidence_insolvency", z)
                elif "orsr" in z: z = i18n_strings.get("evidence_orsr", z)
                # Also translate SK source names that LLM may have written directly
                z = _translate_evidence_source(z, i18n_strings)
                item["zdroj"] = z
            evidence_list = raw_list
    except Exception as e:
        logger.warning(f"Nepodarilo sa naparsovať evidence z verdict.justification: {e}")

    # ── Deterministický adjustment breakdown (pre transparentnosť v scorecard) ──
    det_breakdown = {}
    try:
        if verdict and getattr(verdict, 'adjustmentBreakdown', None):
            det_breakdown = json.loads(verdict.adjustmentBreakdown)
    except (json.JSONDecodeError, TypeError, AttributeError):
        pass
        logger.warning(f"Nepodarilo sa naparsovať evidence z verdict.justification: {e}")

    # ── i18n override for fallback verdict ──
    # When LLM was unavailable, the verdict was stored with Slovak strings.
    # Replace them with i18n versions based on report_language.
    # Use a wrapper class instead of mutating the Prisma model directly.
    class _VerdictOverride:
        """Delegate to original verdict but override specific fields."""
        def __init__(self, original, overrides):
            self._original = original
            self._overrides = overrides
        def __getattr__(self, name):
            if name in self._overrides:
                return self._overrides[name]
            return getattr(self._original, name)

    # ── Parse executiveSections from JSON string to list of dicts for template ──
    _executive_sections = []
    if verdict and getattr(verdict, 'executiveSections', None):
        try:
            _executive_sections = json.loads(verdict.executiveSections)
        except (json.JSONDecodeError, TypeError):
            _executive_sections = []
    if verdict:
        verdict = _VerdictOverride(verdict, {"executiveSections": _executive_sections})

    # ── Render-time placeholder injection (second line of defense) ──
    # Cached verdicts may contain unresolved {{...}} placeholders if they were
    # generated before the inject_metrics fix. Apply inject_metrics here to
    # ensure placeholders are always resolved at render time.
    if verdict and stmts:
        _stmts_for_ph = [
            {f: getattr(s, f, None) for f in (
                'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
                'shortTermLiabilities', 'longTermLiabilities', 'totalLiabilities',
                'operatingCashFlow', 'investingCashFlow', 'cashAndEquivalents',
                'grossProfit', 'currentAssets', 'inventory', 'depreciation',
                'tradeReceivables', 'tradePayables', 'employeeCount',
            )}
            for s in stmts
        ]
        _trends_for_ph = {}
        try:
            _trends_for_ph = compute_financial_trends(stmts) or {}
        except Exception:
            pass
        _ph = build_metric_placeholders(
            stmts=_stmts_for_ph,
            trends=_trends_for_ph,
            company_name=getattr(company, 'name', ''),
        )
        if _ph:
            _overrides_ph = {}
            for _field in ('executiveSummary', 'keyRisk', 'finalVerdict'):
                _val = getattr(verdict, _field, None)
                if _val and isinstance(_val, str):
                    _overrides_ph[_field] = inject_metrics(_val, _ph)
            # Inject into executiveSections
            _injected_es = []
            for _sec in _executive_sections:
                if isinstance(_sec, dict):
                    _st = _sec.get('title', '')
                    if _st:
                        _sec['title'] = inject_metrics(_st, _ph)
                    _pts = _sec.get('points', [])
                    if isinstance(_pts, list):
                        _sec['points'] = [inject_metrics(p, _ph) if p else p for p in _pts]
                    _injected_es.append(_sec)
            _overrides_ph['executiveSections'] = _injected_es or _executive_sections
            # Inject into findings
            _findings = getattr(verdict, 'findings', None)
            if _findings:
                _injected_findings = []
                for _f in _findings:
                    if isinstance(_f, dict):
                        for _ff in ('title', 'evidence', 'explanation', 'implication'):
                            _fv = _f.get(_ff, '')
                            if _fv and isinstance(_fv, str):
                                _f[_ff] = inject_metrics(_fv, _ph)
                        _injected_findings.append(_f)
                _overrides_ph['findings'] = _injected_findings
            verdict = _VerdictOverride(verdict, _overrides_ph)

    if verdict and getattr(verdict, 'llmAnalysisStatus', None) == 'FALLBACK_ALGORITHMIC':
        hard_stop = any(
            e.get("impact") == "CRITICAL" for e in evidence_list
        ) if evidence_list else False
        risk_cat = getattr(verdict, 'riskCategory', 'INSUFFICIENT_DATA')
        score_val = getattr(verdict, 'verifaScore', 0)

        overrides = {
            "executiveSummary": i18n_strings.get("fallback_exec_summary", getattr(verdict, 'executiveSummary', '')),
            "executiveSections": [],
            "finalVerdict": (
                i18n_strings.get("fallback_verdict_hardstop", "")
                if hard_stop else
                i18n_strings.get("fallback_verdict_normal", "").format(cat=risk_cat, score=score_val)
            ),
            "keyRisk": (
                i18n_strings.get("fallback_key_risk_hardstop", "")
                if hard_stop else
                i18n_strings.get("fallback_key_risk_normal", "")
            ),
        }

        # Override evidence list items
        for item in evidence_list:
            claim = item.get("tvrdenie", item.get("claim", ""))
            if "Algoritmické hodnotenie" in claim or "Algorithmic assessment" in claim:
                item["tvrdenie"] = i18n_strings.get("fallback_claim", claim)
                item["dokaz"] = i18n_strings.get("fallback_evidence", "").format(score=score_val, cat=risk_cat)
                item["zdroj"] = i18n_strings.get("fallback_source", item.get("zdroj", ""))
            elif "HARD STOP" in claim:
                item["tvrdenie"] = i18n_strings.get("fallback_hardstop_claim", claim)
                item["dokaz"] = i18n_strings.get("fallback_hardstop_evidence", item.get("dokaz", ""))
                item["zdroj"] = i18n_strings.get("fallback_hardstop_source", item.get("zdroj", ""))
            elif "Rozpis pilierov" in claim or "Pillar breakdown" in claim:
                item["tvrdenie"] = i18n_strings.get("fallback_pillar_breakdown", claim)
                item["zdroj"] = i18n_strings.get("fallback_pillar_source", item.get("zdroj", ""))

        verdict = _VerdictOverride(verdict, overrides)

    scorecard_breakdown = []
    algorithmic_total = 0
    # Uprednostni uložený scorecardBreakdown z verdiktu — bol počítaný z raw dát
    # a zodpovedá uloženému verifaScore. Prepočet len ako fallback keď chýba.
    stored_breakdown = getattr(verdict, "scorecardBreakdown", None) if verdict else None
    # Check if stored breakdown has N/A flags (computed when data was missing)
    stored_has_na = False
    if stored_breakdown:
        for p in stored_breakdown:
            for f in (p.get("flags") or []):
                if "N/A" in str(f):
                    stored_has_na = True
                    break
            if stored_has_na:
                break
    if stored_breakdown and not (stored_has_na and stmts):
        scorecard_breakdown = stored_breakdown
        algorithmic_total = max(0, sum(p.get("score", 0) for p in stored_breakdown))
    elif stmts:
        company_dict_for_scoring = {
            "vestnikEvents": [
                {"eventType": e.eventType, "severityLevel": getattr(e, "severityLevel", None)}
                for e in vestnik_events
            ],
            "financialStatements": stmts,
            "companyEvents": [
                {"source": e.source, "eventType": e.eventType, "severity": e.severity, "metadata": e.metadata}
                for e in (getattr(company, 'companyEvents', None) or [])
            ],
        }
        trends_for_scoring = compute_financial_trends(stmts)
        sc_result = compute_forensic_scorecard(company_dict_for_scoring, trends_for_scoring)
        algorithmic_total = sc_result.total_score
        scorecard_breakdown = [
            {"name": p.name, "score": p.score, "max_score": p.max_score, "detail": p.detail, "flags": p.flags}
            for p in sc_result.pillars
        ]

    # Piotroski F-score: stored scorecard breakdown is the single source of truth
    # (it corresponds to the stored verifaScore shown on the cover page).
    # Recompute from current statements ONLY as fallback when stored breakdown
    # has no Piotroski flag (old verdicts) — then patch flags AND detail so
    # section II, pillar score and detail panel all show the same value.
    _pio_score = _extract_piotroski_from_scorecard(scorecard_breakdown)
    sorted_stmts_raw = sorted(stmts or [], key=lambda s: s.year)
    if _pio_score is not None:
        # Rebuild piotroski_result from stored flags (incl. neutralized criteria) for the detail panel
        _stored_pio_flags = []
        for _p in scorecard_breakdown:
            for _f in (_p.get("flags") or []):
                if re.match(r'Piotroski F-score:\s*\d+\s*z\s*8', _f) or re.match(r'Neutralizované kritériá \(chýbajúce dáta\):', _f):
                    _stored_pio_flags.append(_f)
        piotroski_result = {"score": _pio_score, "flags": _stored_pio_flags or [f"Piotroski F-score: {_pio_score} z 8"]}
    else:
        piotroski_result = compute_piotroski_f_score(sorted_stmts_raw)
        _pio_score = piotroski_result.get("score")
        _pio_flags = piotroski_result.get("flags", [])
        if scorecard_breakdown and _pio_score is not None:
            for p in scorecard_breakdown:
                if p.get("name") == "Finančné zdravie":
                    old_flags = p.get("flags") or []
                    new_flags = []
                    for f in old_flags:
                        if re.match(r'Piotroski F-score:\s*\d+\s*z\s*8', f):
                            new_flags.append(f"Piotroski F-score: {_pio_score} z 8")
                        elif re.match(r'Neutralizované kritériá \(chýbajúce dáta\):', f):
                            if _pio_flags and len(_pio_flags) > 1:
                                new_flags.append(_pio_flags[1])
                            else:
                                new_flags.append(f)
                        else:
                            new_flags.append(f)
                    if not any(re.match(r'Piotroski F-score:', f) for f in new_flags):
                        new_flags.extend(_pio_flags)
                    p["flags"] = new_flags
                    p["detail"] = " | ".join(new_flags[:2])
                    break
    # i18n: Translate scorecard pillar names, details, and flags at display time
    if scorecard_breakdown:
        scorecard_breakdown = _translate_scorecard(scorecard_breakdown, i18n_strings)

    # i18n: Override pillar breakdown evidence item with translated scorecard text
    if evidence_list and scorecard_breakdown:
        translated_dokaz = " | ".join(
            f"{p['name']}: {p['score']}/{p['max_score']} — {p['detail']}"
            for p in scorecard_breakdown
        )
        for item in evidence_list:
            claim = item.get("tvrdenie", item.get("claim", ""))
            if "Rozpis pilierov" in claim or "Pillar breakdown" in claim or i18n_strings.get("fallback_pillar_breakdown", "") in claim:
                item["dokaz"] = translated_dokaz

    # Vypnutie Altman Z-Score pre finančné inštitúcie (NACE 64, 65, 66) alebo "banka"/"poisťovňa" v názve
    is_financial_institution = False
    if company.naceCode and company.naceCode.startswith(("64", "65", "66")):
        is_financial_institution = True
    elif company.name and re.search(r'\bbanka\b|\bpoisťovňa\b|\bpojišťovna\b|\bpoisťovne\b', company.name.lower()):
        is_financial_institution = True

    # Súvahová heuristika — ak najnovší výkaz vyzerá ako finančná inštitúcia
    # (currentAssets chýba, shortTermLiabilities takmer 0, veľké záväzky)
    if not is_financial_institution and stmts:
        latest_stmt = max(stmts, key=lambda s: s.year)
        from src.analytics import _is_financial_institution as _is_fin_inst_balance
        if _is_fin_inst_balance(latest_stmt):
            is_financial_institution = True

    # Startup detekcia — pre pre-revenue firmy s veľkým imaním
    sorted_stmts_for_startup = sorted(stmts or [], key=lambda s: s.year)
    startup_info = detect_startup_profile(sorted_stmts_for_startup)
    is_startup = startup_info.get("is_startup", False)

    if is_financial_institution:
        altman_scores = []
    elif is_startup:
        altman_scores = []
    else:
        altman_scores = sorted(
            [{"year": s.year, **compute_altman_z_score(s)} for s in (stmts or []) if s.year and s.year > 2000],
            key=lambda z: z["year"]
        )

    # Beneish M-score — earnings manipulation detection
    beneish_result = compute_beneish_m_score(sorted_stmts_raw)
    beneish_m_score = beneish_result.get("m_score")
    beneish_is_manipulator = beneish_result.get("is_manipulator", False)
    beneish_flags = beneish_result.get("flags", [])
    # Translate Beneish flags
    beneish_flags = [_translate_flag(f, i18n_strings) for f in beneish_flags]

    # YoY rast tržieb a zisku
    yoy_revenue_growth = None
    yoy_profit_growth = None
    if len(sorted_stmts_raw) >= 2:
        curr = sorted_stmts_raw[-1]
        prev = sorted_stmts_raw[-2]
        curr_rev = getattr(curr, 'mainActivityRevenue', 0) or 0
        prev_rev = getattr(prev, 'mainActivityRevenue', 0) or 0
        curr_profit = getattr(curr, 'netProfitLoss', 0) or 0
        prev_profit = getattr(prev, 'netProfitLoss', 0) or 0
        if prev_rev > 0:
            yoy_revenue_growth = round(((curr_rev - prev_rev) / prev_rev) * 100, 1)
        if prev_profit != 0:
            yoy_profit_growth = round(((curr_profit - prev_profit) / abs(prev_profit)) * 100, 1)

    # Trend ratios pre všetky roky (pre trend graf)
    trend_ratios = []
    for s in sorted_stmts_raw:
        r = compute_financial_ratios(s)
        trend_ratios.append({
            "year": s.year,
            "roa_pct": r.get("roa_pct"),
            "roe_pct": r.get("roe_pct"),
            "net_profit_margin_pct": r.get("net_profit_margin_pct"),
            "current_ratio": r.get("current_ratio"),
            "debt_to_equity": r.get("debt_to_equity"),
        })

    # Trend graf pre ROA/ROE/maržu
    ratios_chart_base64 = ""
    if len(trend_ratios) >= 2:
        ratios_chart_base64 = generate_ratios_trend_chart(trend_ratios, lang=report_language)

    # Radar chart pre 5 pilierov
    radar_chart_base64 = ""
    if scorecard_breakdown and len(scorecard_breakdown) >= 3:
        radar_chart_base64 = generate_radar_chart(scorecard_breakdown, lang=report_language)

    # Auditor opinion info
    auditor_opinion = None
    if latest_stmt and getattr(latest_stmt, 'auditorOpinion', None):
        ao = latest_stmt.auditorOpinion
        raw_opinion_type = getattr(ao, 'opinionType', None)
        # i18n: Translate auditor opinion type from Slovak DB value
        opinion_type = raw_opinion_type
        if raw_opinion_type:
            opt_lower = raw_opinion_type.lower()
            if "bez výhrad" in opt_lower:
                opinion_type = i18n_strings.get("auditor_unqualified", raw_opinion_type)
            elif "výhrad" in opt_lower:
                opinion_type = i18n_strings.get("auditor_qualified", raw_opinion_type)
            elif "záporn" in opt_lower or "adverse" in opt_lower:
                opinion_type = i18n_strings.get("auditor_adverse", raw_opinion_type)
            elif "zdržan" in opt_lower or "disclaimer" in opt_lower:
                opinion_type = i18n_strings.get("auditor_disclaimer", raw_opinion_type)
        def _clean_db_val(v):
            """DB may store string 'null' instead of Python None."""
            if v is None or (isinstance(v, str) and v.strip().lower() == "null"):
                return None
            return v
        auditor_opinion = {
            "opinion_type": _clean_db_val(opinion_type),
            "going_concern_risk": _clean_db_val(getattr(ao, 'goingConcernRisk', None)),
            "reservation_text": _clean_db_val(getattr(ao, 'reservationText', None)),
            "auditor_name": _clean_db_val(getattr(ao, 'auditorName', None)),
        }

    # ── Forensic & Audit Findings: structured evidence from NotesRisk, NarrativeRisk, AuditorOpinion ──
    forensic_findings = _build_forensic_findings(stmts_sorted, auditor_opinion, i18n_strings)

    # Gauge arc endpoint for cover page score gauge
    score_val = verdict.verifaScore if verdict else 0
    arc_angle = (score_val / 100.0) * 180
    rad = (180 - arc_angle) * math.pi / 180.0
    gx, gy, gr = 100, 100, 80
    gauge_end_x = round(gx + gr * math.cos(rad), 2)
    gauge_end_y = round(gy - gr * math.sin(rad), 2)
    gauge_large_arc = 1 if arc_angle > 180 else 0

    # Cash flow waterfall + balance sheet infographic
    cf_waterfall_base64 = generate_cashflow_waterfall(latest_stmt, lang=report_language) if latest_stmt else ""
    bs_infographic_base64 = generate_balance_sheet_infographic(latest_stmt, lang=report_language) if latest_stmt else ""
    pl_infographic_base64 = generate_pl_infographic(latest_stmt, lang=report_language) if latest_stmt else ""
    liquidity_chart_base64 = generate_liquidity_chart(stmts_sorted, lang=report_language) if stmts_sorted else ""
    employee_chart_base64 = generate_employee_chart(stmts_sorted, lang=report_language) if stmts_sorted else ""
    rpe_chart_base64 = generate_rpe_chart(stmts_sorted, lang=report_language) if stmts_sorted else ""

    # Asset & equity composition donuts + forensic statement delay
    asset_composition_chart_base64 = ""
    equity_composition_chart_base64 = ""
    statement_delay_days = None
    if latest_stmt:
        asset_composition_chart_base64 = generate_asset_composition_donut(latest_stmt, lang=report_language)
        equity_composition_chart_base64 = generate_equity_composition_donut(latest_stmt, lang=report_language)
        # Forensic signal: days between period end and statement compilation date
        stmt_date_raw = getattr(latest_stmt, "statementDate", None)
        if stmt_date_raw:
            try:
                from datetime import date as _date
                stmt_date = _date.fromisoformat(str(stmt_date_raw)[:10])
                period_end = _date(latest_stmt.year, 12, 31)
                statement_delay_days = (stmt_date - period_end).days
            except (ValueError, TypeError):
                pass

    # QR code for cover page
    qr_base64 = ""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=4, border=1)
        qr.add_data(f"https://verifa.sk/reports/{company.ico}")
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color='#1e293b', back_color='white')
        qr_buf = io.BytesIO()
        qr_img.save(qr_buf, format='PNG')
        qr_base64 = base64.b64encode(qr_buf.getvalue()).decode('utf-8')
    except Exception:
        pass

    # ── Confidence score (Spoľahlivosť analýzy) ──
    confidence_factors = []
    confidence_score = 100

    # 1. Audit (±15 bodov)
    has_audit = bool(auditor_opinion)
    if has_audit:
        confidence_factors.append({"label": i18n_strings.get("conf_audit_ok"), "ok": True, "weight": 15})
    else:
        confidence_factors.append({"label": i18n_strings.get("conf_audit_missing"), "ok": False, "weight": 15})
        confidence_score -= 15

    # 2. Úplnosť finančných výkazov (±20 bodov)
    has_full_statements = bool(stmts) and len(stmts) >= 1
    if has_full_statements:
        confidence_factors.append({"label": i18n_strings.get("conf_statements_ok"), "ok": True, "weight": 20})
    else:
        confidence_factors.append({"label": i18n_strings.get("conf_statements_missing"), "ok": False, "weight": 20})
        confidence_score -= 20

    # 3. Dĺžka histórie (±20 bodov)
    stmt_count = len(stmts) if stmts else 0
    if stmt_count >= 5:
        confidence_factors.append({"label": i18n_strings.get("conf_history_long", "").format(n=stmt_count), "ok": True, "weight": 20})
    elif stmt_count >= 2:
        confidence_factors.append({"label": i18n_strings.get("conf_history_medium", "").format(n=stmt_count), "ok": True, "weight": 10})
        confidence_score -= 10
    elif stmt_count == 1:
        confidence_factors.append({"label": i18n_strings.get("conf_history_short"), "ok": False, "weight": 20})
        confidence_score -= 20
    else:
        confidence_factors.append({"label": i18n_strings.get("conf_history_none"), "ok": False, "weight": 20})
        confidence_score -= 20

    # 4. Pokrytie registrov (±25 bodov)
    total_sources = sum(counts.values()) if counts else 0
    failed_sources = counts.get("FAILED", 0) + counts.get("UNAVAILABLE", 0)
    # Kritické registre dlžníkov — ich nedostupnosť je slepá škvrna pre risk assessment
    _critical_debt_sources = {"VSZP_DLZNICI", "UNION_DLZNICI", "DOVERA_DLZNICI", "SP_DLZNICI", "INSOLVENCY"}
    unavailable_critical = sum(1 for s in (sources or []) if s.source_type in _critical_debt_sources and s.status in ("UNAVAILABLE", "FAILED"))
    if total_sources > 0:
        success_ratio = (total_sources - failed_sources) / total_sources
        if success_ratio >= 0.9 and unavailable_critical == 0:
            confidence_factors.append({"label": i18n_strings.get("conf_registries_all"), "ok": True, "weight": 25})
        elif success_ratio >= 0.6 and unavailable_critical == 0:
            confidence_factors.append({"label": i18n_strings.get("conf_registries_partial", "").format(pct=int(success_ratio*100)), "ok": True, "weight": 15})
            confidence_score -= 10
        elif unavailable_critical > 0:
            # Critical debt registries unavailable — blind spot in risk assessment
            confidence_factors.append({"label": i18n_strings.get("conf_registries_partial", "").format(pct=int(success_ratio*100)), "ok": False, "weight": 25})
            confidence_score -= 25
        else:
            confidence_factors.append({"label": i18n_strings.get("conf_registries_limited", "").format(pct=int(success_ratio*100)), "ok": False, "weight": 25})
            confidence_score -= 25
        # Extra penalty for unavailable critical debt registries
        if unavailable_critical > 0:
            confidence_score -= unavailable_critical * 8  # -8 per unavailable critical source
    else:
        confidence_factors.append({"label": i18n_strings.get("conf_registries_none"), "ok": False, "weight": 25})
        confidence_score -= 25

    # 5. LLM analýza (±20 bodov)
    llm_status = getattr(verdict, 'llmAnalysisStatus', None) if verdict else None
    if llm_status and llm_status != 'FALLBACK_ALGORITHMIC':
        confidence_factors.append({"label": i18n_strings.get("conf_llm_ok"), "ok": True, "weight": 20})
    else:
        confidence_factors.append({"label": i18n_strings.get("conf_llm_missing"), "ok": False, "weight": 20})
        confidence_score -= 20

    confidence_score = max(0, min(100, confidence_score))

    # Valid until date (90 days from generation)
    from datetime import datetime, timedelta
    valid_until = (datetime.now() + timedelta(days=90)).strftime('%d.%m.%Y')

    # ── Compute insolvency score, fraud heatmap, and strengths/weaknesses ──
    _insolvency = compute_insolvency_score(stmts, i18n_strings)
    _fraud_heatmap = compute_fraud_heatmap(verdict, stmts, vestnik_events, i18n_strings)
    _strengths_weaknesses = compute_strengths_weaknesses(
        scorecard_breakdown, _fraud_heatmap, _insolvency,
        verdict, stmts, vestnik_events, i18n_strings
    )

    # ── Štátne záväzky, RPE alert a YoY tabuľka (nové právne rizikové indikátory) ──
    _stmts_as_dicts = [
        {f: getattr(s, f, None) for f in (
            'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
            'shortTermLiabilities', 'staffCosts', 'depreciation', 'interestExpense', 'incomeTax',
            'socialInsuranceLiabilities', 'taxLiabilities', 'employeeLiabilities',
            'employeeCount',
        )}
        for s in stmts_sorted
    ]
    _scraper_results = {}
    if source_map:
        for st_type in ("SP_DLZNICI", "FINANCNA_SPRAVA"):
            src = source_map.get(st_type)
            if src:
                # Only set has_record=True if scraper succeeded AND findings
                # don't contain "no records" phrases. A FAILED scraper (timeout,
                # network error) must NOT be interpreted as "company is in the
                # debtor list" — that creates false positives.
                src_status = getattr(src, 'status', 'SUCCESS')
                findings = (src.findings or "").upper()
                if src_status != 'SUCCESS':
                    has_record = False
                else:
                    has_record = ("ŽIADNY ZÁZNAM" not in findings
                                  and "NENAŠLI SA ŽIADNE ZÁZNAMY" not in findings
                                  and "NENAŠLI ŽIADNE" not in findings)
                _scraper_results[st_type] = {"has_record": has_record}
    _state_liabilities_alert = compute_state_liabilities_alert(_stmts_as_dicts, scraper_results=_scraper_results)
    _state_liabilities_alert = _translate_state_liabilities_alert(_state_liabilities_alert, i18n_strings)
    _rpe_alert = compute_revenue_per_employee_alert(_stmts_as_dicts)
    _yoy_table = compute_yoy_summary_table(_stmts_as_dicts, i18n_strings=i18n_strings)

    # Fallbacky kritických agentov — varovanie v reporte ak Chief/QA bežal na slabšom modeli
    _critical_fallbacks = get_critical_fallbacks()

    return {
        "company": company,
        "verdict": verdict,
        "evidence_list": evidence_list,
        "latest_stmt": latest_stmt,
        "stmts_sorted": stmts_sorted,
        "ebitda_by_year": ebitda_by_year,
        "latest_ratios": latest_ratios,
        "gross_profit_estimated": gross_profit_estimated,
        "gross_profit_all_estimated": gross_profit_all_estimated,
        "estimated_gp_years": estimated_gp_years,
        "cashflow_estimated": cashflow_estimated,
        "has_cashflow_data": has_cashflow_data,
        "nace_code": nace_code,
        "nace_text": nace_text,
        "employee_count": employee_count,
        "employee_count_estimated": employee_count_estimated,
        "vestnik_events": vestnik_events,
        "chart_image_base64": chart_base64,
        "balance_chart_base64": balance_chart_base64,
        "pnl_chart_base64": pnl_chart_base64,
        "cashflow_chart_base64": cashflow_chart_base64,
        "altman_chart_base64": generate_altman_chart(altman_scores, lang=report_language) if altman_scores else "",
        "logo_base64": logo_base64,
        "start_pages_map": start_pages_map or {},
        "total_pages": total_pages,
        "generated_at": generated_at,
        "counts": counts,
        "grouped_sources": grouped_sources,
        "critical_sources": critical_sources,
        "labels": {k: i18n_strings.get(v, k) for k, v in SOURCE_LABEL_I18N_KEYS.items()},
        "scorecard_breakdown": scorecard_breakdown,
        "algorithmic_total": algorithmic_total,
        "det_breakdown": det_breakdown,
        "hard_stop": any("HARD STOP" in (p.get("detail") or "") for p in scorecard_breakdown),
        "altman_scores": altman_scores,
        "is_financial_institution": is_financial_institution,
        "is_startup": is_startup,
        "startup_info": startup_info,
        "has_mixed_consolidation": has_mixed_consolidation,
        "financial_basis": financial_basis,
        "has_non_standard_months": has_non_standard_months,
        "has_short_history": has_short_history,
        "has_balance_imbalance": has_balance_imbalance,
        "piotroski_score": piotroski_result.get("score"),
        "piotroski_flags": piotroski_result.get("flags", []),
        "beneish_m_score": beneish_m_score,
        "beneish_is_manipulator": beneish_is_manipulator,
        "beneish_flags": beneish_flags,
        "yoy_revenue_growth": yoy_revenue_growth,
        "yoy_profit_growth": yoy_profit_growth,
        "trend_ratios": trend_ratios,
        "ratios_chart_base64": ratios_chart_base64,
        "radar_chart_base64": radar_chart_base64,
        "auditor_opinion": auditor_opinion,
        "forensic_findings": forensic_findings,
        "bs_source_gap": getattr(latest_stmt, 'dataQualityStatus', None) == 'SOURCE_GAP' if latest_stmt else False,
        "gauge_end_x": gauge_end_x,
        "gauge_end_y": gauge_end_y,
        "gauge_large_arc": gauge_large_arc,
        "cf_waterfall_base64": cf_waterfall_base64,
        "bs_infographic_base64": bs_infographic_base64,
        "pl_infographic_base64": pl_infographic_base64,
        "liquidity_chart_base64": liquidity_chart_base64,
        "employee_chart_base64": employee_chart_base64,
        "rpe_chart_base64": rpe_chart_base64,
        "asset_composition_chart_base64": asset_composition_chart_base64,
        "equity_composition_chart_base64": equity_composition_chart_base64,
        "statement_delay_days": statement_delay_days,
        "qr_base64": qr_base64,
        "valid_until": valid_until,
        "confidence_score": confidence_score,
        "confidence_factors": confidence_factors,
        "company_city": company_city,
        "company_founded_year": company_founded_year,
        "revenue_per_employee": revenue_per_employee,
        "report_language": report_language,
        "i18n": get_i18n_strings(report_language),
        "insolvency_score": _insolvency,
        "fraud_heatmap": _fraud_heatmap,
        "strengths_weaknesses": _strengths_weaknesses,
        "state_liabilities_alert": _state_liabilities_alert,
        "rpe_alert": _rpe_alert,
        "yoy_table": _yoy_table,
        "critical_fallbacks": _critical_fallbacks,
        "coverage_successful": _successful_sources,
        "coverage_total": _ACTIVE_SCRAPER_COUNT,
        "coverage_uncontrolled": len(_uncontrolled_sources),
        "uncontrolled_sources": _uncontrolled_sources,
        "company_persons": company_persons,
        "persons_statutar": _persons_statutar,
        "persons_spolocnik": _persons_spolocnik,
    }

def render_html_report(context: dict) -> str:
    current_dir = Path(__file__).parent
    templates_dir = current_dir / "templates"
    font_dir = current_dir / "pdf" / "fonts"
    context['font_dir'] = str(font_dir.absolute())
    context['tailwind_dir'] = str(templates_dir.absolute())
    env = Environment(loader=FileSystemLoader(templates_dir))
    env.filters['format_currency'] = format_currency
    env.filters['format_number'] = format_number
    env.filters['format_number_millions'] = format_number_millions
    env.filters['format_cf_millions'] = format_cf_millions
    env.filters['format_findings'] = lambda source, i18n=None: format_findings(source, i18n or context.get('i18n', {}))
    env.filters['sanitize_llm'] = sanitize_llm_text
    
    template = env.get_template("report_template.html")
    return template.render(**context)

async def render_pdf_via_playwright(html_content: str, pdf_path: str, ico: str):
    logger.info(f"Spúšťam Playwright pre konverziu do PDF ({pdf_path})...")
    dir_name = os.path.dirname(pdf_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
    # Unikátny názov .html — zabraňuje kolízii pri súbežných reportoch rovnakého IČO
    _base = pdf_path[:-4] if pdf_path.endswith('.pdf') else pdf_path
    html_path = os.path.abspath(f"{_base}.{os.getpid()}.{int(time.time() * 1000)}.html")
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            "--disable-gpu", "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-extensions",
            "--no-first-run",
        ])
        page = await browser.new_page()
        try:
            await page.goto(f"file://{html_path}", wait_until="domcontentloaded", timeout=30000)
            try:
                await page.wait_for_function(
                    "() => { const styles = document.querySelectorAll('style'); for (const s of styles) { if (s.textContent.includes('--tw') || s.textContent.includes('.container')) return true; } return false; }",
                    timeout=10000
                )
            except Exception:
                logger.warning("Tailwind JIT styles neboli detekované včas — pokračujem bez čakania")
            try:
                await page.evaluate("async () => { await document.fonts.ready; }")
            except Exception:
                pass
            try:
                await page.wait_for_function(
                    "() => document.fonts.check('10px Inter') && document.fonts.check('bold 10px Inter') && document.fonts.check('10px \"DejaVu Sans\"')",
                    timeout=10000
                )
            except Exception:
                pass
            await page.emulate_media(media="print")
            try:
                await asyncio.wait_for(
                    page.pdf(
                        path=pdf_path,
                        format="A4",
                        margin={"top": "12mm", "bottom": "18mm", "left": "0mm", "right": "0mm"},
                        print_background=True,
                        display_header_footer=False,
                        prefer_css_page_size=True,
                    ),
                    timeout=120,
                )
            except asyncio.TimeoutError:
                logger.error(f"Playwright page.pdf() timeout (120s) — HTML pravdepodobne príliš veľký")
                raise
        finally:
            # Explicit page close prevents resource leaks if PDF generation throws
            try:
                await page.close()
            except Exception:
                pass
            await browser.close()
    try:
        os.remove(html_path)
    except Exception:
        pass
    logger.info(f"PDF úspešne vygenerované: {pdf_path}")
    return pdf_path

async def generate_forensic_pdf_report(
    ico: str,
    sources: Optional[list] = None,
    start_pages_map: Optional[dict] = None,
    total_pages: int = 0,
    generated_at: str = "",
    target_path: str = "",
    report_language: str = "sk",
    vestnik_date_from: Optional[str] = None,
    company_name_override: Optional[str] = None,
):
    logger.info(f"Generujem HTML/PDF report pre IČO: {ico} (report_language={report_language})")
    db = get_db()

    # Fallback: ak generated_at alebo total_pages chýbajú (napr. pri priamom volaní
    # bez PdfCompiler), doplníme rozumné defaulty, aby cover page nezobrazovala
    # prázdne hodnoty ("Vygenerované: " / "Počet strán: 0").
    if not generated_at:
        from datetime import datetime
        try:
            from zoneinfo import ZoneInfo
            generated_at = datetime.now(ZoneInfo("Europe/Bratislava")).strftime("%d.%m.%Y %H:%M:%S")
        except Exception:
            generated_at = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        logger.warning(f"[REPORT] generated_at bol prázdny — fallback na {generated_at}")
    if total_pages <= 0:
        # Odhad: cover page (7-8) + divider (1) + zdroje (0 ak žiadne)
        total_pages = 8
        logger.warning(f"[REPORT] total_pages bol 0 — fallback na {total_pages}")

    try:
        company = await db.company.find_unique(
            where={'ico': ico},
            include={
                'auditVerdict': True,
                'financialStatements': {'orderBy': {'year': 'asc'}, 'include': {'auditorOpinion': True, 'narrativeRisk': True, 'notesRisk': True}},
                'vestnikEvents': {'orderBy': {'publishedAt': 'desc'}},
                'companyEvents': True,
                'companyPersons': True,
            }
        )
        
        if not company or not company.auditVerdict:
            logger.error(f"Nedostatok dát pre generovanie PDF (IČO: {ico})")
            return None

        if company_name_override and company_name_override != company.name:
            logger.info(f"[REPORT] Overriding company name: '{company.name}' → '{company_name_override}'")
            company.name = company_name_override

        context = prepare_report_context(company, sources, start_pages_map, total_pages, generated_at, report_language=report_language, vestnik_date_from=vestnik_date_from)
        html_content = render_html_report(context)

        pdf_path = target_path or f"assets/{ico}/Verifa_Forensic_Report_{ico}.pdf"
        await render_pdf_via_playwright(html_content, pdf_path, ico)

        return pdf_path

    finally:
        pass


async def generate_financial_summary_pdf(ico: str, target_path: str) -> Optional[str]:
    """Vygeneruje 1-2 strany s finančným prehľadom z DB dát (FinancialStatement).
    Používa sa pre IFRS firmy, kde registeruz.sk nezobrazuje štruktúrované HTML."""
    db = get_db()
    try:
        company = await db.company.find_unique(
            where={'ico': ico},
            include={
                'financialStatements': {
                    'orderBy': {'year': 'asc'},
                    'include': {'auditorOpinion': True},
                },
            },
        )
        if not company or not company.financialStatements:
            logger.warning(f"[FIN_SUMMARY] Žiadne finančné výkazy pre IČO {ico}")
            return None

        stmts = sorted(company.financialStatements, key=lambda s: s.year, reverse=True)[:5]
        stmts, _ = _filter_consolidation_consistency(stmts)
        stmts.sort(key=lambda s: s.year)
        latest = stmts[-1]
        years = [s.year for s in stmts]

        def _fmt(val) -> str:
            if val is None:
                return "—"
            return f"{float(val) / 1_000_000:,.2f} M €".replace(",", "X").replace(".", ",").replace("X", " ")

        rows_balance = [
            ("Celkové aktíva", [s.totalAssets for s in stmts]),
            ("Obežný majetok", [s.currentAssets for s in stmts]),
            ("Vlastné imanie", [s.equity for s in stmts]),
            ("Krátkodobé záväzky", [s.shortTermLiabilities for s in stmts]),
            ("Dlhodobé záväzky", [s.longTermLiabilities for s in stmts]),
            ("Pohľadávky z obch. styku", [s.tradeReceivables for s in stmts]),
            ("Záväzky z obch. styku", [s.tradePayables for s in stmts]),
        ]

        rows_pnl = [
            ("Tržby z hlavnej činnosti", [s.mainActivityRevenue for s in stmts]),
            ("Hrubá marža", [s.grossProfit for s in stmts]),
            ("Čistý zisk/strata", [s.netProfitLoss for s in stmts]),
            ("Osobné náklady", [s.staffCosts for s in stmts]),
            ("Peniaze a peňažné ekvivalenty", [s.cashAndEquivalents for s in stmts]),
            ("Prevádzkové cash flow", [s.operatingCashFlow for s in stmts]),
        ]

        def _table_rows(rows):
            html = ""
            for label, vals in rows:
                cells = "".join(f"<td style='text-align:right;padding:6px 10px;border-bottom:1px solid #e2e8f0;'>{_fmt(v)}</td>" for v in vals)
                html += f"<tr><td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#334155;'>{label}</td>{cells}</tr>"
            return html

        year_headers = "".join(f"<th style='text-align:right;padding:6px 10px;color:#64748b;font-size:11px;'>{y}</th>" for y in years)

        audit_text = ""
        if latest.auditorOpinion:
            ao = latest.auditorOpinion
            audit_text = f"<p style='font-size:11px;color:#64748b;margin-top:8px;'>Názor audítora ({latest.year}): <strong>{ao.opinionType}</strong>"
            if ao.goingConcernRisk:
                audit_text += f" — {ao.goingConcernRisk}"
            if ao.reservationText:
                audit_text += f" — {ao.reservationText}"
            audit_text += "</p>"

        stmt_type = latest.statementType or "IFRS"
        consolidated = "Konsolidovaná" if latest.isConsolidated else "Individuálna"

        font_dir = str((Path(__file__).parent / "pdf" / "fonts").absolute())
        html_content = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@font-face {{
    font-family: 'Inter';
    src: url('file://{font_dir}/Inter-Regular.ttf') format('truetype');
    font-weight: 400;
    font-display: swap;
}}
@font-face {{
    font-family: 'Inter';
    src: url('file://{font_dir}/Inter-Bold.ttf') format('truetype');
    font-weight: 700;
    font-display: swap;
}}
@font-face {{
    font-family: 'DejaVu Sans';
    src: url('file://{font_dir}/DejaVuSans.ttf') format('truetype');
    font-weight: 400;
    font-display: swap;
}}
body {{ font-family: 'Inter', 'DejaVu Sans', 'Segoe UI', system-ui, sans-serif; color: #1e293b; margin: 0; padding: 20px 30px; }}
h1 {{ font-size: 18px; color: #0f172a; margin: 0 0 4px 0; }}
h2 {{ font-size: 13px; color: #475569; margin: 20px 0 8px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }}
.meta {{ font-size: 11px; color: #94a3b8; margin-bottom: 16px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
th {{ text-align: left; padding: 6px 10px; color: #64748b; font-size: 11px; }}
.note {{ font-size: 10px; color: #94a3b8; margin-top: 12px; }}
</style></head>
<body>
<h1>Finančný prehľad — {company.name or f'Spoločnosť s IČO {ico}'}</h1>
<div class="meta">IČO: {ico} &nbsp;|&nbsp; Typ: {stmt_type} ({consolidated}) &nbsp;|&nbsp; Obdobie: {years[0]}–{years[-1]}</div>

<h2>Súvaha</h2>
<table>
<thead><tr><th style='text-align:left;padding:6px 10px;color:#64748b;font-size:11px;'>Položka (v EUR)</th>{year_headers}</tr></thead>
<tbody>{_table_rows(rows_balance)}</tbody>
</table>

<h2>Výkaz ziskov a strát</h2>
<table>
<thead><tr><th style='text-align:left;padding:6px 10px;color:#64748b;font-size:11px;'>Položka (v EUR)</th>{year_headers}</tr></thead>
<tbody>{_table_rows(rows_pnl)}</tbody>
</table>

{audit_text}
<p class="note">Zdroj: Register účtovných závierok (registeruz.sk) — údaje extrahované z IFRS PDF závierky pomocou automatizovanej analýzy textu. Štruktúrované HTML tabuľky nie sú dostupné pre IFRS účtovné jednotky.</p>
<p class="note">EBITDA = Čistý zisk + Daň z príjmov + Náklady na úroky + Odpisy. Zaokrúhlenie na celé tisíce môže spôsobiť drobné odchýlky vo výpočte.</p>
</body></html>"""

        await render_pdf_via_playwright(html_content, target_path, ico)
        logger.info(f"[FIN_SUMMARY] Vygenerovaný finančný prehľad pre IČO {ico} → {target_path}")
        return target_path

    except Exception as e:
        logger.error(f"[FIN_SUMMARY] Chyba pre IČO {ico}: {e}", exc_info=True)
        return None
    finally:
        pass

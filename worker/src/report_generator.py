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
from prisma import Prisma
from jinja2 import Environment, FileSystemLoader
from src.i18n import get_i18n_strings
from src.infographics import generate_pl_infographic, generate_balance_sheet_infographic, generate_cashflow_waterfall

from src.plotly_charts import (
    generate_financial_chart,
    generate_balance_sheet_chart,
    generate_pnl_chart,
    generate_cashflow_chart,
    generate_liquidity_chart,
    generate_altman_chart,
    generate_ratios_trend_chart,
    generate_radar_chart,
    generate_debt_donut
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

def format_currency(value: float) -> str:
    """Naformátuje číslo ako menu (napr. 1 234 567 €). Ak je None, vráti '—'."""
    if value is None:
        return "—"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f} mil. €".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.1f} tis. €".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f} €".replace(",", " ")
    except (ValueError, TypeError):
        return "—"

def format_number(value: float) -> str:
    """Vráti číslo bez menovej prípony — pre tabuľky kde je jednotka uvedená v hlavičke."""
    if value is None:
        return "—"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f}".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.0f}".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f}".replace(",", " ")
    except (ValueError, TypeError):
        return "—"

def format_number_millions(value: float, treat_zero_as_none: bool = False) -> str:
    """Vráti číslo v miliónoch s 2 desatinnými miestami — pre tabuľky s mixom veľkých a malých hodnôt.
    Zabraňuje zmiešavaniu miliónov a tisícov v jednej tabuľke.
    Ak treat_zero_as_none=True, nula sa zobrazí ako '—' (pre cash flow polia, kde 0 = chýbajúce dáta)."""
    if value is None:
        return "—"
    if treat_zero_as_none and value == 0:
        return "—"
    try:
        val = float(value)
        return f"{val / 1_000_000:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ")
    except (ValueError, TypeError):
        return "—"

def format_cf_millions(value: float) -> str:
    """Wrapper pre format_number_millions s treat_zero_as_none=True.
    Pre cash flow polia: 0 znamená chýbajúce dáta, nie nulový cash flow."""
    return format_number_millions(value, treat_zero_as_none=True)

def sanitize_llm_text(text: str) -> str:
    """Sanitizuje LLM generovaný text pre PDF rendering.
    - Odstráni LaTeX $...$ syntax a nahradí ju plain textom
    - Opraví časté preklepy slovenských slov
    - Konvertuje Unicode znaky, ktoré by sa mohli skomiť
    """
    if not text:
        return text
    # LaTeX $...$ → plain text (zachová vnútro)
    text = re.sub(r'\$([^$]+)\$', r'\1', text)
    # LaTeX ^{...} a _{...} → plain text
    text = re.sub(r'\^[\{]([^}]+)[\}]', r'\1', text)
    text = re.sub(r'\^\{([^}]+)\}', r'\1', text)
    text = re.sub(r'\\prime\\prime', "''", text)
    text = re.sub(r"\\prime", "'", text)
    text = re.sub(r"\\pm", "+/-", text)
    text = re.sub(r"\\times", "x", text)
    text = re.sub(r"\\leq", "<=", text)
    text = re.sub(r"\\geq", ">=", text)
    text = re.sub(r"\\neq", "!=", text)
    text = re.sub(r"\\approx", "~", text)
    # Bežné preklepy z LLM
    text = text.replace("dižnik", "dlžník").replace("dižníkov", "dlžníkov")
    text = text.replace("bezúhonnost", "bezúhonnosť")
    text = text.replace("Interpretica", "Interpretácia")
    text = text.replace("Rezpečná", "Bezpečná")
    text = text.replace("Plotroski", "Piotroski")
    text = re.sub(r'F-score:\s*(\d)/B\b', r'F-score: \1/8', text)
    return text

def format_findings(source, i18n=None) -> str:
    fallback = (i18n or {}).get("no_records", "Bez záznamu.")
    raw = source.findings or source.message or fallback
    raw = sanitize_llm_text(raw)

    # ── Comprehensive scraper findings translation ──
    if i18n:
        raw = _translate_scraper_findings(raw, i18n)

    max_chars = 350
    if len(raw) > max_chars:
        truncated = raw[:max_chars]
        last_nl = truncated.rfind("\n")
        if last_nl > 100:
            truncated = truncated[:last_nl]
        raw = truncated + "\n" + (i18n or {}).get("findings_truncated", "… (ďalšie záznamy v PDF výpise)")

    findings = xml_escape(raw)
    findings = findings.replace("\n", "<br/>")

    findings = re.sub(
        r'(https?://[^\s&lt;&gt;]+)',
        r'<a href="\1" class="text-blue-600 hover:underline">' + (i18n or {}).get("findings_view_detail", "[Zobraziť detail]") + r'</a>',
        findings,
    )

    _KEY_PATTERN = re.compile(
        r'(?m)^(Oprávnený|Povinný|Sídlo|IČO|DIČ|Predmet|Dátum|Stav|'
        r'Typ|Spoločnosť|Meno|Priezvisko|Dátum narodenia|'
        r'Vyrubená daň|Daňová strata|Spoľahlivosť|'
        r'Exekútor|Spôsob|Predmet exekúcie|'
        r'Záložný veriteľ|Záložný dlžník|Predmet záložného práva|'
        r'Dražobník|Dražba|Najvyššie prihodenie|'
        r'Prihlasovateľ|Značka|Registračné číslo|'
        r'Účastník konania|Dôvod diskvalifikácie|'
        r'Rozhodnutie|Súd|Spisová značka|Dátum právoplatnosti|'
        r'Legal form|Date of establishment|Rechtsform|Gründungsdatum|'
        r'IČ DPH|DIČ|Obec|PSČ|Ulica|Štát|'
        r'Zdaňovacie obdobie|Uplatnený nadmerný odpočet|Priznaná vlastná daňová povinnosť'
        r')\s*:',
    )
    findings = _KEY_PATTERN.sub(r'<b>\1:</b>', findings)

    is_info_source = source.source_type in {"CRZ", "RPVS", "UVO", "REGISTER_UZ", "ROZHODNUTIA"}
    warning_label = (i18n or {}).get("findings_warning", "POZOR")
    info_label = (i18n or {}).get("findings_info", "INFO")
    if "POZOR" in findings:
        if is_info_source:
            findings = findings.replace("POZOR!", f'<span class="text-blue-600 font-bold">{info_label}:</span>')
            findings = findings.replace("POZOR:", f'<span class="text-blue-600 font-bold">{info_label}:</span>')
            findings = findings.replace("POZOR", f'<span class="text-blue-600 font-bold">{info_label}</span>')
        else:
            findings = findings.replace("POZOR!", f'<span class="text-rose-600 font-bold">{warning_label}!</span>')
            findings = findings.replace("POZOR:", f'<span class="text-rose-600 font-bold">{warning_label}:</span>')
            findings = findings.replace("POZOR", f'<span class="text-rose-600 font-bold">{warning_label}</span>')

    reliable_high = (i18n or {}).get("findings_reliable_high", "vysoko spoľahlivý")
    reliable_low = (i18n or {}).get("findings_reliable_low", "menej spoľahlivý")
    reliable_medium = (i18n or {}).get("findings_reliable_medium", "spoľahlivý")
    findings = re.sub(re.escape(reliable_high), r'<span class="text-emerald-600 font-bold">\g<0></span>', findings)
    findings = re.sub(re.escape(reliable_low), r'<span class="text-rose-600 font-bold">\g<0></span>', findings)
    findings = re.sub(r'(?<!' + re.escape(reliable_high.split()[0]) + r' )(?!' + re.escape(reliable_low.split()[0]) + r' )' + re.escape(reliable_medium), r'<span class="text-amber-500 font-bold">\g<0></span>', findings)
    tax_assessed = (i18n or {}).get("findings_tax_assessed", "Vyrubená daň")
    tax_loss = (i18n or {}).get("findings_tax_loss", "Daňová strata")
    findings = re.sub(re.escape(tax_assessed) + r':\s*(?!0[.,]00)([\d.,\s]+\s*EUR)', r'<span class="text-emerald-600 font-bold">' + tax_assessed + r': \1</span>', findings)
    findings = re.sub(re.escape(tax_loss) + r':\s*(?!0[.,]00)([\d.,\s]+\s*EUR)', r'<span class="text-rose-600 font-bold">' + tax_loss + r': \1</span>', findings)

    return findings


# ── Scraper findings translation map ──
# (regex_pattern, i18n_key, optional_format_kwargs_extractor)
_FINDINGS_TRANSLATIONS = [
    # Debtor lists
    (r"Žiadny záznam — subjekt nie je v zozname dlžníkov VšZP\.", "scr_no_record_debtors", {"source": "VšZP"}),
    (r"Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení\.", "scr_no_record_debtors", {"source": "Social Insurance"}),
    (r"Žiadny záznam — subjekt nie je v zozname dlžníkov UNION\.", "scr_no_record_debtors", {"source": "UNION"}),
    (r"Žiadny záznam — subjekt nie je v zozname dlžníkov Dôvery\.", "scr_no_record_debtors", {"source": "Dôvera"}),
    # Insolvency
    (r"Subjekt nemá negatívne záznamy v registri úpadcov(?:\s*\(Stav neurčený\))?\.", "scr_no_negative_records_insolvency", {}),
    (r"Nájdený záznam v insolvenčnom registri — POZOR!.*", "scr_found_insolvency", {}),
    (r"Žiadny záznam v registri úpadcov.*", "scr_no_negative_records_insolvency", {}),
    # DPH
    (r"Žiadny záznam — subjekt nie je v zozname daňových subjektov registrovaných pre DPH\.", "scr_not_in_dph_registered", {}),
    (r"Žiadny záznam — subjekt nie je v zozname vymazaných platiteľov DPH\.", "scr_not_in_dph_removed", {}),
    (r"Žiadny záznam — subjekt nie je v zozname platiteľov DPH s dôvodmi na zrušenie registrácie\.", "scr_not_in_dph_cancellation", {}),
    (r"Žiadny záznam — subjekt nie je v zozname DPH subjektov s nadmerným odpočtom\.", "scr_not_in_dph_excess", {}),
    # Tax
    (r"Žiadny záznam — subjekt nie je v zozname daňových subjektov s indexom daňovej spoľahlivosti\.", "scr_not_in_tax_reliability", {}),
    (r"Žiadny záznam v zozname daňových dlžníkov — subjekt nemá daňové nedoplatky\.", "scr_no_tax_debts", {}),
    (r"Žiadny záznam — subjekt nie je v zozname daňových subjektov registrovaných na daň z príjmov\.", "scr_not_in_income_tax_registered", {}),
    (r"Žiadny záznam — subjekt nie je v zozname subjektov s výškou dane z príjmov právnickej osoby\.", "scr_not_in_income_tax_amount", {}),
    # Notarial registers
    (r"Subjekt nie je evidovaný v Notárskom centrálnom registri záložných práv\.", "scr_not_in_ncrzp", {}),
    (r"Subjekt nie je evidovaný v Notárskom centrálnom registri dražieb\.", "scr_not_in_ncrd", {}),
    # Generic
    (r"Žiadny záznam — subjekt nie je v zozname\.", "scr_not_in_list_generic", {}),
    (r"Žiadny záznam v Živnostenskom registri SR\.", "scr_no_zrsr_record", {}),
    (r"Žiadny záznam v Centrálnom registri zmlúv\.", "scr_no_crz_contracts", {}),
    (r"Žiadny záznam v registri Úradu pre verejné obstarávanie\.", "scr_no_uvo_records", {}),
    # ORSR
    (r"Kritériám vyhľadávania nezodpovedá žiadny záznam — IČO neexistuje v ORSR\.", "scr_orsr_no_match", {}),
    (r"Záznam neexistuje alebo nebol nájdený\.", "scr_orsr_not_found", {}),
    (r"Aktívna spoločnosť v ORSR \(bez zistených anomálií\)\.", "scr_orsr_active", {}),
    # RPVS
    (r"Subjekt nie je evidovaný ako partner verejného sektora\.", "scr_not_public_sector_partner", {}),
    (r"Subjekt je evidovaný ako partner verejného sektora \(Koneční užívatelia výhod uvedení vo výpise\)\.", "scr_rpvs_partner", {}),
    # Court decisions
    (r"Za ostatné obdobie sa nenašli rozhodnutia súdov\.", "scr_no_court_decisions", {}),
    (r"POZOR:\s*Za ostatné obdobie sa našli rozhodnutia súdov \((.*?)\)\.\s*Odporúčame urobiť kontrolu\.", "scr_found_court_decisions", {}),
    (r"INFO:\s*Za ostatné obdobie sa našli rozhodnutia súdov \((.*?)\)\.\s*Odporúčame urobiť kontrolu\.", "scr_court_decisions_found", {}),
    # Disqualifications
    (r"Neboli k dispozícii žiadne osoby z ORSR na porovnanie s registrom diskvalifikácií\.", "scr_no_disqualifications", {}),
    # Data unavailable
    (r"Dáta dočasne nedostupné — skúste vygenerovať report znovu\.", "scr_data_unavailable", {}),
    # ZRSR unavailable
    (r"ZRSR portál vrátil 'Odkaz je neplatný' — výpis nie je dostupný\.", "scr_zrsr_unavailable", {}),
    # Poverenia
    (r"Na uvedené IČO: (\d+) nebolo nájdené žiadne poverenie.*", "scr_no_poverenie", {}),
    # DPH registered / excess / income tax (with IČO)
    (r"Subjekt \(IČO: (\d+)\) je registrovaný pre DPH\.", "scr_dph_registered", {}),
    (r"Subjekt \(IČO: (\d+)\) je v zozname DPH subjektov s nadmerným odpočtom\.", "scr_dph_excess_found", {}),
    (r"Subjekt \(IČO: (\d+)\) je registrovaný na daň z príjmov(?:\s*\(detaily v PDF\))?\.", "scr_income_tax_registered", {}),
    # RPO
    (r"Subjekt \(IČO: (\d+)\) je v Registri právnických osôb.*", "scr_rpo_found", {}),
    (r"Právna forma: (.+)", "scr_legal_form", {}),
    (r"Dátum vzniku: (.+)", "scr_founded_date", {}),
    # CRZ / UVO with counts
    (r"INFO:\s*Pre IČO (\d+) sa našlo (\d+) zmlúv v CRZ \(zobrazených na (\d+) stranách\)\.\s*Odporúčame skontrolovať zmluvy v vygenerovanom PDF\.", "scr_crz_contracts_found", {}),
    (r"POZOR:\s*Pre IČO (\d+) sa našlo (\d+) zmlúv v CRZ \(zobrazených na (\d+) stranách\)\.\s*Odporúčame skontrolovať zmluvy v vygenerovanom PDF\.", "scr_crz_contracts_found_warn", {}),
    (r"INFO:\s*Pre IČO (\d+) sa našlo (\d+) záznamov v UVO \(zobrazených na (\d+) stranách\)\.\s*Odporúčame skontrolovať záznamy vo vygenerovanom PDF\.", "scr_uvo_records_found", {}),
    (r"POZOR:\s*Pre IČO (\d+) sa našlo (\d+) záznamov v UVO \(zobrazených na (\d+) stranách\)\.\s*Odporúčame skontrolovať záznamy vo vygenerovanom PDF\.", "scr_uvo_records_found_warn", {}),
    # Register účtovných závierok
    (r"Účtovná závierka nájdená pre IČO (\d+) v Registri účtovných závierok\.", "scr_registeruz_found", {}),
    # Tax reliability rating (with IČO and company name)
    (r"IČO:\s*(\d+)\s*[-—]\s*(.+?)\s*[-—]\s*Hodnotenie:\s*vysoko spoľahlivý", "scr_tax_reliability_high", {}),
    (r"IČO:\s*(\d+)\s*[-—]\s*(.+?)\s*[-—]\s*Hodnotenie:\s*menej spoľahlivý", "scr_tax_reliability_low", {}),
    (r"IČO:\s*(\d+)\s*[-—]\s*(.+?)\s*[-—]\s*Hodnotenie:\s*spoľahlivý", "scr_tax_reliability_medium", {}),
]


def _translate_scraper_findings(raw: str, i18n: dict) -> str:
    """Translate known Slovak scraper findings to the report language."""
    for pattern, i18n_key, extra_kwargs in _FINDINGS_TRANSLATIONS:
        m = _re.search(pattern, raw)
        if m:
            template = i18n.get(i18n_key, raw)
            kwargs = dict(extra_kwargs)
            # Extract format args from regex groups
            groups = m.groups()
            if i18n_key == "scr_no_poverenie" and groups:
                kwargs["ico"] = groups[0]
            elif i18n_key in ("scr_dph_registered", "scr_dph_excess_found", "scr_income_tax_registered", "scr_rpo_found", "scr_registeruz_found") and groups:
                kwargs["ico"] = groups[0]
            elif i18n_key in ("scr_found_court_decisions", "scr_court_decisions_found") and groups:
                kwargs["parts"] = groups[0]
            elif i18n_key in ("scr_crz_contracts_found", "scr_crz_contracts_found_warn") and len(groups) >= 3:
                kwargs["ico"] = groups[0]
                kwargs["count"] = groups[1]
                kwargs["pages"] = groups[2]
            elif i18n_key in ("scr_uvo_records_found", "scr_uvo_records_found_warn") and len(groups) >= 3:
                kwargs["ico"] = groups[0]
                kwargs["count"] = groups[1]
                kwargs["pages"] = groups[2]
            elif i18n_key == "scr_legal_form" and groups:
                kwargs["val"] = groups[0]
            elif i18n_key == "scr_founded_date" and groups:
                kwargs["val"] = groups[0]
            elif i18n_key in ("scr_tax_reliability_high", "scr_tax_reliability_low", "scr_tax_reliability_medium") and len(groups) >= 2:
                kwargs["ico"] = groups[0]
                kwargs["name"] = groups[1]
            try:
                return template.format(**kwargs)
            except (KeyError, IndexError):
                return template
    return raw


# ── Scorecard pillar name mapping (Slovak stored → i18n key) ──
_PILLAR_NAME_MAP = {
    "Platobná schopnosť & Exekúcie": "pillar_payment",
    "Finančné zdravie": "pillar_financial",
    "Ziskovosť, Stabilita a Cash Flow": "pillar_profitability",
    "Rast & Trendová sila": "pillar_growth",
    "Právna bezúhonnosť": "pillar_legal",
    "Forenzný indikátor: Biely Kôň": "pillar_forensic",
    "Data Quality Multiplier": "pillar_dq",
}

# ── Flag/detail translation patterns ──
import re as _re

def _translate_flag(flag: str, i18n_strings: dict) -> str:
    """Translate a single scorecard flag from Slovak to the report language."""
    # Current ratio flags
    if flag == "Current ratio: N/A (bez dát)":
        return i18n_strings.get("flag_cr_na", flag)
    m = _re.match(r"Current ratio: ([\d.]+) — výborná likvidita", flag)
    if m: return i18n_strings.get("flag_cr_excellent", flag).format(val=m.group(1))
    m = _re.match(r"Current ratio: ([\d.]+) — dostatočná likvidita", flag)
    if m: return i18n_strings.get("flag_cr_sufficient", flag).format(val=m.group(1))
    m = _re.match(r"Current ratio: ([\d.]+) — problematická likvidita", flag)
    if m: return i18n_strings.get("flag_cr_problematic", flag).format(val=m.group(1))
    m = _re.match(r"Current ratio: ([\d.]+) — kritická likvidita", flag)
    if m: return i18n_strings.get("flag_cr_critical", flag).format(val=m.group(1))
    # Equity flags
    if flag == "Vlastné imanie: N/A":
        return i18n_strings.get("flag_equity_na", flag)
    m = _re.match(r"Vlastné imanie: kladné \(E/D = ([\d.]+)\)", flag)
    if m: return i18n_strings.get("flag_equity_positive", flag).format(val=m.group(1))
    m = _re.match(r"Vlastné imanie: ZÁPORNÉ \(E/D = ([\d.]+)\)", flag)
    if m: return i18n_strings.get("flag_equity_negative", flag).format(val=m.group(1))
    # Vestnik flags
    if flag == "Vestník: žiadne kritické udalosti":
        return i18n_strings.get("flag_vestnik_none", flag)
    if flag == "Vestník: staré kritické/vysoké udalosti (znížená váha)":
        return i18n_strings.get("flag_vestnik_old", flag)
    m = _re.match(r"Vestník: aktívne kritické/vysoké udalosti \(penalizácia ([\d.]+)x\)", flag)
    if m: return i18n_strings.get("flag_vestnik_active", flag).format(val=m.group(1))
    # Altman flags
    if flag == "Altman Z'': N/A":
        return i18n_strings.get("flag_altman_na", flag)
    m = _re.match(r"Altman Z'' = ([\d.]+) — Bezpečná zóna", flag)
    if m: return i18n_strings.get("flag_altman_safe", flag).format(val=m.group(1))
    m = _re.match(r"Altman Z'' = ([\d.]+) — Šedá zóna", flag)
    if m: return i18n_strings.get("flag_altman_grey", flag).format(val=m.group(1))
    m = _re.match(r"Altman Z'' = ([\d.]+) — Núdzová zóna", flag)
    if m: return i18n_strings.get("flag_altman_distress", flag).format(val=m.group(1))
    # Piotroski
    if flag == "Piotroski F-score: N/A":
        return i18n_strings.get("flag_piotroski_na", flag)
    # Startup
    m = _re.match(r"STARTUP profil: .* imaním ([\d,.]+) €\)", flag)
    if m: return i18n_strings.get("flag_startup_profile", flag).format(val=m.group(1))
    # Data void
    if flag == "DATA VOID: Kľúčové finančné metriky nedostupné":
        return i18n_strings.get("flag_data_void", flag)
    # Profitability
    m = _re.match(r"Ziskovosť: (\d+)/(\d+) rokov v zisku", flag)
    if m: return i18n_strings.get("flag_profitability", flag).format(p=m.group(1), n=m.group(2))
    # Cash flow
    if flag == "Cash Flow: Silný (CF/Rev > 10%)":
        return i18n_strings.get("flag_cf_strong", flag)
    if flag == "Cash Flow: Kladný":
        return i18n_strings.get("flag_cf_positive", flag)
    if flag.startswith("Cash Flow: Záporný"):
        return i18n_strings.get("flag_cf_negative", flag)
    if flag == "Cash Flow: N/A":
        return i18n_strings.get("flag_cf_na", flag)
    if "Divergencia CF/Zisk" in flag:
        return i18n_strings.get("flag_cf_divergence", flag)
    # CAGR
    if flag == "CAGR tržieb: N/A":
        return i18n_strings.get("flag_cagr_na", flag)
    if flag == "CAGR: stagnácia":
        return i18n_strings.get("flag_cagr_stagnation", flag)
    if flag == "CAGR: pokles":
        return i18n_strings.get("flag_cagr_decline", flag)
    # Equity growing
    m = _re.match(r"Vlastné imanie rastie YoY: \+([\d.]+)%", flag)
    if m: return i18n_strings.get("flag_equity_growing", flag).format(val=m.group(1))
    # Revenue declining
    if "Tržby klesajú 3 roky" in flag:
        return i18n_strings.get("flag_revenue_declining", flag)
    # Vestnik severity flags
    if flag == "KRITICKÉ udalosti vo Vestníku":
        return i18n_strings.get("flag_vestnik_critical", flag)
    if flag == "VYSOKÉ udalosti vo Vestníku":
        return i18n_strings.get("flag_vestnik_high", flag)
    if flag == "STREDNÉ udalosti vo Vestníku":
        return i18n_strings.get("flag_vestnik_medium", flag)
    if flag == "Len nízko-rizikové záznamy vo Vestníku":
        return i18n_strings.get("flag_vestnik_low", flag)
    if flag == "Bez záznamu v Obchodnom vestníku ✓":
        return i18n_strings.get("flag_vestnik_clean", flag)
    # Auditor
    if flag == "Audítorský posudok: bez výhrad ✓":
        return i18n_strings.get("flag_auditor_clean", flag)
    m = _re.match(r"Audítorský posudok: (.+) \(−3b\)", flag)
    if m: return i18n_strings.get("flag_auditor_qualified", flag).format(val=m.group(1))
    # New company
    if flag == "Nová firma / chýbajúce výkazy":
        return i18n_strings.get("flag_new_company", flag)
    # Penalty losses
    m = _re.match(r"Penalizácia: (\d+) roky strata", flag)
    if m: return i18n_strings.get("flag_penalty_losses", flag).format(val=m.group(1))
    # HARD STOP detail
    if "HARD STOP" in flag:
        return i18n_strings.get("detail_hard_stop", flag)
    return flag


def _translate_scorecard(breakdown: list, i18n_strings: dict) -> list:
    """Translate scorecard pillar names, details, and flags at display time."""
    result = []
    for pillar in breakdown:
        p = dict(pillar)
        # Translate pillar name
        name_key = _PILLAR_NAME_MAP.get(p.get("name", ""))
        if name_key:
            p["name"] = i18n_strings.get(name_key, p["name"])
        # Translate detail
        detail = p.get("detail", "")
        if detail:
            if "Skóre ponížené" in detail:
                m = _re.match(r"Skóre ponížené \(koeficient ([\d.]+)\)", detail)
                if m:
                    p["detail"] = i18n_strings.get("detail_dq_penalty", detail).format(val=m.group(1))
            elif "Boli detekované kritické znaky" in detail:
                p["detail"] = i18n_strings.get("detail_forensic_wh", detail)
            elif "HARD STOP" in detail:
                p["detail"] = i18n_strings.get("detail_hard_stop", detail)
            else:
                # Detail is typically " | ".join(flags[:2]) — translate each part
                parts = detail.split(" | ")
                p["detail"] = " | ".join(_translate_flag(part, i18n_strings) for part in parts)
        # Translate flags
        if p.get("flags"):
            p["flags"] = [_translate_flag(f, i18n_strings) for f in p["flags"]]
        result.append(p)
    return result


def prepare_report_context(company, sources, start_pages_map, total_pages, generated_at, report_language="sk"):
    i18n_strings = get_i18n_strings(report_language)
    verdict = company.auditVerdict
    if company.financialStatements:
        company.financialStatements = sorted(company.financialStatements, key=lambda s: s.year, reverse=True)[:5]
    stmts = company.financialStatements
    # Sanitizácia: 0 pre cash flow polia = chýbajúce dáta (artefakt starého LLM promptu)
    for stmt in (stmts or []):
        sanitize_cash_flow_fields(stmt)
    # Fallback: ak grossProfit chýba (extrakcia zlyhala), vypočítaj ako prevádzkový zisk
    # Používa sa pre IFRS/SK GAAP by-function výkazy kde gross profit nie je explicitne uvedený
    # Výpočet: revenue - (staffCosts + depreciation + interestExpense) ≈ approx operating profit
    # Vyžaduje všetky 3 nákladové položky — ak niektorá chýba, fallback sa nevykoná
    gross_profit_estimated = False
    estimated_gp_years = set()
    for stmt in (stmts or []):
        if getattr(stmt, 'grossProfit', None) is None:
            revenue = getattr(stmt, 'mainActivityRevenue', None)
            staff = getattr(stmt, 'staffCosts', None)
            depreciation = getattr(stmt, 'depreciation', None)
            interest = getattr(stmt, 'interestExpense', None)
            if revenue and revenue > 0 and staff is not None and depreciation is not None and interest is not None:
                estimated = revenue - staff - depreciation - interest
                # Sanity check: fallback nesmie byť záporný ani > 100% tržieb
                if 0 < estimated <= revenue:
                    stmt.grossProfit = estimated
                    estimated_gp_years.add(stmt.year)
                    gross_profit_estimated = True
    # Ak sú VŠETKY hodnoty grossProfit odhadnuté (žiadny rok nemá reálnu hrubú maržu),
    # môžeme premenovať celý riadok. Inak ostáva "Hrubá marža" a odhadnuté bunky sa označia.
    _gp_years = [s for s in (stmts or []) if getattr(s, 'grossProfit', None) is not None]
    gross_profit_all_estimated = bool(_gp_years) and all(s.year in estimated_gp_years for s in _gp_years)

    # Fallback: ak operatingCashFlow chýba (zjednodušený výkaz bez CF), vypočítaj nepriamou metódou
    # Operating CF ≈ Net Profit + Depreciation - ΔInventory - ΔTrade Receivables + ΔTrade Payables
    cashflow_estimated = estimate_missing_cash_flow(stmts or [])
    latest_stmt = max(stmts, key=lambda s: s.year) if stmts else None
    vestnik_events = company.vestnikEvents or []
    
    # Zoradené výkazy pre tabuľky (od najstaršieho)
    stmts_sorted = sorted(stmts, key=lambda s: s.year) if stmts else []
    
    # Najnovšie finančné pomery pre karty v reporte
    latest_ratios = {}
    if latest_stmt:
        latest_ratios = compute_financial_ratios(latest_stmt)
    
    # NACE info
    nace_code = getattr(company, 'naceCode', None)
    nace_text = getattr(company, 'naceText', None)
    
    # Počet zamestnancov z najnovšieho výkazu (alebo odhad z staffCosts)
    employee_count = getattr(latest_stmt, 'employeeCount', None) if latest_stmt else None
    if not employee_count and latest_stmt:
        staff_costs = getattr(latest_stmt, 'staffCosts', 0) or 0
        if staff_costs > 0:
            employee_count = max(1, round(staff_costs / 12000))  # odhad: priemerná ročná mzda ~12k €
    
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
    
    if stmts:
        is_cons_set = set(getattr(s, 'isConsolidated', False) for s in stmts)
        if len(is_cons_set) > 1:
            has_mixed_consolidation = True
            
        for s in stmts:
            months = getattr(s, 'monthsInPeriod', 12)
            if months is not None and months != 12:
                has_non_standard_months = True
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
    
    # Načítanie Verifa loga
    current_dir = Path(__file__).parent
    logo_path = current_dir.parent / "assets" / "logo-verifa.png"
    logo_base64 = ""
    if logo_path.exists():
        with open(logo_path, "rb") as lf:
            logo_base64 = base64.b64encode(lf.read()).decode('utf-8')
            
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
                item["zdroj"] = z
            evidence_list = raw_list
    except Exception as e:
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

    if verdict and getattr(verdict, 'llmAnalysisStatus', None) == 'FALLBACK_ALGORITHMIC':
        hard_stop = any(
            e.get("impact") == "CRITICAL" for e in evidence_list
        ) if evidence_list else False
        risk_cat = getattr(verdict, 'riskCategory', 'INSUFFICIENT_DATA')
        score_val = getattr(verdict, 'verifaScore', 0)

        overrides = {
            "executiveSummary": i18n_strings.get("fallback_exec_summary", getattr(verdict, 'executiveSummary', '')),
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
    if stored_breakdown:
        scorecard_breakdown = stored_breakdown
        algorithmic_total = sum(p.get("score", 0) for p in stored_breakdown)
    elif stmts:
        company_dict_for_scoring = {
            "vestnikEvents": [
                {"eventType": e.eventType, "severityLevel": getattr(e, "severityLevel", None)}
                for e in vestnik_events
            ],
            "financialStatements": stmts,
        }
        trends_for_scoring = compute_financial_trends(stmts)
        sc_result = compute_forensic_scorecard(company_dict_for_scoring, trends_for_scoring)
        algorithmic_total = sc_result.total_score
        scorecard_breakdown = [
            {"name": p.name, "score": p.score, "max_score": p.max_score, "detail": p.detail, "flags": p.flags}
            for p in sc_result.pillars
        ]

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
    elif company.name and re.search(r'\bbanka\b|\bpoisťovňa\b', company.name.lower()):
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

    # Piotroski F-score
    sorted_stmts_raw = sorted(stmts or [], key=lambda s: s.year)
    piotroski_result = compute_piotroski_f_score(sorted_stmts_raw)

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

    # Gauge arc endpoint for cover page score gauge
    score_val = verdict.verifaScore if verdict else 0
    arc_angle = (score_val / 100.0) * 180
    rad = (180 - arc_angle) * math.pi / 180.0
    gx, gy, gr = 100, 100, 80
    gauge_end_x = round(gx + gr * math.cos(rad), 2)
    gauge_end_y = round(gy - gr * math.sin(rad), 2)
    gauge_large_arc = 1 if arc_angle > 180 else 0

    # Cash flow waterfall + debt donut + balance sheet infographic
    cf_waterfall_base64 = generate_cashflow_waterfall(latest_stmt, lang=report_language) if latest_stmt else ""
    debt_donut_base64 = generate_debt_donut(latest_stmt, lang=report_language) if latest_stmt else ""
    bs_infographic_base64 = generate_balance_sheet_infographic(latest_stmt, lang=report_language) if latest_stmt else ""
    pl_infographic_base64 = generate_pl_infographic(latest_stmt, lang=report_language) if latest_stmt else ""
    liquidity_chart_base64 = generate_liquidity_chart(stmts_sorted, lang=report_language) if stmts_sorted else ""

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
    if total_sources > 0:
        success_ratio = (total_sources - failed_sources) / total_sources
        if success_ratio >= 0.9:
            confidence_factors.append({"label": i18n_strings.get("conf_registries_all"), "ok": True, "weight": 25})
        elif success_ratio >= 0.6:
            confidence_factors.append({"label": i18n_strings.get("conf_registries_partial", "").format(pct=int(success_ratio*100)), "ok": True, "weight": 15})
            confidence_score -= 10
        else:
            confidence_factors.append({"label": i18n_strings.get("conf_registries_limited", "").format(pct=int(success_ratio*100)), "ok": False, "weight": 25})
            confidence_score -= 25
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

    return {
        "company": company,
        "verdict": verdict,
        "evidence_list": evidence_list,
        "latest_stmt": latest_stmt,
        "stmts_sorted": stmts_sorted,
        "latest_ratios": latest_ratios,
        "gross_profit_estimated": gross_profit_estimated,
        "gross_profit_all_estimated": gross_profit_all_estimated,
        "estimated_gp_years": estimated_gp_years,
        "cashflow_estimated": cashflow_estimated,
        "nace_code": nace_code,
        "nace_text": nace_text,
        "employee_count": employee_count,
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
        "labels": {k: i18n_strings.get(v, k) for k, v in SOURCE_LABEL_I18N_KEYS.items()},
        "scorecard_breakdown": scorecard_breakdown,
        "algorithmic_total": algorithmic_total,
        "altman_scores": altman_scores,
        "is_financial_institution": is_financial_institution,
        "is_startup": is_startup,
        "startup_info": startup_info,
        "has_mixed_consolidation": has_mixed_consolidation,
        "has_non_standard_months": has_non_standard_months,
        "has_short_history": has_short_history,
        "piotroski_score": piotroski_result.get("score"),
        "piotroski_flags": piotroski_result.get("flags", []),
        "yoy_revenue_growth": yoy_revenue_growth,
        "yoy_profit_growth": yoy_profit_growth,
        "trend_ratios": trend_ratios,
        "ratios_chart_base64": ratios_chart_base64,
        "radar_chart_base64": radar_chart_base64,
        "auditor_opinion": auditor_opinion,
        "gauge_end_x": gauge_end_x,
        "gauge_end_y": gauge_end_y,
        "gauge_large_arc": gauge_large_arc,
        "cf_waterfall_base64": cf_waterfall_base64,
        "debt_donut_base64": debt_donut_base64,
        "bs_infographic_base64": bs_infographic_base64,
        "pl_infographic_base64": pl_infographic_base64,
        "liquidity_chart_base64": liquidity_chart_base64,
        "qr_base64": qr_base64,
        "valid_until": valid_until,
        "confidence_score": confidence_score,
        "confidence_factors": confidence_factors,
        "company_city": company_city,
        "company_founded_year": company_founded_year,
        "revenue_per_employee": revenue_per_employee,
        "report_language": report_language,
        "i18n": get_i18n_strings(report_language),
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
            "--font-render-hinting=none",
        ])
        page = await browser.new_page()
        await page.goto(f"file://{html_path}", wait_until="networkidle", timeout=30000)
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
        await page.pdf(
            path=pdf_path, 
            format="A4", 
            margin={"top": "12mm", "bottom": "18mm", "left": "0mm", "right": "0mm"}, 
            print_background=True,
            display_header_footer=False,
            prefer_css_page_size=True,
        )
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
):
    logger.info(f"Generujem HTML/PDF report pre IČO: {ico} (report_language={report_language})")
    db = Prisma()
    await db.connect()
    
    try:
        company = await db.company.find_unique(
            where={'ico': ico},
            include={
                'auditVerdict': True,
                'financialStatements': {'orderBy': {'year': 'asc'}, 'include': {'auditorOpinion': True, 'narrativeRisk': True, 'notesRisk': True}},
                'vestnikEvents': {'orderBy': {'publishedAt': 'desc'}}
            }
        )
        
        if not company or not company.auditVerdict:
            logger.error(f"Nedostatok dát pre generovanie PDF (IČO: {ico})")
            return None

        context = prepare_report_context(company, sources, start_pages_map, total_pages, generated_at, report_language=report_language)
        html_content = render_html_report(context)

        pdf_path = target_path or f"assets/{ico}/Verifa_Forensic_Report_{ico}.pdf"
        await render_pdf_via_playwright(html_content, pdf_path, ico)

        return pdf_path

    finally:
        await db.disconnect()


async def generate_financial_summary_pdf(ico: str, target_path: str) -> Optional[str]:
    """Vygeneruje 1-2 strany s finančným prehľadom z DB dát (FinancialStatement).
    Používa sa pre IFRS firmy, kde registeruz.sk nezobrazuje štruktúrované HTML."""
    db = Prisma()
    await db.connect()
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
<p class="note">EBITDA = Čistý zisk + Náklady na úroky + Odpisy. Zaokrúhlenie na celé tisíce môže spôsobiť drobné odchýlky vo výpočte.</p>
</body></html>"""

        await render_pdf_via_playwright(html_content, target_path, ico)
        logger.info(f"[FIN_SUMMARY] Vygenerovaný finančný prehľad pre IČO {ico} → {target_path}")
        return target_path

    except Exception as e:
        logger.error(f"[FIN_SUMMARY] Chyba pre IČO {ico}: {e}", exc_info=True)
        return None
    finally:
        await db.disconnect()

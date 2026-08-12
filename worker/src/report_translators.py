"""Translation helpers for scraper findings, flags, scorecards, and evidence sources."""

import re
from typing import Optional
from xml.sax.saxutils import escape as xml_escape

from src.report_sanitizers import sanitize_llm_text


_MANUAL_LOOKUP_URLS: dict[str, str] = {
    "ORSR": "https://www.orsr.sk/default.asp?lan=sk",
    "ZRSR": "https://www.zrsr.sk/default.aspx?lan=sk",
    "INSOLVENCY": "https://www.justice.gov.sk/Stranky/Registre/Registru-upadcov.aspx",
    "CRE": "https://www.crz.sk/",
    "RPVS": "https://rpvs.gov.sk/rpvs/",
    "RPO": "https://www.rpo.sk/",
    "OBCHODNY_VESTNIK": "https://www.slov-lex.sk/obchodny-vestnik/",
    "CRZ": "https://www.crz.gov.sk/index.php/main/zmluvy/",
    "UVO": "https://www.uvo.gov.sk/evestnik",
    "REGISTER_UZ": "https://www.registeruz.sk/",
    "ROZHODNUTIA": "https://www.slov-lex.sk/pravne-predpisy/sudy/",
    "DISKVALIFIKACIE": "https://www.justice.gov.sk/Stranky/Registre/Registrovane-osoby.aspx",
    "NCRZP": "https://www.ncz.sk/",
    "NCRD": "https://www.ncrd.sk/",
    "OCHRANNE_ZNAMKY": "https://www.upv.gov.sk/sk/registre/",
    "SP_DLZNICI": "https://www.socpoist.sk/obchodna-informacia/",
    "VszP_DLZNICI": "https://www.vszp.sk/prehliadky-a-pojistne/pritomnost-na-trhu-pojistneho/zoznamy-dlznikov/",
    "UNION_DLZNICI": "https://www.unionzp.sk/zoznam-dlznikov/",
    "DOVERA_DLZNICI": "https://www.dovera.sk/zoznam-dlznikov/",
    "FS_DANOVE_SUBJEKTY": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FS_DPH_REGISTROVANI": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FS_DPH_RUSENIE": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FS_DPH_VYMAZANI": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FS_DPH_NADMERNY_ODPOCET": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FS_DAN_Z_PRIJMOV": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FS_DAN_PRIJMOV_REG": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "FINANCNA_SPRAVA": "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy",
    "POVERENIA": "https://www.justice.gov.sk/Stranky/Registre/Exekucie.aspx",
}

def format_findings(source, i18n=None) -> str:
    fallback = (i18n or {}).get("no_records", "Bez záznamu.")
    raw = source.findings or source.message or fallback
    # Sanitize raw exception text that leaked from scraper errors
    raw = re.sub(r'Unhandled exception:\s*\w*Error:\s*', '', raw)
    raw = re.sub(r'\bScraperUnavailableError:\s*', '', raw)
    raw = re.sub(r'\bPlaywrightTimeoutError:\s*', '', raw)
    raw = re.sub(r'\bPlaywrightError:\s*', '', raw)
    # Strip "TypeName: message" patterns from FAILED status messages
    raw = re.sub(r'^Interná chyba scrapera:\s*\w*Error:\s*', 'Interná chyba scrapera: ', raw)
    raw = re.sub(r'^Interná chyba:\s*\w*Error:\s*', 'Interná chyba: ', raw)
    raw = re.sub(r'^Neznáma chyba[^:]*:\s*\w*Error:\s*', 'Neznáma chyba: ', raw)
    raw = re.sub(r'^Chyba pri spracovaní[^:]*:\s*\w*Error:\s*', 'Chyba pri spracovaní: ', raw)
    # Playwright race condition errors — replace with clean UI message
    raw = re.sub(r'Page\.add_style_tag:\s*Execution context was destroyed.*', 'Register dočasne nedostupný — chyba pri renderovaní stránky.', raw)
    raw = re.sub(r'Execution context was destroyed.*', 'Register dočasne nedostupný — chyba pri renderovaní stránky.', raw)
    raw = re.sub(r'Target page.*has been closed.*', 'Register dočasne nedostupný — chyba pri renderovaní stránky.', raw)
    raw = re.sub(r'Page\.goto:\s*Navigation.*timeout.*', 'Register nedostupný — prekročený časový limit načítania.', raw)
    # Generic Playwright error patterns
    raw = re.sub(r'^Chyba pri generovaní PDF[^:]*:\s*Page\.\w+:\s*', 'Register dočasne nedostupný — ', raw)
    # FS scraper — link not found means the state portal changed its layout
    raw = re.sub(r'^Nepodarilo sa nájsť link\s*["„].*["„]\.', 'Register nedostupný — štátny portál zmenil layout.', raw)
    # Semafor queue timeout — scraper čakal príliš dlho na semafor
    raw = re.sub(r'Scraper čakal príliš dlho na semafor \(\d+s\)\.?', 'Register dočasne nedostupný — prekročený časový limit.', raw)
    raw = sanitize_llm_text(raw)

    # ── Comprehensive scraper findings translation ──
    if i18n:
        raw = _translate_scraper_findings(raw, i18n)

    # ── Fix double-dots from sentence concatenation artefacts ──
    raw = re.sub(r'\.\s*\.', '. ', raw).strip()

    # ── Fix merged words from newline-joined findings ──
    # Scraper findings sú joinované s \n, ale HTML rendering zrazí newlines.
    # Nahradíme \n za " | " aby slová nezliepali (napr. "NCRZP.Číslo:" → "NCRZP. | Číslo:").
    raw = re.sub(r'\n+', ' | ', raw).strip()

    # ── Append manual lookup URL for failed/unavailable sources ──
    if source.status in ("FAILED", "UNAVAILABLE"):
        url = _MANUAL_LOOKUP_URLS.get(source.source_type)
        if url:
            label = (i18n or {}).get("findings_manual_lookup", "Informáciu dohľadáte na")
            raw = f"{raw} | {label}: {url}"

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
    (r"INFO:\s*Pre IČO (\d+) sa (našla|našli|našlo) (\d+) (zmluvu|zmluvy|zmlúv) v CRZ \(zobrazených na (\d+) (strane|stranách)\)\.\s*Odporúčame skontrolovať zmluvy vo vygenerovanom PDF\.", "scr_crz_contracts_found", {}),
    (r"POZOR:\s*Pre IČO (\d+) sa (našla|našli|našlo) (\d+) (zmluvu|zmluvy|zmlúv) v CRZ \(zobrazených na (\d+) (strane|stranách)\)\.\s*Odporúčame skontrolovať zmluvy vo vygenerovanom PDF\.", "scr_crz_contracts_found_warn", {}),
    (r"INFO:\s*Pre IČO (\d+) sa našlo (\d+) záznamov v UVO \(zobrazených na (\d+) (strane|stranách)\)\.\s*Odporúčame skontrolovať záznamy vo vygenerovanom PDF\.", "scr_uvo_records_found", {}),
    (r"POZOR:\s*Pre IČO (\d+) sa našlo (\d+) záznamov v UVO \(zobrazených na (\d+) (strane|stranách)\)\.\s*Odporúčame skontrolovať záznamy vo vygenerovanom PDF\.", "scr_uvo_records_found_warn", {}),
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
            elif i18n_key in ("scr_crz_contracts_found", "scr_crz_contracts_found_warn") and len(groups) >= 6:
                # Regex groups: 0=ico, 1=verb, 2=count, 3=noun, 4=pages, 5=strana_str
                kwargs["ico"] = groups[0]
                kwargs["count"] = groups[2]
                kwargs["pages"] = groups[4]
                kwargs["strana_str"] = groups[5]
            elif i18n_key in ("scr_uvo_records_found", "scr_uvo_records_found_warn") and len(groups) >= 4:
                kwargs["ico"] = groups[0]
                kwargs["count"] = groups[1]
                kwargs["pages"] = groups[2]
                kwargs["strana_str"] = groups[3]
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
    "Forenzný indikátor: Anomália v štruktúre vedenia": "pillar_forensic",
    "Data Quality Multiplier": "pillar_dq",
    "Cash Flow / DSO Stress": "pillar_cf_dso",
    "ORSR Forenzná penalizácia": "pillar_orsr_forensic",
}

# ── Flag/detail translation patterns ──
import re as _re


def _extract_piotroski_from_scorecard(scorecard_breakdown: list) -> Optional[int]:
    """Extract Piotroski F-score integer from scorecard flags (Slovak format, pre-translation)."""
    if not scorecard_breakdown:
        return None
    for pillar in scorecard_breakdown:
        for flag in (pillar.get("flags") or []):
            m = _re.match(r'Piotroski F-score:\s*(\d+)\s*z\s*8', flag)
            if m:
                return int(m.group(1))
    return None

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
    m = _re.match(r"Vlastné imanie: kladné \(D/E = ([\d.]+)\)", flag)
    if m: return i18n_strings.get("flag_equity_positive", flag).format(val=m.group(1))
    m = _re.match(r"Vlastné imanie: ZÁPORNÉ \(D/E = ([\d.]+)\)", flag)
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
    m = _re.match(r"Piotroski F-score: (\d+) z 8", flag)
    if m: return i18n_strings.get("flag_piotroski_score", flag).format(val=m.group(1))
    if flag == "Nedostatok dát pre Piotroski F-score (min. 2 roky)":
        return i18n_strings.get("flag_piotroski_no_data", flag)
    m = _re.match(r"Neutralizované kritériá \(chýbajúce dáta\): (.+)", flag)
    if m: return i18n_strings.get("flag_piotroski_neutral", flag).format(criteria=m.group(1))
    # Beneish M-score
    m = _re.match(r"Beneish M-score = (-?[\d.]+) — Vyššie riziko", flag)
    if m: return i18n_strings.get("flag_beneish_manipulator", flag).format(val=m.group(1))
    m = _re.match(r"Beneish M-score = (-?[\d.]+) — Bez znám manipulácie", flag)
    if m: return i18n_strings.get("flag_beneish_clean", flag).format(val=m.group(1))
    if flag == "Nedostatok dát pre Beneish M-score (min. 2 roky)":
        return i18n_strings.get("flag_beneish_no_data", flag)
    if flag == "Nedostatok dát pre Beneish M-score (nulové tržby/aktíva)":
        return i18n_strings.get("flag_beneish_no_revenue", flag)
    # Startup
    m = _re.match(r"STARTUP profil: .* imaním ([\d,.]+) €\)", flag)
    if m: return i18n_strings.get("flag_startup_profile", flag).format(val=m.group(1))
    # Data void
    if flag == "DATA VOID: Kľúčové finančné metriky nedostupné":
        return i18n_strings.get("flag_data_void", flag)
    if flag == "DATA VOID":
        return i18n_strings.get("flag_data_void_short", flag)
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
    m = _re.match(r"CAGR: \+([\d.]+)%", flag)
    if m: return i18n_strings.get("flag_cagr_growth", flag).format(val=m.group(1))
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
    # Konkurz / Likvidácia flag
    if flag == "Konkurz / Likvidácia / Reštrukturalizácia":
        return i18n_strings.get("flag_hard_stop_konkurz", flag)
    # ORSR forensic flags
    m = _re.match(r"ORSR CRITICAL: (\d+) zmien štatutárov", flag)
    if m: return i18n_strings.get("flag_orsr_critical", flag).format(val=m.group(1))
    if flag == "ORSR HIGH: zvýšené riziko z ORSR histórie (−2b)":
        return i18n_strings.get("flag_orsr_high", flag)
    m = _re.match(r"Vysoký počet zmien štatutárov \((\d+)\) pre malú firmu", flag)
    if m: return i18n_strings.get("flag_orsr_small_corp", flag).format(val=m.group(1))
    m = _re.match(r"Vysoký počet zmien štatutárov \((\d+)\) pre strednú firmu", flag)
    if m: return i18n_strings.get("flag_orsr_medium_corp", flag).format(val=m.group(1))
    m = _re.match(r"Vysoký počet zmien štatutárov \((\d+)\):", flag)
    if m: return i18n_strings.get("flag_orsr_big_corp", flag).format(val=m.group(1))
    if flag == "Virtuálne sídlo + zahraničný štatutár (−1b)":
        return i18n_strings.get("flag_orsr_virtual_foreign", flag)
    # CF/DSO stress flag
    if "papierový zisk" in flag:
        return i18n_strings.get("flag_cf_dso_stress", flag)
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


# ── State liabilities alert translation ──────────────────────────────────────

_STATE_LIAB_MSG_MAP = {
    # (field, severity, in_registry) → i18n key
    ("socialInsuranceLiabilities", "CRITICAL", True): "state_liab_sp_critical",
    ("socialInsuranceLiabilities", "INFO", False): "state_liab_sp_info",
    ("socialInsuranceLiabilities", "WARNING", True): "state_liab_sp_warning",
    ("socialInsuranceLiabilities", "INFO", True): "state_liab_sp_info_low",
    ("taxLiabilities", "CRITICAL", True): "state_liab_tax_critical",
    ("taxLiabilities", "INFO", False): "state_liab_tax_info",
    ("taxLiabilities", "WARNING", True): "state_liab_tax_warning",
    ("taxLiabilities", "INFO", True): "state_liab_tax_info_low",
    ("employeeLiabilities", "WARNING", None): "state_liab_emp_warning",
}


def _translate_state_liabilities_alert(alert_data: dict, i18n_strings: dict) -> dict:
    """Translate hardcoded Slovak state liabilities messages to the report language."""
    if not alert_data or not alert_data.get("alerts"):
        return alert_data
    for alert in alert_data["alerts"]:
        field = alert.get("field", "")
        severity = alert.get("severity", "")
        msg = alert.get("message", "")
        val = alert.get("value", 0)
        year = ""
        m = _re.search(r"\(rok (\d+)\)", msg)
        if m:
            year = m.group(1)
        # Determine registry status from message text
        in_registry = "nie je v" not in msg.lower() and "firma nie je" not in msg.lower()
        if field == "employeeLiabilities":
            key = _STATE_LIAB_MSG_MAP.get((field, severity, None))
        else:
            key = _STATE_LIAB_MSG_MAP.get((field, severity, in_registry))
        if key:
            formatted_val = f"{int(val):,}".replace(",", " ") if val else ""
            alert["message"] = i18n_strings.get(key, msg).format(val=formatted_val, year=year)
    return alert_data


# ── Evidence source name translation ─────────────────────────────────────────

_EVIDENCE_SOURCE_MAP = {
    "Súvaha": "src_suvaha",
    "Finančné zdravie": "src_fin_zdravie",
    "Výkaz ziskov a strát": "src_vykaz_ziskov",
    "Analýza trendov": "src_analyza_trendov",
    "Vestník": "src_vestnik",
    "OR SR": "src_orsr",
    "ORSR": "src_orsr",
    "CRZ": "src_crz",
    "RPVS": "src_rpvs",
    "PDF výpis": "src_pdf_vypis",
    "RÚZ": "src_ruz",
    "RUZ": "src_ruz",
}


def _translate_evidence_source(source: str, i18n_strings: dict) -> str:
    """Translate a single evidence source name from Slovak to the report language."""
    if not source:
        return source
    # Exact match
    key = _EVIDENCE_SOURCE_MAP.get(source.strip())
    if key:
        return i18n_strings.get(key, source)
    # Partial match (source may contain extra text)
    for sk_name, i18n_key in _EVIDENCE_SOURCE_MAP.items():
        if sk_name in source:
            translated = i18n_strings.get(i18n_key, sk_name)
            return source.replace(sk_name, translated)
    return source



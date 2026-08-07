import os
import glob
import json
import re
import logging
import time
from datetime import datetime
from typing import Optional

import asyncio
import fitz
from prisma import Prisma, Json
from dotenv import load_dotenv

load_dotenv()

from src.config import settings as _cfg
from src.db_repository import (
    save_to_db, save_narrative_to_db, save_notes_to_db,
    save_company_events_to_db, append_company_event_to_db,
    update_ai_status, get_avg_completion_seconds,
)
from src.log_helpers import (
    PhaseTimer, log_pipeline_start, log_pipeline_end,
    log_llm_call, log_llm_retry, get_correlation_id,
)
from src.ruz_api import download_ifrs_reports
from src.llm_extractor import (
    CompanyFinancialExtraction, NarrativeRiskAnalysis, AuditVerdict, EvidenceItem,
    evaluate_audit_verdict, extract_financial_data,
    extract_narrative_risk, extract_notes_risks, extract_staff_costs_focused,
    verify_critical_numbers_blind, generate_cross_analysis,
    verify_report_quality, VerificationConfidenceItem,
)
from src.scrapers.obchodny_vestnik import ObchodnyVestnikXmlScraper, save_vestnik_events_to_db
from src.report_generator import generate_forensic_pdf_report
from src.pdf_ingestion import extract_core_financials, slice_narrative_pdf, slice_notes_pdf, extract_relevant_pdf_chunks
from src.llm_orchestrator import safe_llm_call, _MODEL_IFRS, _MODEL_NARRATIVE, _MODEL_NOTES, _MODEL_VESTNIK
from src.agents.pdf_reader import extract_company_events
from src.analytics import sanitize_cash_flow_fields, estimate_missing_cash_flow, compute_financial_trends, compute_forensic_scorecard

# Nastavenie logovania do súboru pre produkciu
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("errors.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Globálny semaphore pre LLM volania — zdieľaný medzi všetkými reportmi
# Paid Gemini API: 360 RPM, 1M TPM — semaphore 10 je bezpečné
_GLOBAL_LLM_SEM = asyncio.Semaphore(10)

# Fallback baseline ak nie sú historické dáta (sekundy)
_PIPELINE_BASELINE_FALLBACK = _cfg.pipeline_baseline_fallback


def _extract_year_from_fn(file_path: str) -> int:
    """Extrahuje rok z názvu súboru (napr. IFRS_35876832_2024_0.pdf → 2024)."""
    fn = os.path.basename(file_path)
    parts = fn.split('_')
    if len(parts) >= 3 and parts[2].isdigit():
        return int(parts[2])
    return 0


def _check_cross_year_unit_consistency(results: list[CompanyFinancialExtraction]) -> None:
    """
    Detekuje a opravuje nekonzistentné jednotky (EUR vs tisíce EUR) naprieč rokmi.

    LLM extrakcia z IFRS PDF môže pre niektoré roky vrátiť hodnoty v tisícoch EUR
    namiesto EUR (napr. ak PDF hlavička uvádza "v tisícoch EUR" ale LLM to prehliadne).
    Prejav: niektoré roky majú assets ~1.2M, iné ~1.2B — rozdiel ~1000x.

    Algoritmus (globálna bimodálna detekcia):
    - Zbierame celkové aktíva pre všetky roky.
    - Nájdeme maximálnú hodnotu (predpoklad: najväčšia hodnota je v EUR).
    - Pre každý rok: ak max_assets / year_assets je v rozsahu 100-10000,
      skontrolujeme či ratio blíži k 1000 (tisíce) alebo 1,000,000 (milióny).
    - Ak väčšina rokov je v jednotnej skupine a menšina v druhej, opravíme menšinu.
    - Funguje aj keď 2+ po sebe idúce roky sú v tisícoch (narozdiel od susedného porovnania).
    """
    if len(results) < 2:
        return

    # Zbierame (year, assets) pre roky s dátami
    year_assets = {}
    for data in results:
        y = data.metriky.rok_zavierky
        a = data.metriky.celkove_aktiva
        if y and a is not None and a > 0:
            year_assets[y] = a

    if len(year_assets) < 2:
        return

    max_assets = max(year_assets.values())
    years_to_fix = set()

    for yr, assets in year_assets.items():
        ratio = max_assets / assets
        # tisíce EUR: ratio ~1000 (povoľujeme 100-10000 pre veľké firmy s variabilnými aktívami)
        # Mimo rozsah 100-10000 = skutočný rozdiel v aktívach, nie chyba jednotiek
        if 100 <= ratio <= 10000:
            years_to_fix.add(yr)
            logger.warning(
                f"[UNIT FIX] Rok {yr}: assets={assets:,.0f} vs max={max_assets:,.0f} "
                f"(ratio={ratio:.0f}x) — pravdepodobne tisíce EUR, násobím ×1000"
            )

    # Bezpečnostný limit: neprepisuj viac ako polovicu rokov
    # (ak by všetky roky boli "tisíce", max je tiež tisíce a ratio by bolo ~1)
    if len(years_to_fix) >= len(year_assets):
        logger.warning(
            f"[UNIT FIX] Záchytná kontrola: {len(years_to_fix)}/{len(year_assets)} rokov "
            f"označených na opravu — príliš mnoho, preskakujem (pravdepodobne legitímne malé hodnoty)"
        )
        return

    if not years_to_fix:
        return

    # Polia, ktoré treba násobiť ×1000 (všetky peňažné)
    money_fields = [
        "celkove_aktiva", "obezny_majetok", "vlastne_imanie_celkom",
        "kratkodobe_zavazky", "dlhodobe_zavazky", "trzby_z_hlavnej_cinnosti",
        "hruba_marza", "zisk_alebo_strata_po_zdaneni",
        "peniaze_a_penazne_ekvivalenty_k_31_12",
        "ciste_penazne_toky_z_prevadzkovej_cinnosti",
        "osobne_naklady", "pohladavky_z_obchodneho_styku",
        "zavazky_z_obchodneho_styku", "zasoby", "odpisy",
        "investicny_cash_flow", "financny_cash_flow", "uroky", "dan_z_prijmu",
        "zavazky_sp", "danove_zavazky", "zavazky_zamestnanci",
        # Extended income statement fields (must be fixed together with balance sheet)
        "naklady_na_hosp_cinnost", "spotreba_materialu", "sluzby",
        "mzdove_naklady", "dane_a_poplatky",
        "vysledok_z_fin_cinnosti", "zisk_pred_zdanenim",
        # Extended asset/equity composition
        "neobezny_majetok", "dlhodoby_nehmotny_majetok", "dlhodoby_hmotny_majetok",
        "dlhodoby_financny_majetok", "dlhodobe_pohladavky",
        "kratkodoby_financny_majetok", "casove_rozlisenie_aktiv",
        "zakladne_imanie", "emisione_azio", "ostatne_kapitalove_fondy",
        "zakonne_rezervne_fondy", "ostatne_fondy_zo_zisku",
        "vysledok_minuly_rokov", "nerozdeleny_zisk", "neuhradena_strata",
        "vysledok_beziaceho_roka", "dlhodobe_rezervy", "kratkodobe_rezervy",
        "bezne_bankove_uvery", "kratkodobe_financne_vypomoci",
        "prevod_podielov_spolocnikom",
    ]

    for data in results:
        y = data.metriky.rok_zavierky
        if y in years_to_fix:
            for field in money_fields:
                val = getattr(data.metriky, field, None)
                if val is not None and val != 0:
                    setattr(data.metriky, field, val * 1000)
            logger.info(f"[UNIT FIX] Rok {y}: všetky peňažné polia vynásobené ×1000")


def _check_cross_year_duplicates(results: list[CompanyFinancialExtraction]) -> None:
    """
    Detekuje a opravuje duplicitné hodnoty osobných nákladov naprieč rokmi.
    LLM môže duplikovať hodnotu z jedného roku do iného (najmä pri IFRS by-function
    výkazoch, kde si LLM "požičia" hodnotu z iného roku, ktorý videlo v tréningovom
    okne PDF).

    Logika:
    - Ak rovnaká hodnota osobných nákladov (s toleranciou 1€) existuje pre 2+ roky,
      ktoré NIE sú susedné (rozdiel > 1), považujeme to za duplikát.
    - Pre susedné roky (rozdiel = 1) s rovnakou hodnotou iba logujeme varovanie
      (môže to byť legitímne pre malé firmy).
    - Pri duplikáte nullujeme hodnotu pre starší rok (novší rok je pravdepodobne
      správny, pretože PDF pre rok X obsahuje stĺpce pre X a X-1).
    """
    # Zbierame unikátne roky a ich osobné náklady
    year_to_staff = {}
    for data in results:
        year = data.metriky.rok_zavierky
        staff = data.metriky.osobne_naklady
        if year and staff is not None and staff > 0:
            year_to_staff[year] = staff

    if len(year_to_staff) < 2:
        return

    # Skupiny rokov s rovnakou hodnotou (tolerancia 1€ pre float porovnanie)
    sorted_years = sorted(year_to_staff.keys(), reverse=True)
    checked = set()

    for i, year_a in enumerate(sorted_years):
        if year_a in checked:
            continue
        val_a = year_to_staff[year_a]
        duplicates = [year_a]

        for year_b in sorted_years[i + 1:]:
            if year_b in checked:
                continue
            val_b = year_to_staff[year_b]
            if abs(val_a - val_b) <= 1.0:
                duplicates.append(year_b)
                checked.add(year_b)

        if len(duplicates) >= 2:
            # Susedné roky (rozdiel = 1) — môže byť legitímne, len logujeme
            non_adjacent = [y for y in duplicates if any(abs(y - other) > 1 for other in duplicates)]

            if non_adjacent or len(duplicates) >= 3:
                # Nullujeme staršie roky (ponecháme najnovší)
                keeper = max(duplicates)
                for data in results:
                    y = data.metriky.rok_zavierky
                    if y in duplicates and y != keeper:
                        old_val = data.metriky.osobne_naklady
                        data.metriky.osobne_naklady = None
                        logger.warning(
                            f"[DUPLICATE CHECK] Osobné náklady pre rok {y} nullované "
                            f"(hodnota {old_val} sa zhoduje s rokom {keeper} — pravdepodobne duplikát z LLM)"
                        )
            else:
                # Iba susedné roky s rovnakou hodnotou — logujeme varovanie
                logger.info(
                    f"[DUPLICATE CHECK] Susedné roky {duplicates} majú rovnaké osobné náklady "
                    f"({val_a}) — môže byť legitímne, nulovanie preskakujem"
                )

        checked.add(year_a)


# ── Debt PDF collection patterns ────────────────────────────────────────────
_RESULTS_DEBT_PATTERNS = [
    "dovera_dlznici_*{ico}*.pdf",
    "sp_dlznici_*{ico}*.pdf",
    "vszp_dlznici_*{ico}*.pdf",
    "union_dlznici_*{ico}*.pdf",
    "insolvency_*{ico}*.pdf",
    "crz_*{ico}*.pdf",
    "diskvalifikacie_*{ico}*.pdf",
    "fs_danove_subjekty_*{ico}*.pdf",
    "fs_dph_*{ico}*.pdf",
    "fs_dan_*{ico}*.pdf",
    "ROZHODNUTIA_*{ico}*.pdf",
]
_ASSETS_DEBT_PATTERNS = ["DEBTS_*.pdf", "EXC_*.pdf", "DLZ_*.pdf"]


def _collect_debt_pdfs(ico: str) -> list[str]:
    """Zozbiera PDF súbory z registrov (dlhy, exekúcie, insolvencia) pre Chief Auditora."""
    debt_pdfs: list[str] = []
    results_dir = os.environ.get("RESULTS_DIR", "./results")
    for rid_dir in glob.glob(f"{results_dir}/*"):
        if os.path.isdir(rid_dir):
            for pattern in _RESULTS_DEBT_PATTERNS:
                debt_pdfs.extend(glob.glob(f"{rid_dir}/{pattern.format(ico=ico)}"))
    assets_dir = f"assets/{ico}"
    if os.path.exists(assets_dir):
        for pattern in _ASSETS_DEBT_PATTERNS:
            debt_pdfs.extend(glob.glob(f"{assets_dir}/{pattern}"))
    return list(dict.fromkeys(debt_pdfs))


def _build_fallback_verdict(company_dict: dict, scorecard, report_language: str = "sk") -> AuditVerdict:
    """Vytvorí fallback AuditVerdict z deterministického algoritmického skóre, keď LLM zlyhá."""
    from src.i18n import get_i18n_strings
    i = get_i18n_strings(report_language)

    prescore = scorecard.total_score if scorecard else 0
    risk_cat = scorecard.risk_category if scorecard else "INSUFFICIENT_DATA"
    hard_stop = scorecard.hard_stop if scorecard else False

    pillar_summaries = []
    if scorecard and scorecard.pillars:
        for p in scorecard.pillars:
            pillar_summaries.append(f"{p.name}: {p.score}/{p.max_score} — {p.detail}")

    evidence = [
        EvidenceItem(
            claim=i.get("fallback_claim", "Algoritmické hodnotenie (5-pilierový model)"),
            evidence=i.get("fallback_evidence", "Skóre {score}/100, kategória {cat}").format(score=prescore, cat=risk_cat),
            source=i.get("fallback_source", "Deterministický algoritmus"),
            impact="NEUTRAL",
        )
    ]
    if hard_stop:
        evidence.append(EvidenceItem(
            claim=i.get("fallback_hardstop_claim", "HARD STOP — konkurz/likvidácia/reštrukturalizácia"),
            evidence=i.get("fallback_hardstop_evidence", "Detegované vo Vestníku"),
            source=i.get("fallback_hardstop_source", "Obchodný vestník"),
            impact="CRITICAL",
        ))
    if pillar_summaries:
        evidence.append(EvidenceItem(
            claim=i.get("fallback_pillar_breakdown", "Rozpis pilierov"),
            evidence=" | ".join(pillar_summaries),
            source=i.get("fallback_pillar_source", "5-pilierový scorecard"),
            impact="NEUTRAL",
        ))

    return AuditVerdict(
        verifa_score=prescore,
        risk_category=risk_cat,
        debt_exposure_rating=None,
        executive_summary=i.get("fallback_exec_summary", ""),
        final_verdict=(
            i.get("fallback_verdict_hardstop", "")
            if hard_stop else
            i.get("fallback_verdict_normal", "").format(cat=risk_cat, score=prescore)
        ),
        zdovodnenie=evidence,
        kľúčové_riziko=(
            i.get("fallback_key_risk_hardstop", "")
            if hard_stop else
            i.get("fallback_key_risk_normal", "")
        ),
        llm_analysis_status="FALLBACK_ALGORITHMIC",
    )


async def run_pdf_reader_agent(ico: str, sources: list, report_language: str = "sk") -> bool:
    """
    PDF Reader Agent: prečíta všetky PDF z registrov (z scrapers) a uloží CompanyEvent[] do DB.
    Beží po scraperoch, paralelne s AI pipeline (IFRS/VS/Notes).
    Vracia True ak prebehol úspešne, False ak zlyhal — pre audit verdict metadata.
    """
    from src.models import ScrapedSource

    # Zozbieraj dáta zo sources — preferuj raw_data (JSON z API) pred PDF text extrakciou
    pdf_texts: list[tuple[str, str]] = []
    for s in sources:
        if hasattr(s, 'status') and s.status == "SUCCESS":
            label = f"{s.source_type}_{os.path.basename(s.file_path) if s.file_path else 'no_file'}"

            # 1. Preferuj raw_data (štruktúrované JSON z API) — presnejšie, žiadne halucinácie
            if hasattr(s, 'raw_data') and s.raw_data:
                import json as _json
                json_text = _json.dumps(s.raw_data, ensure_ascii=False, default=str)
                if json_text.strip() and json_text != "[]":
                    pdf_texts.append((label, f"[JSON API DATA]\n{json_text}"))
                    logger.info(f"[PDF Reader] Používam JSON API dáta pre {label} ({len(s.raw_data)} záznamov)")
                    continue  # JSON dáta použité, nepotrebné čítať PDF

            # 2. Fallback: extrahuj text z PDF
            if hasattr(s, 'file_path') and s.file_path:
                try:
                    if os.path.exists(s.file_path) and os.path.getsize(s.file_path) > 0:
                        text = extract_relevant_pdf_chunks(s.file_path)
                        # Full-text fallback: ak keyword extrakcia vrátila málo textu (< 500 znakov),
                        # extrahuj celý PDF text — typicky pre krátke výpisy z registrov
                        if not text or len(text.strip()) < 500:
                            try:
                                import fitz
                                doc = fitz.open(s.file_path)
                                full_text = ""
                                for page in doc:
                                    full_text += page.get_text("text")
                                doc.close()
                                if full_text.strip():
                                    text = full_text
                                    logger.info(f"[PDF Reader] Full-text fallback pre {label} (keyword extrakcia < 500 znakov)")
                            except Exception:
                                pass
                        if text and text.strip():
                            pdf_texts.append((label, text))
                except Exception as e:
                    logger.warning(f"[PDF Reader] Nepodarilo sa extrahovať text z {s.file_path}: {e}")

    if not pdf_texts:
        logger.info(f"[PDF Reader Agent] IČO={ico}: žiadne PDF texty na analýzu — preskakujem.")
        return True

    logger.info(f"[PDF Reader Agent] IČO={ico}: analyzujem {len(pdf_texts)} PDF dokumentov")
    try:
        result = await safe_llm_call(
            extract_company_events, pdf_texts,
            model=_cfg.model_vestnik,
            label="PDF Reader Agent",
            report_language=report_language,
        )
        if result and result.events:
            await save_company_events_to_db(ico, result.events)
            logger.info(f"[PDF Reader Agent] IČO={ico}: uložených {len(result.events)} udalostí do DB")
        else:
            logger.info(f"[PDF Reader Agent] IČO={ico}: žiadne udalosti nájdené")
        return True
    except Exception as e:
        logger.error(f"[PDF Reader Agent] IČO={ico}: chyba pri analýze PDF: {e}", exc_info=True)
        return False


async def run_orsr_forensics_agent(ico: str, sources: list, report_language: str = "sk") -> bool:
    """
    Agent pre forenznú analýzu Úplného výpisu ORSR (Biele kone, virtuálne sídla).
    Beží paralelne s PDF Reader Agentom.
    Vracia True ak prebehol úspešne, False ak zlyhal — pre audit verdict metadata.
    """
    from src.agents.orsr_forensic import analyze_orsr_history
    from src.utils.orsr_heuristics import is_virtual_seat, is_foreign_statutory
    
    orsr_source = next((s for s in sources if s.source_type == "ORSR" and s.status == "SUCCESS"), None)
    if not orsr_source or not getattr(orsr_source, "full_extract_text", None):
        return True
        
    logger.info(f"[ORSR Forensic Agent] IČO={ico}: analyzujem históriu ORSR")
    try:
        # LLM volanie pre spočítanie zmien
        forensics = await analyze_orsr_history(orsr_source.full_extract_text, report_language=report_language)

        # Deterministické Python heuristiky — hľadáme v úplnom výpise (nie v findings)
        forensics.has_virtual_seat = is_virtual_seat(orsr_source.full_extract_text)
        forensics.has_foreign_statutory = bool(
            getattr(orsr_source, "persons", None)
            and is_foreign_statutory(orsr_source.persons)
        )

        # Vyhodnotenie severity
        severity = "INFO"
        title = "Analýza histórie ORSR"
        description = f"Počet zmien štatutárov: {forensics.statutory_changes_count}, počet zmien sídla: {forensics.address_changes_count}."

        if forensics.has_virtual_seat:
            description += " Identifikované virtuálne sídlo."
        if forensics.has_foreign_statutory:
            description += " Identifikovaný zahraničný štatutár."

        if forensics.high_turnover_risk or (forensics.has_virtual_seat and forensics.has_foreign_statutory):
            severity = "CRITICAL"
            title = "Riziko Bieleho koňa (ORSR Anomálie)"
        elif forensics.has_virtual_seat or forensics.has_foreign_statutory or forensics.statutory_changes_count > 2:
            severity = "HIGH"
            title = "Zvýšené riziko z ORSR histórie"

        from src.agents.pdf_reader import CompanyEvent
        event = CompanyEvent(
            source="ORSR",
            event_type="FORENSIC_ANALYSIS",
            severity=severity,
            title=title,
            description=description,
            event_date=None,
            amount=None,
            metadata=forensics.model_dump(),
        )
        await append_company_event_to_db(ico, event)
        logger.info(f"[ORSR Forensic Agent] IČO={ico}: Uložená forenzná analýza ({severity})")

        # ── Deterministický scan ORSR pre historické konkurzy/reštrukturalizácie ──
        # Vestník API má lookback 365 dní. Ak firma prešla konkurzom pred rokom,
        # Vestník to už neukáže, ale ORSR "Ďalšie právne skutočnosti" to stále obsahuje.
        # Tento scan zachytí gap a vytvorí synthetický VestnikEvent.
        _CRITICAL_KEYWORDS = [
            "konkurz", "konkurzné", "vyhlásenie konkurzu",
            "reštrukturalizácia", "restrukturalizácia",
            "likvidácia", "likvidátor",
            "zrušenie spoločnosti", "zrušená",
        ]
        orsr_text_lower = orsr_source.full_extract_text.lower()
        found_keywords = [kw for kw in _CRITICAL_KEYWORDS if kw in orsr_text_lower]

        if found_keywords:
            # Skontroluj, či už nemáme vestnik event s rovnakou problematikou
            # (aby sme neduplikovali penalizáciu)
            from src.db_repository import get_company_with_relations
            existing_company = await get_company_with_relations(ico)
            existing_vestnik_types = []
            if existing_company and existing_company.vestnikEvents:
                for ve in existing_company.vestnikEvents:
                    ve_type = (ve.eventType or "").lower()
                    existing_vestnik_types.append(ve_type)

            # Ak už máme vestnik event o konkurze/reštrukturalizácii, preskoč
            already_covered = any(
                any(kw in vt for kw in ["konkurz", "reštruktural", "restruktural", "likvid"])
                for vt in existing_vestnik_types
            )

            matched = ", ".join(found_keywords[:3])

            if not already_covered:
                critical_event = CompanyEvent(
                    source="ORSR",
                    event_type="HISTORICAL_BANKRUPTCY",
                    severity="CRITICAL",
                    title=f"Historický záznam o insolvencii v ORSR ({matched})",
                    description=(
                        f"V Úplnom výpise z ORSR bola nájdená zmienka o: {matched}. "
                        f"Táto udalosť môže byť staršia ako lookback okno Obchodného vestníka "
                        f"a nemusí byť v ňom zachytená. Overte aktuálny stav v RKR."
                    ),
                    event_date=None,
                    amount=None,
                    metadata={"keywords_found": found_keywords, "source": "ORSR_text_scan"},
                )
                await append_company_event_to_db(ico, critical_event)
                logger.warning(
                    f"[ORSR Forensic Agent] IČO={ico}: Nájdené historické kľúčové slová v ORSR: {matched} — "
                    f"vytvorený synthetický CRITICAL event"
                )
            else:
                logger.info(
                    f"[ORSR Forensic Agent] IČO={ico}: Nájdené kľúčové slová ({matched}), "
                    f"ale vestník už obsahuje relevantný event — preskakujem"
                )

        return True
    except Exception as e:
        logger.error(f"[ORSR Forensic Agent] IČO={ico}: chyba: {e}", exc_info=True)
        return False


def _sanitize_verdict_text(text: str) -> str:
    """Sanitizuje LLM text pred uložením do DB.
    Aplikuje sa pri ukladaní verdictu — druhá vrstva je template filter sanitize_llm."""
    if not text:
        return text
    # Garbled text detection — PDF extraction artefacts with mixed scripts
    cyrillic = sum(1 for c in text if '\u0400' <= c <= '\u04FF')
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    arabic = sum(1 for c in text if '\u0600' <= c <= '\u06ff')
    if (cyrillic + cjk + arabic) >= 3:
        return ""
    # "ALE" → "ale" — LLM ignoruje prompt inštrukciu aj napriek opakovaným pokusom
    text = re.sub(r'\bALE\b', 'ale', text)
    # LaTeX $...$ → plain text
    text = re.sub(r'\$([^$]+)\$', r'\1', text)
    text = re.sub(r'\^[\{]([^}]+)[\}]', r'\1', text)
    text = re.sub(r'\^\{([^}]+)\}', r'\1', text)
    text = re.sub(r"\\prime\\prime", "''", text)
    text = re.sub(r"\\prime", "'", text)
    # Bežné preklepy z LLM — rovnaké ako sanitize_llm_text v report_generator.py
    text = text.replace("dižnik", "dlžník").replace("dižníkov", "dlžníkov").replace("dižníci", "dlžníci")
    text = text.replace("Dövera", "Dôvera")
    text = re.sub(r'\bDöver', 'Dôver', text)
    text = re.sub(r'\bsüd', 'súd', text)
    text = re.sub(r'\bSüd', 'Súd', text)
    text = text.replace("Fimra", "Firma").replace("Fimia", "Firma")
    text = text.replace("Registier", "Register")
    # Compound forms — health insurance dlžníci
    text = text.replace("Dôveradižníci", "Dôvera — dlžníci").replace("Dôvera-dižníci", "Dôvera — dlžníci")
    text = text.replace("Dôveradlžníci", "Dôvera — dlžníci").replace("Dôvera-dlžníci", "Dôvera — dlžníci")
    text = text.replace("VšZP-dižníci", "VšZP — dlžníci").replace("VšZPdižníci", "VšZP — dlžníci")
    text = text.replace("VšZP-dlžníci", "VšZP — dlžníci")
    text = text.replace("Union-dižníci", "Union — dlžníci").replace("Uniondižníci", "Union — dlžníci")
    text = text.replace("Union-dlžníci", "Union — dlžníci")
    text = text.replace("SP-dižníci", "SP — dlžníci").replace("SPdižníci", "SP — dlžníci")
    text = text.replace("SP-dlžníci", "SP — dlžníci")
    # Generic regex fallback — catches any remaining dižn* OCR artefacts not caught above
    text = re.sub(r'\bdižník\b', 'dlžník', text)
    text = re.sub(r'\bdižníkov\b', 'dlžníkov', text)
    text = re.sub(r'\bdižníci\b', 'dlžníci', text)
    text = re.sub(r'\bdižníkmi\b', 'dlžníkmi', text)
    text = re.sub(r'\bdižníkovi\b', 'dlžníkovi', text)
    return text


async def run_and_save_audit_verdict(
    ico: str,
    force: bool = False,
    report_language: str = "sk",
    failed_agents: list | None = None,
    registry_sources: list | None = None,
):
    """
    1. Získa všetky dostupné dáta pre dané IČO z databázy (Finančné výkazy, Naratívne analýzy, Vestník).
    2. Spustí Chief Auditora.
    3. Uloží AuditVerdict do DB.

    failed_agents: zoznam názvov agentov ktoré zlyhali (napr. ['PDF Reader', 'ORSR Forensic']) —
    Chief Auditor dostane varovanie v kontexte a môže znížiť istotu skóre.

    Preskočí LLM ak verdict existuje a žiadne nové dáta neprišli od posledného výpočtu.
    Re-run ak: nové vestnik events, nové finančné výkazy, nové PDF z registrov, alebo verdict > 90 dní.
    """
    STALE_TTL_DAYS = 90

    from src.db_repository import get_company_with_relations, save_audit_verdict
    try:
        # Načítaj existujúci verdict + všetky dáta naraz
        company = await get_company_with_relations(ico)
        if not company:
            logger.warning(f"Spoločnosť {ico} nebola nájdená pre Chief Auditora.")
            return

        existing_verdict = company.auditVerdict

        # ── Determinizmus: preskoč LLM ak žiadne nové dáta ──
        if existing_verdict and not force:
            from datetime import datetime, timezone
            verdict_ts = existing_verdict.createdAt.replace(tzinfo=timezone.utc) if existing_verdict.createdAt else datetime.min.replace(tzinfo=timezone.utc)
            reasons = []

            # 1. Nové vestnik events?
            for e in (company.vestnikEvents or []):
                e_ts = e.createdAt.replace(tzinfo=timezone.utc) if e.createdAt else None
                if e_ts and e_ts > verdict_ts:
                    reasons.append(f"nový vestnik event ({e.eventType})")
                    break

            # 2. Nové finančné výkazy?
            for s in (company.financialStatements or []):
                s_ts = s.createdAt.replace(tzinfo=timezone.utc) if s.createdAt else None
                if s_ts and s_ts > verdict_ts:
                    reasons.append(f"nový finančný výkaz ({s.year})")
                    break

            # 2b. Nové CompanyEvents (ORSR forensic, PDF Reader, etc.)?
            for e in (company.companyEvents or []):
                e_ts = e.createdAt.replace(tzinfo=timezone.utc) if e.createdAt else None
                if e_ts and e_ts > verdict_ts:
                    reasons.append(f"nový company event ({e.source}/{e.eventType})")
                    break

            # 3. Fallback: verdict príliš starý
            age_days = (datetime.now(timezone.utc) - verdict_ts).days
            if age_days > STALE_TTL_DAYS:
                reasons.append(f"verdict {age_days}d starý (> {STALE_TTL_DAYS}d)")

            if not reasons:
                logger.info(f"AuditVerdict pre IČO {ico} je aktuálny (skóre {existing_verdict.verifaScore}) — preskakujem LLM.")
                return
            else:
                logger.info(f"Re-run LLM pre IČO {ico}: {', '.join(reasons)}")

        # Fallback: ak operatingCashFlow chýba (zjednodušený výkaz bez CF), vypočítaj nepriamou metódou
        # Musí sa aplikovať PRED dumpom a scorecardom, inak P3 pilier ukáže "Cash Flow: N/A"
        if company.financialStatements:
            estimate_missing_cash_flow(company.financialStatements)

        # Jediný model_dump — po estimácii CF, aby obsahoval odhadované hodnoty
        company_dict = company.model_dump(exclude_none=False)

        # Sanitizácia: 0 pre cash flow polia = chýbajúce dáta (artefakt starého LLM promptu)
        # Konvertujeme na None, aby LLM judge nevidel operatingCashFlow: 0 a nepísal o "nulovom cash flow"
        for stmt in company_dict.get("financialStatements", []):
            sanitize_cash_flow_fields(stmt)
        
        # Cesta B: Deterministická agregácia a výpočet 5-ročného trendu
        scorecard = None
        if company.financialStatements:
            # Zoradiť a skrátiť na posledných 5 rokov — konzistentné s report_generator.py
            sorted_stmts = sorted(company.financialStatements, key=lambda s: s.year, reverse=True)[:5]
            company.financialStatements = sorted_stmts
            company_dict["financialStatements"] = [
                {f: getattr(s, f, None) for f in (
                    'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
                    'shortTermLiabilities', 'longTermLiabilities', 'staffCosts', 'depreciation',
                    'interestExpense', 'incomeTax', 'operatingCashFlow', 'investingCashFlow', 'financingCashFlow',
                    'cashAndEquivalents', 'grossProfit', 'currentAssets', 'inventory',
                    'tradeReceivables', 'tradePayables', 'socialInsuranceLiabilities',
                    'taxLiabilities', 'employeeLiabilities', 'employeeCount', 'monthsInPeriod',
                    'statementType', 'auditorOpinion', 'narrativeRisk', 'notesRisk',
                )}
                for s in sorted_stmts
            ]
            trends = compute_financial_trends(company.financialStatements)
            scorecard = compute_forensic_scorecard(company_dict, trends)
            trends["algorithmic_prescore"] = scorecard.total_score
            trends["scorecard_breakdown"] = [
                {
                    "name": p.name,
                    "score": p.score,
                    "max_score": p.max_score,
                    "detail": p.detail,
                    "flags": p.flags,
                }
                for p in scorecard.pillars
            ]
            company_dict["analyza_trendov"] = trends

            
        company_data = json.dumps(company_dict, default=str)

        # Chief Auditor dostáva všetky dáta z DB (FinancialMetrics, NarrativeRisk, NotesRisk,
        # VestnikEvents, CompanyEvents z PDF Reader Agent). Už nepotrebuje raw PDF text.
        event_count = len(company_dict.get("companyEvents", []))
        logger.info(f"Spúšťam Cross-Analysis + Chief Auditor pre IČO: {ico}. CompanyEvents z DB: {event_count}")

        # ── Cross-Analysis Agent (Flash) — krížová analýza, executive_summary + key_risk ──
        # Cross-Analysis dostáva analyza_trendov (pomery, trendy, Altman Z) + kľúčové
        # finančné metriky z výkazov, aby mohla skutočne krížovo analyzovať.
        narrative_by_year = []
        notes_by_year = []
        key_metrics_by_year = []
        for stmt in company_dict.get("financialStatements", []):
            nr = stmt.get("narrativeRisk")
            if nr:
                narrative_by_year.append({"rok": stmt.get("year"), "narrativeRisk": nr})
            notes = stmt.get("notesRisk")
            if notes:
                notes_by_year.append({"rok": stmt.get("year"), "notesRisk": notes})
            # Kľúčové metriky pre krížovú analýzu (nie plné výkazy, len pomery a absolúty)
            key_metrics_by_year.append({
                "rok": stmt.get("year"),
                "totalAssets": stmt.get("totalAssets"),
                "currentAssets": stmt.get("currentAssets"),
                "equity": stmt.get("equity"),
                "shortTermLiabilities": stmt.get("shortTermLiabilities"),
                "mainActivityRevenue": stmt.get("mainActivityRevenue"),
                "netProfitLoss": stmt.get("netProfitLoss"),
                "operatingCashFlow": stmt.get("operatingCashFlow"),
                "cashAndEquivalents": stmt.get("cashAndEquivalents"),
                "staffCosts": stmt.get("staffCosts"),
                "tradeReceivables": stmt.get("tradeReceivables"),
                "tradePayables": stmt.get("tradePayables"),
                "employeeCount": stmt.get("employeeCount"),
                "auditorOpinion": stmt.get("auditorOpinion"),
            })

        # Extrahuj findings z registry sources pre LLM kontext
        registry_findings = []
        registry_status_summary = []
        for src in (registry_sources or []):
            if not src:
                continue
            src_type = getattr(src, 'source_type', 'UNKNOWN')
            src_status = getattr(src, 'status', 'UNKNOWN')
            src_findings = getattr(src, 'findings', None) or ""
            if src_status != "SUCCESS":
                # FAILED/UNAVAILABLE scrapery sa nezahrnú do findings,
                # ale zaznamenaj ich do status summary aby LLM nehalucinoval
                # že sú "čisté" keď sa fakt neoverili.
                registry_status_summary.append(
                    f"{src_type}: UNVERIFIED (scraper zlyhal — dáta sa nepodarilo overiť, "
                    f"NIE je to 'čistý register', NEZÁVERUJ že subjekt nie je dlžník)"
                )
                continue
            registry_findings.append({
                "source_type": src_type,
                "findings": src_findings[:2000] if isinstance(src_findings, str) else str(src_findings)[:2000],
            })
            # Build explicit status summary for anti-hallucination grounding
            is_clean = any(kw in src_findings.lower() for kw in [
                "žiadny záznam", "bez záznamu", "nie je v zozname", "nebolo nájdené",
                "no record", "not in the list", "žiadne poverenie",
                "nemá negatívne", "nie je evidovaný",
            ])
            if is_clean:
                registry_status_summary.append(f"{src_type}: CLEAN (žiadny záznam o dlhu/exekúcii)")
            else:
                registry_status_summary.append(f"{src_type}: RECORD_FOUND")

        cross_input_dict = {
            "ico": company_dict.get("ico"),
            "name": company_dict.get("name"),
            "naceText": company_dict.get("naceText"),
            "analyza_trendov": company_dict.get("analyza_trendov", {}),
            "key_metrics_by_year": key_metrics_by_year,
            "narrativeRisk_by_year": narrative_by_year,
            "notesRisk_by_year": notes_by_year,
            "vestnikEvents": company_dict.get("vestnikEvents", []),
            "companyEvents": company_dict.get("companyEvents", []),
            "registryFindings": registry_findings,
            "registryStatusSummary": registry_status_summary,
            **({"_agent_warnings": [
                f"POZOR: Agent '{a}' zlyhal počas analýzy — jeho výstupy môžu chýbať. "
                f"Zváž zníženie istoty skóre."
                for a in (failed_agents or [])
            ]} if failed_agents else {}),
        }
        cross_input_json = json.dumps(cross_input_dict, default=str, ensure_ascii=False)
        logger.info(f"Cross-Analysis vstup: {len(cross_input_json)} chars (redukovaný z {len(company_data)} chars)")

        # Redukovaný vstup pre Chief Auditora — obsahuje kľúčové metriky z výkazov,
        # ale neposiela znova plné texty naratívnych/poznámkových analýz (tie sú v cross_input_dict).
        auditor_input_dict = {
            **cross_input_dict,
            "financialStatements": [
                {
                    "year": stmt.get("year"),
                    "auditorOpinion": stmt.get("auditorOpinion"),
                    "monthsInPeriod": stmt.get("monthsInPeriod"),
                    "isConsolidated": stmt.get("isConsolidated"),
                    "currency": stmt.get("currency"),
                    "statementType": stmt.get("statementType"),
                    "totalAssets": stmt.get("totalAssets"),
                    "currentAssets": stmt.get("currentAssets"),
                    "equity": stmt.get("equity"),
                    "shortTermLiabilities": stmt.get("shortTermLiabilities"),
                    "longTermLiabilities": stmt.get("longTermLiabilities"),
                    "mainActivityRevenue": stmt.get("mainActivityRevenue"),
                    "grossProfit": stmt.get("grossProfit"),
                    "netProfitLoss": stmt.get("netProfitLoss"),
                    "cashAndEquivalents": stmt.get("cashAndEquivalents"),
                    "operatingCashFlow": stmt.get("operatingCashFlow"),
                    "staffCosts": stmt.get("staffCosts"),
                    "tradeReceivables": stmt.get("tradeReceivables"),
                    "tradePayables": stmt.get("tradePayables"),
                    "inventory": stmt.get("inventory"),
                    "depreciation": stmt.get("depreciation"),
                    "investingCashFlow": stmt.get("investingCashFlow"),
                    "financingCashFlow": stmt.get("financingCashFlow"),
                    "interestExpense": stmt.get("interestExpense"),
                    "employeeCount": stmt.get("employeeCount"),
                }
                for stmt in company_dict.get("financialStatements", [])
            ],
        }
        auditor_input_json = json.dumps(auditor_input_dict, default=str, ensure_ascii=False)

        cross_summary = ""
        try:
            cross_result = await safe_llm_call(
                generate_cross_analysis, cross_input_json,
                model=_cfg.model_cross_analysis,
                label="Cross-Analysis Agent",
                report_language=report_language,
            )
            cross_summary = json.dumps({
                "executive_summary": cross_result.executive_summary,
                "key_risk": cross_result.key_risk,
            }, ensure_ascii=False)
            logger.info(f"Cross-Analysis Agent dokončený pre IČO {ico}: summary={len(cross_result.executive_summary)} chars")
        except Exception as cross_err:
            logger.warning(f"Cross-Analysis Agent zlyhal pre IČO {ico}: {cross_err} — Chief Auditor pokračuje bez neho.")

        # ── Chief Auditor — finálny verdikt + scorecard + evidence ──
        try:
            logger.info(f"Chief Auditor vstup: {len(auditor_input_json)} chars (redukovaný z {len(company_data)} chars)")
            verdict = await safe_llm_call(
                evaluate_audit_verdict, auditor_input_json,
                model=_cfg.model_verdict,
                label="Chief Auditor",
                report_language=report_language,
                cross_analysis_summary=cross_summary,
            )

            # ── Expert Mode: 2-pass (draft → refine) ──
            if _cfg.chief_auditor_two_pass and verdict:
                try:
                    draft_json = json.dumps(verdict.model_dump(), default=str, ensure_ascii=False)
                    refine_input = json.dumps({
                        "company_data": json.loads(auditor_input_json),
                        "draft_verdict": json.loads(draft_json),
                        "cross_analysis_summary": cross_summary,
                        "instruction": "Refine the draft verdict. Improve logical flow, remove repetitions, deepen analysis of hidden connections, and make recommendations more specific and actionable. Keep all factual numbers unchanged.",
                    }, ensure_ascii=False, default=str)
                    logger.info(f"Chief Auditor 2-pass (refine): {len(refine_input)} chars")
                    refined = await safe_llm_call(
                        evaluate_audit_verdict, refine_input,
                        model=_cfg.model_verdict,
                        label="Chief Auditor (refine pass)",
                        report_language=report_language,
                        cross_analysis_summary=cross_summary,
                    )
                    if refined:
                        verdict = refined
                        logger.info(f"Chief Auditor 2-pass (refine) dokončený pre IČO {ico}")
                except Exception as refine_err:
                    logger.warning(f"Chief Auditor 2-pass (refine) zlyhal pre IČO {ico}: {refine_err} — používam draft z 1. pass.")

        except Exception as llm_err:
            logger.error(f"Chief Auditor LLM zlyhal pre IČO {ico}: {type(llm_err).__name__}: {llm_err} — používam algoritmický fallback.", exc_info=True)
            verdict = _build_fallback_verdict(company_dict, scorecard, report_language=report_language)

        # ── Report QA Agent (Flash) — verifikácia verdiktu proti zdrojovým dátam ──
        qa_discrepancies = []
        try:
            verdict_json = json.dumps(verdict.model_dump(), default=str, ensure_ascii=False)
            qa_result = await safe_llm_call(
                verify_report_quality, verdict_json, company_data,
                model=_cfg.model_qa, label="Report QA Agent",
                report_language=report_language,
            )
            if qa_result and not qa_result.overall_ok:
                qa_discrepancies = qa_result.discrepancies
                for d in qa_discrepancies:
                    if d.severity == "CRITICAL":
                        logger.warning(f"[QA CRITICAL] IČO {ico}: {d.field} — verdict={d.verdict_value} vs source={d.source_value}")
                    else:
                        logger.info(f"[QA {d.severity}] IČO {ico}: {d.field} — verdict={d.verdict_value} vs source={d.source_value}")
            else:
                qa_score = getattr(qa_result, "quality_score", None)
                logger.info(f"[QA OK] IČO {ico}: Report QA Agent nenašiel nezrovnalosti (quality_score={qa_score})")
        except Exception as qa_err:
            logger.warning(f"Report QA Agent zlyhal pre IČO {ico}: {qa_err} — preskakujem QA kontrolu.")

        # Ak QA našlo CRITICAL nezrovnalosti, zavoláme Chief Auditora znova so spätnou väzbou.
        if qa_discrepancies and any(d.severity == "CRITICAL" for d in qa_discrepancies):
            try:
                qa_discrepancies_json = json.dumps([d.model_dump() for d in qa_discrepancies], ensure_ascii=False)
                logger.warning(f"[QA RE-RUN] IČO {ico}: re-running Chief Auditor with {len(qa_discrepancies)} discrepancies")
                verdict = await safe_llm_call(
                    evaluate_audit_verdict, auditor_input_json,
                    model=_cfg.model_verdict,
                    label="Chief Auditor (QA re-run)",
                    report_language=report_language,
                    cross_analysis_summary=cross_summary,
                    qa_discrepancies_json=qa_discrepancies_json,
                )
            except Exception as rerun_err:
                logger.warning(f"[QA RE-RUN] IČO {ico}: re-run zlyhal: {rerun_err} — používam pôvodný verdict.")

        # ── Fix 3: Deterministické verifaScore ─────────────────────────────────
        # verifaScore = compute_forensic_scorecard().total_score (vždy, bez ohľadu na LLM).
        # LLM forenzný adjustment (llm_score_adjustment) je len informatívny — neukladá sa do skóre.
        # Fallback na verdict.verifa_score len ak neexistujú finančné výkazy (firma bez dát).
        deterministic_score = scorecard.total_score if scorecard is not None else verdict.verifa_score
        llm_adj = getattr(verdict, "llm_score_adjustment", 0) or 0

        # ── ORSR Management Anomaly override ────────────────────────────────────
        # Ak LLM (Chief Auditor) nastaví white_horse_risk_dismissed=True,
        # zrušíme ORSR forenznú penalizáciu z deterministic_score.
        wh_dismissed = getattr(verdict, "white_horse_risk_dismissed", False)
        wh_refund = 0
        if wh_dismissed and scorecard is not None:
            for p in scorecard.pillars:
                if "ORSR" in p.name and p.score < 0:
                    wh_refund += abs(p.score)
                    logger.info(f"[MGMT ANOMALY OVERRIDE] IČO {ico}: LLM dismissed mgmt anomaly risk — refunding {abs(p.score)}b ORSR penalty")
            if wh_refund > 0:
                deterministic_score = min(100, deterministic_score + wh_refund)

        logger.info(
            f"Ukladám AuditVerdict pre IČO {ico}: "
            f"Score={deterministic_score} (algo{f'+{wh_refund}b WH override' if wh_refund else ''}), "
            f"LLM_adj={llm_adj:+d}, "
            f"Debt Rating: {verdict.debt_exposure_rating}, Status: {verdict.llm_analysis_status}"
        )

        final_score = max(0, min(100, deterministic_score + llm_adj))

        # Deterministická risk_category — Python lookup namiesto LLM
        # Fallback na LLM hodnotu len ak neexistujú finančné výkazy (INSUFFICIENT_DATA)
        if scorecard is not None:
            if final_score >= 90:
                _risk_category = "AAA"
            elif final_score >= 70:
                _risk_category = "A"
            elif final_score >= 40:
                _risk_category = "B"
            else:
                _risk_category = "C"
        else:
            _risk_category = verdict.risk_category

        verdict_payload = {
            'verifaScore': final_score,
            'riskCategory': _risk_category,
            'debtExposureRating': verdict.debt_exposure_rating,
            'finalVerdict': _sanitize_verdict_text(verdict.final_verdict),
            'executiveSummary': _sanitize_verdict_text(verdict.executive_summary),
            'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
            'keyRisk': _sanitize_verdict_text(verdict.kľúčové_riziko),
            'scorecardBreakdown': Json(company_dict.get("analyza_trendov", {}).get("scorecard_breakdown", [])),
            'llmScoreAdjustment': llm_adj,
            'llmAnalysisStatus': verdict.llm_analysis_status,
        }

        # ── Deterministická anti-halucinácia: odstráň neoveriteľné dlhy z verdict textu ──
        # Ak LLM spomenie konkrétne sumy dlhov voči registrom, ktoré sú CLEAN,
        # tieto pasáže nahradíme varovaním o halucinácii.
        verdict_payload = _strip_hallucinated_debts(verdict_payload, registry_status_summary, ico)
        await save_audit_verdict(ico, verdict_payload)

    except Exception as e:
        logger.error(f"Chyba pri generovaní AuditVerdict pre IČO {ico}: {e}", exc_info=True)


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


def _remaining_eta(t_start: float, baseline: float) -> int:
    """Vypočíta dynamický remaining ETA z uplynutého času a baseliny."""
    elapsed = time.perf_counter() - t_start
    return max(5, int(baseline - elapsed))



async def process_company(
    ico: str,
    report_request_id: Optional[str] = None,
    report_language: str = "sk",
    ruz_files: Optional[list] = None,
    ov_events: Optional[list] = None,
):
    """
    Hlavný orchestrátor pre dané IČO.
    1. Sťahuje finančné a výročné správy a spracuje ich cez LLM.
    2. Scrapuje záznamy z Obchodného vestníka (XML) a spracuje ich cez LLM.

    ruz_files: ak je zadaný (zo ScrapedSource.raw_data REGISTER_UZ), preskočí download z RÚZ API.
    ov_events: ak je zadaný (zo ScrapedSource.findings OBCHODNY_VESTNIK), preskočí run_xml.
    """
    log_pipeline_start(ico, report_request_id or "-")
    _t_start = time.perf_counter()
    _ifrs_count = 0
    _vs_count = 0

    from src.db_repository import get_avg_completion_seconds, get_report_request_company_name, upsert_company_name, update_ai_status
    
    avg_seconds = await get_avg_completion_seconds()
    if avg_seconds and avg_seconds > 0:
        pipeline_baseline = avg_seconds
        logger.info(f"[PIPELINE] Dynamická baseline ETA: {avg_seconds:.0f}s (z histórie behov)")
    else:
        pipeline_baseline = _PIPELINE_BASELINE_FALLBACK
        
    company_name = None
    if report_request_id:
        company_name = await get_report_request_company_name(report_request_id)

    # Fallback placeholder ak nemáme reálny názov z ORSR
    fallback_name = company_name or f"Spoločnosť s IČO {ico}"
    
    await upsert_company_name(ico, company_name or fallback_name)
    
    await update_ai_status(report_request_id, "ai.downloading", _remaining_eta(_t_start, pipeline_baseline))
        
    # 1. Stiahnutie z RÚZ (IFRS a VS) — preskočí ak scraper už stiahol súbory
    if ruz_files:
        logger.info(f"[PIPELINE] RÚZ: použijem {len(ruz_files)} súborov zo scraper fázy (bez duplicitného downloadu)")
        downloaded_files = [f for f in ruz_files if os.path.exists(f)]
    else:
        with PhaseTimer("RÚZ download"):
            downloaded_files = await download_ifrs_reports(ico, max_years=_cfg.ruz_max_years, output_dir=f"assets/{ico}")

    if not downloaded_files:
        logger.error(f"[PIPELINE] CRITICAL: Žiadne finančné výkazy z RÚZ pre IČO {ico} — report bude bez finančnej analýzy!")
    
    await update_ai_status(report_request_id, "ai.analyzing_statements", _remaining_eta(_t_start, pipeline_baseline))
    # Krátko po začiatku analýzy aktualizujeme na konkrétnejší status
    await asyncio.sleep(2)
    await update_ai_status(report_request_id, "ai.extracting_financials", _remaining_eta(_t_start, pipeline_baseline))
    # 2. Rozdelenie súborov na IFRS a VS
    ifrs_files = []
    vs_files = []
    for fp in downloaded_files:
        fn = os.path.basename(fp)
        if fn.startswith("IFRS_") or fn.startswith("SKGAAP_"):
            ifrs_files.append(fp)
        elif fn.startswith("VS_"):
            vs_files.append(fp)

    # Zoznam pre zbieranie extrahovaných dát (pre cross-year duplicate check)
    _ifrs_results: list[CompanyFinancialExtraction] = []

    # Smart routing: Pre firmy, ktoré zverejňujú IFRS závierku ako súčasť Výročnej správy (napr. OMV),
    # je samostatný IFRS_ súbor často len 1-stranová obálka. Ak IFRS_ dokument má <= 2 strany
    # a existuje VS_ dokument pre daný rok, presmerujeme IFRS analýzu na VS_ dokument.
    for i, ifrs_fp in enumerate(ifrs_files):
        try:
            doc = fitz.open(ifrs_fp)
            pages = doc.page_count
            doc.close()
            if pages <= 2:
                # Nájdi zodpovedajúci VS súbor pre tento rok
                year = _extract_year_from_fn(ifrs_fp)
                vs_match = next((f for f in vs_files if _extract_year_from_fn(f) == year), None)
                if vs_match:
                    logger.info(f"[{get_correlation_id() or '-'}] Smart routing: {os.path.basename(ifrs_fp)} má len {pages} strany. Nahrádzam ho {os.path.basename(vs_match)} pre finančnú analýzu.")
                    ifrs_files[i] = vs_match
        except Exception as e:
            pass

    _ifrs_count = len(ifrs_files)
    _vs_count = len(vs_files)
    logger.info(f"[{get_correlation_id() or '-'}] Files: IFRS={_ifrs_count} VS={_vs_count}")

    async def _process_ifrs(file_path: str, sem: asyncio.Semaphore):
        """Spracuje jeden IFRS PDF: pošle celé PDF do Gemini v jednom volaní (Flash má 1M token context).

        Pre SK GAAP .txt súbory s .metrics.json sidecarom preskočí LLM a použije priamo parsované dáta.
        RÚZ "notes" PDF (prílohy k SK GAAP) preskočí — inak by prázdne metriky z LLM prepísali parsované dáta.
        """
        file_name = os.path.basename(file_path)
        try:
            logger.info(f"Spracovávam finančné výkazy: {file_name}")

            # ── RÚZ notes PDF (auditor reports / poznámky k SK GAAP) — preskočíme LLM extrakciu ──
            if file_path.lower().endswith(".pdf") and "notes" in file_name.lower():
                logger.info(f"[SK_GAAP NOTES] {file_name} — preskakujem LLM extrakciu (bude spracované cez _process_notes)")
                return

            # ── SK GAAP fast path: check for JSON-parsed metrics sidecar ──
            if file_path.lower().endswith(".txt"):
                from src.ruz_parser import load_metrics_sidecar, metrics_to_extraction
                parsed_metrics = load_metrics_sidecar(file_path)
                if parsed_metrics is not None and parsed_metrics.celkove_aktiva is not None:
                    logger.info(f"[SK_GAAP PARSED] {file_name} → rok={parsed_metrics.rok_zavierky} "
                                f"assets={parsed_metrics.celkove_aktiva} revenue={parsed_metrics.trzby_z_hlavnej_cinnosti} "
                                f"(preskakujem LLM)")
                    data = metrics_to_extraction(parsed_metrics, ico, company_name or fallback_name)
                    _ifrs_results.append(data)
                    return
                else:
                    reason = "žiadny metrics sidecar" if parsed_metrics is None else "parser extrahoval None hodnoty (prázdne tabuľky)"
                    logger.warning(f"[SK_GAAP] {file_name} — {reason}, používam LLM extrakciu")

            async with sem:
                if file_path.lower().endswith(".pdf"):
                    data, verify_data = await asyncio.gather(
                        safe_llm_call(
                            extract_financial_data, file_path,
                            model=_MODEL_IFRS, label=f"Financial Statements Analyst:{file_name}"
                        ),
                        safe_llm_call(
                            verify_critical_numbers_blind, file_path,
                            model=_cfg.model_fallback, label=f"Financial Verification Analyst:{file_name}"
                        )
                    )
                else:
                    data = await safe_llm_call(
                        extract_financial_data, file_path,
                        model=_MODEL_IFRS, label=f"Financial Statements Analyst:{file_name}"
                    )
                    verify_data = None

            if data:
                if verify_data:
                    def values_match(pro: Optional[float], flash: Optional[float], tolerance: float = 0.01) -> bool:
                        if pro is None or flash is None:
                            return False
                        if pro == 0 and flash == 0:
                            return True
                        return abs(pro - flash) / max(abs(pro), abs(flash)) <= tolerance

                    check_fields = [
                        "celkove_aktiva", "trzby_z_hlavnej_cinnosti", 
                        "zisk_alebo_strata_po_zdaneni", "vlastne_imanie_celkom", 
                        "ciste_penazne_toky_z_prevadzkovej_cinnosti",
                        "danove_zavazky",
                    ]
                    
                    for field in check_fields:
                        val_pro = getattr(data.metriky, field, None)
                        val_flash = getattr(verify_data, field, None)
                        
                        if val_flash is None:
                            data.verification_confidence.append(VerificationConfidenceItem(field=field, confidence="MEDIUM"))
                        elif values_match(val_pro, val_flash):
                            data.verification_confidence.append(VerificationConfidenceItem(field=field, confidence="HIGH"))
                        else:
                            data.verification_confidence.append(VerificationConfidenceItem(field=field, confidence="LOW"))
                            logger.warning(f"[VERIFY MISMATCH] {file_name}: {field} PRO={val_pro} FLASH={val_flash} -> KEEPING PRO VALUE (LOW CONFIDENCE)")

                if data.metriky.osobne_naklady is None:
                    logger.info(f"[STAFF COSTS RETRY] Osobné náklady chýbajú. Spúšťam cielene vyhľadávanie v {file_name}")
                    async with sem:
                        staff_costs = await safe_llm_call(
                            extract_staff_costs_focused, file_path,
                            model=_MODEL_IFRS, label=f"Financial Statements Analyst STAFF-COSTS:{file_name}",
                            report_language=report_language,
                        )
                    if staff_costs is not None:
                        data.metriky.osobne_naklady = staff_costs
                        logger.info(f"[STAFF COSTS RETRY] Osobné náklady doplnené: {staff_costs} pre {file_name}")
                    else:
                        logger.warning(f"[STAFF COSTS RETRY] Osobné náklady sa nepodarilo nájsť v {file_name}")

                # Fallback: compute missing balance sheet totals from sub-items
                # NEPREPISUJ polia, ktoré verifikácia nastavila na None (LOW confidence mismatch)
                m = data.metriky
                _low_confidence_fields = {item.field for item in data.verification_confidence if item.confidence == "LOW"}
                if m.obezny_majetok is None:
                    current_sub = [v for v in [m.zasoby, m.pohladavky_z_obchodneho_styku, m.peniaze_a_penazne_ekvivalenty_k_31_12] if v is not None]
                    if len(current_sub) >= 2:
                        m.obezny_majetok = sum(current_sub)
                        logger.info(f"[FALLBACK] {file_name}: obezny_majetok vypočítané z sub-items: {m.obezny_majetok}")
                if m.celkove_aktiva is None and m.obezny_majetok is not None and "celkove_aktiva" not in _low_confidence_fields:
                    m.celkove_aktiva = m.obezny_majetok
                    logger.info(f"[FALLBACK] {file_name}: celkove_aktiva aproximované z obežného majetku: {m.celkove_aktiva}")
                if m.vlastne_imanie_celkom is None and m.celkove_aktiva is not None and "vlastne_imanie_celkom" not in _low_confidence_fields:
                    if m.kratkodobe_zavazky is not None and m.dlhodobe_zavazky is not None:
                        computed_equity = m.celkove_aktiva - (m.kratkodobe_zavazky + m.dlhodobe_zavazky)
                        if computed_equity > 0:
                            m.vlastne_imanie_celkom = computed_equity
                            logger.warning(f"[FALLBACK-APPROX] {file_name}: vlastne_imanie aproximované (horný odhad): {m.vlastne_imanie_celkom}")
                        else:
                            logger.warning(f"[FALLBACK-SKIP] {file_name}: vlastne_imanie by bolo záporné ({computed_equity}) — preskakujem")
                logger.info(
                    f"[IFRS OK] {file_name} → rok={data.metriky.rok_zavierky} "
                    f"ico={data.ico} assets={data.metriky.celkove_aktiva} "
                    f"revenue={data.metriky.trzby_z_hlavnej_cinnosti}"
                )
                _ifrs_results.append(data)
            else:
                logger.warning(f"[IFRS EMPTY] {file_name} → safe_llm_call vrátil None")
        except Exception as e:
            logger.error(f"Chyba pri spracovaní súboru {file_name}: {e}", exc_info=True)

    async def _process_vs(file_path: str, sem: asyncio.Semaphore):
        """Spracuje jeden VS PDF: Gemini naratívna analýza → DB save."""
        file_name = os.path.basename(file_path)
        async with sem:
            try:
                logger.info(f"Spracovávam výročnú správu (Narrative): {file_name} (model: {_MODEL_NARRATIVE})")
                yr_match = re.search(r'_(\d{4})_', file_name)
                narrative_year = int(yr_match.group(1)) if yr_match and int(yr_match.group(1)) > 2000 else datetime.today().year
                
                sliced_path = slice_narrative_pdf(file_path)
                input_path = sliced_path if sliced_path else file_path
                
                narrative = await safe_llm_call(
                    extract_narrative_risk, input_path,
                    model=_MODEL_NARRATIVE, label=f"Annual Report Analyst:{file_name}",
                    report_language=report_language,
                )
                if narrative:
                    logger.info(f"[NARRATIVE OK] {file_name} → DB uložené")
                    await save_narrative_to_db(ico, narrative_year, narrative)
                else:
                    logger.warning(f"[NARRATIVE EMPTY] {file_name} → safe_llm_call vrátil None")
                    
                if sliced_path and sliced_path != file_path:
                    try:
                        os.remove(sliced_path)
                    except OSError:
                        pass
            except Exception as e:
                logger.error(f"Chyba pri spracovaní súboru {file_name}: {e}", exc_info=True)

    # Notes výsledok — LLM beží paralelne, ale DB save je odložený až po IFRS save
    # (save_notes_to_db vyžaduje existujúci FinancialStatement záznam).
    _notes_result: dict = {}

    async def _process_notes(sem: asyncio.Semaphore):
        """Footnotes Analyst: extrahuje poznámky pre posledné 2 roky paralelne.
        Beží paralelne s IFRS/VS extrakciou. DB save je odložený (viď _notes_result)"""
        try:
            sorted_ifrs = sorted(ifrs_files, key=_extract_year_from_fn, reverse=True)[:2]
            candidates = []
            for fp in sorted_ifrs:
                sliced = slice_notes_pdf(fp)
                if sliced:
                    candidates.append((fp, sliced))

            if not candidates:
                return

            async def _fetch_notes(fp: str, sliced_path: str):
                year = _extract_year_from_fn(fp)
                file_name = os.path.basename(fp)
                logger.info(f"[NOTES] Spracovávam poznámky pre rok {year} z {file_name}")
                try:
                    async with sem:
                        return year, await safe_llm_call(
                            extract_notes_risks, sliced_path,
                            model=_MODEL_NOTES, label=f"Footnotes Analyst:{file_name}",
                            report_language=report_language,
                        )
                finally:
                    try:
                        os.remove(sliced_path)
                    except OSError:
                        pass

            notes_results = await asyncio.gather(
                *[_fetch_notes(fp, sliced) for fp, sliced in candidates],
                return_exceptions=True,
            )
            # Vyber najnovší rok s dátami
            for res in notes_results:
                if isinstance(res, tuple):
                    year, notes_data = res
                    if notes_data and "year" not in _notes_result:
                        _notes_result["year"] = year
                        _notes_result["data"] = notes_data
                elif isinstance(res, Exception):
                    logger.error(f"Chyba pri spracovaní poznámok: {res}", exc_info=True)
        except Exception as e:
            logger.error(f"Chyba pri spracovaní poznámok: {e}", exc_info=True)

    # Vestník: použi už stiahnuté dáta zo scraper fázy, alebo spusti nový scrape
    async def _process_vestnik():
        try:
            if ov_events is not None:
                logger.info(f"[Vestník] Používam {len(ov_events)} eventov zo scraper fázy (bez duplicitného scrapu)")
                ov_result = {"status": "SUCCESS", "events": ov_events, "white_horse_risk": False, "cross_event_pattern": ""}
            else:
                logger.info(f"Spracovávam Obchodný vestník pre IČO: {ico}")
                ov_scraper = ObchodnyVestnikXmlScraper()
                ov_result = await ov_scraper.run_xml(ico=ico)

            if ov_result.get("status") == "SUCCESS" and ov_result.get("events"):
                await save_vestnik_events_to_db(ico, ov_result["events"])

            if ov_result.get("white_horse_risk") and ov_result.get("cross_event_pattern"):
                from src.agents.pdf_reader import CompanyEvent as PdfCompanyEvent
                white_horse_event = PdfCompanyEvent(
                    source="OBCHODNY_VESTNIK",
                    event_type="WHITE_HORSE_PATTERN",
                    severity="CRITICAL",
                    title="Vzorec spoločnosti s redukovanou substanciou detekovaný",
                    description=ov_result["cross_event_pattern"],
                    event_date=None,
                    amount=None,
                    metadata={"detection_method": "vestnik_batch_cross_analysis"},
                )
                await append_company_event_to_db(ico, white_horse_event)
                logger.warning(f"[Vestník] IČO {ico}: Mgmt anomaly pattern uložený do DB ako CRITICAL CompanyEvent")
        except Exception as e:
            logger.error(f"Chyba pri spracovaní Vestníka: {e}", exc_info=True)

    vestnik_task = asyncio.create_task(_process_vestnik())

    # Paralelné spracovanie všetkých PDF naraz (IFRS + VS + Notes)
    # Semaphore(10) garantuje max 10 súčasných LLM volaní — bezpečné pre paid Gemini API
    pdf_tasks = [_process_ifrs(fp, _GLOBAL_LLM_SEM) for fp in ifrs_files] + \
                [_process_vs(fp, _GLOBAL_LLM_SEM) for fp in vs_files]
    if ifrs_files:
        pdf_tasks.append(_process_notes(_GLOBAL_LLM_SEM))
    if pdf_tasks:
        await update_ai_status(report_request_id, "ai.semantic_narrative", _remaining_eta(_t_start, pipeline_baseline))
        with PhaseTimer(f"LLM extrakcia ({len(pdf_tasks)} tasks)"):
            await asyncio.gather(*pdf_tasks, return_exceptions=True)

    # Cross-year unit consistency check (EUR vs tisíce EUR)
    # LLM môže pre niektoré roky vrátiť tisíce EUR namiesto EUR
    if len(_ifrs_results) >= 2:
        _check_cross_year_unit_consistency(_ifrs_results)

    # Cross-year duplicate detection pre osobné náklady
    # LLM môže duplikovať hodnotu z jedného roku do iného (najmä pri IFRS by-function výkazoch)
    if len(_ifrs_results) >= 2:
        _check_cross_year_duplicates(_ifrs_results)

    # CRITICAL CHECK: ak neboli extrahované žiadne finančné údaje, ulož varovanie
    if not _ifrs_results:
        logger.error(f"[PIPELINE] CRITICAL: Žiadne finančné údaje extrahované pre IČO {ico} — report bude bez finančnej analýzy! (ifrs_files={len(ifrs_files)}, vs_files={len(vs_files)})")
        try:
            from src.db_repository import append_company_event_to_db
            await append_company_event_to_db(ico, {
                "source": "PIPELINE",
                "eventType": "FINANCIAL_DATA_MISSING",
                "severity": "CRITICAL",
                "description": "Nepodarilo sa získať finančné údaje z RÚZ — report je bez finančnej analýzy.",
                "metadata": {"ifrs_files": len(ifrs_files), "vs_files": len(vs_files)},
            })
        except Exception as e:
            logger.warning(f"[PIPELINE] Nepodarilo sa uložiť FINANCIAL_DATA_MISSING event: {e}")

    # Uloženie do DB po duplicate checku
    for data in _ifrs_results:
        try:
            await save_to_db(data)
            logger.info(f"[IFRS SAVED] rok={data.metriky.rok_zavierky} → DB uložené")
        except Exception as e:
            logger.error(f"[IFRS SAVE ERROR] rok={data.metriky.rok_zavierky}: {e}", exc_info=True)

    # Odložený notes DB save — teraz už FinancialStatement existuje (viď _process_notes)
    if _notes_result.get("data"):
        try:
            await save_notes_to_db(ico, _notes_result["year"], _notes_result["data"])
        except Exception as e:
            logger.error(f"[NOTES SAVE ERROR] rok={_notes_result.get('year')}: {e}", exc_info=True)

    await update_ai_status(report_request_id, "ai.risk_analysis", _remaining_eta(_t_start, pipeline_baseline))
    
    # Počkáme, kým sa dokončí úloha s Vestníkom (väčšinou sa stihne počas PDF)
    await vestnik_task
        
    await update_ai_status(report_request_id, "ai.final_verdict", _remaining_eta(_t_start, pipeline_baseline))
    # Krátko po začiatku verdict fázy aktualizujeme na konkrétnejší status
    await asyncio.sleep(2)
    await update_ai_status(report_request_id, "ai.cross_validation", _remaining_eta(_t_start, pipeline_baseline))
    
    # 4. Sudca (Chief Auditor) sa spúšťa z main.py PO dokončení scraperov,
    # aby mal prístup k PDF súborom z registrov (dlhy, exekúcie, insolvencia).
    # Tu iba uložíme AI status.
        
    _elapsed = time.perf_counter() - _t_start
    logger.info(
        f"[{get_correlation_id() or '-'}] PIPELINE SUMMARY: ico={ico} "
        f"ifrs={_ifrs_count} vs={_vs_count} "
        f"models=FinStmts:{_MODEL_IFRS}|AnnReport:{_MODEL_NARRATIVE}|Footnotes:{_MODEL_NOTES}|Vestnik:{_MODEL_VESTNIK}|PDFReader:{_cfg.model_vestnik}|Chief:{_cfg.model_verdict} "
        f"elapsed={_elapsed:.1f}s"
    )
    log_pipeline_end(ico, "OK", _elapsed)

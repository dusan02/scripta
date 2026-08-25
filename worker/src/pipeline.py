from __future__ import annotations

import os
import glob
import json
import re
import logging
import time
import hashlib
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
    save_scoring_snapshot,
)

from src.log_helpers import (
    PhaseTimer, log_pipeline_start, log_pipeline_end,
    log_llm_call, log_llm_retry, get_correlation_id,
)
from src.ruz_api import download_ifrs_reports
from src.extraction_cache import (
    cache_lookup, cache_store,
    cache_lookup_generic, cache_store_generic,
    compute_pdf_hash,
    EXTRACTOR_FINANCIAL_ANALYST, EXTRACTOR_FINANCIAL_VERIFY,
    EXTRACTOR_NOTES_FORENSIC,
)
from src.llm_extractor import (
    CompanyFinancialExtraction, NarrativeRiskAnalysis, AuditVerdict, EvidenceItem,
    evaluate_audit_verdict, extract_financial_data,
    extract_narrative_risk, extract_notes_risks, extract_staff_costs_focused,
    verify_critical_numbers_blind, generate_cross_analysis,
    verify_report_quality, VerificationConfidenceItem,
)
from src.scrapers.obchodny_vestnik import ObchodnyVestnikXmlScraper, save_vestnik_events_to_db
from src.report_generator import generate_forensic_pdf_report
from src.pdf_ingestion import extract_core_financials, slice_narrative_pdf, slice_notes_pdf, extract_relevant_pdf_chunks, get_sliced_pdf_page_range
from src.llm_orchestrator import safe_llm_call, _MODEL_IFRS, _MODEL_NARRATIVE, _MODEL_NOTES, _MODEL_VESTNIK, check_pro_model_available, get_chief_auditor_model
from src.agents.pdf_reader import extract_company_events
from src.analytics import sanitize_cash_flow_fields, estimate_missing_cash_flow, compute_financial_trends, compute_forensic_scorecard

SCORING_VERSION = "v3"

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
        # Total liabilities (row 101 — zahŕňa rezervy + všetky záväzky)
        # Mapuje sa na totalLiabilities v DB — musí byť fixnuté spolu s ostatnými
        "celkove_cudzie_zdroje",
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


# Imports from extracted modules
from src.verdict_builder import (
    _build_fallback_verdict,
    _sanitize_verdict_text,
    _apply_orsr_override,
    _compute_deterministic_adjustment,
    run_and_save_audit_verdict,
    run_pdf_reader_agent,
    run_orsr_forensics_agent,
)
from src.verdict_metrics import (
    _format_eur,
    _format_ratio,
    _format_pct,
    _format_count,
    _yoy_text,
    _altman_zone,
    _compute_ebitda,
    build_metric_placeholders,
    inject_metrics,
    _strip_narrative_financial_metrics,
    _inject_ncrzp_findings,
    _strip_hallucinated_debts,
)

def _remaining_eta(t_start: float, baseline: float) -> int:
    """Vypočíta dynamický remaining ETA z uplynutého času a baseliny."""
    elapsed = time.perf_counter() - t_start
    return max(5, int(baseline - elapsed))


def _apply_balance_sheet_fallbacks(m, low_confidence_fields: set = None, file_name: str = ""):
    """Compute missing balance sheet totals from sub-items.

    - obezny_majetok from inventory + trade receivables + cash (if >= 2 sub-items present)
    - celkove_aktiva from obezny_majetok (if missing)
    - vlastne_imanie_celkom from celkove_aktiva - liabilities (including reserves + bank loans)

    NEPREPISUJ polia, ktoré verifikácia nastavila na None (LOW confidence mismatch).
    """
    if low_confidence_fields is None:
        low_confidence_fields = set()

    if m.obezny_majetok is None:
        current_sub = [v for v in [m.zasoby, m.pohladavky_z_obchodneho_styku, m.peniaze_a_penazne_ekvivalenty_k_31_12] if v is not None]
        if len(current_sub) >= 2:
            m.obezny_majetok = sum(current_sub)
            logger.info(f"[FALLBACK] {file_name}: obezny_majetok vypočítané z sub-items: {m.obezny_majetok}")
    if m.celkove_aktiva is None and m.obezny_majetok is not None and "celkove_aktiva" not in low_confidence_fields:
        m.celkove_aktiva = m.obezny_majetok
        logger.info(f"[FALLBACK] {file_name}: celkove_aktiva aproximované z obežného majetku: {m.celkove_aktiva}")
    if m.vlastne_imanie_celkom is None and m.celkove_aktiva is not None and "vlastne_imanie_celkom" not in low_confidence_fields:
        if m.kratkodobe_zavazky is not None and m.dlhodobe_zavazky is not None:
            liabilities = m.kratkodobe_zavazky + m.dlhodobe_zavazky
            if getattr(m, 'dlhodobe_rezervy', None) is not None:
                liabilities += m.dlhodobe_rezervy
            if getattr(m, 'kratkodobe_rezervy', None) is not None:
                liabilities += m.kratkodobe_rezervy
            if getattr(m, 'bezne_bankove_uvery', None) is not None:
                liabilities += m.bezne_bankove_uvery
            computed_equity = m.celkove_aktiva - liabilities
            if computed_equity > 0:
                m.vlastne_imanie_celkom = computed_equity
                logger.warning(f"[FALLBACK-APPROX] {file_name}: vlastne_imanie aproximované (horný odhad): {m.vlastne_imanie_celkom}")
            else:
                logger.warning(f"[FALLBACK-SKIP] {file_name}: vlastne_imanie by bolo záporné ({computed_equity}) — preskakujem")


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
    _llm_quota_exhausted = False  # True ak Gemini vrátil 429 RESOURCE_EXHAUSTED

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

            # ── Extraction cache: check if we already extracted this PDF ──
            # Cache key: pdfHash + extractor + model + promptVersion + schemaVersion
            # HIT → return cached result (0 LLM calls, 100% deterministic)
            # MISS → call LLM, store result in cache
            _pdf_hash = await asyncio.to_thread(compute_pdf_hash, file_path)
            cached_data = await cache_lookup(
                file_path,
                extractor=EXTRACTOR_FINANCIAL_ANALYST,
                model=_MODEL_IFRS,
                hash_override=_pdf_hash,
            )
            if cached_data is not None:
                logger.info(f"[CACHE] Using cached extraction for {file_name} — skipping LLM")
                _ifrs_results.append(cached_data)
                return

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

            # ── Cache the LLM extraction result ──
            if data:
                await cache_store(
                    file_path,
                    company_ico=ico,
                    extractor=EXTRACTOR_FINANCIAL_ANALYST,
                    model=_MODEL_IFRS,
                    data=data,
                    confidence="UNKNOWN",  # Will be refined by verification below
                    hash_override=_pdf_hash,
                )

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
                m = data.metriky
                _low_confidence_fields = {item.field for item in data.verification_confidence if item.confidence == "LOW"}
                _apply_balance_sheet_fallbacks(m, _low_confidence_fields, file_name)
                logger.info(
                    f"[IFRS OK] {file_name} → rok={data.metriky.rok_zavierky} "
                    f"ico={data.ico} assets={data.metriky.celkove_aktiva} "
                    f"revenue={data.metriky.trzby_z_hlavnej_cinnosti}"
                )
                _ifrs_results.append(data)
            else:
                logger.warning(f"[IFRS EMPTY] {file_name} → safe_llm_call vrátil None")
        except Exception as e:
            error_str = str(e).lower()
            if "429" in error_str or "resource_exhausted" in error_str or "all models failed" in error_str:
                nonlocal _llm_quota_exhausted
                _llm_quota_exhausted = True
                logger.error(f"[IFRS LLM_QUOTA] {file_name} → Gemini 429 RESOURCE_EXHAUSTED — extrakcia zlyhala kvôli vyčerpaným kreditom")
            else:
                logger.error(f"Chyba pri spracovaní súboru {file_name}: {e}", exc_info=True)

    async def _process_vs(file_path: str, sem: asyncio.Semaphore):
        """Spracuje jeden VS PDF: Gemini naratívna analýza → DB save."""
        file_name = os.path.basename(file_path)
        async with sem:
            try:
                logger.info(f"Spracovávam výročnú správu (Narrative): {file_name} (model: {_MODEL_NARRATIVE})")
                yr_match = re.search(r'_(\d{4})_', file_name)
                narrative_year = int(yr_match.group(1)) if yr_match and int(yr_match.group(1)) > 2000 else datetime.today().year
                
                sliced_path = await asyncio.to_thread(slice_narrative_pdf, file_path)
                input_path = sliced_path if sliced_path else file_path
                
                narrative = await safe_llm_call(
                    extract_narrative_risk, input_path,
                    model=_MODEL_NARRATIVE, label=f"Annual Report Analyst:{file_name}",
                    report_language=report_language,
                )
                if narrative:
                    _strip_narrative_financial_metrics(narrative)
                    # F4.1: Nastav source_pages z sliced PDF pre evidence grounding
                    if sliced_path and not narrative.source_pages:
                        narrative.source_pages = get_sliced_pdf_page_range(sliced_path)
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
                sliced = await asyncio.to_thread(slice_notes_pdf, fp)
                if sliced:
                    candidates.append((fp, sliced))

            if not candidates:
                return

            async def _fetch_notes(fp: str, sliced_path: str):
                year = _extract_year_from_fn(fp)
                file_name = os.path.basename(fp)
                logger.info(f"[NOTES] Spracovávam poznámky pre rok {year} z {file_name}")
                try:
                    # ── Extraction cache: check if we already extracted these notes ──
                    _pdf_hash = await asyncio.to_thread(compute_pdf_hash, sliced_path)
                    cached = await cache_lookup_generic(
                        sliced_path, extractor=EXTRACTOR_NOTES_FORENSIC,
                        model=_MODEL_NOTES, hash_override=_pdf_hash,
                    )
                    if cached is not None:
                        from src.agents.notes_forensic import NotesRiskAnalysis
                        notes_data = NotesRiskAnalysis.model_validate(cached)
                        if notes_data and not notes_data.source_pages:
                            notes_data.source_pages = get_sliced_pdf_page_range(sliced_path)
                        logger.info(f"[CACHE] Using cached notes extraction for {file_name}")
                        return year, notes_data

                    async with sem:
                        notes_data = await safe_llm_call(
                            extract_notes_risks, sliced_path,
                            model=_MODEL_NOTES, label=f"Footnotes Analyst:{file_name}",
                            report_language=report_language,
                        )
                        # F4.1: Nastav source_pages z sliced PDF pre evidence grounding
                        if notes_data and not notes_data.source_pages:
                            notes_data.source_pages = get_sliced_pdf_page_range(sliced_path)
                        # Cache the notes extraction result
                        if notes_data:
                            await cache_store_generic(
                                sliced_path, company_ico=ico,
                                extractor=EXTRACTOR_NOTES_FORENSIC,
                                model=_MODEL_NOTES, data=notes_data,
                                hash_override=_pdf_hash,
                            )
                        return year, notes_data
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
        if _llm_quota_exhausted and ifrs_files:
            # LLM bol nedostupný (429 RESOURCE_EXHAUSTED) — dáta existujú v PDF,
            # ale extrakcia zlyhala. Firma môže byť bezpečne reprocessovaná
            # keď sa Gemini credits doplnia.
            logger.error(f"[PIPELINE] EXTRACTION_PENDING: IČO {ico} — PDF súbory existujú ({len(ifrs_files)}) ale Gemini LLM je nedostupný (429). Reprocessovať po doplnení kreditov.")
            try:
                from src.db_repository import append_company_event_to_db
                await append_company_event_to_db(ico, {
                    "source": "PIPELINE",
                    "eventType": "EXTRACTION_PENDING",
                    "severity": "HIGH",
                    "description": "Finančné výkazy boli stiahnuté z RÚZ, ale extrakcia zlyhala — Gemini API credits vyčerpané (429 RESOURCE_EXHAUSTED). Reprocessovať po doplnení kreditov.",
                    "metadata": {"ifrs_files": len(ifrs_files), "vs_files": len(vs_files), "reason": "LLM_QUOTA_EXHAUSTED"},
                })
            except Exception as e:
                logger.warning(f"[PIPELINE] Nepodarilo sa uložiť EXTRACTION_PENDING event: {e}")
        else:
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

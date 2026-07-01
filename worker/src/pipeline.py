import asyncio
from typing import Optional
from prisma import Prisma
from src.llm_extractor import CompanyFinancialExtraction, NarrativeRiskAnalysis, AuditVerdict, evaluate_audit_verdict
import json
from dotenv import load_dotenv

load_dotenv()

from src.db_repository import save_to_db, save_narrative_to_db, update_ai_status, get_avg_completion_seconds

import os
import glob
import logging
import time
from src.scrapers.ruz_scraper import download_ifrs_reports
from src.llm_extractor import extract_financial_data, extract_narrative_risk, extract_notes_risks
from src.scrapers.obchodny_vestnik import ObchodnyVestnikXmlScraper, save_vestnik_events_to_db
from src.report_generator import generate_forensic_pdf_report
from src.pdf_ingestion import extract_core_financials, slice_narrative_pdf, slice_notes_pdf
from src.db_repository import save_to_db, save_narrative_to_db, save_notes_to_db, update_ai_status, get_avg_completion_seconds
from src.llm_orchestrator import safe_llm_call, _MODEL_IFRS, _MODEL_NARRATIVE, _MODEL_VESTNIK
import re

async def run_and_save_audit_verdict(ico: str):
    """
    1. Získa všetky dostupné dáta pre dané IČO z databázy (Finančné výkazy, Naratívne analýzy, Vestník).
    2. Spustí Chief Auditora.
    3. Uloží AuditVerdict do DB.
    """
    db = Prisma()
    await db.connect()
    try:
        company = await db.company.find_unique(
            where={'ico': ico},
            include={
                'financialStatements': {
                    'include': {
                        'auditorOpinion': True,
                        'narrativeRisk': True,
                        'notesRisk': True
                    }
                },
                'vestnikEvents': True
            }
        )
        if not company:
            logger.warning(f"Spoločnosť {ico} nebola nájdená pre Chief Auditora.")
            return
        # Extrahuje JSON dáta
        company_dict = company.model_dump(exclude_none=True)
        
        # Cesta B: Deterministická agregácia a výpočet 5-ročného trendu
        from src.analytics import compute_financial_trends, compute_forensic_scorecard
        if company.financialStatements:
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

            
        import json
        company_data = json.dumps(company_dict, default=str)
        
        # Hľadáme PDF súbory z registrov v results/{report_id}/ aj assets/{ico}/
        # Sudca potrebuje vidieť: dlhy poisťovniam, daňové dlhy, exekúcie, insolvenciu, diskvalifikácie
        debt_pdfs = []

        # 1. Nové cesty: results/{report_id}/ (kde scrapery ukladajú)
        results_dir = os.environ.get("RESULTS_DIR", "./results")
        for rid_dir in glob.glob(f"{results_dir}/*"):
            if os.path.isdir(rid_dir):
                debt_pdfs.extend(glob.glob(f"{rid_dir}/dovera_dlznici_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/sp_dlznici_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/vszp_dlznici_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/union_dlznici_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/insolvency_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/crz_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/diskvalifikacie_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/fs_danove_subjekty_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/fs_dph_*{ico}*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/fs_dan_*{ico}*.pdf"))

        # 2. Staré cesty: assets/{ico}/ (pre spätňu kompatibilitu)
        assets_dir = f"assets/{ico}"
        if os.path.exists(assets_dir):
            debt_pdfs.extend(glob.glob(f"{assets_dir}/DEBTS_*.pdf"))
            debt_pdfs.extend(glob.glob(f"{assets_dir}/EXC_*.pdf"))
            debt_pdfs.extend(glob.glob(f"{assets_dir}/DLZ_*.pdf"))

        # Deduplikácia (ak sa ten istý súbor nájde cez viaceré cesty)
        debt_pdfs = list(dict.fromkeys(debt_pdfs))

        logger.info(f"Spúšťam Chief Auditora (The Verifa Scorer) pre IČO: {ico}. Nájdené PDF na analýzu: {len(debt_pdfs)}")
        verdict = await safe_llm_call(
            evaluate_audit_verdict, company_data, debt_pdfs,
            model="gemini-2.5-pro",
            label="Chief Auditor"
        )
        
        logger.info(f"Ukladám AuditVerdict pre IČO {ico}: Skóre {verdict.verifa_score}, Debt Rating: {verdict.debt_exposure_rating}")
        
        from prisma import Json
        await db.auditverdict.upsert(
            where={'companyIco': ico},
            data={
                'create': {
                    'companyIco': ico,
                    'verifaScore': verdict.verifa_score,
                    'riskCategory': verdict.risk_category,
                    'debtExposureRating': verdict.debt_exposure_rating,
                    'finalVerdict': verdict.final_verdict,
                    'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
                    'keyRisk': verdict.kľúčové_riziko,
                    'scorecardBreakdown': Json(company_dict.get("analyza_trendov", {}).get("scorecard_breakdown", [])),
                },
                'update': {
                    'verifaScore': verdict.verifa_score,
                    'riskCategory': verdict.risk_category,
                    'debtExposureRating': verdict.debt_exposure_rating,
                    'finalVerdict': verdict.final_verdict,
                    'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
                    'keyRisk': verdict.kľúčové_riziko,
                    'scorecardBreakdown': Json(company_dict.get("analyza_trendov", {}).get("scorecard_breakdown", [])),
                }
            }
        )
    except Exception as e:
        logger.error(f"Chyba pri generovaní AuditVerdict pre IČO {ico}: {e}", exc_info=True)
    finally:
        await db.disconnect()

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

# Fallback baseline ak nie sú historické dáta (sekundy)
from src.config import settings as _cfg
_PIPELINE_BASELINE_FALLBACK = _cfg.pipeline_baseline_fallback

# Dynamická baseline — nastaví sa pri štarte process_company z histórie behov
_pipeline_baseline: float = _PIPELINE_BASELINE_FALLBACK

def _remaining_eta(t_start: float) -> int:
    """Vypočíta dynamický remaining ETA z uplynutého času a baseliny."""
    elapsed = time.perf_counter() - t_start
    return max(5, int(_pipeline_baseline - elapsed))



async def process_company(ico: str, report_request_id: Optional[str] = None):
    """
    Hlavný orchestrátor pre dané IČO.
    1. Sťahuje finančné a výročné správy a spracuje ich cez LLM.
    2. Scrapuje záznamy z Obchodného vestníka (XML) a spracuje ich cez LLM.
    """
    logger.info(f"Spúšťam pipeline pre IČO: {ico}")
    _t_start = time.perf_counter()
    _ifrs_count = 0
    _vs_count = 0

    global _pipeline_baseline

    db = Prisma()
    await db.connect()
    try:
        # Načítanie dynamickej baseliny z priemerného času posledných behov
        avg_seconds = await get_avg_completion_seconds(db)
        if avg_seconds and avg_seconds > 0:
            _pipeline_baseline = avg_seconds
            logger.info(f"[PIPELINE] Dynamická baseline ETA: {avg_seconds:.0f}s (z histórie behov)")
        else:
            _pipeline_baseline = _PIPELINE_BASELINE_FALLBACK
        company_name = None
        if report_request_id:
            req = await db.reportrequest.find_unique(where={'id': report_request_id})
            if req and req.companyName:
                company_name = req.companyName

        # Fallback placeholder ak nemáme reálny názov z ORSR
        fallback_name = company_name or f"Spoločnosť s IČO {ico}"

        existing = await db.company.find_unique(where={'ico': ico})
        _INVALID_NAMES = {"", "n/a", "n/a.", "none", "null", "-"}
        if existing:
            # Update ak máme reálny názov a existujúci je placeholder/N/A
            existing_is_invalid = (not existing.name) or existing.name.lower() in _INVALID_NAMES or existing.name.startswith("Spoločnosť s IČO")
            if company_name and existing_is_invalid:
                await db.company.update(where={'ico': ico}, data={'name': company_name})
        else:
            await db.company.create(data={'ico': ico, 'name': fallback_name})

        await update_ai_status(db, report_request_id, "Sťahovanie dát a štrukturálna príprava", _remaining_eta(_t_start))
        
        # 1. Stiahnutie z RÚZ (IFRS a VS)
        downloaded_files = await download_ifrs_reports(ico, max_years=_cfg.ruz_max_years, output_dir=f"assets/{ico}")
        
        await update_ai_status(db, report_request_id, "Analýza účtovných závierok", _remaining_eta(_t_start))
        
        # 2. Rozdelenie súborov na IFRS a VS
        ifrs_files = []
        vs_files = []
        for fp in downloaded_files:
            fn = os.path.basename(fp)
            if fn.startswith("IFRS_"):
                ifrs_files.append(fp)
            elif fn.startswith("VS_"):
                vs_files.append(fp)

        _ifrs_count = len(ifrs_files)
        _vs_count = len(vs_files)

        async def _process_ifrs(file_path: str, sem: asyncio.Semaphore):
            """Spracuje jeden IFRS PDF: slice → Gemini extrakcia → DB save."""
            file_name = os.path.basename(file_path)
            async with sem:
                try:
                    logger.info(f"Spracovávam finančné výkazy: {file_name} (model: {_MODEL_IFRS})")
                    sliced_path = extract_core_financials(file_path)
                    input_path = sliced_path if sliced_path else file_path
                    logger.info(f"PDF slicing: {file_name} → {os.path.basename(input_path)}")
                    data = await safe_llm_call(
                        extract_financial_data, input_path,
                        model=_MODEL_IFRS, label=f"IFRS:{file_name}"
                    )
                    
                    # Auto-retry s celým PDF, ak chýbajú kľúčové polia (odrezané poznámky)
                    if data and sliced_path and sliced_path != file_path:
                        m = data.metriky
                        if m.pohladavky_z_obchodneho_styku is None or m.zavazky_z_obchodneho_styku is None:
                            import fitz
                            doc = fitz.open(file_path)
                            total_pages = len(doc)
                            doc.close()
                            if total_pages <= 80:
                                logger.info(f"[RETRY] Dáta sú neúplné (chýbajú pohľadávky/záväzky). Spúšťam analýzu nad neskráteným PDF ({total_pages} strán): {file_name}")
                                data2 = await safe_llm_call(
                                    extract_financial_data, file_path,
                                    model=_MODEL_IFRS, label=f"IFRS-RETRY:{file_name}"
                                )
                                if data2:
                                    data = data2
                            else:
                                logger.warning(f"[RETRY SKIP] PDF má {total_pages} > 80 strán, preskakujem full-retry kvôli nákladom: {file_name}")

                    if data:
                        logger.info(
                            f"[IFRS OK] {file_name} → rok={data.metriky.rok_zavierky} "
                            f"ico={data.ico} assets={data.metriky.celkove_aktiva} "
                            f"revenue={data.metriky.trzby_z_hlavnej_cinnosti}"
                        )
                        await save_to_db(data)
                        logger.info(f"[IFRS SAVED] {file_name} → DB uložené")

                        # Extrahovanie a uloženie rizík z poznámok (presunuté do post-procesingu)
                    else:
                        logger.warning(f"[IFRS EMPTY] {file_name} → safe_llm_call vrátil None")
                    if sliced_path and sliced_path != file_path:
                        try:
                            os.remove(sliced_path)
                        except OSError:
                            pass
                except Exception as e:
                    logger.error(f"Chyba pri spracovaní súboru {file_name}: {e}", exc_info=True)

        async def _process_vs(file_path: str, sem: asyncio.Semaphore):
            """Spracuje jeden VS PDF: Gemini naratívna analýza → DB save."""
            file_name = os.path.basename(file_path)
            async with sem:
                try:
                    logger.info(f"Spracovávam výročnú správu (Narrative): {file_name} (model: {_MODEL_NARRATIVE})")
                    yr_match = re.search(r'_(\d{4})_', file_name)
                    narrative_year = int(yr_match.group(1)) if yr_match and int(yr_match.group(1)) > 2000 else 2024
                    
                    sliced_path = slice_narrative_pdf(file_path, max_pages=15)
                    input_path = sliced_path if sliced_path else file_path
                    
                    narrative = await safe_llm_call(
                        extract_narrative_risk, input_path,
                        model=_MODEL_NARRATIVE, label=f"VS:{file_name}"
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

        # Vytvorenie asynchrónnej úlohy pre Vestník, aby bežala paralelne
        async def _process_vestnik():
            logger.info(f"Spracovávam Obchodný vestník pre IČO: {ico}")
            ov_scraper = ObchodnyVestnikXmlScraper()
            try:
                ov_result = await ov_scraper.run_xml(ico=ico)
                if ov_result.get("status") == "SUCCESS" and ov_result.get("events"):
                    await save_vestnik_events_to_db(ico, ov_result["events"])
            except Exception as e:
                logger.error(f"Chyba pri paralelnom spracovaní Vestníka: {e}", exc_info=True)

        vestnik_task = asyncio.create_task(_process_vestnik())

        # Paralelné spracovanie PDF s prísnym obmedzením concurrency na max 6 LLM volaní naraz (test limitov)
        _llm_sem = asyncio.Semaphore(6)
        pdf_tasks = [_process_ifrs(fp, _llm_sem) for fp in ifrs_files] + [_process_vs(fp, _llm_sem) for fp in vs_files]
        if pdf_tasks:
            await asyncio.gather(*pdf_tasks)

        # 3b. Extrakcia poznámok (len pre najnovší rok, s fallbackom na staršie ak zlyhá)
        def _extract_year_from_fn(fp: str) -> int:
            fn = os.path.basename(fp)
            parts = fn.split('_')
            if len(parts) >= 3 and parts[2].isdigit():
                return int(parts[2])
            return 0

        sorted_ifrs = sorted(ifrs_files, key=_extract_year_from_fn, reverse=True)
        notes_attempts = 0
        for fp in sorted_ifrs:
            if notes_attempts >= 2:
                break
            year = _extract_year_from_fn(fp)
            file_name = os.path.basename(fp)
            sliced_notes_path = slice_notes_pdf(fp)
            if sliced_notes_path:
                notes_attempts += 1
                logger.info(f"[NOTES] Spracovávam poznámky pre najnovší rok {year} z {file_name}")
                notes_data = await safe_llm_call(
                    extract_notes_risks, sliced_notes_path,
                    model=_MODEL_NARRATIVE, label=f"NOTES:{file_name}"
                )
                if notes_data:
                    await save_notes_to_db(ico, year, notes_data)
                try:
                    os.remove(sliced_notes_path)
                except OSError:
                    pass
                if notes_data:
                    break # Máme poznámky, preskoč staršie roky kvôli úspore tokenov

        await update_ai_status(db, report_request_id, "Analýza rizík a udalostí (Vestník)", _remaining_eta(_t_start))
        
        # Počkáme, kým sa dokončí úloha s Vestníkom (väčšinou sa stihne počas PDF)
        await vestnik_task
            
        await update_ai_status(db, report_request_id, "Záverečný forenzný posudok", _remaining_eta(_t_start))
        
        # 4. Sudca (Chief Auditor) sa spúšťa z main.py PO dokončení scraperov,
        # aby mal prístup k PDF súborom z registrov (dlhy, exekúcie, insolvencia).
        # Tu iba uložíme AI status.
            
        _elapsed = time.perf_counter() - _t_start
        logger.info(
            f"[PIPELINE SUMMARY] ico={ico} "
            f"ifrs={_ifrs_count} vs={_vs_count} "
            f"models=IFRS:{_MODEL_IFRS}|VS:{_MODEL_NARRATIVE}|OV:{_MODEL_VESTNIK}|Verdikt:gemini-2.5-flash "
            f"elapsed={_elapsed:.1f}s"
        )
        logger.info(f"Pipeline pre IČO {ico} dokončená.")
    finally:
        await db.disconnect()

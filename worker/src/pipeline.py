import asyncio
from typing import Optional
from prisma import Prisma
from src.llm_extractor import CompanyFinancialExtraction, NarrativeRiskAnalysis, AuditVerdict, evaluate_audit_verdict
import json
from dotenv import load_dotenv

load_dotenv()

from src.db_repository import save_to_db, save_narrative_to_db, update_ai_status

import os
import glob
import logging
import time
from src.scrapers.ruz_scraper import download_ifrs_reports
from src.llm_extractor import extract_financial_data, extract_narrative_risk
from src.scrapers.obchodny_vestnik import ObchodnyVestnikXmlScraper, save_vestnik_events_to_db
from src.report_generator import generate_forensic_pdf_report
from src.pdf_ingestion import extract_core_financials

from src.llm_orchestrator import safe_llm_call, _MODEL_IFRS, _MODEL_NARRATIVE, _MODEL_VESTNIK

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
                        'narrativeRisk': True
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
            trends["algorithmic_prescore"] = compute_forensic_scorecard(company_dict, trends)
            company_dict["_5_year_trend_analysis"] = trends
            
        import json
        company_data = json.dumps(company_dict, default=str)
        
        # Hľadáme PDF súbory z registrov v results/{report_id}/ aj assets/{ico}/
        # Sudca potrebuje vidieť: dlhy poisťovniam, daňové dlhy, exekúcie, insolvenciu, diskvalifikácie
        debt_pdfs = []

        # 1. Nové cesty: results/{report_id}/ (kde scrapery ukladajú)
        results_dir = os.environ.get("RESULTS_DIR", "./results")
        for rid_dir in glob.glob(f"{results_dir}/*"):
            if os.path.isdir(rid_dir):
                debt_pdfs.extend(glob.glob(f"{rid_dir}/dovera_dlznici_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/sp_dlznici_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/vszp_dlznici_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/union_dlznici_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/insolvency_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/crz_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/diskvalifikacie_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/fs_danove_subjekty_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/fs_dph_*.pdf"))
                debt_pdfs.extend(glob.glob(f"{rid_dir}/fs_dan_*.pdf"))

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
            label="Chief Auditor"
        )
        
        logger.info(f"Ukladám AuditVerdict pre IČO {ico}: Skóre {verdict.verifa_score}, Debt Rating: {verdict.debt_exposure_rating}")
        
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
                },
                'update': {
                    'verifaScore': verdict.verifa_score,
                    'riskCategory': verdict.risk_category,
                    'debtExposureRating': verdict.debt_exposure_rating,
                    'finalVerdict': verdict.final_verdict,
                    'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
                    'keyRisk': verdict.kľúčové_riziko,
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

# Baselina pre celkový odhadovaný čas pipeline (sekundy)
_PIPELINE_BASELINE_SECONDS = 130

def _remaining_eta(t_start: float) -> int:
    """Vypočíta dynamický remaining ETA z uplynutého času a baseliny."""
    elapsed = time.perf_counter() - t_start
    return max(5, int(_PIPELINE_BASELINE_SECONDS - elapsed))



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

    db = Prisma()
    await db.connect()
    try:
        company_name = None
        if report_request_id:
            req = await db.reportrequest.find_unique(where={'id': report_request_id})
            if req and req.companyName:
                company_name = req.companyName
                
        await db.company.upsert(
            where={'ico': ico},
            data={
                'create': {'ico': ico, 'name': company_name},
                'update': {'name': company_name} if company_name else {}
            }
        )

        await update_ai_status(db, report_request_id, "Sťahovanie dát a štrukturálna príprava", _remaining_eta(_t_start))
        
        # 1. Stiahnutie z RÚZ (IFRS a VS)
        downloaded_files = await download_ifrs_reports(ico, max_years=5, output_dir=f"assets/{ico}")
        
        await update_ai_status(db, report_request_id, "Analýza účtovných závierok", _remaining_eta(_t_start))
        
        # 2. Rozdelenie súborov na IFRS a VS
        import re as _re
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
                    if data:
                        logger.info(
                            f"[IFRS OK] {file_name} → rok={data.metriky.rok_zavierky} "
                            f"ico={data.ico} assets={data.metriky.celkove_aktiva} "
                            f"revenue={data.metriky.trzby_z_hlavnej_cinnosti}"
                        )
                        await save_to_db(data)
                        logger.info(f"[IFRS SAVED] {file_name} → DB uložené")
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
                    yr_match = _re.search(r'_(\d{4})_', file_name)
                    narrative_year = int(yr_match.group(1)) if yr_match and int(yr_match.group(1)) > 2000 else 2024
                    narrative = await safe_llm_call(
                        extract_narrative_risk, file_path,
                        model=_MODEL_NARRATIVE, label=f"VS:{file_name}"
                    )
                    await save_narrative_to_db(ico, narrative_year, narrative)
                except Exception as e:
                    logger.error(f"Chyba pri spracovaní súboru {file_name}: {e}", exc_info=True)

        # Paralelné spracovanie s prísnym obmedzením concurrency na max 2 LLM volania naraz
        _llm_sem = asyncio.Semaphore(2)
        all_tasks = [_process_ifrs(fp, _llm_sem) for fp in ifrs_files] + [_process_vs(fp, _llm_sem) for fp in vs_files]
        if all_tasks:
            await asyncio.gather(*all_tasks)

        await update_ai_status(db, report_request_id, "Analýza rizík a udalostí", _remaining_eta(_t_start))

        # 3. Scrapovanie Obchodného vestníka
        logger.info(f"Spracovávam Obchodný vestník pre IČO: {ico}")
        ov_scraper = ObchodnyVestnikXmlScraper()
        try:
            ov_result = await ov_scraper.run_xml(ico=ico)
            if ov_result["status"] == "SUCCESS" and ov_result.get("events"):
                await save_vestnik_events_to_db(ico, ov_result["events"])
        except Exception as e:
            logger.error(f"Chyba pri Obchodnom vestníku: {e}", exc_info=True)
            
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

import asyncio
from prisma import Prisma
from src.llm_extractor import CompanyFinancialExtraction, NarrativeRiskAnalysis, AuditVerdict, evaluate_audit_verdict
import json
from dotenv import load_dotenv

load_dotenv()

# Lock pre serializáciu DB zápisov — paralelné save_to_db volania spôsobujú
# race condition na company.upsert s rovnakým IČO
_db_lock = asyncio.Lock()

async def save_to_db(data: CompanyFinancialExtraction):
    """
    Uloží extrahované finančné dáta a názor audítora do databázy pomocou Prisma Clienta.
    """
    async with _db_lock:
        db = Prisma()
        await db.connect()

        try:
            # 1. Vytvoríme alebo updatneme záznam o firme
            await db.company.upsert(
                where={'ico': data.ico},
                data={
                    'create': {'ico': data.ico, 'name': data.nazov_spolocnosti},
                    'update': {'ico': data.ico, 'name': data.nazov_spolocnosti}
                }
            )

            # 2. Uložíme finančné výkazy
            # Použijeme upsert namiesto create, aby sme predišli chybe UniqueConstraint
            statement = await db.financialstatement.upsert(
                where={
                    'companyIco_year': {
                        'companyIco': data.ico,
                        'year': data.metriky.rok_zavierky
                    }
                },
                data={
                    'create': {
                        'companyIco': data.ico,
                        'year': data.metriky.rok_zavierky,
                        'totalAssets': data.metriky.celkove_aktiva,
                        'currentAssets': data.metriky.obezny_majetok,
                        'equity': data.metriky.vlastne_imanie_celkom,
                        'shortTermLiabilities': data.metriky.kratkodobe_zavazky,
                        'mainActivityRevenue': data.metriky.trzby_z_hlavnej_cinnosti,
                        'netProfitLoss': data.metriky.zisk_alebo_strata_po_zdaneni,
                        'cashAndEquivalents': data.metriky.peniaze_a_penazne_ekvivalenty_k_31_12,
                        'operatingCashFlow': data.metriky.ciste_penazne_toky_z_prevadzkovej_cinnosti,
                    },
                    'update': {
                        'totalAssets': data.metriky.celkove_aktiva,
                        'currentAssets': data.metriky.obezny_majetok,
                        'equity': data.metriky.vlastne_imanie_celkom,
                        'shortTermLiabilities': data.metriky.kratkodobe_zavazky,
                        'mainActivityRevenue': data.metriky.trzby_z_hlavnej_cinnosti,
                        'netProfitLoss': data.metriky.zisk_alebo_strata_po_zdaneni,
                        'cashAndEquivalents': data.metriky.peniaze_a_penazne_ekvivalenty_k_31_12,
                        'operatingCashFlow': data.metriky.ciste_penazne_toky_z_prevadzkovej_cinnosti,
                    }
                }
            )

            # 3. Uložíme názor audítora (naviazaný na konkrétny výkaz)
            await db.auditoropinion.upsert(
                where={'financialStatementId': statement.id},
                data={
                    'create': {
                        'financialStatementId': statement.id,
                        'opinionType': data.audit.nazor_auditora,
                        'goingConcernRisk': data.audit.going_concern_riziko,
                        'reservationText': data.audit.auditor_vyhrady_text,
                    },
                    'update': {
                        'opinionType': data.audit.nazor_auditora,
                        'goingConcernRisk': data.audit.going_concern_riziko,
                        'reservationText': data.audit.auditor_vyhrady_text,
                    }
                }
            )
        finally:
            await db.disconnect()

async def save_narrative_to_db(ico: str, year: int, narrative: NarrativeRiskAnalysis):
    """
    Uloží extrahovanú textovú analýzu (z Výročnej správy) k zodpovedajúcemu finančnému výkazu.
    Ak výkaz neexistuje, vytvorí prázdny.
    """
    db = Prisma()
    await db.connect()
    try:
        # Najprv sa uistíme, že máme vytvorenú Company a FinancialStatement
        await db.company.upsert(
            where={'ico': ico},
            data={'create': {'ico': ico}, 'update': {'ico': ico}}
        )
        
        statement = await db.financialstatement.upsert(
            where={
                'companyIco_year': {
                    'companyIco': ico,
                    'year': year
                }
            },
            data={
                'create': {
                    'companyIco': ico,
                    'year': year,
                    'totalAssets': 0,
                    'equity': 0,
                    'shortTermLiabilities': 0,
                    'mainActivityRevenue': 0,
                    'netProfitLoss': 0,
                    'cashAndEquivalents': 0,
                    'operatingCashFlow': 0,
                },
                'update': {}
            }
        )
        
        await db.narrativeriskanalysis.upsert(
            where={'financialStatementId': statement.id},
            data={
                'create': {
                    'financialStatementId': statement.id,
                    'managementChanges': narrative.management_changes,
                    'litigationRisks': narrative.litigation_risks,
                    'goingConcernDoubts': narrative.going_concern_doubts,
                    'plannedInvestments': narrative.planned_investments,
                    'forensicRedFlags': narrative.forensic_red_flags,
                    'synthesis': narrative.synthesis
                },
                'update': {
                    'managementChanges': narrative.management_changes,
                    'litigationRisks': narrative.litigation_risks,
                    'goingConcernDoubts': narrative.going_concern_doubts,
                    'plannedInvestments': narrative.planned_investments,
                    'forensicRedFlags': narrative.forensic_red_flags,
                    'synthesis': narrative.synthesis
                }
            }
        )
    finally:
        await db.disconnect()

import os
import glob
import logging
import time
from src.scrapers.ifrs_downloader import download_ifrs_reports
from src.llm_extractor import extract_financial_data, extract_narrative_risk
from src.scrapers.obchodny_vestnik import ObchodnyVestnikXmlScraper, save_vestnik_events_to_db
from src.report_generator import generate_forensic_pdf_report
from src.pdf_ingestion import extract_core_financials

# ── Hybrid Model Routing ────────────────────────────────────────────────────
# IFRS tabuľky: gemini-2.5-flash — spoľahlivý OCR/extraktor, ~20× lacnejší ako 3.5
# Naratívna analýza (VS): gemini-3.5-flash — potrebuje hlbšie pochopenie nuancií
# Vestník udalosti: gemini-2.5-flash — štruktúrovaná extrakcia textu
_MODEL_IFRS = "gemini-2.5-flash"
_MODEL_NARRATIVE = "gemini-3.5-flash"
_MODEL_VESTNIK = "gemini-2.5-flash"

# ── Exponential Backoff + Fallback Model ──────────────────────────────────
_BACKOFF_SECONDS = [15, 45, 120, 300]
_FALLBACK_MODEL = "gemini-3.5-flash"

async def safe_llm_call(func, *args, label: str = "llm_call", **kwargs):
    """
    Bezpečne zavolá LLM funkciu s exponential backoff a fallback modelom.

    - 4 pokusy s backoff [15s, 45s, 120s, 300s] pre 503 chyby.
    - Po vyčerpaní pokusov skúsi fallback model (gemini-3.5-flash).
    - Ak fallback tiež zlyhá, vyhodí výnimku.
    """
    model = kwargs.get("model", "unknown")
    for attempt, wait in enumerate(_BACKOFF_SECONDS):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            if "503" not in str(e):
                raise
            logger.warning(
                f"API 503 pre {label} (model={model}), čakám {wait}s "
                f"(pokus {attempt + 1}/{len(_BACKOFF_SECONDS)})"
            )
            await asyncio.sleep(wait)

    # Fallback na iný model (iný Google pool / priorita)
    if model != _FALLBACK_MODEL:
        logger.warning(f"503 vyčerpané pre {label} (model={model}), skúšam fallback: {_FALLBACK_MODEL}")
        kwargs["model"] = _FALLBACK_MODEL
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Fallback {_FALLBACK_MODEL} tiež zlyhal pre {label}: {e}")
            raise

    raise Exception(f"Max retries reached for {label} (model={model})")

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
        from src.analytics import compute_financial_trends
        if company.financialStatements:
            trends = compute_financial_trends(company.financialStatements)
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
                    'justification': verdict.zdovodnenie,
                    'keyRisk': verdict.kľúčové_riziko,
                },
                'update': {
                    'verifaScore': verdict.verifa_score,
                    'riskCategory': verdict.risk_category,
                    'debtExposureRating': verdict.debt_exposure_rating,
                    'finalVerdict': verdict.final_verdict,
                    'justification': verdict.zdovodnenie,
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

async def update_ai_status(db: Prisma, report_request_id: str, ai_status: str, eta: int):
    if report_request_id:
        try:
            await db.reportrequest.update(
                where={'id': report_request_id},
                data={'aiStatus': ai_status, 'eta': eta}
            )
        except Exception as e:
            logger.warning(f"Nepodarilo sa aktualizovať AI status: {e}")

async def process_company(ico: str, report_request_id: str = None):
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

        await update_ai_status(db, report_request_id, "Sťahovanie dát a štrukturálna príprava", 45)
        
        # 1. Stiahnutie z RÚZ (IFRS a VS)
        downloaded_files = await download_ifrs_reports(ico, max_years=3, output_dir=f"assets/{ico}")
        
        await update_ai_status(db, report_request_id, "Analýza účtovných závierok (LLM)", 35)
        
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

        async def _process_ifrs(file_path: str):
            """Spracuje jeden IFRS PDF: slice → Gemini extrakcia → DB save."""
            file_name = os.path.basename(file_path)
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
                    await save_to_db(data)
                if sliced_path and sliced_path != file_path:
                    try:
                        os.remove(sliced_path)
                    except OSError:
                        pass
            except Exception as e:
                logger.error(f"Chyba pri spracovaní súboru {file_name}: {e}", exc_info=True)

        async def _process_vs(file_path: str):
            """Spracuje jeden VS PDF: Gemini naratívna analýza → DB save."""
            file_name = os.path.basename(file_path)
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

        # Paralelné spracovanie: všetky IFRS + VS naraz
        all_tasks = [_process_ifrs(fp) for fp in ifrs_files] + [_process_vs(fp) for fp in vs_files]
        if all_tasks:
            await asyncio.gather(*all_tasks)

        await update_ai_status(db, report_request_id, "Analýza rizík a udalostí (LLM)", 20)

        # 3. Scrapovanie Obchodného vestníka
        logger.info(f"Spracovávam Obchodný vestník pre IČO: {ico}")
        ov_scraper = ObchodnyVestnikXmlScraper()
        try:
            ov_result = await ov_scraper.run_xml(ico=ico)
            if ov_result["status"] == "SUCCESS" and ov_result.get("events"):
                await save_vestnik_events_to_db(ico, ov_result["events"])
        except Exception as e:
            logger.error(f"Chyba pri Obchodnom vestníku: {e}", exc_info=True)
            
        await update_ai_status(db, report_request_id, "Záverečný forenzný posudok (Chief Auditor)", 10)
        
        # 4. Sudca (Chief Auditor) sa spúšťa z main.py PO dokončení scraperov,
        # aby mal prístup k PDF súborom z registrov (dlhy, exekúcie, insolvencia).
        # Tu iba uložíme AI status.
            
        _elapsed = time.perf_counter() - _t_start
        logger.info(
            f"[PIPELINE SUMMARY] ico={ico} "
            f"ifrs={_ifrs_count} vs={_vs_count} "
            f"models=IFRS:{_MODEL_IFRS}|VS:{_MODEL_NARRATIVE}|OV:{_MODEL_VESTNIK}|Verdikt:gemini-3.1-pro-preview "
            f"elapsed={_elapsed:.1f}s"
        )
        logger.info(f"Pipeline pre IČO {ico} dokončená.")
    finally:
        await db.disconnect()

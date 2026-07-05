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
    update_ai_status, get_avg_completion_seconds,
)
from src.log_helpers import (
    PhaseTimer, log_pipeline_start, log_pipeline_end,
    log_llm_call, log_llm_retry, get_correlation_id,
)
from src.scrapers.ruz_scraper import download_ifrs_reports
from src.llm_extractor import (
    CompanyFinancialExtraction, NarrativeRiskAnalysis, AuditVerdict, EvidenceItem,
    evaluate_audit_verdict, extract_financial_data,
    extract_narrative_risk, extract_notes_risks, extract_staff_costs_focused,
)
from src.scrapers.obchodny_vestnik import ObchodnyVestnikXmlScraper, save_vestnik_events_to_db
from src.report_generator import generate_forensic_pdf_report
from src.pdf_ingestion import extract_core_financials, slice_narrative_pdf, slice_notes_pdf
from src.llm_orchestrator import safe_llm_call, _MODEL_IFRS, _MODEL_NARRATIVE, _MODEL_NOTES, _MODEL_VESTNIK
from src.analytics import sanitize_cash_flow_fields, compute_financial_trends, compute_forensic_scorecard

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
# Gemini free tier ~5 RPM; 2 paralelné volania + staggered delay = bezpečné
_GLOBAL_LLM_SEM = asyncio.Semaphore(2)

# Fallback baseline ak nie sú historické dáta (sekundy)
_PIPELINE_BASELINE_FALLBACK = _cfg.pipeline_baseline_fallback


def _extract_year_from_fn(file_path: str) -> int:
    """Extrahuje rok z názvu súboru (napr. IFRS_35876832_2024_0.pdf → 2024)."""
    fn = os.path.basename(file_path)
    parts = fn.split('_')
    if len(parts) >= 3 and parts[2].isdigit():
        return int(parts[2])
    return 0


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


def _build_fallback_verdict(company_dict: dict, scorecard) -> AuditVerdict:
    """Vytvorí fallback AuditVerdict z deterministického algoritmického skóre, keď LLM zlyhá."""
    prescore = scorecard.total_score if scorecard else 0
    risk_cat = scorecard.risk_category if scorecard else "INSUFFICIENT_DATA"
    hard_stop = scorecard.hard_stop if scorecard else False

    pillar_summaries = []
    if scorecard and scorecard.pillars:
        for p in scorecard.pillars:
            pillar_summaries.append(f"{p.name}: {p.score}/{p.max_score} — {p.detail}")

    evidence = [
        EvidenceItem(
            claim="Algoritmické hodnotenie (5-pilierový model)",
            evidence=f"Skóre {prescore}/100, kategória {risk_cat}",
            source="Deterministický algoritmus",
            impact="NEUTRAL",
        )
    ]
    if hard_stop:
        evidence.append(EvidenceItem(
            claim="HARD STOP — konkurz/likvidácia/reštrukturalizácia",
            evidence="Detegované vo Vestníku",
            source="Obchodný vestník",
            impact="CRITICAL",
        ))
    if pillar_summaries:
        evidence.append(EvidenceItem(
            claim="Rozpis pilierov",
            evidence=" | ".join(pillar_summaries),
            source="5-pilierový scorecard",
            impact="NEUTRAL",
        ))

    return AuditVerdict(
        verifa_score=prescore,
        risk_category=risk_cat,
        debt_exposure_rating=None,
        executive_summary=(
            "Hodnotenie bolo vypočítané na základe deterministického algoritmického modelu "
            "(5-pilierový scorecard). LLM analýza (Chief Auditor) bola dočasne nedostupná. "
            "Posudok môže chýbať cross-verification medzi finančnými dátami a PDF výpismi z registrov."
        ),
        final_verdict=(
            "Kriticky rizikový stav — HARD STOP (konkurz/likvidácia)."
            if hard_stop else
            f"Algoritmické hodnotenie: {risk_cat} ({prescore}/100). LLM analýza nedostupná."
        ),
        zdovodnenie=evidence,
        kľúčové_riziko=(
            "Konkurz / likvidácia / reštrukturalizácia detegovaná vo Vestníku."
            if hard_stop else
            "LLM analýza nedostupná — odporúčame spustiť re-run pre plný forenzný posudok."
        ),
        llm_analysis_status="FALLBACK_ALGORITHMIC",
    )


async def run_and_save_audit_verdict(ico: str, force: bool = False):
    """
    1. Získa všetky dostupné dáta pre dané IČO z databázy (Finančné výkazy, Naratívne analýzy, Vestník).
    2. Spustí Chief Auditora.
    3. Uloží AuditVerdict do DB.

    Preskočí LLM ak verdict existuje a žiadne nové dáta neprišli od posledného výpočtu.
    Re-run ak: nové vestnik events, nové finančné výkazy, nové PDF z registrov, alebo verdict > 90 dní.
    """
    STALE_TTL_DAYS = 90

    db = Prisma()
    await db.connect()
    try:
        # Načítaj existujúci verdict + všetky dáta naraz
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
                'vestnikEvents': True,
                'auditVerdict': True,
            }
        )
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

            # 3. Fallback: verdict príliš starý
            age_days = (datetime.now(timezone.utc) - verdict_ts).days
            if age_days > STALE_TTL_DAYS:
                reasons.append(f"verdict {age_days}d starý (> {STALE_TTL_DAYS}d)")

            if not reasons:
                logger.info(f"AuditVerdict pre IČO {ico} je aktuálny (skóre {existing_verdict.verifaScore}) — preskakujem LLM.")
                return
            else:
                logger.info(f"Re-run LLM pre IČO {ico}: {', '.join(reasons)}")

        # Extrahuje JSON dáta
        company_dict = company.model_dump(exclude_none=True)
        
        # Sanitizácia: 0 pre cash flow polia = chýbajúce dáta (artefakt starého LLM promptu)
        # Konvertujeme na None, aby LLM judge nevidel operatingCashFlow: 0 a nepísal o "nulovom cash flow"
        for stmt in company_dict.get("financialStatements", []):
            sanitize_cash_flow_fields(stmt)
        
        # Cesta B: Deterministická agregácia a výpočet 5-ročného trendu
        scorecard = None
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

            
        company_data = json.dumps(company_dict, default=str)
        
        # Hľadáme PDF súbory z registrov v results/{report_id}/ aj assets/{ico}/
        # Sudca potrebuje vidieť: dlhy poisťovniam, daňové dlhy, exekúcie, insolvenciu, diskvalifikácie
        debt_pdfs = _collect_debt_pdfs(ico)

        logger.info(f"Spúšťam Chief Auditora (The Verifa Scorer) pre IČO: {ico}. Nájdené PDF na analýzu: {len(debt_pdfs)}")
        try:
            verdict = await safe_llm_call(
                evaluate_audit_verdict, company_data, debt_pdfs,
                model=_cfg.model_verdict,
                label="Chief Auditor"
            )
        except Exception as llm_err:
            logger.error(f"Chief Auditor LLM zlyhal pre IČO {ico}: {type(llm_err).__name__}: {llm_err} — používam algoritmický fallback.", exc_info=True)
            verdict = _build_fallback_verdict(company_dict, scorecard)
        
        # ── Fix 3: Deterministické verifaScore ─────────────────────────────────
        # verifaScore = compute_forensic_scorecard().total_score (vždy, bez ohľadu na LLM).
        # LLM forenzný adjustment (llm_score_adjustment) je len informatívny — neukladá sa do skóre.
        # Fallback na verdict.verifa_score len ak neexistujú finančné výkazy (firma bez dát).
        deterministic_score = scorecard.total_score if scorecard is not None else verdict.verifa_score
        llm_adj = getattr(verdict, "llm_score_adjustment", 0) or 0
        logger.info(
            f"Ukladám AuditVerdict pre IČO {ico}: "
            f"Score={deterministic_score} (algo), LLM_adj={llm_adj:+d}, "
            f"Debt Rating: {verdict.debt_exposure_rating}, Status: {verdict.llm_analysis_status}"
        )

        verdict_payload = {
            'verifaScore': deterministic_score,
            'riskCategory': verdict.risk_category,
            'debtExposureRating': verdict.debt_exposure_rating,
            'finalVerdict': verdict.final_verdict,
            'executiveSummary': verdict.executive_summary,
            'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
            'keyRisk': verdict.kľúčové_riziko,
            'scorecardBreakdown': Json(company_dict.get("analyza_trendov", {}).get("scorecard_breakdown", [])),
            'llmAnalysisStatus': verdict.llm_analysis_status,
        }
        await db.auditverdict.upsert(
            where={'companyIco': ico},
            data={
                'create': {'companyIco': ico, **verdict_payload},
                'update': verdict_payload,
            }
        )

    except Exception as e:
        logger.error(f"Chyba pri generovaní AuditVerdict pre IČO {ico}: {e}", exc_info=True)
    finally:
        await db.disconnect()


def _remaining_eta(t_start: float, baseline: float) -> int:
    """Vypočíta dynamický remaining ETA z uplynutého času a baseliny."""
    elapsed = time.perf_counter() - t_start
    return max(5, int(baseline - elapsed))



async def process_company(ico: str, report_request_id: Optional[str] = None):
    """
    Hlavný orchestrátor pre dané IČO.
    1. Sťahuje finančné a výročné správy a spracuje ich cez LLM.
    2. Scrapuje záznamy z Obchodného vestníka (XML) a spracuje ich cez LLM.
    """
    log_pipeline_start(ico, report_request_id or "-")
    _t_start = time.perf_counter()
    _ifrs_count = 0
    _vs_count = 0

    db = Prisma()
    await db.connect()
    try:
        # Načítanie dynamickej baseliny z priemerného času posledných behov.
        # Lokálna premenná (nie globálna) — zabraňuje race condition pri paralelných reportoch.
        avg_seconds = await get_avg_completion_seconds(db)
        if avg_seconds and avg_seconds > 0:
            pipeline_baseline = avg_seconds
            logger.info(f"[PIPELINE] Dynamická baseline ETA: {avg_seconds:.0f}s (z histórie behov)")
        else:
            pipeline_baseline = _PIPELINE_BASELINE_FALLBACK
        company_name = None
        if report_request_id:
            req = await db.reportrequest.find_unique(where={'id': report_request_id})
            if req and req.companyName:
                company_name = req.companyName

        # Fallback placeholder ak nemáme reálny názov z ORSR
        fallback_name = company_name or f"Spoločnosť s IČO {ico}"

        existing = await db.company.find_unique(where={'ico': ico})
        _INVALID_NAMES = {"", "n/a", "n/a.", "none", "null", "-", "nezistené"}
        if existing:
            # Update ak máme reálny názov a existujúci je placeholder/N/A
            existing_is_invalid = (not existing.name) or existing.name.lower() in _INVALID_NAMES or existing.name.startswith("Spoločnosť s IČO")
            if company_name and existing_is_invalid:
                await db.company.update(where={'ico': ico}, data={'name': company_name})
        else:
            await db.company.create(data={'ico': ico, 'name': fallback_name})

        await update_ai_status(db, report_request_id, "ai.downloading", _remaining_eta(_t_start, pipeline_baseline))
        
        # 1. Stiahnutie z RÚZ (IFRS a VS)
        with PhaseTimer("RÚZ download"):
            downloaded_files = await download_ifrs_reports(ico, max_years=_cfg.ruz_max_years, output_dir=f"assets/{ico}")
        
        await update_ai_status(db, report_request_id, "ai.analyzing_statements", _remaining_eta(_t_start, pipeline_baseline))
        
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
        logger.info(f"[{get_correlation_id() or '-'}] Files: IFRS={_ifrs_count} VS={_vs_count}")

        # Zoznam pre zbieranie extrahovaných dát (pre cross-year duplicate check)
        _ifrs_results: list[CompanyFinancialExtraction] = []

        async def _process_ifrs(file_path: str, sem: asyncio.Semaphore):
            """Spracuje jeden IFRS PDF: slice → Gemini extrakcia → (deferred DB save)."""
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
                    
                    # Auto-retry s celým PDF, ak chýbajú kľúčové polia (odrezané poznámky).
                    # POZOR: Cash flow polia (investičný/finančný CF) SEM NEPATRIA — v zjednodušených
                    # výkazoch ("Výkaz vybraných údajov" / VÚ POD) legitímne chýbajú a full-PDF retry
                    # by ich aj tak nenašiel, len by zbytočne minul LLM tokeny.
                    if data and sliced_path and sliced_path != file_path:
                        m = data.metriky
                        # Core súvahové/P&L polia, ktoré sú prítomné v každom type výkazu
                        core_missing = {
                            "celkové aktíva": m.celkove_aktiva is None,
                            "obežný majetok": m.obezny_majetok is None,
                            "vlastné imanie": m.vlastne_imanie_celkom is None,
                            "pohľadávky": m.pohladavky_z_obchodneho_styku is None,
                            "záväzky": m.zavazky_z_obchodneho_styku is None,
                            "osobné náklady": m.osobne_naklady is None,
                        }
                        needs_retry = any(core_missing.values())
                        if needs_retry:
                            doc = fitz.open(file_path)
                            total_pages = len(doc)
                            doc.close()
                            if total_pages <= 80:
                                missing = [label for label, is_missing in core_missing.items() if is_missing]
                                logger.info(f"[RETRY] Dáta sú neúplné (chýba: {', '.join(missing)}). Spúšťam analýzu nad neskráteným PDF ({total_pages} strán): {file_name}")
                                data2 = await safe_llm_call(
                                    extract_financial_data, file_path,
                                    model=_MODEL_IFRS, label=f"IFRS-RETRY:{file_name}"
                                )
                                if data2:
                                    # Zachovaj hodnoty z prvého pokusu ak retry nevrátil lepšie
                                    for field_name, old_val in data.metriky.model_dump().items():
                                        new_val = getattr(data2.metriky, field_name, None)
                                        if new_val is None and old_val is not None:
                                            setattr(data2.metriky, field_name, old_val)
                                    data = data2
                            else:
                                logger.warning(f"[RETRY SKIP] PDF má {total_pages} > 80 strán, preskakujem full-retry kvôli nákladom: {file_name}")

                    # Cielený retry pre osobné náklady (IFRS by-function výkazy — mzdové náklady v poznámkach)
                    if data and data.metriky.osobne_naklady is None:
                        retry_path = file_path  # Vždy použi full PDF pre staff costs retry (poznámky môžu byť ďaleko)
                        logger.info(f"[STAFF COSTS RETRY] Osobné náklady chýbajú. Spúšťam cielene vyhľadávanie v {file_name}")
                        staff_costs = await safe_llm_call(
                            extract_staff_costs_focused, retry_path,
                            model=_MODEL_IFRS, label=f"STAFF-COSTS:{file_name}"
                        )
                        if staff_costs is not None:
                            data.metriky.osobne_naklady = staff_costs
                            logger.info(f"[STAFF COSTS RETRY] Osobné náklady doplnené: {staff_costs} pre {file_name}")
                        else:
                            logger.warning(f"[STAFF COSTS RETRY] Osobné náklady sa nepodarilo nájsť v {file_name}")

                    if data:
                        # Fallback: compute missing balance sheet totals from sub-items
                        # Order matters: compute obezny_majetok first, then celkove_aktiva from it
                        # to avoid double-counting (obežný majetok + its own sub-items)
                        m = data.metriky
                        if m.obezny_majetok is None:
                            current_sub = [v for v in [m.zasoby, m.pohladavky_z_obchodneho_styku, m.peniaze_a_penazne_ekvivalenty_k_31_12] if v is not None]
                            if len(current_sub) >= 2:
                                m.obezny_majetok = sum(current_sub)
                                logger.info(f"[FALLBACK] {file_name}: obezny_majetok vypočítané z sub-items: {m.obezny_majetok}")
                        if m.celkove_aktiva is None and m.obezny_majetok is not None:
                            # Lower bound: celkové aktíva ≥ obežný majetok (chýba neobežný/fixed assets)
                            m.celkove_aktiva = m.obezny_majetok
                            logger.info(f"[FALLBACK] {file_name}: celkove_aktiva aproximované z obežného majetku: {m.celkove_aktiva}")
                        if m.vlastne_imanie_celkom is None and m.celkove_aktiva is not None:
                            # Equity = Assets - Liabilities
                            # UPOZORNENIE: Toto je horný odhad (upper bound) — v schéme nemáme
                            # rezervy, časové rozlíšenie ani samostatné bankové úvery.
                            # Vyžadujeme obe zložky záväzkov, aby sme minimalizovali skreslenie.
                            if m.kratkodobe_zavazky is not None and m.dlhodobe_zavazky is not None:
                                computed_equity = m.celkove_aktiva - (m.kratkodobe_zavazky + m.dlhodobe_zavazky)
                                if computed_equity > 0:
                                    m.vlastne_imanie_celkom = computed_equity
                                    logger.warning(f"[FALLBACK-APPROX] {file_name}: vlastne_imanie aproximované (horný odhad, môže byť nadhodnotené): {m.vlastne_imanie_celkom}")
                                else:
                                    logger.warning(f"[FALLBACK-SKIP] {file_name}: vlastne_imanie by bolo záporné ({computed_equity}), pravdepodobne chýbajú záväzky — preskakujem")
                        logger.info(
                            f"[IFRS OK] {file_name} → rok={data.metriky.rok_zavierky} "
                            f"ico={data.ico} assets={data.metriky.celkove_aktiva} "
                            f"revenue={data.metriky.trzby_z_hlavnej_cinnosti}"
                        )
                        _ifrs_results.append(data)
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
                    narrative_year = int(yr_match.group(1)) if yr_match and int(yr_match.group(1)) > 2000 else datetime.today().year
                    
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

        # Paralelné spracovanie PDF s globálnym obmedzením concurrency
        # _GLOBAL_LLM_SEM(2) je zdieľaný medzi všetkými reportmi — Gemini free tier ~5 RPM
        _stagger_counter = 0

        _STAGGER_MAX_DELAY = 10.0  # strop — stagger len rozloží úvodný burst, concurrency rieši semaphore(2)

        async def _staggered_process(coro_func, *args, **kwargs):
            nonlocal _stagger_counter
            _stagger_counter += 1
            delay = min((_stagger_counter - 1) * 2.0, _STAGGER_MAX_DELAY)  # 0, 2, 4, 6, 8, 10, 10, ...
            if delay > 0:
                await asyncio.sleep(delay)
            return await coro_func(*args, **kwargs)

        pdf_tasks = [_staggered_process(_process_ifrs, fp, _GLOBAL_LLM_SEM) for fp in ifrs_files] + \
                    [_staggered_process(_process_vs, fp, _GLOBAL_LLM_SEM) for fp in vs_files]
        if pdf_tasks:
            with PhaseTimer(f"LLM extrakcia ({len(pdf_tasks)} files)"):
                await asyncio.gather(*pdf_tasks)

        # Cross-year duplicate detection pre osobné náklady
        # LLM môže duplikovať hodnotu z jedného roku do iného (najmä pri IFRS by-function výkazoch)
        if len(_ifrs_results) >= 2:
            _check_cross_year_duplicates(_ifrs_results)

        # Uloženie do DB po duplicate checku
        for data in _ifrs_results:
            try:
                await save_to_db(data)
                logger.info(f"[IFRS SAVED] rok={data.metriky.rok_zavierky} → DB uložené")
            except Exception as e:
                logger.error(f"[IFRS SAVE ERROR] rok={data.metriky.rok_zavierky}: {e}", exc_info=True)

        # 3b. Extrakcia poznámok (len pre najnovší rok, s fallbackom na staršie ak zlyhá)
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
                    model=_MODEL_NOTES, label=f"NOTES:{file_name}"
                )
                if notes_data:
                    await save_notes_to_db(ico, year, notes_data)
                try:
                    os.remove(sliced_notes_path)
                except OSError:
                    pass
                if notes_data:
                    break # Máme poznámky, preskoč staršie roky kvôli úspore tokenov

        await update_ai_status(db, report_request_id, "ai.risk_analysis", _remaining_eta(_t_start, pipeline_baseline))
        
        # Počkáme, kým sa dokončí úloha s Vestníkom (väčšinou sa stihne počas PDF)
        await vestnik_task
            
        await update_ai_status(db, report_request_id, "ai.final_verdict", _remaining_eta(_t_start, pipeline_baseline))
        
        # 4. Sudca (Chief Auditor) sa spúšťa z main.py PO dokončení scraperov,
        # aby mal prístup k PDF súborom z registrov (dlhy, exekúcie, insolvencia).
        # Tu iba uložíme AI status.
            
        _elapsed = time.perf_counter() - _t_start
        logger.info(
            f"[{get_correlation_id() or '-'}] PIPELINE SUMMARY: ico={ico} "
            f"ifrs={_ifrs_count} vs={_vs_count} "
            f"models=IFRS:{_MODEL_IFRS}|VS:{_MODEL_NARRATIVE}|NOTES:{_MODEL_NOTES}|OV:{_MODEL_VESTNIK}|Verdikt:{_cfg.model_verdict} "
            f"elapsed={_elapsed:.1f}s"
        )
        log_pipeline_end(ico, "OK", _elapsed)
    finally:
        await db.disconnect()

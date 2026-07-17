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
from src.scrapers.ruz_scraper import download_ifrs_reports
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


async def run_pdf_reader_agent(ico: str, sources: list, report_language: str = "sk") -> None:
    """
    PDF Reader Agent: prečíta všetky PDF z registrov (z scrapers) a uloží CompanyEvent[] do DB.
    Beží po scraperoch, paralelne s AI pipeline (IFRS/VS/Notes).
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
        return

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
    except Exception as e:
        logger.error(f"[PDF Reader Agent] IČO={ico}: chyba pri analýze PDF: {e}", exc_info=True)


async def run_orsr_forensics_agent(ico: str, sources: list, report_language: str = "sk") -> None:
    """
    Agent pre forenznú analýzu Úplného výpisu ORSR (Biele kone, virtuálne sídla).
    Beží paralelne s PDF Reader Agentom.
    """
    from src.agents.orsr_forensic import analyze_orsr_history
    from src.utils.orsr_heuristics import is_virtual_seat, is_foreign_statutory
    
    orsr_source = next((s for s in sources if s.source_type == "ORSR" and s.status == "SUCCESS"), None)
    if not orsr_source or not getattr(orsr_source, "full_extract_text", None):
        return
        
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

    except Exception as e:
        logger.error(f"[ORSR Forensic Agent] IČO={ico}: chyba: {e}", exc_info=True)


async def run_and_save_audit_verdict(ico: str, force: bool = False, report_language: str = "sk"):
    """
    1. Získa všetky dostupné dáta pre dané IČO z databázy (Finančné výkazy, Naratívne analýzy, Vestník).
    2. Spustí Chief Auditora.
    3. Uloží AuditVerdict do DB.

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
        # ZREDUKOVANÝ VSTUP: Cross-Analysis nepotrebuje raw IFRS/VS čísla (~25k chars).
        # Trendy, pomery a Altman Z sú už agregované v analyza_trendov. Z výkazov berieme
        # len narrativeRisk (going concern, red flags, synthesis) — to je pre krížovú analýzu kľúčové.
        narrative_by_year = []
        notes_by_year = []
        for stmt in company_dict.get("financialStatements", []):
            nr = stmt.get("narrativeRisk")
            if nr:
                narrative_by_year.append({"rok": stmt.get("year"), "narrativeRisk": nr})
            notes = stmt.get("notesRisk")
            if notes:
                notes_by_year.append({"rok": stmt.get("year"), "notesRisk": notes})

        cross_input_dict = {
            "ico": company_dict.get("ico"),
            "name": company_dict.get("name"),
            "naceText": company_dict.get("naceText"),
            "analyza_trendov": company_dict.get("analyza_trendov", {}),
            "narrativeRisk_by_year": narrative_by_year,
            "notesRisk_by_year": notes_by_year,
            "vestnikEvents": company_dict.get("vestnikEvents", []),
            "companyEvents": company_dict.get("companyEvents", []),
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

        # ── Chief Auditor (Pro) — finálny verdikt + scorecard + evidence ──
        try:
            logger.info(f"Chief Auditor vstup: {len(auditor_input_json)} chars (redukovaný z {len(company_data)} chars)")
            verdict = await safe_llm_call(
                evaluate_audit_verdict, auditor_input_json, [],
                model=_cfg.model_verdict,
                label="Chief Auditor",
                report_language=report_language,
                cross_analysis_summary=cross_summary,
            )
        except Exception as llm_err:
            logger.error(f"Chief Auditor LLM zlyhal pre IČO {ico}: {type(llm_err).__name__}: {llm_err} — používam algoritmický fallback.", exc_info=True)
            verdict = _build_fallback_verdict(company_dict, scorecard, report_language=report_language)

        # ── Report QA Agent (Flash) — verifikácia verdiktu proti zdrojovým dátam ──
        qa_discrepancies = []
        try:
            verdict_json = json.dumps(verdict.model_dump(), default=str, ensure_ascii=False)
            qa_result = await safe_llm_call(
                verify_report_quality, verdict_json, company_data,
                model=_cfg.model_fallback, label="Report QA Agent",
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
                logger.info(f"[QA OK] IČO {ico}: Report QA Agent nenašiel nezrovnalosti")
        except Exception as qa_err:
            logger.warning(f"Report QA Agent zlyhal pre IČO {ico}: {qa_err} — preskakujem QA kontrolu.")

        # Ak QA našlo CRITICAL nezrovnalosti, zavoláme Chief Auditora znova so spätnou väzbou.
        if qa_discrepancies and any(d.severity == "CRITICAL" for d in qa_discrepancies):
            try:
                qa_discrepancies_json = json.dumps([d.model_dump() for d in qa_discrepancies], ensure_ascii=False)
                logger.warning(f"[QA RE-RUN] IČO {ico}: re-running Chief Auditor with {len(qa_discrepancies)} discrepancies")
                verdict = await safe_llm_call(
                    evaluate_audit_verdict, auditor_input_json, [],
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
        logger.info(
            f"Ukladám AuditVerdict pre IČO {ico}: "
            f"Score={deterministic_score} (algo), LLM_adj={llm_adj:+d}, "
            f"Debt Rating: {verdict.debt_exposure_rating}, Status: {verdict.llm_analysis_status}"
        )

        # Deterministická risk_category — Python lookup namiesto LLM
        # Fallback na LLM hodnotu len ak neexistujú finančné výkazy (INSUFFICIENT_DATA)
        if scorecard is not None:
            if deterministic_score >= 90:
                _risk_category = "AAA"
            elif deterministic_score >= 70:
                _risk_category = "A"
            elif deterministic_score >= 40:
                _risk_category = "B"
            else:
                _risk_category = "C"
        else:
            _risk_category = verdict.risk_category

        verdict_payload = {
            'verifaScore': deterministic_score,
            'riskCategory': _risk_category,
            'debtExposureRating': verdict.debt_exposure_rating,
            'finalVerdict': verdict.final_verdict,
            'executiveSummary': verdict.executive_summary,
            'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
            'keyRisk': verdict.kľúčové_riziko,
            'scorecardBreakdown': Json(company_dict.get("analyza_trendov", {}).get("scorecard_breakdown", [])),
            'llmAnalysisStatus': verdict.llm_analysis_status,
        }
        await save_audit_verdict(ico, verdict_payload)

    except Exception as e:
        logger.error(f"Chyba pri generovaní AuditVerdict pre IČO {ico}: {e}", exc_info=True)


def _remaining_eta(t_start: float, baseline: float) -> int:
    """Vypočíta dynamický remaining ETA z uplynutého času a baseliny."""
    elapsed = time.perf_counter() - t_start
    return max(5, int(baseline - elapsed))



async def process_company(ico: str, report_request_id: Optional[str] = None, report_language: str = "sk"):
    """
    Hlavný orchestrátor pre dané IČO.
    1. Sťahuje finančné a výročné správy a spracuje ich cez LLM.
    2. Scrapuje záznamy z Obchodného vestníka (XML) a spracuje ich cez LLM.
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
        
    # 1. Stiahnutie z RÚZ (IFRS a VS)
    with PhaseTimer("RÚZ download"):
        downloaded_files = await download_ifrs_reports(ico, max_years=_cfg.ruz_max_years, output_dir=f"assets/{ico}")
    
    await update_ai_status(report_request_id, "ai.analyzing_statements", _remaining_eta(_t_start, pipeline_baseline))
    # Krátko po začiatku analýzy aktualizujeme na konkrétnejší status
    await asyncio.sleep(2)
    await update_ai_status(report_request_id, "ai.extracting_financials", _remaining_eta(_t_start, pipeline_baseline))
    # 2. Rozdelenie súborov na IFRS a VS
    ifrs_files = []
    vs_files = []
    for fp in downloaded_files:
        fn = os.path.basename(fp)
        if fn.startswith("IFRS_"):
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
        """Spracuje jeden IFRS PDF: pošle celé PDF do Gemini v jednom volaní (Flash má 1M token context)."""
        file_name = os.path.basename(file_path)
        try:
            logger.info(f"Spracovávam finančné výkazy: {file_name}")
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
                        "ciste_penazne_toky_z_prevadzkovej_cinnosti"
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
        """Footnotes Analyst: extrahuje poznámky pre najnovší rok (fallback na staršie).
        Beží paralelne s IFRS/VS extrakciou. DB save je odložený (viď _notes_result)."""
        try:
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
                    logger.info(f"[NOTES] Spracovávam poznámky pre rok {year} z {file_name}")
                    async with sem:
                        notes_data = await safe_llm_call(
                            extract_notes_risks, sliced_notes_path,
                            model=_MODEL_NOTES, label=f"Footnotes Analyst:{file_name}",
                            report_language=report_language,
                        )
                    try:
                        os.remove(sliced_notes_path)
                    except OSError:
                        pass
                    if notes_data:
                        _notes_result["year"] = year
                        _notes_result["data"] = notes_data
                        break  # Máme poznámky, preskoč staršie roky kvôli úspore tokenov
        except Exception as e:
            logger.error(f"Chyba pri spracovaní poznámok: {e}", exc_info=True)

    # Vytvorenie asynchrónnej úlohy pre Vestník, aby bežala paralelne
    async def _process_vestnik():
        logger.info(f"Spracovávam Obchodný vestník pre IČO: {ico}")
        ov_scraper = ObchodnyVestnikXmlScraper()
        try:
            ov_result = await ov_scraper.run_xml(ico=ico)
            if ov_result.get("status") == "SUCCESS" and ov_result.get("events"):
                await save_vestnik_events_to_db(ico, ov_result["events"])

            # Propagácia white_horse_risk do DB ako CompanyEvent
            if ov_result.get("white_horse_risk") and ov_result.get("cross_event_pattern"):
                from src.agents.pdf_reader import CompanyEvent as PdfCompanyEvent
                white_horse_event = PdfCompanyEvent(
                    source="OBCHODNY_VESTNIK",
                    event_type="WHITE_HORSE_PATTERN",
                    severity="CRITICAL",
                    title="Vzorec schránkovej firmy (biely kôň) detekovaný",
                    description=ov_result["cross_event_pattern"],
                    event_date=None,
                    amount=None,
                    metadata={"detection_method": "vestnik_batch_cross_analysis"},
                )
                await append_company_event_to_db(ico, white_horse_event)
                logger.warning(f"[Vestník] IČO {ico}: White horse pattern uložený do DB ako CRITICAL CompanyEvent")
        except Exception as e:
            logger.error(f"Chyba pri paralelnom spracovaní Vestníka: {e}", exc_info=True)

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

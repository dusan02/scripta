"""Verdict building — fallback verdict, ORSR override, deterministic adjustment."""

from __future__ import annotations

import os
import re
import json
import hashlib
import logging
from typing import Optional

from prisma import Prisma, Json

from src.config import settings as _cfg
from src.llm_extractor import AuditVerdict, EvidenceItem, evaluate_audit_verdict, generate_cross_analysis, verify_report_quality
from src.llm_orchestrator import safe_llm_call, check_pro_model_available, get_chief_auditor_model
from src.analytics import compute_financial_trends, compute_forensic_scorecard, estimate_missing_cash_flow, sanitize_cash_flow_fields
from src.db_repository import (
    save_company_events_to_db,
    append_company_event_to_db,
    save_scoring_snapshot,
)
from src.pdf_ingestion import extract_relevant_pdf_chunks
from src.agents.pdf_reader import extract_company_events
from src.verdict_metrics import (
    build_metric_placeholders,
    inject_metrics,
    _strip_narrative_financial_metrics,
    _inject_ncrzp_findings,
    _strip_hallucinated_debts,
    _METRIC_PATTERNS,
)
from src.batch_score import SCORING_VERSION

logger = logging.getLogger(__name__)


def _build_fallback_verdict(company_dict: dict, scorecard, report_language: str = "sk") -> AuditVerdict:
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


def _enrich_findings_source_pages(findings: list) -> list:
    """F4.3: Enrich findings source_pages for Súvaha/Balance Sheet sources.

    LLM Chief Auditor generates source_pages=null for Súvaha findings because
    it doesn't know which page the balance sheet is on in the PDF. This function
    sets a deterministic label for balance-sheet-sourced findings so the PDF
    report shows "Zdroj: Súvaha, str. 1" instead of just "Zdroj: Súvaha".

    Notes/Vestník/OR SR findings keep their LLM-generated source_pages unchanged.

    Does NOT touch scoring, business rules, or finding content — only source_pages.
    """
    BALANCE_SHEET_SOURCES = {"Súvaha", "Balance Sheet", "Súvaha a Výkaz ziskov a strát"}
    for f in findings:
        source = getattr(f, 'source', None) or ''
        source_pages = getattr(f, 'source_pages', None)
        # Only enrich if source is balance-sheet AND source_pages is null/empty
        if source in BALANCE_SHEET_SOURCES and not source_pages:
            f.source_pages = "1"
    return findings


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


def _apply_orsr_override(
    wh_dismissed: bool,
    scorecard,
    deterministic_score: int,
    ico: str,
) -> tuple[int, int]:
    """
    ORSR Management Anomaly override.

    Ak LLM (Chief Auditor) nastaví white_horse_risk_dismissed=True,
    zrušíme ORSR forenznú penalizáciu z deterministic_score.

    Vráti (wh_refund, updated_deterministic_score).
    """
    wh_refund = 0
    if wh_dismissed and scorecard is not None:
        for p in scorecard.pillars:
            if "ORSR" in p.name and p.score < 0:
                wh_refund += abs(p.score)
                logger.info(f"[MGMT ANOMALY OVERRIDE] IČO {ico}: LLM dismissed mgmt anomaly risk — refunding {abs(p.score)}b ORSR penalty")
        if wh_refund > 0:
            # Cap refund at 50% of ORSR penalty to prevent score inflation.
            # Without this cap, a fraudulent company with many ORSR anomalies
            # could get a large refund that pushes score to 100, masking
            # real risks from other pillars.
            wh_refund = min(wh_refund, 15)  # hard cap at 15 points
            deterministic_score = min(100, deterministic_score + wh_refund)
    return wh_refund, deterministic_score


def _compute_deterministic_adjustment(
    narrative_by_year: list,
    notes_by_year: list,
    company_events: list,
    ico: str,
    is_consolidated: bool = False,
    registry_sources: list | None = None,
) -> tuple:
    """
    Deterministický forenzný adjustment namiesto LLM ±10.
    Konvertuje štruktúrované LLM nálezy (NarrativeRisk, NotesRisk, CompanyEvents)
    na deterministické penalizácie podľa pevných pravidiel.

    Vracia (adj, breakdown) kde breakdown je dict s jednotlivými penalizáciami.

    Pravidlá (v3 — menej agresívne, kontextovo citlivé):
    - going_concern_doubts = True → -3
    - litigation_risks (non-empty, non-"no risk") → -2
    - related_party_transactions (non-empty, ONLY for non-consolidated) → -2
    - contingent_risks (non-empty) → -2
    - off_balance_sheet_liabilities (non-empty) → -1
    - CompanyEvent CRITICAL (SUDNE_ROZHODNUTIE, INSOLVENCIA) → -3 each (max -6)
    - Aktívne poverenie na exekúciu (POVERENIA source with RECORD_FOUND) → -15 (mimo cap)
    - forensic_red_flags: IGNORED (too noisy, already filtered in fraud heatmap)
    - Cap: -5 (v3 — menej agresívne ako pôvodné ±10), poverenia penalty je mimo cap
    """
    adj = 0
    reasons = []
    breakdown = {
        "going_concern": 0,
        "litigation": 0,
        "related_party": 0,
        "contingent_risks": 0,
        "off_balance": 0,
        "critical_events": 0,
        "active_execution": 0,
    }

    # ── NarrativeRiskAnalysis ──
    # Only use the most recent year to avoid cumulative penalties
    # (same litigation risk appears in every annual report)
    latest_nr = None
    for entry in narrative_by_year:
        nr = entry.get("narrativeRisk") if isinstance(entry, dict) else None
        if nr and isinstance(nr, dict):
            latest_nr = nr
            break  # narrative_by_year is sorted newest first

    if latest_nr:
        if latest_nr.get("goingConcernDoubts") is True or latest_nr.get("going_concern_doubts") is True:
            adj -= 3
            breakdown["going_concern"] = -3
            reasons.append("going_concern (-3)")

        litigation = latest_nr.get("litigationRisks") or latest_nr.get("litigation_risks") or ""
        if litigation and isinstance(litigation, str):
            low = litigation.lower().strip()
            if low and low not in ("žiadne", "none", "no", "nie", "bez rizík", "žiadne riziká"):
                adj -= 2
                breakdown["litigation"] = -2
                reasons.append("litigation (-2)")

    # ── NotesRiskAnalysis ──
    # Only use the most recent year to avoid cumulative penalties
    latest_notes = None
    for entry in notes_by_year:
        notes = entry.get("notesRisk") if isinstance(entry, dict) else None
        if notes and isinstance(notes, dict):
            latest_notes = notes
            break  # notes_by_year is sorted newest first

    if latest_notes:

        rpt = latest_notes.get("relatedPartyTransactions") or latest_notes.get("related_party_transactions") or ""
        if rpt and isinstance(rpt, str) and rpt.strip().lower() not in ("žiadne", "none", "null", "nie"):
            if not is_consolidated:
                adj -= 2
                breakdown["related_party"] = -2
                reasons.append("related_party (-2)")
            else:
                reasons.append("related_party (skipped — consolidated)")

        cr = latest_notes.get("contingentRisks") or latest_notes.get("contingent_risks") or ""
        if cr and isinstance(cr, str) and cr.strip().lower() not in ("žiadne", "none", "null", "nie"):
            adj -= 2
            breakdown["contingent_risks"] = -2
            reasons.append("contingent_risks (-2)")

        obs = latest_notes.get("offBalanceSheetLiabilities") or latest_notes.get("off_balance_sheet_liabilities") or ""
        if obs and isinstance(obs, str) and obs.strip().lower() not in ("žiadne", "none", "null", "nie"):
            adj -= 1
            breakdown["off_balance"] = -1
            reasons.append("off_balance (-1)")

    # ── CompanyEvents (CRITICAL severity) ──
    critical_events = 0
    for ev in company_events:
        if not isinstance(ev, dict):
            continue
        severity = ev.get("severity", "")
        event_type = ev.get("eventType", "") or ev.get("event_type", "")
        if severity == "CRITICAL" and event_type in ("SUDNE_ROZHODNUTIE", "INSOLVENCIA", "HISTORICAL_BANKRUPTCY"):
            critical_events += 1
    if critical_events > 0:
        ev_penalty = min(critical_events * 3, 6)
        adj -= ev_penalty
        breakdown["critical_events"] = -ev_penalty
        reasons.append(f"critical_events ({critical_events} × -3, capped -{ev_penalty})")

    # Clamp to -5..+5 (v3 — less aggressive than original ±10)
    raw_adj = adj
    adj = max(-5, min(5, adj))

    # Scale breakdown if clamped
    if adj != raw_adj and raw_adj < 0:
        scale = adj / raw_adj
        for k in breakdown:
            breakdown[k] = int(round(breakdown[k] * scale))

    # ── Aktívne poverenie na exekúciu (mimo cap) ──────────────────────────────
    # Poverenia scraper nájde záznamy v registri poverení na vykonanie exekúcie.
    # Toto je vážny signál platobnej neschopnosti — penalizácia -15 bodov (mimo cap).
    # Metodika uvádza -30, ale -15 je rozumnejšie (neposúva firmu automaticky do C).
    poverenia_penalty = 0
    for src in (registry_sources or []):
        if not src:
            continue
        src_type = getattr(src, 'source_type', 'UNKNOWN')
        src_status = getattr(src, 'status', 'UNKNOWN')
        src_findings = (getattr(src, 'findings', None) or "").lower()
        if src_type == "POVERENIA" and src_status == "SUCCESS":
            # Ak findings neobsahuje "žiadne poverenie" / "nebolo nájdené" → záznam existuje
            is_clean = any(kw in src_findings for kw in [
                "žiadne poverenie", "nebolo nájdené", "no enforcement",
                "no record", "not in the list",
            ])
            if not is_clean:
                poverenia_penalty = -15
                reasons.append("active_execution (-15 — poverenie na exekúciu)")
                break

    if poverenia_penalty != 0:
        breakdown["active_execution"] = poverenia_penalty
        adj += poverenia_penalty  # mimo cap

    if adj != 0:
        logger.info(f"[DET_ADJ] IČO {ico}: deterministic adjustment = {adj:+d} ({'; '.join(reasons)})")

    return adj, breakdown


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

            # ── Statement type consistency: nemiešať konsolidované a individuálne ──
            # Ak firma má oba typy závierok, preferujeme jeden typ pre konzistentný trend.
            # Priorita: konsolidované (ak ≥3 roky), inak individuálne.
            cons_stmts = [s for s in sorted_stmts if getattr(s, 'isConsolidated', False)]
            indiv_stmts = [s for s in sorted_stmts if not getattr(s, 'isConsolidated', False)]
            if cons_stmts and indiv_stmts:
                if len(cons_stmts) >= 3:
                    sorted_stmts = cons_stmts
                    company_dict["_financial_basis"] = "consolidated"
                    logger.info(f"[{ico}] Financial basis: consolidated ({len(cons_stmts)} years) — mixing avoided")
                else:
                    sorted_stmts = indiv_stmts
                    company_dict["_financial_basis"] = "individual"
                    logger.info(f"[{ico}] Financial basis: individual ({len(indiv_stmts)} years) — mixing avoided")
            else:
                company_dict["_financial_basis"] = "consolidated" if cons_stmts else "individual"

            company.financialStatements = sorted_stmts
            company_dict["financialStatements"] = [
                {f: getattr(s, f, None) for f in (
                    'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
                    'shortTermLiabilities', 'longTermLiabilities', 'totalLiabilities',
                    'staffCosts', 'depreciation',
                    'interestExpense', 'incomeTax', 'operatingCashFlow', 'investingCashFlow', 'financingCashFlow',
                    'cashAndEquivalents', 'grossProfit', 'currentAssets', 'inventory',
                    'tradeReceivables', 'tradePayables', 'socialInsuranceLiabilities',
                    'taxLiabilities', 'employeeLiabilities', 'employeeCount', 'monthsInPeriod',
                    'statementType', 'isConsolidated', 'auditorOpinion', 'narrativeRisk', 'notesRisk',
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
                # nr môže byť Pydantic model (NarrativeRiskAnalysis) — konvertuj na dict
                nr_dict = nr.model_dump() if hasattr(nr, "model_dump") else nr
                narrative_by_year.append({"rok": stmt.get("year"), "narrativeRisk": nr_dict})
            notes = stmt.get("notesRisk")
            if notes:
                # notes môže byť Pydantic model (NotesRiskAnalysis) — konvertuj na dict
                notes_dict = notes.model_dump() if hasattr(notes, "model_dump") else notes
                notes_by_year.append({"rok": stmt.get("year"), "notesRisk": notes_dict})
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

        # Deterministický filter: odstráň halucinované forensicRedFlags z naratívu,
        # ktoré tvrdia "transakcie so spriaznenými osobami" alebo "presun majetku",
        # ak notesRisk_by_year neobsahuje žiadne relatedPartyTransactions.
        # Toto je safety net — aj keď LLM ignoruje prompt pravidlá, kód zaručí grounding.
        def _get_attr(obj, name, default=None):
            """Helper: getattr pre Pydantic objekty aj dict."""
            if isinstance(obj, dict):
                return obj.get(name, default)
            return getattr(obj, name, default)

        def _set_attr(obj, name, value):
            """Helper: setattr pre Pydantic objekty aj dict."""
            if isinstance(obj, dict):
                obj[name] = value
            else:
                setattr(obj, name, value)

        _has_related_party_in_notes = any(
            _get_attr(_get_attr(_nr, "notesRisk"), "relatedPartyTransactions")
            for _nr in notes_by_year
        )
        if not _has_related_party_in_notes:
            _RP_PATTERNS = [
                re.compile(r'spriaznen', re.IGNORECASE),
                re.compile(r'related\s*part', re.IGNORECASE),
                re.compile(r'presun\s*majetk', re.IGNORECASE),
                re.compile(r'asset\s*transfer', re.IGNORECASE),
                re.compile(r'dcérs', re.IGNORECASE),
                re.compile(r'subsidiar', re.IGNORECASE),
                re.compile(r'odtok\s*kapit', re.IGNORECASE),
                re.compile(r'capital\s*extract', re.IGNORECASE),
            ]
            _removed_count = 0
            for entry in narrative_by_year:
                nr = _get_attr(entry, "narrativeRisk")
                flags = _get_attr(nr, "forensicRedFlags")
                if flags and isinstance(flags, list):
                    filtered = []
                    for flag in flags:
                        if isinstance(flag, str) and any(p.search(flag) for p in _RP_PATTERNS):
                            _removed_count += 1
                            logger.warning(f"[GROUNDING FILTER] Odstránený halucinovaný forensicRedFlag z naratívu {_get_attr(entry, 'rok')}: {flag[:80]}")
                        else:
                            filtered.append(flag)
                    if len(filtered) != len(flags):
                        _set_attr(nr, "forensicRedFlags", filtered)
            if _removed_count > 0:
                logger.info(f"[GROUNDING FILTER] Celkom odstránených {_removed_count} halucinovaných forensicRedFlags (žiadne relatedPartyTransactions v notesRisk)")

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
        # Pre-flight check: ak 3.1 Pro nedostupný, použijeme 2.5 Pro priamo (žiadny flash — halucinuje)
        _chief_model = _cfg.model_verdict
        if _cfg.expert_mode:
            _pro_ok = await check_pro_model_available("gemini-3.1-pro-preview", timeout=8.0)
            if not _pro_ok:
                _chief_model = "gemini-2.5-pro"
                logger.info(f"[{ico}] CHIEF AUDITOR: 3.1 Pro nedostupný → používam {_chief_model}")
            else:
                _chief_model = "gemini-3.1-pro-preview"

        try:
            logger.info(f"Chief Auditor vstup: {len(auditor_input_json)} chars (redukovaný z {len(company_data)} chars) | model={_chief_model}")
            verdict = await safe_llm_call(
                evaluate_audit_verdict, auditor_input_json,
                model=_chief_model,
                label="Chief Auditor",
                report_language=report_language,
                cross_analysis_summary=cross_summary,
            )

            # ── Expert Mode: 2-pass (draft → refine) ──
            # Refine dostáva IBA draft_verdict + cross_summary + instruction.
            # NEposielame znova company_data (~32K chars) — draft_verdict už
            # obsahuje všetky faktické závery z company_data. Refine má zlepšiť
            # text/logiku, nie re-analyzovať zdroj. Znižuje input z ~37K na ~6-9K chars.
            if _cfg.chief_auditor_two_pass and verdict:
                try:
                    draft_json = json.dumps(verdict.model_dump(), default=str, ensure_ascii=False)
                    refine_input = json.dumps({
                        "draft_verdict": json.loads(draft_json),
                        "cross_analysis_summary": cross_summary,
                        "instruction": "Refine the draft verdict. Improve logical flow, remove repetitions, deepen analysis of hidden connections, and make recommendations more specific and actionable. Keep all factual numbers unchanged. CRITICAL: Keep all {{PLACEHOLDER}} tags (like {{REVENUE}}, {{OCF}}, {{ALTMAN_Z}}) exactly as they are — do NOT replace them with numbers.",
                    }, ensure_ascii=False, default=str)
                    logger.info(f"Chief Auditor 2-pass (refine): {len(refine_input)} chars | model={_chief_model}")
                    refined = await safe_llm_call(
                        evaluate_audit_verdict, refine_input,
                        model=_chief_model,
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
                    model=_chief_model,
                    label="Chief Auditor (QA re-run)",
                    report_language=report_language,
                    cross_analysis_summary=cross_summary,
                    qa_discrepancies_json=qa_discrepancies_json,
                )
            except Exception as rerun_err:
                logger.warning(f"[QA RE-RUN] IČO {ico}: re-run zlyhal: {rerun_err} — používam pôvodný verdict.")

        # ── Fix 3: Deterministické verifaScore ─────────────────────────────────
        # verifaScore = compute_forensic_scorecard().total_score + deterministic adjustment.
        # LLM forenzný adjustment (llm_score_adjustment) je len informatívny — neukladá sa do skóre.
        # Deterministický adjustment sa počíta z NarrativeRisk, NotesRisk a CompanyEvents.
        # Fallback na verdict.verifa_score len ak neexistujú finančné výkazy (firma bez dát).
        deterministic_score = scorecard.total_score if scorecard is not None else verdict.verifa_score
        llm_adj = getattr(verdict, "llm_score_adjustment", 0) or 0  # informational only

        # ── ORSR Management Anomaly override ────────────────────────────────────
        # Ak LLM (Chief Auditor) nastaví white_horse_risk_dismissed=True,
        # zrušíme ORSR forenznú penalizáciu z deterministic_score.
        wh_dismissed = getattr(verdict, "white_horse_risk_dismissed", False)
        wh_refund, deterministic_score = _apply_orsr_override(
            wh_dismissed, scorecard, deterministic_score, ico
        )

        # ── Deterministický forenzný adjustment (namiesto LLM ±10) ──────────────
        det_adj, det_breakdown = _compute_deterministic_adjustment(
            narrative_by_year, notes_by_year,
            company_dict.get("companyEvents", []),
            ico,
            is_consolidated=company_dict.get("_financial_basis") == "consolidated",
            registry_sources=registry_sources,
        )

        logger.info(
            f"Ukladám AuditVerdict pre IČO {ico}: "
            f"Score={deterministic_score} (algo{f'+{wh_refund}b WH override' if wh_refund else ''}), "
            f"Det_adj={det_adj:+d}, LLM_adj(infonly)={llm_adj:+d}, "
            f"Debt Rating: {verdict.debt_exposure_rating}, Status: {verdict.llm_analysis_status}"
        )

        final_score = max(0, min(100, deterministic_score + det_adj))

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
            'executiveSections': json.dumps(
                [{"title": _sanitize_verdict_text(s.title), "points": [_sanitize_verdict_text(p) for p in s.points]}
                 for s in verdict.executive_sections],
                ensure_ascii=False
            ) if verdict.executive_sections else None,
            'justification': json.dumps([e.model_dump() for e in verdict.zdovodnenie], ensure_ascii=False),
            'keyRisk': _sanitize_verdict_text(verdict.kľúčové_riziko),
            'scorecardBreakdown': Json(company_dict.get("analyza_trendov", {}).get("scorecard_breakdown", [])),
            'findings': Json([f.model_dump() for f in _enrich_findings_source_pages(verdict.findings)]) if verdict.findings else None,
            'llmScoreAdjustment': det_adj,
            'llmAnalysisStatus': verdict.llm_analysis_status,
            'adjustmentBreakdown': json.dumps(det_breakdown, ensure_ascii=False),
        }

        # ── Deterministická injekcia placeholderov z DB ──
        # LLM generuje text s {{PLACEHOLDER}} tagmi, my ich nahradíme presnými hodnotami.
        # Toto eliminuje halucináciu čísel a dangling fragmenty.
        _stmts_for_ph = company_dict.get("financialStatements", [])
        _trends_for_ph = company_dict.get("analyza_trendov", {})
        # Extrahuj počet zmien štatutárov z CompanyEvents (FORENSIC_ANALYSIS event)
        _statutar_count = None
        for _ev in (company_dict.get("companyEvents") or []):
            if isinstance(_ev, dict) and _ev.get("eventType") == "FORENSIC_ANALYSIS":
                _meta = _ev.get("metadata") or {}
                _statutar_count = _meta.get("statutory_changes_count")
                break
        _metric_placeholders = build_metric_placeholders(
            stmts=_stmts_for_ph,
            trends=_trends_for_ph,
            company_name=company_dict.get("name", ""),
            statutar_changes=_statutar_count,
        )
        _ph_count = len(_metric_placeholders)
        _es_raw = verdict_payload.get('executiveSummary', '') or ''
        _es_has_placeholders = '{{' in _es_raw
        logger.info(
            f"[{ico}] inject_metrics: placeholders={_ph_count}, "
            f"stmts={len(_stmts_for_ph)}, statutar={_statutar_count}, "
            f"es_has_placeholders={_es_has_placeholders}, "
            f"es_sample={_es_raw[:120]!r}"
        )
        # ── Anti-halucinácia: očisť verdict texty od konkrétnych finančných metrík ──
        # KRITICKÉ: Toto musí bežať PRED inject_metrics! Inak by odstránilo nahradené
        # hodnoty z placeholderov (napr. "klesli o 13,2 %" → "klesli o").
        # Regex beží na raw LLM texte (s {{PLACEHOLDER}} tagmi), ktorý neobsahuje čísla.
        for _vfield in ('executiveSummary', 'keyRisk', 'finalVerdict'):
            _vtext = verdict_payload.get(_vfield, "")
            if _vtext and isinstance(_vtext, str):
                for _pat, _repl in _METRIC_PATTERNS:
                    _vtext = _pat.sub(_repl, _vtext)
                verdict_payload[_vfield] = _vtext

        # ── Anti-halucinácia pre executive_sections ──
        _esec = verdict_payload.get('executiveSections')
        if _esec and isinstance(_esec, str):
            try:
                _esec_list = json.loads(_esec)
                for _sec in _esec_list:
                    if not isinstance(_sec, dict):
                        continue
                    _stitle = _sec.get("title", "")
                    if _stitle and isinstance(_stitle, str):
                        for _pat, _repl in _METRIC_PATTERNS:
                            _stitle = _pat.sub(_repl, _stitle)
                        _sec["title"] = _stitle
                    _spoints = _sec.get("points", [])
                    if isinstance(_spoints, list):
                        for _pi, _pt in enumerate(_spoints):
                            if _pt and isinstance(_pt, str):
                                for _pat, _repl in _METRIC_PATTERNS:
                                    _pt = _pat.sub(_repl, _pt)
                                _spoints[_pi] = _pt
                verdict_payload['executiveSections'] = json.dumps(_esec_list, ensure_ascii=False)
            except (json.JSONDecodeError, TypeError):
                pass

        # ── Anti-halucinácia pre evidence_list (justification) ──
        # Zdôvodnenie obsahuje "tvrdenie" a "dokaz" polia, ktoré LLM generuje.
        # Očistíme ich rovnakými patternmi — PRED inject_metrics.
        _just = verdict_payload.get('justification')
        if _just and isinstance(_just, str):
            try:
                _just_list = json.loads(_just)
                for _item in _just_list:
                    if not isinstance(_item, dict):
                        continue
                    for _ifield in ('tvrdenie', 'dokaz', 'claim', 'evidence'):
                        _itext = _item.get(_ifield, "")
                        if _itext and isinstance(_itext, str):
                            for _pat, _repl in _METRIC_PATTERNS:
                                _itext = _pat.sub(_repl, _itext)
                            _item[_ifield] = _itext
                verdict_payload['justification'] = json.dumps(_just_list, ensure_ascii=False)
            except (json.JSONDecodeError, TypeError):
                pass

        # ── Deterministická injekcia placeholderov z DB ──
        # Nahradí {{PLACEHOLDER}} tagy presnými hodnotami z DB.
        # Beží PO regex cleanup — takže nahradené hodnoty nie sú ovplyvnené regexom.
        if _metric_placeholders:
            for _vfield in ('executiveSummary', 'keyRisk', 'finalVerdict'):
                _vtext = verdict_payload.get(_vfield, "")
                if _vtext and isinstance(_vtext, str):
                    verdict_payload[_vfield] = inject_metrics(_vtext, _metric_placeholders)
            # Injektuj placeholdre do executive_sections
            _esec = verdict_payload.get('executiveSections')
            if _esec and isinstance(_esec, str):
                try:
                    _esec_list = json.loads(_esec)
                    for _sec in _esec_list:
                        if not isinstance(_sec, dict):
                            continue
                        _stitle = _sec.get("title", "")
                        if _stitle and isinstance(_stitle, str):
                            _sec["title"] = inject_metrics(_stitle, _metric_placeholders)
                        _spoints = _sec.get("points", [])
                        if isinstance(_spoints, list):
                            for _pi, _pt in enumerate(_spoints):
                                if _pt and isinstance(_pt, str):
                                    _spoints[_pi] = inject_metrics(_pt, _metric_placeholders)
                    verdict_payload['executiveSections'] = json.dumps(_esec_list, ensure_ascii=False)
                except (json.JSONDecodeError, TypeError):
                    pass
            # Injektuj aj do justification evidence items
            _just = verdict_payload.get('justification')
            if _just and isinstance(_just, str):
                try:
                    _just_list = json.loads(_just)
                    for _item in _just_list:
                        if not isinstance(_item, dict):
                            continue
                        for _ifield in ('tvrdenie', 'dokaz', 'claim', 'evidence'):
                            _itext = _item.get(_ifield, "")
                            if _itext and isinstance(_itext, str):
                                _item[_ifield] = inject_metrics(_itext, _metric_placeholders)
                    verdict_payload['justification'] = json.dumps(_just_list, ensure_ascii=False)
                except (json.JSONDecodeError, TypeError):
                    pass
            # Injektuj placeholdre do findings (Analýza & Nálezy sekcia)
            _findings = verdict_payload.get('findings')
            if _findings and isinstance(_findings, str):
                try:
                    _findings_list = json.loads(_findings)
                    for _item in _findings_list:
                        if not isinstance(_item, dict):
                            continue
                        for _ffield in ('title', 'description', 'evidence', 'detail', 'recommendation'):
                            _ftext = _item.get(_ffield, "")
                            if _ftext and isinstance(_ftext, str):
                                _item[_ffield] = inject_metrics(_ftext, _metric_placeholders)
                    verdict_payload['findings'] = json.dumps(_findings_list, ensure_ascii=False)
                except (json.JSONDecodeError, TypeError):
                    pass
                except (json.JSONDecodeError, TypeError):
                    pass

        # ── Deterministická anti-halucinácia: odstráň neoveriteľné dlhy z verdict textu ──
        # Ak LLM spomenie konkrétne sumy dlhov voči registrom, ktoré sú CLEAN,
        # tieto pasáže nahradíme varovaním o halucinácii.
        verdict_payload = _strip_hallucinated_debts(verdict_payload, registry_status_summary, ico)

        # ── Deterministický inject NCRZP záložných práv ──
        # Cross-Analysis LLM často ignoruje NCRZP findings v executive_summary.
        # Tento inject zaručí, že záložné práva sa objavia v tabuľke Forenzné dôkazy.
        verdict_payload = _inject_ncrzp_findings(verdict_payload, registry_findings, ico)

        await save_audit_verdict(ico, verdict_payload)

        # ── Scoring Snapshot (permanent audit trail) ─────────────────────────────
        # Ukladá kompletný scoring snapshot pre budúci empirický model.
        # Nikdy neprepisuje staré snapshoty — vždy vytvorí nový záznam.
        try:
            _financial_basis = company_dict.get("_financial_basis", "individual")
            _is_consolidated = _financial_basis == "consolidated"
            _latest_year = None
            _stmts = company_dict.get("financialStatements", [])
            if _stmts and isinstance(_stmts, list):
                _latest_year = getattr(_stmts[0], "year", None) if hasattr(_stmts[0], "year") else (_stmts[0].get("year") if isinstance(_stmts[0], dict) else None)

            # Input data hash — reproducibility
            # Hashuje všetky vstupy, ktoré ovplyvňujú score:
            # base_score, consolidation status, narrative/notes risk findings, company events
            _hash_input = json.dumps({
                "ico": ico,
                "base_score": deterministic_score,
                "is_consolidated": _is_consolidated,
                "narrative": [
                    {
                        "rok": e.get("rok"),
                        "gc": (e.get("narrativeRisk") or {}).get("goingConcernDoubts"),
                        "lit": (e.get("narrativeRisk") or {}).get("litigationRisks"),
                    }
                    for e in narrative_by_year if isinstance(e, dict)
                ],
                "notes": [
                    {
                        "rok": e.get("rok"),
                        "rpt": (e.get("notesRisk") or {}).get("relatedPartyTransactions"),
                        "cr": (e.get("notesRisk") or {}).get("contingentRisks"),
                        "obs": (e.get("notesRisk") or {}).get("offBalanceSheetLiabilities"),
                    }
                    for e in notes_by_year if isinstance(e, dict)
                ],
                "events": [
                    {"sev": ev.get("severity"), "type": ev.get("eventType")}
                    for ev in (company_dict.get("companyEvents") or [])
                    if isinstance(ev, dict)
                ],
            }, sort_keys=True, default=str)
            _input_hash = hashlib.sha256(_hash_input.encode()).hexdigest()[:16]

            snapshot_payload = {
                'companyIco': ico,
                'scoringVersion': SCORING_VERSION,
                'financialYear': _latest_year,
                'baseScore': deterministic_score,
                'finalScore': final_score,
                'riskCategory': _risk_category,
                'adjustmentTotal': det_adj,
                'adjustments': Json(det_breakdown),
                'isConsolidated': _is_consolidated,
                'financialBasis': _financial_basis,
                'llmAdjustment': llm_adj,
                'whOverrideRefund': wh_refund,
                'inputDataHash': _input_hash,
            }
            await save_scoring_snapshot(snapshot_payload)
        except Exception as snap_err:
            logger.warning(f"[{ico}] ScoringSnapshot save failed (non-fatal): {snap_err}")

    except Exception as e:
        logger.error(f"Chyba pri generovaní AuditVerdict pre IČO {ico}: {e}", exc_info=True)


# ── Deterministická injekcia finančných metrík do LLM textov ──────────────
# LLM generuje text s placeholdermi ({{REVENUE}}, {{OCF}}, atď.).
# Táto funkcia nahradí placeholdre presnými hodnotami z DB.
# Eliminuje halucináciu čísel a dangling fragmenty po regex cleanup.


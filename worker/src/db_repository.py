import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional, cast
from prisma import Prisma
import httpx
from src.llm_extractor import CompanyFinancialExtraction, NarrativeRiskAnalysis

logger = logging.getLogger(__name__)


def _is_garbled(text: str) -> bool:
    """Detekuje garbled text z PDF extrakcie — zmes písmen z rôznych skriptov."""
    if not text or len(text) < 10:
        return False
    cyrillic = sum(1 for c in text if '\u0400' <= c <= '\u04FF')
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    arabic = sum(1 for c in text if '\u0600' <= c <= '\u06ff')
    if (cyrillic + cjk + arabic) >= 3:
        return True
    alpha = sum(1 for c in text if c.isalpha())
    if len(text) > 20 and alpha / len(text) < 0.4:
        return True
    return False


def _clean_text(text: str) -> str:
    """Sanitizuje text pred uložením do DB."""
    if not text:
        return text
    if _is_garbled(text):
        return ""
    text = re.sub(r'\bALE\b', 'ale', text)
    text = re.sub(r'\$([^$]+)\$', r'\1', text)
    text = re.sub(r'\^\{([^}]+)\}', r'\1', text)
    return text

# Lock pre serializáciu DB zápisov — paralelné save_to_db volania spôsobujú
# race condition na company.upsert s rovnakým IČO
_db_lock = None

def get_db_lock():
    global _db_lock
    if _db_lock is None:
        _db_lock = asyncio.Lock()
    return _db_lock

async def _fetch_nace_from_api(ico: str):
    """Získa NACE kód (napr. '64190') z verejnej API Registra UZ."""
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "Verifa.sk/1.0"}) as client:
            resp = await client.get(f"https://www.registeruz.sk/cruz-public/api/accountingentity?ico={ico}")
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and len(data) > 0:
                    ent = data[0]
                    return ent.get("skNaceCategory"), ent.get("skNaceCategoryName")
                elif isinstance(data, dict):
                    return data.get("skNaceCategory"), data.get("skNaceCategoryName")
    except Exception as e:
        logger.warning(f"Zlyhal fetch NACE kódu pre {ico}: {e}")
    return None, None

async def save_company_events_to_db(ico: str, events: list) -> None:
    """Uloží CompanyEvent[] z PDF Reader Agent do databázy."""
    import json as _json
    db = Prisma()
    await db.connect()
    try:
        await db.company.upsert(
            where={'ico': ico},
            data={'create': {'ico': ico}, 'update': {}}
        )
        # Vymaž staré eventy z PDF Reader Agent (nahradenie pri re-run), ale zachov FORENSIC_ANALYSIS
        await db.companyevent.delete_many(where={
            'companyIco': ico,
            'NOT': {'eventType': 'FORENSIC_ANALYSIS'},
        })
        inserted = 0
        for ev in events:
            event_date = None
            if ev.event_date:
                try:
                    from datetime import datetime
                    event_date = datetime.strptime(ev.event_date, "%Y-%m-%d")
                except (ValueError, TypeError):
                    pass
            metadata_json = _json.dumps(ev.metadata, ensure_ascii=False) if ev.metadata is not None else None
            result = await db.execute_raw(
                '''
                INSERT INTO "CompanyEvent"
                  (id, "companyIco", source, "eventType", severity, title, description,
                   "eventDate", amount, metadata, "createdAt")
                VALUES
                  (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
                   $7::timestamp, $8, $9::jsonb, NOW())
                ON CONFLICT DO NOTHING
                ''',
                ico,
                ev.source,
                ev.event_type,
                ev.severity,
                ev.title,
                ev.description,
                event_date,
                ev.amount,
                metadata_json,
            )
            inserted += result
        logger.info(f"CompanyEvent[] uložené pre IČO={ico}: {inserted}/{len(events)} udalostí (dedup)")
    finally:
        await db.disconnect()


async def append_company_event_to_db(ico: str, event) -> None:
    """Pridá jeden CompanyEvent bez vymazania existujúcich (pre paralelných agentov).
    Používa ON CONFLICT DO NOTHING pre cross-agent deduplication podľa
    (companyIco, source, eventType, eventDate, amount).
    """
    import json as _json
    db = Prisma()
    await db.connect()
    try:
        await db.company.upsert(
            where={'ico': ico},
            data={'create': {'ico': ico}, 'update': {}}
        )
        event_date = None
        if event.event_date:
            try:
                from datetime import datetime
                event_date = datetime.strptime(event.event_date, "%Y-%m-%d")
            except (ValueError, TypeError):
                pass

        metadata_json = None
        if event.metadata is not None:
            metadata_json = _json.dumps(event.metadata, ensure_ascii=False)

        # ON CONFLICT DO NOTHING: ak identický event (zdroj+typ+dátum+suma) už existuje,
        # ticho preskočíme — chráni pred race condition dvoch agentov zapisujúcich súčasne
        result = await db.execute_raw(
            '''
            INSERT INTO "CompanyEvent"
              (id, "companyIco", source, "eventType", severity, title, description,
               "eventDate", amount, metadata, "createdAt")
            VALUES
              (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
               $7::timestamp, $8, $9::jsonb, NOW())
            ON CONFLICT DO NOTHING
            ''',
            ico,
            event.source,
            event.event_type,
            event.severity,
            event.title,
            event.description,
            event_date,
            event.amount,
            metadata_json,
        )
        if result == 0:
            logger.debug(f"CompanyEvent deduplicated (cross-agent) pre IČO={ico}: {event.source}/{event.event_type}")
        else:
            logger.info(f"CompanyEvent appended pre IČO={ico}: {event.source}/{event.event_type}")
    finally:
        await db.disconnect()


async def get_company_events(ico: str) -> list:
    """Načíta CompanyEvent[] z DB pre dané IČO."""
    db = Prisma()
    await db.connect()
    try:
        return await db.companyevent.find_many(
            where={'companyIco': ico},
            order={'severity': 'asc'},
        )
    finally:
        await db.disconnect()


async def save_to_db(data: CompanyFinancialExtraction):
    """
    Uloží extrahované finančné dáta a názor audítora do databázy pomocou Prisma Clienta.
    """
    async with get_db_lock():
        db = Prisma()
        await db.connect()

        try:
            # 1. Vytvoríme alebo updatneme záznam o firme
            gemini_name = (data.nazov_spolocnosti or "").strip()
            _INVALID_NAMES = {"", "n/a", "n/a.", "nie je známy", "neznámy", "none", "null", "-", "neznáma spoločnosť", "nezistené", "nezisten", "neuvedené", "neuveden", "not stated", "not provided", "unknown"}
            is_placeholder = gemini_name.lower() in _INVALID_NAMES or gemini_name.startswith("Spoločnosť s IČO")
            
            # Fetch NACE kód
            nace_code, nace_text = await _fetch_nace_from_api(data.ico)
            
            await db.company.upsert(
                where={'ico': data.ico},
                data={
                    'create': {
                        'ico': data.ico,
                        'name': gemini_name if not is_placeholder else f"Spoločnosť s IČO {data.ico}",
                        'naceCode': nace_code,
                        'naceText': nace_text
                    },
                    'update': {}
                }
            )

            # Update name only if current is empty/placeholder (don't overwrite ORSR's real name)
            if gemini_name and not is_placeholder:
                existing_co = await db.company.find_unique(where={'ico': data.ico})
                curr_name = (existing_co.name or "").lower() if existing_co else ""
                if not curr_name or curr_name in _INVALID_NAMES or curr_name.startswith("spoločnosť s ičo"):
                    await db.company.update(
                        where={'ico': data.ico},
                        data={'name': gemini_name}
                    )
            if nace_code or nace_text:
                nace_update: dict = {}
                if nace_code:
                    nace_update['naceCode'] = nace_code
                if nace_text:
                    nace_update['naceText'] = nace_text
                await db.company.update(
                    where={'ico': data.ico},
                    data=nace_update
                )

            # 2. Uložíme finančné výkazy
            # Použijeme upsert namiesto create, aby sme predišli chybe UniqueConstraint
            # Filter out None values — Python Prisma client throws "Null constraint violation"
            # when None is explicitly passed for nullable Float? fields.
            stmt_fields = {
                'totalAssets': data.metriky.celkove_aktiva,
                'currentAssets': data.metriky.obezny_majetok,
                'equity': data.metriky.vlastne_imanie_celkom,
                'shortTermLiabilities': data.metriky.kratkodobe_zavazky,
                'longTermLiabilities': data.metriky.dlhodobe_zavazky,
                'mainActivityRevenue': data.metriky.trzby_z_hlavnej_cinnosti,
                'grossProfit': data.metriky.hruba_marza,
                'netProfitLoss': data.metriky.zisk_alebo_strata_po_zdaneni,
                'cashAndEquivalents': data.metriky.peniaze_a_penazne_ekvivalenty_k_31_12,
                'operatingCashFlow': data.metriky.ciste_penazne_toky_z_prevadzkovej_cinnosti if data.metriky.ciste_penazne_toky_z_prevadzkovej_cinnosti != 0 else None,
                'staffCosts': data.metriky.osobne_naklady,
                'tradeReceivables': data.metriky.pohladavky_z_obchodneho_styku,
                'tradePayables': data.metriky.zavazky_z_obchodneho_styku,
                'inventory': data.metriky.zasoby,
                'depreciation': data.metriky.odpisy,
                'investingCashFlow': data.metriky.investicny_cash_flow if data.metriky.investicny_cash_flow != 0 else None,
                'financingCashFlow': data.metriky.financny_cash_flow if data.metriky.financny_cash_flow != 0 else None,
                'interestExpense': data.metriky.uroky,
                'employeeCount': data.metriky.pocet_zamestnancov,
                'socialInsuranceLiabilities': data.metriky.zavazky_sp,
                'taxLiabilities': data.metriky.danove_zavazky,
                'employeeLiabilities': data.metriky.zavazky_zamestnanci,
                'currency': data.metriky.mena,
                'statementType': data.metriky.typ_zavierky,
                'monthsInPeriod': data.metriky.pocet_mesiacov_obdobia if data.metriky.pocet_mesiacov_obdobia is not None else 12,
                'isConsolidated': data.metriky.is_consolidated,
            }
            stmt_data = {k: v for k, v in stmt_fields.items() if v is not None}

            # Build create dict with only fields that have values
            create_data = {'companyIco': data.ico, 'year': data.metriky.rok_zavierky}
            for key, value in stmt_data.items():
                create_data[key] = value

            statement = await db.financialstatement.upsert(
                where={
                    'companyIco_year': {
                        'companyIco': data.ico,
                        'year': data.metriky.rok_zavierky
                    }
                },
                data={
                    'create': create_data,  # type: ignore
                    'update': stmt_data,
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
                        'reservationText': _clean_text(data.audit.auditor_vyhrady_text),
                    },
                    'update': {
                        'opinionType': data.audit.nazor_auditora,
                        'goingConcernRisk': data.audit.going_concern_riziko,
                        'reservationText': _clean_text(data.audit.auditor_vyhrady_text),
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
                },
                'update': {}
            }
        )
        
        await db.narrativeriskanalysis.upsert(
            where={'financialStatementId': statement.id},
            data={
                'create': {
                    'statement': {'connect': {'id': statement.id}},
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
        logger.info(f"Naratívna analýza uložená pre IČO={ico}, ROK={year}")
    finally:
        await db.disconnect()

async def save_notes_to_db(ico: str, year: int, notes_risk):
    db = Prisma()
    await db.connect()
    try:
        # Uistíme sa, že výkaz existuje
        statement = await db.financialstatement.find_unique(
            where={
                'companyIco_year': {
                    'companyIco': ico,
                    'year': year
                }
            }
        )
        if not statement:
            # Ak výkaz ešte neexistuje, museli by sme ho vytvoriť s nulami,
            # ale on by mal existovať z IFRS extrakcie, ktorá beží prvá.
            logger.warning(f"FinancialStatement pre IČO={ico}, ROK={year} neexistuje pri ukladaní notes_risk.")
            return

        await db.notesriskanalysis.upsert(
            where={'financialStatementId': statement.id},
            data={
                'create': {
                    'financialStatementId': statement.id,
                    'relatedPartyTransactions': notes_risk.related_party_transactions,
                    'offBalanceSheetLiabilities': notes_risk.off_balance_sheet_liabilities,
                    'contingentRisks': notes_risk.contingent_risks
                },
                'update': {
                    'relatedPartyTransactions': notes_risk.related_party_transactions,
                    'offBalanceSheetLiabilities': notes_risk.off_balance_sheet_liabilities,
                    'contingentRisks': notes_risk.contingent_risks
                }
            }
        )
        logger.info(f"Analýza poznámok uložená pre IČO={ico}, ROK={year}")
    finally:
        await db.disconnect()

_avg_cache: dict = {}  # {"value": float, "ts": float}
_AVG_CACHE_TTL = 120  # 2 minúty

async def get_avg_completion_seconds(limit: int = 20) -> Optional[float]:
    """Vráti priemerný čas dokončenia (v sekundách) z posledných N completed/partial reportov."""
    import time as _time
    
    now = _time.perf_counter()
    cached = _avg_cache.get("value")
    if cached is not None and (now - _avg_cache.get("ts", 0)) < _AVG_CACHE_TTL:
        return cached
        
    db = Prisma()
    await db.connect()
    try:
        rows = await db.reportrequest.find_many(
            where={"status": {"in": ["COMPLETED", "PARTIAL"]}},
            order={"completedAt": "desc"},
            take=limit,
        )
        durations = []
        for r in rows:
            if r.completedAt and r.createdAt:
                dur = (r.completedAt - r.createdAt).total_seconds()
                if 10 < dur < 600:
                    durations.append(dur)
        if not durations:
            return None
        durations.sort()
        mid = len(durations) // 2
        avg = durations[mid] if len(durations) % 2 == 1 else (durations[mid - 1] + durations[mid]) / 2
        _avg_cache["value"] = avg
        _avg_cache["ts"] = now
        return avg
    except Exception as e:
        logger.warning(f"Nepodarilo sa získať priemerný čas dokončenia: {e}")
        return None
    finally:
        await db.disconnect()

async def update_ai_status(report_request_id: Optional[str], ai_status: Optional[str], eta: int):
    """Aktualizuje informačný status pre AI pipeline a odhadovaný čas cez Prisma."""
    if not report_request_id:
        return
    db = Prisma()
    await db.connect()
    try:
        data = {'eta': eta}
        if ai_status is not None:
            data['aiStatus'] = ai_status
        await db.reportrequest.update(
            where={'id': report_request_id},
            data=data
        )
    except Exception as e:
        logger.warning(f"Nepodarilo sa aktualizovať AI status: {e}")
    finally:
        await db.disconnect()

async def get_report_request_company_name(report_request_id: str) -> Optional[str]:
    db = Prisma()
    await db.connect()
    try:
        req = await db.reportrequest.find_unique(where={'id': report_request_id})
        return req.companyName if req else None
    finally:
        await db.disconnect()

async def upsert_company_name(ico: str, company_name: str) -> None:
    db = Prisma()
    await db.connect()
    try:
        existing = await db.company.find_unique(where={'ico': ico})
        _INVALID_NAMES = {"", "n/a", "n/a.", "none", "null", "-", "nezistené", "nezisten", "neuvedené", "neuveden", "not stated", "not provided", "unknown", "neznáma spoločnosť"}
        
        if existing:
            # Update len ak máme lepší názov
            if company_name and company_name.lower() not in _INVALID_NAMES:
                curr = (existing.name or "").lower()
                if not curr or curr in _INVALID_NAMES or curr.startswith("spoločnosť s ičo"):
                    await db.company.update(where={'ico': ico}, data={'name': company_name})
        else:
            name_to_save = company_name if company_name and company_name.lower() not in _INVALID_NAMES else None
            await db.company.create(data={'ico': ico, 'name': name_to_save})
    finally:
        await db.disconnect()


async def get_verifa_score(ico: str) -> Optional[int]:
    """Prečíta aktuálne verifaScore z AuditVerdict pre dané IČO."""
    db = Prisma()
    await db.connect()
    try:
        verdict = await db.auditverdict.find_unique(where={'companyIco': ico})
        return verdict.verifaScore if verdict else None
    finally:
        await db.disconnect()


async def get_company_with_relations(ico: str):
    """Načíta spoločnosť so všetkými reláciami pre Chief Auditora."""
    db = Prisma()
    await db.connect()
    try:
        return await db.company.find_unique(
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
                'companyEvents': True,
                'auditVerdict': True,
            }
        )
    finally:
        await db.disconnect()


async def save_audit_verdict(ico: str, verdict_payload: dict):
    """Uloží konečný verdikt do databázy."""
    db = Prisma()
    await db.connect()
    try:
        await db.auditverdict.upsert(
            where={'companyIco': ico},
            data={
                'create': {
                    'companyIco': ico,
                    **verdict_payload,
                },
                'update': verdict_payload,
            }
        )
        logger.info(f"AuditVerdict pre {ico} bol uložený.")
    finally:
        await db.disconnect()


async def update_report_status(
    report_request_id: str,
    status: str,
    result_file_path: Optional[str] = None,
    company_name: Optional[str] = None,
    verifa_score: Optional[int] = None,
) -> None:
    db = Prisma()
    await db.connect()
    try:
        data = {"status": status}
        if result_file_path is not None:
            data["resultFilePath"] = result_file_path
        if status in ("COMPLETED", "PARTIAL"):
            data["completedAt"] = datetime.now(timezone.utc)
        if company_name is not None:
            data["companyName"] = company_name
        if verifa_score is not None:
            data["verifaScore"] = verifa_score
        
        await db.reportrequest.update(
            where={"id": report_request_id},
            data=data
        )
    except Exception as e:
        logger.warning(f"Nepodarilo sa aktualizovať status reportu: {e}")
    finally:
        await db.disconnect()


async def get_avg_phase_durations(limit: int = 20) -> Optional[dict]:
    db = Prisma()
    await db.connect()
    try:
        rows = await db.reportrequest.find_many(
            where={"status": {"in": ["COMPLETED", "PARTIAL"]}},
            order={"completedAt": "desc"},
            take=limit,
        )
        if not rows:
            return None
            
        def _median(values: list) -> Optional[float]:
            vals = sorted(v for v in values if v is not None and v > 0)
            if not vals:
                return None
            mid = len(vals) // 2
            return vals[mid] if len(vals) % 2 == 1 else (vals[mid - 1] + vals[mid]) / 2

        result = {}
        for phase, col in [("scrapers", "scrapersMs"), ("ai", "aiMs"), ("auditor", "auditorMs"), ("compile", "compileMs")]:
            vals = [getattr(r, col, None) for r in rows if getattr(r, col, None) is not None and getattr(r, col, None) > 0]
            med = _median(vals)
            result[phase] = med / 1000.0 if med else None

        totals = []
        for r in rows:
            if r.completedAt and r.createdAt:
                dur = (r.completedAt - r.createdAt).total_seconds()
                if 0 < dur < 1800:
                    totals.append(dur)
        result["total"] = _median(totals)
        return result if any(v is not None for v in result.values()) else None
    except Exception as e:
        logger.warning(f"Nepodarilo sa získať avg phase durations: {e}")
        return None
    finally:
        await db.disconnect()


async def save_phase_duration(report_request_id: str, phase: str, duration_ms: int) -> None:
    db = Prisma()
    await db.connect()
    try:
        col_map = {"scrapers": "scrapersMs", "ai": "aiMs", "auditor": "auditorMs", "compile": "compileMs"}
        col = col_map.get(phase)
        if not col:
            return
        await db.reportrequest.update(
            where={"id": report_request_id},
            data={col: duration_ms}
        )
    except Exception as e:
        logger.warning(f"Nepodarilo sa uložiť phase duration: {e}")
    finally:
        await db.disconnect()


async def upsert_report_sources(report_request_id: str, sources: list) -> None:
    db = Prisma()
    await db.connect()
    try:
        for source in sources:
            await db.reportsource.upsert(
                where={
                    "reportRequestId_sourceType": {
                        "reportRequestId": report_request_id,
                        "sourceType": source.source_type
                    }
                },
                data={
                    "create": {
                        "reportRequestId": report_request_id,
                        "sourceType": source.source_type,
                        "status": source.status,
                        "statusMessage": source.status_message,
                        "filePath": source.file_path,
                        "pageCount": source.page_count,
                        "findings": source.findings,
                    },
                    "update": {
                        "status": source.status,
                        "statusMessage": source.status_message,
                        "filePath": source.file_path,
                        "pageCount": source.page_count,
                        "findings": source.findings,
                    }
                }
            )
    except Exception as e:
        logger.warning(f"Nepodarilo sa uložiť report sources: {e}")
    finally:
        await db.disconnect()


async def upsert_single_report_source(report_request_id: str, source) -> None:
    await upsert_report_sources(report_request_id, [source])


async def update_source_page_counts(report_request_id: str, sources: list) -> None:
    db = Prisma()
    await db.connect()
    try:
        for source in sources:
            if source.status == "SUCCESS" and source.page_count and source.page_count > 0:
                await db.reportsource.update(
                    where={
                        "reportRequestId_sourceType": {
                            "reportRequestId": report_request_id,
                            "sourceType": source.source_type
                        }
                    },
                    data={"pageCount": source.page_count}
                )
    except Exception as e:
        logger.warning(f"Nepodarilo sa aktualizovať page counts: {e}")
    finally:
        await db.disconnect()


async def create_bug_report(report_request_id: str, error_details: str) -> None:
    db = Prisma()
    await db.connect()
    try:
        req = await db.reportrequest.find_unique(where={"id": report_request_id})
        if not req:
            return
            
        existing = await db.feedback.find_first(
            where={
                "requestId": report_request_id,
                "category": "BUG"
            }
        )
        if existing:
            return
            
        ico = req.ico or "neznáme"
        company = req.companyName or "neznáma"
        message = (
            f"[AUTO-BUG] Report {report_request_id} zlyhal.\\n"
            f"Firma: {company} (IČO: {ico})\\n"
            f"Chyba: {error_details[:2000]}"
        )
        
        await db.feedback.create(
            data={
                "userId": req.userId,
                "category": "BUG",
                "requestId": report_request_id,
                "message": message,
                "status": "OPEN",
            }
        )
    except Exception as e:
        logger.warning(f"Nepodarilo sa vytvoriť bug report pre {report_request_id}: {e}")
    finally:
        await db.disconnect()


async def charge_credit(report_request_id: str) -> None:
    db = Prisma()
    await db.connect()
    try:
        req = await db.reportrequest.find_unique(where={"id": report_request_id})
        if not req or not req.userId:
            return

        user_id = req.userId
        user = await db.user.find_unique(where={"id": user_id})
        
        if not user or user.role in ("ADMIN", "ENTERPRISE"):
            return
            
        if user.credits <= 0:
            logger.warning(f"Užívateľ {user_id} nemá kredity pre report {report_request_id}!")
            return
            
        async with db.tx() as transaction:
            await transaction.user.update(
                where={"id": user_id},
                data={"credits": {"decrement": 1}}
            )
            await transaction.credittransaction.create(
                data={
                    "userId": user_id,
                    "amount": -1,
                    "type": "CONSUME",
                    "description": f"Analýza firmy {req.companyName or req.ico}",
                    "reportId": report_request_id
                }
            )
    except Exception as e:
        logger.error(f"Failed to charge credit: {e}")
    finally:
        await db.disconnect()

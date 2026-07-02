import asyncio
import logging
from typing import Optional, cast
from prisma import Prisma
import httpx
from src.llm_extractor import CompanyFinancialExtraction, NarrativeRiskAnalysis

logger = logging.getLogger(__name__)

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
        async with httpx.AsyncClient(timeout=5.0) as client:
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
            _INVALID_NAMES = {"", "n/a", "n/a.", "nie je známy", "neznámy", "none", "null", "-"}
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

            # Update fields separately if they have values
            if gemini_name and not is_placeholder:
                await db.company.update(
                    where={'ico': data.ico},
                    data={'name': gemini_name}
                )
            if nace_code:
                await db.company.update(
                    where={'ico': data.ico},
                    data={'naceCode': nace_code}
                )
            if nace_text:
                await db.company.update(
                    where={'ico': data.ico},
                    data={'naceText': nace_text}
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
                'longTermLiabilities': data.metriky.dlhodobeZavazky,
                'mainActivityRevenue': data.metriky.trzby_z_hlavnej_cinnosti,
                'grossProfit': data.metriky.hruba_marza,
                'netProfitLoss': data.metriky.zisk_alebo_strata_po_zdaneni,
                'cashAndEquivalents': data.metriky.peniaze_a_penazne_ekvivalenty_k_31_12,
                'operatingCashFlow': data.metriky.ciste_penazne_toky_z_prevadzkovej_cinnosti,
                'staffCosts': data.metriky.osobne_naklady,
                'tradeReceivables': data.metriky.pohladavky_z_obchodneho_styku,
                'tradePayables': data.metriky.zavazky_z_obchodneho_styku,
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
                    'update': {},
                }
            )

            # Update fields separately if they have values
            if 'totalAssets' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'totalAssets': stmt_data['totalAssets']}
                )
            if 'currentAssets' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'currentAssets': stmt_data['currentAssets']}
                )
            if 'equity' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'equity': stmt_data['equity']}
                )
            if 'shortTermLiabilities' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'shortTermLiabilities': stmt_data['shortTermLiabilities']}
                )
            if 'longTermLiabilities' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'longTermLiabilities': stmt_data['longTermLiabilities']}
                )
            if 'mainActivityRevenue' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'mainActivityRevenue': stmt_data['mainActivityRevenue']}
                )
            if 'grossProfit' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'grossProfit': stmt_data['grossProfit']}
                )
            if 'netProfitLoss' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'netProfitLoss': stmt_data['netProfitLoss']}
                )
            if 'cashAndEquivalents' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'cashAndEquivalents': stmt_data['cashAndEquivalents']}
                )
            if 'operatingCashFlow' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'operatingCashFlow': stmt_data['operatingCashFlow']}
                )
            if 'staffCosts' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'staffCosts': stmt_data['staffCosts']}
                )
            if 'tradeReceivables' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'tradeReceivables': stmt_data['tradeReceivables']}
                )
            if 'tradePayables' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'tradePayables': stmt_data['tradePayables']}
                )
            if 'currency' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'currency': stmt_data['currency']}
                )
            if 'statementType' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'statementType': stmt_data['statementType']}
                )
            if 'monthsInPeriod' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'monthsInPeriod': stmt_data['monthsInPeriod']}
                )
            if 'isConsolidated' in stmt_data:
                await db.financialstatement.update(
                    where={'id': statement.id},
                    data={'isConsolidated': stmt_data['isConsolidated']}
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
        logger.info(f"Naratívna analýza uložená pre IČO={ico}, ROK={year}")
    finally:
        await db.disconnect()

async def save_notes_to_db(ico: str, year: int, notes_risk):
    from prisma import Prisma
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
_AVG_CACHE_TTL = 300  # 5 minút

async def get_avg_completion_seconds(db: Prisma, limit: int = 20) -> Optional[float]:
    """Vráti priemerný čas dokončenia (v sekundách) z posledných N completed/partial reportov.
    Filtruje outliery > 30 min (stuck/retried reporty). Cacheované na 5 minút."""
    import time as _time
    now = _time.perf_counter()
    cached = _avg_cache.get("value")
    if cached is not None and (now - _avg_cache.get("ts", 0)) < _AVG_CACHE_TTL:
        return cached
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
                if 0 < dur < 1800:  # Filter stuck/retried reports > 30 min
                    durations.append(dur)
        if not durations:
            return None
        avg = sum(durations) / len(durations)
        _avg_cache["value"] = avg
        _avg_cache["ts"] = now
        return avg
    except Exception as e:
        logger.warning(f"Nepodarilo sa získať priemerný čas dokončenia: {e}")
        return None


async def update_ai_status(db: Prisma, report_request_id: Optional[str], ai_status: str, eta: int):
    """
    Aktualizuje informačný status pre AI pipeline a odhadovaný čas cez Prisma.
    """
    if report_request_id:
        try:
            await db.reportrequest.update(
                where={'id': report_request_id},
                data={'aiStatus': ai_status, 'eta': eta}
            )
        except Exception as e:
            logger.warning(f"Nepodarilo sa aktualizovať AI status: {e}")

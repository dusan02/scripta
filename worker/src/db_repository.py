import asyncio
import logging
from typing import Optional
from prisma import Prisma
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

async def save_to_db(data: CompanyFinancialExtraction):
    """
    Uloží extrahované finančné dáta a názor audítora do databázy pomocou Prisma Clienta.
    """
    async with get_db_lock():
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

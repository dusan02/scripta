import asyncio
from prisma import Prisma
from src.pipeline import run_and_save_audit_verdict

async def main():
    db = Prisma()
    await db.connect()
    
    ico = "31637051"
    
    await db.company.upsert(where={'ico': ico}, data={'create': {'ico': ico, 'name': 'Mondi SCP'}, 'update': {}})
    
    stmt = await db.financialstatement.create(
        data={
            'companyIco': ico,
            'year': 2023,
            'totalAssets': 500000000,
            'equity': 200000000,
            'shortTermLiabilities': 150000000,
            'mainActivityRevenue': 400000000,
            'netProfitLoss': 54700000,
            'cashAndEquivalents': 10000000,
            'operatingCashFlow': 20000000
        }
    )
    
    await db.auditoropinion.create(
        data={
            'financialStatementId': stmt.id,
            'opinionType': 'Bez výhrad',
            'goingConcernRisk': False,
            'reservationText': None
        }
    )
    
    await db.narrativeriskanalysis.create(
        data={
            'financialStatementId': stmt.id,
            'managementChanges': 'Zmeny v predstavenstve bez udania dôvodu v Q3.',
            'litigationRisks': 'Prebiehajúce spory ohľadom enviromentálnych pokút (EcoPower projekt).',
            'goingConcernDoubts': False,
            'plannedInvestments': 'Masívne investície do projektu EcoPower v najbližších dvoch rokoch.',
            'forensicRedFlags': ['Dividendy 70 mil. EUR vs. zisk 54,7 mil. EUR.', 'Firma sa vyciciava prostredníctvom dividend.', 'Likvidita klesá o 50%.'],
            'synthesis': 'Spoločnosť vykazuje vnútorný rozpor - deklaruje obrovské kapitálové výdavky na projekt EcoPower, no zároveň vypláca extrémne dividendy, ktoré presahujú jej čistý zisk, čo rapídne znižuje jej likviditu.'
        }
    )
    
    await db.disconnect()
    
    await run_and_save_audit_verdict(ico)

if __name__ == "__main__":
    asyncio.run(main())

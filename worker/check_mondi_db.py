import asyncio
from prisma import Prisma

async def main():
    db = Prisma()
    await db.connect()
    try:
        ico = "31637051"
        company = await db.company.find_unique(where={'ico': ico})
        print("Company:", company)
        if not company:
            return
            
        fs = await db.financialstatement.find_many(where={'companyIco': ico}, include={'auditorOpinion': True, 'narrativeRisk': True})
        print(f"\nFinancial Statements ({len(fs)}):")
        for f in fs:
            print(f"- Year: {f.year}, NetProfit: {f.netProfitLoss}")
            print(f"  Auditor Opinion: {f.auditorOpinion}")
            if f.narrativeRisk:
                print(f"  Narrative Risk: {f.narrativeRisk.synthesis[:100]}...")
            
        verdict = await db.auditverdict.find_unique(where={'companyIco': ico})
        print(f"\nAudit Verdict: {verdict}")
    finally:
        await db.disconnect()

if __name__ == '__main__':
    asyncio.run(main())

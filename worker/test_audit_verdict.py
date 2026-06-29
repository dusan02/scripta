import asyncio
from src.pipeline import run_and_save_audit_verdict
from prisma import Prisma

async def main():
    print("Spúšťam the Chief Auditor pre Mondi SCP (31637051)...")
    await run_and_save_audit_verdict("31637051")
    
    db = Prisma()
    await db.connect()
    verdict = await db.auditverdict.find_unique(where={"companyIco": "31637051"})
    print("Mondi SCP Verdikt:")
    if verdict:
        print(f"Skóre: {verdict.verifaScore}/100")
        print(f"Kategória: {verdict.riskCategory}")
        print(f"Záverečný verdikt: {verdict.finalVerdict}")
        print(f"Zdôvodnenie: {verdict.justification}")
        print(f"Riziko: {verdict.keyRisk}")
    else:
        print("Nebol vygenerovaný žiadny verdikt.")
    await db.disconnect()

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from prisma import Prisma

async def main():
    db = Prisma()
    await db.connect()
    verdict = await db.auditverdict.find_unique(where={"companyIco": "31637051"})
    print("Mondi SCP Verdikt:")
    if verdict:
        print(f"Skóre: {verdict.verifaScore}/100")
        print(f"Kategória: {verdict.riskCategory}")
        print(f"Debt Exposure: {verdict.debtExposureRating}/10")
        print(f"Záverečný verdikt: {verdict.finalVerdict}")
        print(f"Zdôvodnenie: {verdict.justification}")
        print(f"Riziko: {verdict.keyRisk}")
    else:
        print("Nebol vygenerovaný žiadny verdikt.")
    await db.disconnect()

if __name__ == "__main__":
    asyncio.run(main())

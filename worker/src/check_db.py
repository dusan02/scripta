import asyncio
from prisma import Prisma

async def main():
    db = Prisma()
    await db.connect()
    company = await db.company.find_unique(where={"ico": "51078856"}, include={"sources": True})
    for s in company.sources:
        if s.sourceType == "FS_DANOVE_SUBJEKTY":
            print(s.findings)
    await db.disconnect()

asyncio.run(main())

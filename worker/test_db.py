import asyncio
from prisma import Prisma

async def main():
    db = Prisma()
    await db.connect()
    
    r = await db.reportrequest.find_unique(where={'id': 'cmqyzzmwj0001ejucmbyfzbk8'})
    print(r.status, r.aiStatus)
    
    await db.disconnect()

asyncio.run(main())

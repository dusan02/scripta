import asyncio
from prisma import Prisma
from dotenv import load_dotenv
load_dotenv()
async def main():
    db = Prisma()
    await db.connect()
    reqs = await db.reportrequest.find_many(take=5, order={"createdAt": "desc"})
    for req in reqs:
        print(f"ID: {req.id}, Status: {req.status}, aiStatus: {req.aiStatus}, ETA: {req.eta}")
    await db.disconnect()
asyncio.run(main())

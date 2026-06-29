import asyncio
from prisma import Prisma
from dotenv import load_dotenv
load_dotenv()
async def main():
    db = Prisma()
    await db.connect()
    req = await db.reportrequest.find_unique(where={"id": "cmqyz577a00bl24crjrgs8vyg"})
    if req:
        print(f"ID: {req.id}, Status: {req.status}, aiStatus: '{req.aiStatus}', ETA: {req.eta}")
    await db.disconnect()
asyncio.run(main())

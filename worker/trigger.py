import asyncio
from prisma import Prisma
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

async def main():
    db = Prisma()
    await db.connect()
    user = await db.user.find_first()
    if not user:
        print("No user found")
        return
        
    req = await db.reportrequest.create(
        data={
            "ico": "31699847",
            "userId": user.id,
            "status": "PROCESSING",
            "targetType": "COMPANY",
            "eta": 90,
            "sources": {
                "create": [
                    {"sourceType": "REGISTER_UZ", "status": "PENDING"}
                ]
            }
        }
    )
    print(f"Created request: {req.id}")
    
    async with httpx.AsyncClient() as client:
        resp = await client.post("http://localhost:8000/tasks", json={
            "report_request_id": req.id, 
            "ico": "31699847",
            "target_type": "COMPANY",
            "sources": ["REGISTER_UZ"]
        }, headers={"x-worker-secret": os.getenv("WORKER_SECRET", "")})
        print(f"Worker response: {resp.status_code} {resp.text}")
            
    await db.disconnect()

asyncio.run(main())

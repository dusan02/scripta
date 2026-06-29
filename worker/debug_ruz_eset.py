import asyncio
import json
import httpx
from pprint import pprint

async def get_eset_data():
    ico = "31333532"
    url = f"https://www.registeruz.sk/cruz-public/api/uctovne-zavierky?ico={ico}"
    
    async with httpx.AsyncClient(verify=False) as client:
        resp = await client.get(url)
        data = resp.json()
        print("Found", len(data.get("id", [])), "IDs for IČO", ico)
        
        for uz_id in data.get("id", [])[-10:]:  # check last 10
            detail_url = f"https://www.registeruz.sk/cruz-public/api/uctovna-zavierka?id={uz_id}"
            detail_resp = await client.get(detail_url)
            detail = detail_resp.json()
            print(f"ID: {uz_id}, ObdobieOd: {detail.get('obdobieOd')}, ObdobieDo: {detail.get('obdobieDo')}, Typ: {detail.get('typ')}")
            
asyncio.run(get_eset_data())

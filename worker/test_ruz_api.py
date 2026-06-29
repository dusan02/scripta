import httpx
import asyncio

async def main():
    async with httpx.AsyncClient() as client:
        res = await client.get("https://www.registeruz.sk/cruz-public/api/uctovna-jednotka?ico=54819032", headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept": "application/json"})
        print(res.status_code)
        print(res.text[:500])

asyncio.run(main())

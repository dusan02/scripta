import httpx
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
resp = httpx.get("https://www.registeruz.sk/cruz-public/api/uctovna-jednotka?ico=46958819", headers=headers)
print(resp.status_code, resp.text[:200])

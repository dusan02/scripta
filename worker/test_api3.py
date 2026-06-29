import urllib.request
import json

req = urllib.request.Request(
    'https://www.registeruz.sk/cruz-public/api/uctovne-jednotky?ico=46958819',
    headers={'Accept': 'application/json'}
)
try:
    with urllib.request.urlopen(req) as response:
        print("Status:", response.status)
        print("Body:", response.read().decode('utf-8')[:500])
except Exception as e:
    print("Error:", e)

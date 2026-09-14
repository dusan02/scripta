"""
One-off refinement: for GAP firms classified UNKNOWN (first výkaz was often
"Oznámenie o dátume schválenia" — an announcement, not a statement), re-scan
ALL výkazy of the latest závierka and classify by the financial-statement
template whitelist.

Read-only. Updates gap_enriched_<year>.jsonl in place (rewrites file).
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"

# Financial statement templates (balance sheet / P&L / IFRS / nonprofit / budget)
STATEMENT_TEMPLATES = {
    699: "SK_GAAP_POD",     # Úč POD
    687: "SK_GAAP_MUJ",     # Úč MUJ (mikro)
    709: "IFRS",
    703: "IFRS",
    1164: "SK_GAAP_NO",     # Úč NO (nezisková)
    1180: "SK_GAAP_NUJ",    # Úč NUJ (nezisková)
    690: "SK_GAAP_ROPO",    # Súvaha Úč ROPO SFOV
    727: "SK_GAAP_ROPO",    # Výkaz ziskov a strát Úč ROPO SFOV
}
# Non-statement templates to skip when scanning
SKIP_TEMPLATES = {1171, 1181, 725, 483}


async def ruz_get(client, endpoint, params):
    for attempt in range(3):
        try:
            resp = await asyncio.wait_for(
                client.get(f"{RUZ_API}/{endpoint}", params=params,
                           headers={"User-Agent": UA}, timeout=30.0),
                timeout=45,
            )
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503):
                await asyncio.sleep(2 ** attempt)
                continue
            return None
        except (httpx.HTTPError, asyncio.TimeoutError):
            await asyncio.sleep(2 ** attempt)
    return None


def classify(ids: list[int | None]) -> tuple[str, int | None]:
    """Pick the first real statement template from výkaz template IDs."""
    for t in ids:
        if t in STATEMENT_TEMPLATES:
            return STATEMENT_TEMPLATES[t], t
    for t in ids:
        if t is not None and t not in SKIP_TEMPLATES:
            return "UNKNOWN", t
    return "UNKNOWN", None


async def main():
    in_path = Path("results/gap_enriched_2025.jsonl")
    recs = [json.loads(l) for l in in_path.open(encoding="utf-8")]
    todo = [r for r in recs if r.get("templateKind") == "UNKNOWN"]
    print(f"Refining {len(todo)} UNKNOWN of {len(recs)}")

    sem = asyncio.Semaphore(8)
    done = 0

    async def work(r):
        nonlocal done
        async with sem:
            zid = r.get("ruzZavierkaId")
            if not zid:
                return
            zav = await ruz_get_path(zid)
            if not zav:
                return
            ids: list[int | None] = []
            for vid in (zav.get("idUctovnychVykazov") or [])[:8]:
                v = await ruz_get_path_vykaz(vid)
                if v:
                    ids.append(v.get("idSablony"))
            kind, sab = classify(ids)
            r["templateKind"] = kind
            r["idSablony"] = sab
            done += 1
            if done % 500 == 0:
                print(f"[refine] {done}/{len(todo)}", flush=True)

    async def ruz_get_path(endpoint_id: int) -> dict | None:
        for attempt in range(3):
            try:
                resp = await asyncio.wait_for(
                    client.get(f"{RUZ_API}/uctovna-zavierka", params={"id": endpoint_id},
                               headers={"User-Agent": UA}),
                    timeout=45)
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                await asyncio.sleep(2 ** attempt)
        return None

    async def ruz_get_path_vykaz(vid: int) -> dict | None:
        for attempt in range(3):
            try:
                resp = await asyncio.wait_for(
                    client.get(f"{RUZ_API}/uctovny-vykaz", params={"id": vid},
                               headers={"User-Agent": UA}),
                    timeout=45)
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                await asyncio.sleep(2 ** attempt)
        return None

    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=8, max_keepalive_connections=8)) as client:
        await asyncio.gather(*[work(r) for r in todo])

    with in_path.open("w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"[refine] complete, {done} updated")

    import collections
    print(collections.Counter(r.get("templateKind") for r in recs).most_common())


if __name__ == "__main__":
    asyncio.run(main())

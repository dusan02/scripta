import logging
import httpx
import re
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from prisma import Prisma

from src.llm_extractor import extract_vestnik_event, VestnikExtraction
from ..models import ScrapedSource
from .base import BaseScraper, ScraperInputError

logger = logging.getLogger(__name__)

_API_BASE = "https://datahub.ekosystem.slovensko.digital/api/data/ov"


class ObchodnyVestnikXmlScraper(BaseScraper):
    """
    Sťahuje záznamy z Obchodného vestníka cez ekosystem.slovensko.digital API.
    Filtruje podľa IČO a posiela kritické udalosti do Gemini na forenznú analýzu.
    """
    source_type: str = "OBCHODNY_VESTNIK"

    async def run(self, **kwargs) -> ScrapedSource:
        res = await self.run_xml(**kwargs)
        findings = json.dumps(res.get("events", []), ensure_ascii=False) if res.get("events") else None
        return self._make_result(status=res["status"], findings=findings)

    async def run_xml(self, **kwargs) -> Dict:
        ico: Optional[str] = kwargs.get("ico")
        if not ico:
            raise ScraperInputError("Obchodný vestník vyžaduje IČO.")

        ico_clean = re.sub(r'\s+', '', ico)
        ico_int: Optional[int] = None
        try:
            ico_int = int(ico_clean)
        except ValueError:
            pass

        found_events = []

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                # 1. Konkurz/reštrukturalizácia/likvidácia — najkritické
                found_events.extend(
                    await self._fetch_and_filter(client, "konkurz_restrukturalizacia_issues", ico_int, ico_clean)
                )

                # 2. Podania na obchodný register — zmeny v registri
                found_events.extend(
                    await self._fetch_and_filter(client, "or_podanie_issues", ico_int, ico_clean)
                )

        except Exception as e:
            logger.error(f"[OV] Chyba pri fetch z ekosystem API: {e}")
            return {"status": "SUCCESS", "events_found": 0, "events": []}

        logger.info(f"[OV] IČO {ico_clean}: nájdených {len(found_events)} relevantných záznamov")

        # Pošleme kritické záznamy do Gemini na analýzu
        analyzed_events = []
        for event in found_events:
            try:
                extraction: VestnikExtraction = await extract_vestnik_event(event["text"])
                event_data = {
                    "sourceId": event["id"],
                    "publishedAt": event.get("published_at", "UNKNOWN"),
                    "rawType": event.get("kind_name", event.get("file_name", "Neznámy typ")),
                    "analysis": extraction,
                }
                analyzed_events.append(event_data)
            except Exception as e:
                logger.warning(f"[OV] Gemini analýza zlyhala pre záznam {event['id']}: {e}")

        return {
            "status": "SUCCESS",
            "events_found": len(analyzed_events),
            "events": analyzed_events,
        }

    async def _fetch_and_filter(
        self, client: httpx.AsyncClient, endpoint: str, ico_int: Optional[int], ico_clean: str
    ) -> List[Dict]:
        """
        Fetch z ekosystem sync API a filtrácia podľa štruktúrneho poľa cin/debtor.cin.
        Používa 30-dňový lookback — sync API vracia všetky zmeny od daného dátumu,
        takže dlhší lookback by stiahol milióny záznamov.
        Pre historické dáta by bol potrebný one-time bulk import.
        """
        from_date = (datetime.utcnow() - timedelta(days=30)).isoformat()

        results = []
        url = f"{_API_BASE}/{endpoint}/sync"
        params = {"from": from_date}

        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            items = data if isinstance(data, list) else data.get("items", data.get("data", []))

            for item in items:
                # Filtrácia podľa štruktúrneho IČO poľa (nie textového matchingu)
                # konkurz_restrukturalizacia_issues má debtor.cin
                # or_podanie_issues má cin priamo
                item_cin = item.get("cin")
                if item_cin is None:
                    debtor = item.get("debtor")
                    if debtor and isinstance(debtor, dict):
                        item_cin = debtor.get("cin")

                if item_cin is None:
                    continue

                # Porovnanie ako integer (najspoľahlivejšie)
                try:
                    if int(item_cin) != ico_int:
                        continue
                except (ValueError, TypeError):
                    continue

                # Zostavíme text z dostupných polí
                text_parts = []
                for field in ("heading", "decision", "announcement", "advice", "text", "content"):
                    val = item.get(field)
                    if val and isinstance(val, str) and val.strip():
                        text_parts.append(val.strip())

                text = "\n".join(text_parts)
                if not text:
                    continue

                results.append({
                    "id": str(item.get("id", "UNKNOWN")),
                    "text": text[:8000],
                    "published_at": item.get("published_at", item.get("created_at", "UNKNOWN")),
                    "kind_name": item.get("kind_name", item.get("kind", item.get("file_name", ""))),
                })

        except Exception as e:
            logger.warning(f"[OV] Sync API {endpoint} zlyhalo: {e}")

        return results

async def save_vestnik_events_to_db(ico: str, events: List[Dict]):
    """
    Uloží nájdené eventy do tabuľky VestnikEvent.
    Túto funkciu zavoláme z pipeline po úspešnom scrapovaní.
    """
    db = Prisma()
    await db.connect()
    
    try:
        # Zabezpečiť existenciu firmy
        await db.company.upsert(
            where={'ico': ico},
            data={'create': {'ico': ico}, 'update': {}}
        )
        
        saved = []
        for e in events:
            # Pretože nemáme unikátne obmedzenie na VestnikEvent okrem id, 
            # na zamedzenie duplicít by bolo lepšie kontrolovať sourceId.
            # Ak sourceId nemáme, vytvoríme nový záznam.
            
            analysis: VestnikExtraction = e["analysis"]
            
            # Formátovanie dátumu (ak je 'UNKNOWN', použijeme aktuálny)
            from datetime import datetime
            pub_date = datetime.utcnow()
            if e.get("publishedAt") and e["publishedAt"] != "UNKNOWN":
                try:
                    pub_date = datetime.fromisoformat(e["publishedAt"].replace("Z", "+00:00")).replace(tzinfo=None)
                except (ValueError, TypeError):
                    try:
                        pub_date = datetime.strptime(e["publishedAt"][:10], "%Y-%m-%d")
                    except (ValueError, TypeError):
                        pass
                    
            record = await db.vestnikevent.create({
                "companyIco": ico,
                "eventType": analysis.typ_udalosti,
                "severityLevel": analysis.rizikovost,
                "summary": analysis.zhrnutie + "\nRed Flags: " + ", ".join(analysis.red_flags),
                "publishedAt": pub_date,
                "sourceId": e["sourceId"]
            })
            saved.append(record)
            
        return saved
    finally:
        await db.disconnect()

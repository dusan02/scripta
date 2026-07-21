import logging
import httpx
import re
import json
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from src.llm_extractor import extract_vestnik_event, extract_vestnik_events_batch, VestnikExtraction, VestnikBatchResult
from src.db_client import get_db
from ..models import ScrapedSource
from .base import BaseScraper, ScraperInputError

logger = logging.getLogger(__name__)

_API_BASE = "https://datahub.ekosystem.slovensko.digital/api/data/ov"
_MAX_PAGES = 50
_RATE_LIMIT_DELAY = 1.2  # sekundy medzi requestami (60 req/min limit)


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
        report_language: str = kwargs.get("report_language", "sk")
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

                await asyncio.sleep(_RATE_LIMIT_DELAY)

                # 2. Podania na obchodný register — zmeny v registri
                found_events.extend(
                    await self._fetch_and_filter(client, "or_podanie_issues", ico_int, ico_clean)
                )

        except Exception as e:
            logger.error(f"[OV] Chyba pri fetch z ekosystem API: {e}")
            return {"status": "SUCCESS", "events_found": 0, "events": []}

        logger.info(f"[OV] IČO {ico_clean}: nájdených {len(found_events)} relevantných záznamov")

        # Batch spracovanie — jeden LLM call pre všetky eventy naraz.
        # Namiesto N sériových volaní urobíme 1 volanie, ktoré vidí všetky eventy
        # a dokáže detegovať cross-event vzorce (white horse, chronická insolvencia).
        analyzed_events = []
        batch_result = VestnikBatchResult()
        if found_events:
            try:
                batch_result: VestnikBatchResult = await extract_vestnik_events_batch(
                    found_events, report_language=report_language
                )

                # Map batch results späť na eventy podľa source_index
                for item in batch_result.events:
                    idx = item.source_index
                    if 0 <= idx < len(found_events):
                        event = found_events[idx]
                        extraction = VestnikExtraction(
                            typ_udalosti=item.typ_udalosti,
                            rizikovost=item.rizikovost,
                            zhrnutie=item.zhrnutie,
                            red_flags=item.red_flags,
                        )
                        analyzed_events.append({
                            "sourceId": event["id"],
                            "publishedAt": event.get("published_at", "UNKNOWN"),
                            "rawType": event.get("kind_name", event.get("file_name", "Neznámy typ")),
                            "analysis": extraction,
                        })

                if batch_result.white_horse_risk:
                    logger.warning(f"[OV] IČO {ico_clean}: WHITE HORSE RISK detekovaný! Vzorec: {batch_result.cross_event_pattern}")
                if batch_result.cross_event_pattern:
                    logger.info(f"[OV] IČO {ico_clean}: Cross-event vzorec: {batch_result.cross_event_pattern}")

            except Exception as e:
                logger.warning(f"[OV] Batch analýza zlyhala pre IČO {ico_clean}: {e} — fallback na per-event")
                # Fallback na pôvodný per-event prístup
                for event in found_events:
                    try:
                        extraction: VestnikExtraction = await extract_vestnik_event(event["text"], report_language=report_language)
                        analyzed_events.append({
                            "sourceId": event["id"],
                            "publishedAt": event.get("published_at", "UNKNOWN"),
                            "rawType": event.get("kind_name", event.get("file_name", "Neznámy typ")),
                            "analysis": extraction,
                        })
                    except Exception as e2:
                        logger.warning(f"[OV] Gemini analýza zlyhala pre záznam {event['id']}: {e2}")

        return {
            "status": "SUCCESS",
            "events_found": len(analyzed_events),
            "events": analyzed_events,
            "white_horse_risk": batch_result.white_horse_risk if found_events else False,
            "cross_event_pattern": batch_result.cross_event_pattern if found_events else "",
        }

    async def _fetch_and_filter(
        self, client: httpx.AsyncClient, endpoint: str, ico_int: Optional[int], ico_clean: str
    ) -> List[Dict]:
        """
        Fetch z ekosystem sync API s plnou pagináciou cez Link header.
        Filtruje podľa štruktúrneho poľa cin/debtor.cin.
        Používa 365-dňový lookback — pokrýva historické konkurzy/reštrukturalizácie.
        """
        from_date = (datetime.utcnow() - timedelta(days=365)).isoformat()

        results = []
        url = f"{_API_BASE}/{endpoint}/sync"
        params = {"since": from_date}
        pages_fetched = 0

        try:
            while url and pages_fetched < _MAX_PAGES:
                if pages_fetched > 0:
                    await asyncio.sleep(_RATE_LIMIT_DELAY)
                resp = await client.get(url, params=params if pages_fetched == 0 else None)
                resp.raise_for_status()
                pages_fetched += 1

                data = resp.json()
                items = data if isinstance(data, list) else data.get("items", data.get("data", []))

                page_matches = 0
                for item in items:
                    item_cin = item.get("cin")
                    if item_cin is None:
                        debtor = item.get("debtor")
                        if debtor and isinstance(debtor, dict):
                            item_cin = debtor.get("cin")

                    if item_cin is None:
                        continue

                    try:
                        if int(item_cin) != ico_int:
                            continue
                    except (ValueError, TypeError):
                        continue

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
                    page_matches += 1

                logger.debug(f"[OV] {endpoint} page {pages_fetched}: {len(items)} items, {page_matches} matches")

                # Nasleduj Link header pre ďalšiu stránku
                link_header = resp.headers.get("link", "")
                next_url = None
                if link_header:
                    for part in link_header.split(","):
                        if "rel='next'" in part or 'rel="next"' in part:
                            url_match = re.search(r"<(.+?)>", part)
                            if url_match:
                                next_url = url_match.group(1)
                                break

                url = next_url
                params = None  # ďalšie stránky majú params už v URL z Link headeru

            if pages_fetched >= _MAX_PAGES:
                logger.warning(f"[OV] {endpoint}: dosiahnutý limit {_MAX_PAGES} strán")

        except Exception as e:
            logger.warning(f"[OV] Sync API {endpoint} zlyhalo (page {pages_fetched}): {e}")

        logger.info(f"[OV] {endpoint}: prehľadaných {pages_fetched} strán, nájdených {len(results)} záznamov pre IČO {ico_clean}")
        return results

async def save_vestnik_events_to_db(ico: str, events: List[Dict]):
    """
    Uloží nájdené eventy do tabuľky VestnikEvent.
    Túto funkciu zavoláme z pipeline po úspešnom scrapovaní.
    """
    db = get_db()

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
        pass

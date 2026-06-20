import asyncio
from pathlib import Path
from typing import Dict, List, Type

from playwright.async_api import Browser

from .base import BaseScraper
from .orsr import OrsrScraper
from .zrsr import ZrsrScraper
from .insolvency import InsolvencyScraper
from .cre import CreScraper
from ..models import ScrapedSource

# Registrácia scraperov podľa SourceType.
_SCRAPER_REGISTRY: Dict[str, Type[BaseScraper]] = {
    "ORSR": OrsrScraper,
    "ZRSR": ZrsrScraper,
    "INSOLVENCY": InsolvencyScraper,
    "CRE": CreScraper,
}


def get_scraper(source_type: str) -> Type[BaseScraper]:
    try:
        return _SCRAPER_REGISTRY[source_type]
    except KeyError:
        raise ValueError(f"Unknown source type: {source_type}")


async def run_scrapers(
    sources: List[str],
    *,
    output_dir: Path,
    browser: Browser,
    target_type: str,
    ico: str | None = None,
    name: str | None = None,
    surname: str | None = None,
    birth_date: str | None = None,
) -> List[ScrapedSource]:
    """Spustí všetky scrapery paralelne, každý s vlastnou stránkou."""
    results: List[ScrapedSource] = []

    async def run_one(source_type: str) -> ScrapedSource:
        scraper_cls = get_scraper(source_type)
        scraper = scraper_cls(browser=browser)
        try:
            return await scraper.run(
                output_dir=output_dir,
                target_type=target_type,
                ico=ico,
                name=name,
                surname=surname,
                birth_date=birth_date,
            )
        finally:
            await scraper._close()

    # Spustíme všetky naraz; výpadok jedného registra nezablokuje ostatné.
    tasks = [run_one(source) for source in sources]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Prevedieme výnimky na FAILED výsledky.
    normalized: List[ScrapedSource] = []
    for source, res in zip(sources, results):
        if isinstance(res, BaseException):
            normalized.append(
                ScrapedSource(
                    source_type=source,
                    status="FAILED",
                    status_message=f"Unhandled exception: {type(res).__name__}: {res}",
                )
            )
        else:
            normalized.append(res)
    return normalized

from __future__ import annotations
import asyncio
import logging
from pathlib import Path
from typing import Callable, Dict, List, Optional, Type

from playwright.async_api import Browser

from .base import BaseScraper
from .orsr import OrsrScraper
from .zrsr import ZrsrScraper
from .insolvency import InsolvencyScraper
from .rpvs import RpvsScraper
from .fs import FinancnaSpravaScraper
from .fs_dph_rusenie import FsDphRusenieScraper
from .fs_dph_vymazani import FsDphVymazaniScraper
from .fs_danove_subjekty import FsDanoveSubjektyScraper
from .fs_dan_z_prijmov import FsDanZPrijmovScraper
from .fs_dph_nadmerny_odpocet import FsDphNadmernyOdpocetScraper
from .fs_dph_registrovani import FsDphRegistrovaniScraper
from .fs_dan_prijmov_reg import FsDanPrijmovRegistrovaniScraper
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

# Registrácia scraperov podľa SourceType.
_SCRAPER_REGISTRY: Dict[str, Type[BaseScraper]] = {
    "ORSR": OrsrScraper,
    "ZRSR": ZrsrScraper,
    "INSOLVENCY": InsolvencyScraper,
    "RPVS": RpvsScraper,
    "FINANCNA_SPRAVA": FinancnaSpravaScraper,
    "FS_DPH_RUSENIE": FsDphRusenieScraper,
    "FS_DPH_VYMAZANI": FsDphVymazaniScraper,
    "FS_DANOVE_SUBJEKTY": FsDanoveSubjektyScraper,
    "FS_DAN_Z_PRIJMOV": FsDanZPrijmovScraper,
    "FS_DPH_NADMERNY_ODPOCET": FsDphNadmernyOdpocetScraper,
    "FS_DPH_REGISTROVANI": FsDphRegistrovaniScraper,
    "FS_DAN_PRIJMOV_REG": FsDanPrijmovRegistrovaniScraper,
}

# Scrapery, ktoré závisia na výsledku iného scraperu (potrebujú company_name).
# Mapa: source_type -> zdroj company_name
_DEPENDS_ON: Dict[str, str] = {
    "FINANCNA_SPRAVA": "ORSR",
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
    ico: Optional[str] = None,
    name: Optional[str] = None,
    surname: Optional[str] = None,
    birth_date: Optional[str] = None,
    on_source_done: Optional[Callable[[ScrapedSource], None]] = None,
) -> List[ScrapedSource]:
    """Spustí scrapery — nezávislé paralelne, závislé sekvenčne po ich dependencii.
    Ak je zadaný on_source_done, zavolá sa ihneď po dokončení každého scraperu."""

    # Rozdelíme na nezávislé a závislé scrapery
    independent = [s for s in sources if s not in _DEPENDS_ON]
    dependent = [s for s in sources if s in _DEPENDS_ON]

    results_by_source: Dict[str, ScrapedSource] = {}

    async def run_one(source_type: str, **extra_kwargs) -> ScrapedSource:
        scraper_cls = get_scraper(source_type)
        scraper = scraper_cls(browser=browser)
        try:
            result = await scraper.run(
                output_dir=output_dir,
                target_type=target_type,
                ico=ico,
                name=name,
                surname=surname,
                birth_date=birth_date,
                **extra_kwargs,
            )
            # Ihneď reportujeme dokončenie
            if on_source_done and result:
                try:
                    on_source_done(result)
                except Exception as cb_err:
                    logger.warning(f"on_source_done callback zlyhal pre {source_type}: {cb_err}")
            return result
        finally:
            await scraper._close()

    # 1. prechod — nezávislé scrapery paralelne
    tasks = [run_one(source) for source in independent]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    for source, res in zip(independent, raw_results):
        if isinstance(res, BaseException):
            results_by_source[source] = ScrapedSource(
                source_type=source,
                status="FAILED",
                status_message=f"Unhandled exception: {type(res).__name__}: {res}",
            )
        else:
            results_by_source[source] = res

    # 2. prechod — závislé scrapery (potrebujú company_name z dependencie)
    for source in dependent:
        dependency = _DEPENDS_ON[source]
        dep_result = results_by_source.get(dependency)

        # Získame company_name z dependencie
        company_name = None
        if dep_result and dep_result.status == "SUCCESS":
            company_name = getattr(dep_result, "company_name", None)

        if not company_name:
            logger.info(f"[{source}] Preskakujem — dependencia {dependency} neposkytla company_name.")
            skip_result = ScrapedSource(
                source_type=source,
                status="UNAVAILABLE",
                status_message=f"Závislosť {dependency} neposkytla názov subjektu.",
            )
            results_by_source[source] = skip_result
            if on_source_done:
                try:
                    on_source_done(skip_result)
                except Exception as cb_err:
                    logger.warning(f"on_source_done callback zlyhal pre {source}: {cb_err}")
            continue

        try:
            result = await run_one(source, company_name=company_name)
            results_by_source[source] = result
        except BaseException as e:
            err_result = ScrapedSource(
                source_type=source,
                status="FAILED",
                status_message=f"Unhandled exception: {type(e).__name__}: {e}",
            )
            results_by_source[source] = err_result

    # Vrátime v pôvodnom poradí
    return [results_by_source[s] for s in sources]

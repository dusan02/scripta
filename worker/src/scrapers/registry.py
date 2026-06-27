from __future__ import annotations
import asyncio
import logging
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Type

from playwright.async_api import Browser

from .base import BaseScraper
from .orsr import OrsrScraper
from .zrsr import ZrsrScraper
from .insolvency import InsolvencyScraper
from .rpvs import RpvsScraper
from .ncrzp import NcrzpScraper
from .ncrd import NcrdScraper
from .fs import FinancnaSpravaScraper
from .fs_dph_rusenie import FsDphRusenieScraper
from .fs_dph_vymazani import FsDphVymazaniScraper
from .fs_danove_subjekty import FsDanoveSubjektyScraper
from .fs_dan_z_prijmov import FsDanZPrijmovScraper
from .fs_dph_nadmerny_odpocet import FsDphNadmernyOdpocetScraper
from .fs_dph_registrovani import FsDphRegistrovaniScraper
from .fs_dan_prijmov_reg import FsDanPrijmovRegistrovaniScraper
from .registeruz import RegisterUzScraper
from .crz import CrzScraper
from .uvo import UvoScraper
from .poverenia import PovereniaScraper
from .diskvalifikacie import DiskvalifikacieScraper
from .sp_dlznici import SpDlzniciScraper
from .vszp_dlznici import VszpDlzniciScraper
from .dovera_dlznici import DoveraDlzniciScraper
from .union_dlznici import UnionDlzniciScraper
from ..models import ScrapedSource

# FS scrapery zdieľajú rovnakú URL — obmedzíme paralelizmus aby FS server
# nerobil rate-limiting / timeout
_FS_SOURCE_TYPES = {
    "FINANCNA_SPRAVA", "FS_DPH_RUSENIE", "FS_DPH_VYMAZANI", "FS_DANOVE_SUBJEKTY",
    "FS_DAN_Z_PRIJMOV", "FS_DPH_NADMERNY_ODPOCET", "FS_DPH_REGISTROVANI",
    "FS_DAN_PRIJMOV_REG",
}
_fs_semaphore = asyncio.Semaphore(3)

# Globálny limit súbežných scraperov — 8 contextov je bezpečné pre 8GB server
_global_semaphore = asyncio.Semaphore(8)

logger = logging.getLogger(__name__)

# Registrácia scraperov podľa SourceType.
_SCRAPER_REGISTRY: Dict[str, Type[BaseScraper]] = {
    "ORSR": OrsrScraper,
    "ZRSR": ZrsrScraper,
    "INSOLVENCY": InsolvencyScraper,
    "RPVS": RpvsScraper,
    "NCRZP": NcrzpScraper,
    "NCRD": NcrdScraper,
    "FINANCNA_SPRAVA": FinancnaSpravaScraper,
    "FS_DPH_RUSENIE": FsDphRusenieScraper,
    "FS_DPH_VYMAZANI": FsDphVymazaniScraper,
    "FS_DANOVE_SUBJEKTY": FsDanoveSubjektyScraper,
    "FS_DAN_Z_PRIJMOV": FsDanZPrijmovScraper,
    "FS_DPH_NADMERNY_ODPOCET": FsDphNadmernyOdpocetScraper,
    "FS_DPH_REGISTROVANI": FsDphRegistrovaniScraper,
    "FS_DAN_PRIJMOV_REG": FsDanPrijmovRegistrovaniScraper,
    "SP_DLZNICI": SpDlzniciScraper,
    "VSZP_DLZNICI": VszpDlzniciScraper,
    "DOVERA_DLZNICI": DoveraDlzniciScraper,
    "UNION_DLZNICI": UnionDlzniciScraper,
    "REGISTER_UZ": RegisterUzScraper,
    "CRZ": CrzScraper,
    "UVO": UvoScraper,
    "POVERENIA": PovereniaScraper,
    "DISKVALIFIKACIE": DiskvalifikacieScraper,
}

# Scrapery, ktoré závisia na výsledku iného scraperu (potrebujú company_name).
# Mapa: source_type -> zdroj company_name
_DEPENDS_ON: Dict[str, str] = {
    "FINANCNA_SPRAVA": "ORSR",
    "DISKVALIFIKACIE": "ORSR",
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
    orsr_extract_type: Optional[str] = "CURRENT",
    crz_date_from: Optional[str] = None,
    on_source_done: Optional[Callable[[ScrapedSource], None]] = None,
) -> List[ScrapedSource]:
    """Spustí scrapery — nezávislé paralelne; závislé sa spustia hneď ako ich
    dependencia skončí (paralelne s ostatnými nezávislými).
    Ak je zadaný on_source_done, zavolá sa ihneď po dokončení každého scraperu."""

    # Rozdelíme na nezávislé a závislé scrapery
    independent = [s for s in sources if s not in _DEPENDS_ON]
    dependent = [s for s in sources if s in _DEPENDS_ON]

    results_by_source: Dict[str, ScrapedSource] = {}

    async def run_one(source_type: str, **extra_kwargs) -> ScrapedSource:
        scraper_cls = get_scraper(source_type)
        scraper = scraper_cls(browser=browser)
        is_fs = source_type in _FS_SOURCE_TYPES
        _t_start = time.perf_counter()
        logger.debug(f"[TIMING] ▶ {source_type} START")
        try:
            if is_fs:
                async with _fs_semaphore:
                    async with _global_semaphore:
                        _t_run = time.perf_counter()
                        if _t_run - _t_start > 0.05:
                            logger.debug(f"[TIMING] {source_type} čakal na semafor: {_t_run - _t_start:.2f}s")
                        result = await scraper.run(
                            output_dir=output_dir,
                            target_type=target_type,
                            ico=ico,
                            name=name,
                            surname=surname,
                            birth_date=birth_date,
                            orsr_extract_type=orsr_extract_type,
                            crz_date_from=crz_date_from,
                            **extra_kwargs,
                        )
            else:
                async with _global_semaphore:
                    _t_run = time.perf_counter()
                    if _t_run - _t_start > 0.05:
                        logger.debug(f"[TIMING] {source_type} čakal na globálny semafor: {_t_run - _t_start:.2f}s")
                    result = await scraper.run(
                        output_dir=output_dir,
                        target_type=target_type,
                        ico=ico,
                        name=name,
                        surname=surname,
                        birth_date=birth_date,
                        orsr_extract_type=orsr_extract_type,
                        crz_date_from=crz_date_from,
                        **extra_kwargs,
                    )
            logger.debug(f"[TIMING] ✔ {source_type} HOTOVO za {time.perf_counter() - _t_start:.2f}s → {result.status if result else '?'}")
            # Ihneď reportujeme dokončenie
            if on_source_done and result:
                try:
                    on_source_done(result)
                except Exception as cb_err:
                    logger.warning(f"on_source_done callback zlyhal pre {source_type}: {cb_err}")
            return result
        except BaseException as e:
            logger.debug(f"[TIMING] ✗ {source_type} CHYBA za {time.perf_counter() - _t_start:.2f}s: {type(e).__name__}")
            raise
        finally:
            await scraper._close()

    # 1. prechod — nezávislé scrapery paralelne
    # Závislé scrapery sa spustia hneď ako ich dependencia skončí (nie až po všetkých)
    pending_dependent: Dict[str, asyncio.Task] = {}

    async def _run_dependent_after(dep_source_type: str, dep_result: ScrapedSource) -> None:
        """Spustí závislé scrapery čo najskôr po dokončení dependencie."""
        company_name = None
        ic_dph = None
        persons = None
        if dep_result and dep_result.status == "SUCCESS":
            company_name = getattr(dep_result, "company_name", None)
            ic_dph = getattr(dep_result, "ic_dph", None)
            persons = getattr(dep_result, "persons", None)

        for source in dependent:
            if _DEPENDS_ON.get(source) != dep_source_type:
                continue

            # Zisti čo závislý scraper potrebuje
            extra_kwargs = {}
            if company_name:
                extra_kwargs["company_name"] = company_name
            if ic_dph:
                extra_kwargs["ic_dph"] = ic_dph
            if persons:
                extra_kwargs["persons"] = persons

            if not extra_kwargs:
                logger.info(f"[{source}] Preskakujem — dependencia {dep_source_type} neposkytla potrebné údaje.")
                skip_result = ScrapedSource(
                    source_type=source,
                    status="UNAVAILABLE",
                    status_message=f"Závislosť {dep_source_type} neposkytla potrebné údaje.",
                )
                results_by_source[source] = skip_result
                if on_source_done:
                    try:
                        on_source_done(skip_result)
                    except Exception as cb_err:
                        logger.warning(f"on_source_done callback zlyhal pre {source}: {cb_err}")
                continue

            task = asyncio.ensure_future(run_one(source, **extra_kwargs))
            pending_dependent[source] = task

    async def _run_independent(source_type: str) -> ScrapedSource:
        result = await run_one(source_type)
        # Ak je táto dependencia pre nejaký závislý scraper, spustíme ho hneď
        if source_type in _DEPENDS_ON.values():
            await _run_dependent_after(source_type, result)
        return result

    tasks = [_run_independent(source) for source in independent]
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

    # Počkáme na závislé scrapery ktoré sa spustili paralelne
    if pending_dependent:
        dep_results = await asyncio.gather(*pending_dependent.values(), return_exceptions=True)
        for source, res in zip(pending_dependent.keys(), dep_results):
            if isinstance(res, BaseException):
                results_by_source[source] = ScrapedSource(
                    source_type=source,
                    status="FAILED",
                    status_message=f"Unhandled exception: {type(res).__name__}: {res}",
                )
            else:
                results_by_source[source] = res

    # Safety net — závislé scrapery ktoré sa nespustili (dependencia nebola vybraná
    # alebo zlyhala výnimkou) označíme ako UNAVAILABLE, aby nevznikol KeyError.
    for source in dependent:
        if source in results_by_source:
            continue
        dependency = _DEPENDS_ON[source]
        skip_result = ScrapedSource(
            source_type=source,
            status="UNAVAILABLE",
            status_message=f"Závislosť {dependency} nebola dostupná — názov subjektu sa nezískal.",
        )
        results_by_source[source] = skip_result
        if on_source_done:
            try:
                on_source_done(skip_result)
            except Exception as cb_err:
                logger.warning(f"on_source_done callback zlyhal pre {source}: {cb_err}")

    # Vrátime v pôvodnom poradí
    return [results_by_source[s] for s in sources]

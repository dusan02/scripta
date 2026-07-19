from __future__ import annotations
from .base import BaseScraper, ScraperUnavailableError, ScraperInputError
from .orsr import OrsrScraper
from .zrsr import ZrsrScraper
from .rpo import RpoScraper
from .insolvency import InsolvencyScraper
from .rpvs import RpvsScraper
from .ncrzp import NcrzpScraper
from .ncrd import NcrdScraper
from .obchodny_vestnik import ObchodnyVestnikXmlScraper
from .fs import FinancnaSpravaScraper
from .fs_dph_rusenie import FsDphRusenieScraper
from .fs_dph_vymazani import FsDphVymazaniScraper
from .fs_danove_subjekty import FsDanoveSubjektyScraper
from .registeruz import RegisterUzScraper
from .crz import CrzScraper
from .sp_dlznici import SpDlzniciScraper
from .vszp_dlznici import VszpDlzniciScraper
from .dovera_dlznici import DoveraDlzniciScraper
from .union_dlznici import UnionDlzniciScraper
from .diskvalifikacie import DiskvalifikacieScraper
from .registry import get_scraper, run_scrapers

__all__ = [
    "BaseScraper",
    "ScraperUnavailableError",
    "ScraperInputError",
    "OrsrScraper",
    "ZrsrScraper",
    "RpoScraper",
    "InsolvencyScraper",
    "RpvsScraper",
    "NcrzpScraper",
    "NcrdScraper",
    "ObchodnyVestnikXmlScraper",
    "FinancnaSpravaScraper",
    "FsDphRusenieScraper",
    "FsDphVymazaniScraper",
    "FsDanoveSubjektyScraper",
    "RegisterUzScraper",
    "CrzScraper",
    "SpDlzniciScraper",
    "VszpDlzniciScraper",
    "DoveraDlzniciScraper",
    "UnionDlzniciScraper",
    "DiskvalifikacieScraper",
    "get_scraper",
    "run_scrapers",
]
    
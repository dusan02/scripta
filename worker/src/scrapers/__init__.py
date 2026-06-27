from __future__ import annotations
from .base import BaseScraper, ScraperUnavailableError, ScraperInputError
from .orsr import OrsrScraper
from .zrsr import ZrsrScraper
from .insolvency import InsolvencyScraper
from .ncrzp import NcrzpScraper
from .ncrd import NcrdScraper
from .fs import FinancnaSpravaScraper
from .fs_dph_rusenie import FsDphRusenieScraper
from .fs_dph_vymazani import FsDphVymazaniScraper
from .fs_danove_subjekty import FsDanoveSubjektyScraper
from .registeruz import RegisterUzScraper
from .sp_dlznici import SpDlzniciScraper
from .vszp_dlznici import VszpDlzniciScraper
from .dovera_dlznici import DoveraDlzniciScraper
from .diskvalifikacie import DiskvalifikacieScraper
from .registry import get_scraper, run_scrapers

__all__ = [
    "BaseScraper",
    "ScraperUnavailableError",
    "ScraperInputError",
    "OrsrScraper",
    "ZrsrScraper",
    "InsolvencyScraper",
    "NcrzpScraper",
    "NcrdScraper",
    "FinancnaSpravaScraper",
    "FsDphRusenieScraper",
    "FsDphVymazaniScraper",
    "FsDanoveSubjektyScraper",
    "RegisterUzScraper",
    "SpDlzniciScraper",
    "VszpDlzniciScraper",
    "DoveraDlzniciScraper",
    "DiskvalifikacieScraper",
    "get_scraper",
    "run_scrapers",
]
    
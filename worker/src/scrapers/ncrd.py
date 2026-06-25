from __future__ import annotations

from .notar_base import NotarBaseScraper


class NcrdScraper(NotarBaseScraper):
    """
    Scraper pre Notársky centrálny register dražieb (NCRD).
    URL: https://www.notar.sk/drazby/
    Vyhľadávanie podľa IČO dražobníka.
    """

    source_type = "NCRD"
    base_url = "https://www.notar.sk/drazby/"
    _title = "Notársky centrálny register dražieb (NCRD)"
    _field_label = "IČO dražobníka"
    _no_results_msg = "Subjekt nie je evidovaný v Notárskom centrálnom registri dražieb."

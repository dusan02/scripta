from __future__ import annotations

from .notar_base import NotarBaseScraper


class NcrzpScraper(NotarBaseScraper):
    """
    Scraper pre Notársky centrálny register záložných práv (NCRZP).
    URL: https://www.notar.sk/zalozne-prava/
    Vyhľadávanie podľa IČO záložcu.
    """

    source_type = "NCRZP"
    base_url = "https://www.notar.sk/zalozne-prava/"
    _title = "Notársky centrálny register záložných práv (NCRZP)"
    _field_label = "IČO záložcu"
    _no_results_msg = "Subjekt nie je evidovaný v Notárskom centrálnom registri záložných práv."

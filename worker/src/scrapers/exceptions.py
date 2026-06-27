from __future__ import annotations

class ScraperUnavailableError(Exception):
    """Raised when the target register is unreachable/down."""
    pass

class ScraperInputError(Exception):
    """Raised when the input is invalid for the scraper."""
    pass

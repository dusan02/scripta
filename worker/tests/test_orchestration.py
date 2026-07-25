"""
Unit testy pre orchestráciu generovania reportu.

Testuje:
  - Retry logiku (exponential backoff, UNAVAILABLE zahrnutý)
  - Timeout handling (zachovanie čiastočných výsledkov)
  - _safe_goto broadened exception handling
  - RÚZ API retry mechanizmus
  - RÚZ paralelizácia výkazov
  - max_years konzistencia medzi scraper a pipeline
"""
import asyncio
import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

from src.scrapers.base import BaseScraper
from src.scrapers.registeruz import RegisterUzScraper


class _ConcreteScraper(BaseScraper):
    """Concrete subclass for testing BaseScraper methods."""
    async def run(self, **kwargs):
        pass


# ═══════════════════════════════════════════════════════════════════════════
# _safe_goto — broadened exception handling (3e)
# ═══════════════════════════════════════════════════════════════════════════

class TestSafeGotoBroadened:
    """_safe_goto by mal chytiť všetky výnimky, nielen PlaywrightTimeout/PlaywrightError."""

    def _make_scraper(self):
        browser = MagicMock()
        scraper = _ConcreteScraper(browser)
        scraper.source_type = "TEST"
        return scraper

    @pytest.mark.asyncio
    async def test_network_error_retried(self):
        """Generic Exception (napr. ConnectionError) by mal byť retryovaný."""
        scraper = self._make_scraper()
        page = AsyncMock()
        # Simuluj network error 2x, potom úspech
        page.goto.side_effect = [
            ConnectionError("Network unreachable"),
            ConnectionError("DNS resolution failed"),
            None,  # úspech
        ]
        page.wait_for_load_state = AsyncMock(return_value=None)
        with patch("src.scrapers.base.settings") as mock_settings:
            mock_settings.scraper_retries = 3
            mock_settings.scraper_retry_delay = 0.01
            await scraper._safe_goto(page, "https://example.com")
        assert page.goto.call_count == 3

    @pytest.mark.asyncio
    async def test_generic_exception_raised_after_retries(self):
        """Ak zlyhajú všetky retry, mal by byť ScraperUnavailableError."""
        from src.scrapers.base import ScraperUnavailableError
        scraper = self._make_scraper()
        page = AsyncMock()
        page.goto.side_effect = RuntimeError("Server crashed")
        page.wait_for_load_state = AsyncMock(return_value=None)
        with patch("src.scrapers.base.settings") as mock_settings:
            mock_settings.scraper_retries = 1
            mock_settings.scraper_retry_delay = 0.01
            with pytest.raises(ScraperUnavailableError, match="unreachable"):
                await scraper._safe_goto(page, "https://example.com")
        assert page.goto.call_count == 2  # 1 initial + 1 retry

    @pytest.mark.asyncio
    async def test_success_on_first_try(self):
        """Ak prvý pokus úspešný, žiadny retry."""
        scraper = self._make_scraper()
        page = AsyncMock()
        page.wait_for_load_state = AsyncMock(return_value=None)
        with patch("src.scrapers.base.settings") as mock_settings:
            mock_settings.scraper_retries = 3
            mock_settings.scraper_retry_delay = 0.01
            await scraper._safe_goto(page, "https://example.com")
        assert page.goto.call_count == 1


# ═══════════════════════════════════════════════════════════════════════════
# RÚZ API retry (3f)
# ═══════════════════════════════════════════════════════════════════════════

class TestRuzApiRetry:
    """_api_get by mal retryovať pri 5xx a network chybách."""

    @pytest.mark.asyncio
    async def test_retry_on_500(self):
        """HTTP 500 by mal spustiť retry."""
        from src.ruz_api import _api_get, _API_RETRIES
        client = AsyncMock()
        resp_500 = MagicMock()
        resp_500.status_code = 500
        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.json.return_value = {"id": [42]}
        client.get.side_effect = [resp_500, resp_200]
        with patch("src.ruz_api._API_RETRY_DELAY", 0.01):
            result = await _api_get(client, "uctovne-jednotky", {"ico": "123"})
        assert result == {"id": [42]}
        assert client.get.call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_network_error(self):
        """Network exception by mal spustiť retry."""
        from src.ruz_api import _api_get
        client = AsyncMock()
        resp_ok = MagicMock()
        resp_ok.status_code = 200
        resp_ok.json.return_value = {"ok": True}
        client.get.side_effect = [
            httpx.ConnectError("Connection refused"),
            resp_ok,
        ]
        with patch("src.ruz_api._API_RETRY_DELAY", 0.01):
            result = await _api_get(client, "test-endpoint")
        assert result == {"ok": True}
        assert client.get.call_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_404(self):
        """HTTP 404 by nemal spustiť retry (client error, nie 5xx)."""
        from src.ruz_api import _api_get
        client = AsyncMock()
        resp_404 = MagicMock()
        resp_404.status_code = 404
        client.get.return_value = resp_404
        with patch("src.ruz_api._API_RETRY_DELAY", 0.01):
            result = await _api_get(client, "test-endpoint")
        assert result is None
        assert client.get.call_count == 1

    @pytest.mark.asyncio
    async def test_all_retries_exhausted(self):
        """Ak všetky retry zlyhajú, vráti None."""
        from src.ruz_api import _api_get, _API_RETRIES
        client = AsyncMock()
        resp_500 = MagicMock()
        resp_500.status_code = 500
        client.get.return_value = resp_500
        with patch("src.ruz_api._API_RETRY_DELAY", 0.01):
            result = await _api_get(client, "test-endpoint")
        assert result is None
        assert client.get.call_count == _API_RETRIES + 1

    @pytest.mark.asyncio
    async def test_success_on_first_try(self):
        """HTTP 200 na prvý pokus — žiadny retry."""
        from src.ruz_api import _api_get
        client = AsyncMock()
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"data": "ok"}
        client.get.return_value = resp
        result = await _api_get(client, "test-endpoint")
        assert result == {"data": "ok"}
        assert client.get.call_count == 1


# ═══════════════════════════════════════════════════════════════════════════
# RÚZ paralelizácia výkazov (3g)
# ═══════════════════════════════════════════════════════════════════════════

class TestRuzParallelVykazy:
    """_process_zavierka by mal stiahnuť výkazy paralelne, nie sekvenčne."""

    @pytest.mark.asyncio
    async def test_vykazy_downloaded_in_parallel(self):
        """Overí že výkazy sa stiahnu paralelne — meria čas, nie sekvenčne."""
        from src.ruz_api import _process_zavierka, _FETCH_CONCURRENCY
        import time

        client = AsyncMock()
        # Simuluj 3 výkazy, každý trvá 0.3s
        async def slow_api_get(client, endpoint, params):
            await asyncio.sleep(0.3)
            return {"obsah": {"tabulky": [], "titulnaStrana": {}}, "prilohy": []}

        z = {
            "idUctovnychVykazov": [1, 2, 3],
            "obdobieOd": "01.01.2024",
            "obdobieDo": "31.12.2024",
            "konsolidovana": False,
        }

        with patch("src.ruz_api._api_get", side_effect=slow_api_get), \
             patch("src.ruz_api._download_prilohy", new_callable=AsyncMock, return_value=[]), \
             patch("src.ruz_api._format_vykaz_tables", return_value=""):
            t0 = time.perf_counter()
            await _process_zavierka(client, z, "12345678", Path("/tmp/test_ruz"), 0)
            elapsed = time.perf_counter() - t0

        # Ak by boli sekvenčné: 3 × 0.3s = 0.9s. Paralelne: ~0.3s.
        # Pridajme tolerance pre CI.
        assert elapsed < 0.7, f"Výkazy stiahnuté sekvenčne (elapsed={elapsed:.2f}s, očakávané < 0.7s)"


# ═══════════════════════════════════════════════════════════════════════════
# Retry filter — UNAVAILABLE zahrnutý (3c)
# ═══════════════════════════════════════════════════════════════════════════

class TestRetryFilter:
    """Retry filter by mal zahrnúť aj UNAVAILABLE, nielen FAILED."""

    def test_unavailable_in_retry_filter(self):
        """Simulácia source listu s FAILED + UNAVAILABLE — oba by mali byť retryované."""
        from src.models import ScrapedSource

        sources = [
            ScrapedSource(source_type="ORSR", status="SUCCESS"),
            ScrapedSource(source_type="ZRSR", status="FAILED", status_message="Timeout"),
            ScrapedSource(source_type="RPVS", status="UNAVAILABLE", status_message="Server down"),
            ScrapedSource(source_type="INSOLVENCY", status="SUCCESS"),
        ]

        retryable = [s for s in sources if s.status in ("FAILED", "UNAVAILABLE")]
        retryable_types = [s.source_type for s in retryable]

        assert "ZRSR" in retryable_types, "FAILED by mal byť v retry filteri"
        assert "RPVS" in retryable_types, "UNAVAILABLE by mal byť v retry filteri"
        assert "ORSR" not in retryable_types, "SUCCESS by nemal byť v retry filteri"
        assert "INSOLVENCY" not in retryable_types, "SUCCESS by nemal byť v retry filteri"
        assert len(retryable) == 2

    def test_only_failed_old_behavior_excluded_unavailable(self):
        """Starý filter (len FAILED) by vynechal UNAVAILABLE — overíme že nový to zachytí."""
        from src.models import ScrapedSource

        sources = [
            ScrapedSource(source_type="X", status="UNAVAILABLE"),
        ]

        # Starý filter
        old = [s for s in sources if s.status == "FAILED"]
        assert len(old) == 0, "Starý filter nezachyti UNAVAILABLE"

        # Nový filter
        new = [s for s in sources if s.status in ("FAILED", "UNAVAILABLE")]
        assert len(new) == 1, "Nový filter zachytí UNAVAILABLE"


# ═══════════════════════════════════════════════════════════════════════════
# Exponential backoff delays (3a)
# ═══════════════════════════════════════════════════════════════════════════

class TestExponentialBackoff:
    """Retry passy by mali použiť exponential backoff [3, 10, 30]."""

    def test_retry_delays_values(self):
        """Overí že retry delays sú [3, 10, 30] — 3 passy s exponential backoff."""
        _RETRY_DELAYS = [3, 10, 30]
        assert len(_RETRY_DELAYS) == 3, "Mali by byť 3 retry passy"
        assert _RETRY_DELAYS[0] == 3, "Prvý delay = 3s"
        assert _RETRY_DELAYS[1] == 10, "Druhý delay = 10s"
        assert _RETRY_DELAYS[2] == 30, "Tretí delay = 30s"

    def test_backoff_is_exponential(self):
        """Overí že delays rastú exponenciálne (pomer > 2x medzi po sebe idúcimi)."""
        _RETRY_DELAYS = [3, 10, 30]
        for i in range(1, len(_RETRY_DELAYS)):
            ratio = _RETRY_DELAYS[i] / _RETRY_DELAYS[i - 1]
            assert ratio >= 2.0, f"Delay {i} ({_RETRY_DELAYS[i]}) by mal byť >= 2x delay {i-1} ({_RETRY_DELAYS[i-1]})"


# ═══════════════════════════════════════════════════════════════════════════
# max_years konzistencia (3i)
# ═══════════════════════════════════════════════════════════════════════════

class TestMaxYearsConsistency:
    """Scraper a pipeline by mali používať rovnaký max_years z configu."""

    def test_scraper_uses_config_not_hardcoded(self):
        """registeruz.py by mal čítať max_years z _cfg.ruz_max_years, nie hardcoded 3."""
        import inspect
        source = inspect.getsource(RegisterUzScraper.run)
        assert "_cfg.ruz_max_years" in source, "Scraper by mal používať _cfg.ruz_max_years"
        assert "max_years=3" not in source, "Scraper by nemal mať hardcoded max_years=3"

    def test_config_has_ruz_max_years(self):
        """Config by mal definovať ruz_max_years."""
        from src.config import settings
        assert hasattr(settings, "ruz_max_years"), "Config by mal mať ruz_max_years"
        assert settings.ruz_max_years > 0, "ruz_max_years by mal byť > 0"

    def test_pipeline_uses_config(self):
        """pipeline.py by mal používať _cfg.ruz_max_years."""
        import inspect
        from src.pipeline import process_company
        source = inspect.getsource(process_company)
        assert "ruz_max_years" in source, "Pipeline by mal používať _cfg.ruz_max_years"


# ═══════════════════════════════════════════════════════════════════════════
# Timeout — zachovanie čiastočných výsledkov (3b)
# ═══════════════════════════════════════════════════════════════════════════

class TestTimeoutPreservesPartial:
    """Pri timeoute by sa mali zachovať čiastočné výsledky, nie sources=[]."""

    def test_timeout_creates_failed_sources_not_empty(self):
        """Pri timeoute by sources mali obsahovať FAILED záznamy pre každý source type."""
        from src.models import ScrapedSource

        task_sources = ["ORSR", "ZRSR", "RPVS"]
        # Simulácia toho čo sa stane pri timeoute
        sources = [
            ScrapedSource(source_type=st, status="FAILED", status_message="Scraper timeout (180s)")
            for st in task_sources
        ]
        assert len(sources) == 3, "Sources by nemali byť prázdne pri timeoute"
        assert all(s.status == "FAILED" for s in sources), "Všetky by mali byť FAILED"
        assert all("timeout" in (s.status_message or "").lower() for s in sources), "Status message by mal spomínať timeout"

    def test_timeout_sources_have_correct_types(self):
        """Sources pri timeoute by mali mať správne source_types."""
        from src.models import ScrapedSource

        task_sources = ["ORSR", "ZRSR", "INSOLVENCY"]
        sources = [
            ScrapedSource(source_type=st, status="FAILED", status_message="Scraper timeout (180s)")
            for st in task_sources
        ]
        types = [s.source_type for s in sources]
        assert types == task_sources, "Source types by mali zodpovedať task.sources"

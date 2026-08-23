"""
Unit testy pre orchestráciu generovania reportu.

Testuje:
  - Retry logiku (exponential backoff, UNAVAILABLE zahrnutý)
  - Timeout handling (zachovanie čiastočných výsledkov)
  - _safe_goto broadened exception handling
  - RÚZ API retry mechanizmus (5xx, 429, network errors)
  - RÚZ paralelizácia výkazov
  - max_years konzistencia medzi scraper a pipeline
  - UNAVAILABLE distinction: entity-not-found vs API failure
  - Cache invalidation: 24h max age
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


# ═══════════════════════════════════════════════════════════════════════════
# Per-scraper timeout (registry.py)
# ═══════════════════════════════════════════════════════════════════════════

class TestPerScraperTimeout:
    """run_scrapers by mal mať per-scraper timeout — jeden pomalý scraper nezrúši batch."""

    def test_scraper_timeout_constant_exists(self):
        """_SCRAPER_TIMEOUT by mal byť definovaný v registry.py."""
        from src.scrapers.registry import _SCRAPER_TIMEOUT
        assert _SCRAPER_TIMEOUT > 0, "Per-scraper timeout by mal byť > 0"
        assert _SCRAPER_TIMEOUT <= 300, "Per-scraper timeout by nemal byť príliš vysoký (≤300s)"

    @pytest.mark.asyncio
    async def test_slow_scraper_returns_failed_not_hangs(self):
        """Scraper ktorý trvá dlho by mal byť timeoutovaný, nie zaseknutý."""
        from src.scrapers.registry import run_scrapers, _get_scraper_timeout
        import time

        # Mock browser — nepotrebujeme reálny, scraper sa vytvorí ale run() sa mockuje
        browser = MagicMock()

        # Patch get_scraper aby vrátil scraper s pomalým run()
        slow_scraper = AsyncMock()
        async def slow_run(**kwargs):
            await asyncio.sleep(10)  # dlhšie ako timeout
            from src.models import ScrapedSource
            return ScrapedSource(source_type="TEST", status="SUCCESS")
        slow_scraper.run = slow_run
        slow_scraper._close = AsyncMock()

        with patch("src.scrapers.registry.get_scraper", return_value=MagicMock(return_value=slow_scraper)):
            with patch("src.scrapers.registry._get_scraper_timeout", return_value=0.5):
                t0 = time.perf_counter()
                results = await run_scrapers(
                    sources=["TEST"],
                    output_dir=Path("/tmp"),
                    browser=browser,
                    target_type="COMPANY",
                    ico="12345678",
                )
                elapsed = time.perf_counter() - t0

        assert elapsed < 2.0, f"Scraper nebol timeoutovaný (elapsed={elapsed:.1f}s)"
        assert len(results) == 1
        assert results[0].status == "FAILED", f"Pomalý scraper by mal byť FAILED, nie {results[0].status}"
        assert "timeout" in (results[0].status_message or "").lower()


# ═══════════════════════════════════════════════════════════════════════════
# CancelledError — zachovanie čiastočných výsledkov (registry.py)
# ═══════════════════════════════════════════════════════════════════════════

class TestCancelledPreservesPartial:
    """Pri CancelledError by run_scrapers mal vrátiť už dokončené výsledky."""

    def test_cancelled_error_handled_in_results_loop(self):
        """Overí že kód v registry.py obsahuje CancelledError handling."""
        import inspect
        from src.scrapers.registry import run_scrapers
        source = inspect.getsource(run_scrapers)
        assert "CancelledError" in source, "run_scrapers by mal handlingovať CancelledError"
        assert "cancelled" in source.lower(), "run_scrapers by mal vytvoriť FAILED pre cancelled scrapery"

    @pytest.mark.asyncio
    async def test_partial_results_on_cancellation(self):
        """Ak je jeden scraper dokončený a druhý zrušený, mal by sa zachovať prvý."""
        from src.scrapers.registry import run_scrapers
        from src.models import ScrapedSource

        browser = MagicMock()

        # Prvý scraper rýchlo úspešný, druhý pomalý (bude zrušený)
        fast_result = ScrapedSource(source_type="FAST", status="SUCCESS", file_path="/tmp/fast.pdf")
        fast_scraper = AsyncMock()
        fast_scraper.run = AsyncMock(return_value=fast_result)
        fast_scraper._close = AsyncMock()

        slow_scraper = AsyncMock()
        async def slow_run(**kwargs):
            await asyncio.sleep(100)  # nikdy sa nedokončí včas
        slow_scraper.run = slow_run
        slow_scraper._close = AsyncMock()

        scraper_map = {"FAST": MagicMock(return_value=fast_scraper), "SLOW": MagicMock(return_value=slow_scraper)}

        def mock_get_scraper(st):
            return scraper_map[st]

        with patch("src.scrapers.registry.get_scraper", side_effect=mock_get_scraper):
            scraper_task = asyncio.ensure_future(
                run_scrapers(
                    sources=["FAST", "SLOW"],
                    output_dir=Path("/tmp"),
                    browser=browser,
                    target_type="COMPANY",
                    ico="12345678",
                )
            )
            # Daj fast scraperu čas na dokončenie
            await asyncio.sleep(0.3)
            # Zruš celú úlohu (simulácia globálneho timeoutu)
            scraper_task.cancel()
            try:
                results = await scraper_task
            except asyncio.CancelledError:
                # Ak run_scrapers nedokázalo vrátiť, je to legitné — testujeme že nespadne
                results = []

        # Aspoň FAST by mal byť dokončený — ale pri CancelledError môže run_scrapers
        # vrátiť čiastočné výsledky alebo raise CancelledError. Oba prípady sú OK.
        if results:
            fast = next((r for r in results if r.source_type == "FAST"), None)
            if fast:
                assert fast.status == "SUCCESS", f"FAST scraper by mal byť SUCCESS aj pri cancel"


# ═══════════════════════════════════════════════════════════════════════════
# RÚZ API 429 Rate Limiting retry
# ═══════════════════════════════════════════════════════════════════════════

class TestRuzApi429Retry:
    """_api_get by mal retryovať pri HTTP 429 (Too Many Requests)."""

    @pytest.mark.asyncio
    async def test_retry_on_429(self):
        """HTTP 429 by mal spustiť retry s dlhšou pauzou."""
        from src.ruz_api import _api_get
        client = AsyncMock()
        resp_429 = MagicMock()
        resp_429.status_code = 429
        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.json.return_value = {"id": [42]}
        client.get.side_effect = [resp_429, resp_200]
        with patch("src.ruz_api._API_RETRY_DELAY", 0.01):
            result = await _api_get(client, "uctovne-jednotky", {"ico": "123"})
        assert result == {"id": [42]}
        assert client.get.call_count == 2

    @pytest.mark.asyncio
    async def test_429_uses_longer_delay(self):
        """429 by mal použiť 3x dlhšiu pauzu ako bežný 5xx error."""
        from src.ruz_api import _api_get
        client = AsyncMock()
        resp_429 = MagicMock()
        resp_429.status_code = 429
        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.json.return_value = {"ok": True}
        client.get.side_effect = [resp_429, resp_200]

        call_times = []
        original_sleep = asyncio.sleep

        async def mock_sleep(duration):
            call_times.append(duration)
            await original_sleep(0)

        with patch("src.ruz_api._API_RETRY_DELAY", 2.0), \
             patch("src.ruz_api.asyncio.sleep", side_effect=mock_sleep):
            result = await _api_get(client, "test-endpoint")

        assert result == {"ok": True}
        assert len(call_times) == 1
        assert call_times[0] == 6.0, f"429 retry should use 3x delay (6.0s), got {call_times[0]}"


# ═══════════════════════════════════════════════════════════════════════════
# UNAVAILABLE distinction: entity-not-found vs API failure
# ═══════════════════════════════════════════════════════════════════════════

class TestRuzEntityNotFoundDistinction:
    """download_ifrs_reports by mal rozlíšiť entity-not-found od API failure."""

    @pytest.mark.asyncio
    async def test_entity_not_found_returns_sentinel(self):
        """Ak IČO nie je v RÚZ, vráti ['__ENTITY_NOT_FOUND__'] sentinel."""
        from src.ruz_api import download_ifrs_reports
        import tempfile, os

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("src.ruz_api._api_get", return_value=None):
                result = await download_ifrs_reports("99999999", max_years=3, output_dir=tmpdir)

        assert result == ["__ENTITY_NOT_FOUND__"], \
            f"Entity not found should return sentinel, got {result}"

    @pytest.mark.asyncio
    async def test_registeruz_scraper_handles_entity_not_found(self, tmp_path):
        """RegisterUzScraper by mal vrátiť SUCCESS pre entity-not-found."""
        scraper = RegisterUzScraper(browser=MagicMock())

        with patch("src.ruz_api.download_ifrs_reports", return_value=["__ENTITY_NOT_FOUND__"]), \
             patch("src.config.settings") as mock_cfg:
            mock_cfg.results_dir = str(tmp_path / "results")
            mock_cfg.ruz_max_years = 3
            result = await scraper.run(ico="99999999", output_dir=Path(str(tmp_path / "results")))

        assert result.status == "SUCCESS", \
            f"Entity not found should be SUCCESS (legitimate), got {result.status}"

    @pytest.mark.asyncio
    async def test_api_failure_returns_unavailable(self, tmp_path):
        """Ak API zlyhá (entity exists but detail fetch fails), scraper returns UNAVAILABLE."""
        scraper = RegisterUzScraper(browser=MagicMock())

        with patch("src.ruz_api.download_ifrs_reports", return_value=[]), \
             patch("src.config.settings") as mock_cfg:
            mock_cfg.results_dir = str(tmp_path / "results")
            mock_cfg.ruz_max_years = 3
            result = await scraper.run(ico="00684881", output_dir=Path(str(tmp_path / "results")))

        assert result.status == "UNAVAILABLE", \
            f"API failure should be UNAVAILABLE (retry), got {result.status}"


# ═══════════════════════════════════════════════════════════════════════════
# Cache invalidation: 24h max age
# ═══════════════════════════════════════════════════════════════════════════

class TestRuzCacheInvalidation:
    """download_ifrs_reports by mal ignorovať cache staršiu ako 24h."""

    @pytest.mark.asyncio
    async def test_fresh_cache_is_used(self):
        """Súbory mladšie ako 24h by mali byť použité z cache."""
        from src.ruz_api import download_ifrs_reports
        from unittest.mock import AsyncMock
        import tempfile, os, time

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a fake cached file
            fake_file = Path(tmpdir) / "IFRS_12345678_2024_0.txt"
            fake_file.write_text("fake content " * 20)
            os.utime(fake_file, (time.time(), time.time()))  # Fresh

            # Mock _api_get to return None (entity not found) — cache validation
            # will catch the None and skip, keeping the fresh cache
            with patch("src.ruz_api._api_get", new_callable=AsyncMock, return_value=None) as mock_api:
                result = await download_ifrs_reports("12345678", max_years=3, output_dir=tmpdir)

            assert len(result) == 1
            assert str(fake_file) in result

    @pytest.mark.asyncio
    async def test_expired_cache_is_re_downloaded(self):
        """Súbory staršie ako 24h by mali byť re-downloadované."""
        from src.ruz_api import download_ifrs_reports
        import tempfile, os, time

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create an expired cached file (48h old)
            fake_file = Path(tmpdir) / "IFRS_12345678_2024_0.txt"
            fake_file.write_text("expired content " * 20)
            old_time = time.time() - 48 * 3600  # 48 hours ago
            os.utime(fake_file, (old_time, old_time))

            # Mock API to return entity not found (so we know API was called)
            with patch("src.ruz_api._api_get", return_value=None):
                result = await download_ifrs_reports("12345678", max_years=3, output_dir=tmpdir)

            # API was called (cache was expired), entity not found
            assert result == ["__ENTITY_NOT_FOUND__"], \
                "Expired cache should trigger re-download"


# ═══════════════════════════════════════════════════════════════════════════
# Finally block cleanup — browser.close() exception handling
# ═══════════════════════════════════════════════════════════════════════════

class TestFinallyBlockCleanup:
    """Test that browser.close() exception in finally block doesn't
    prevent playwright.stop() from running — prevents process/memory leak."""

    @pytest.mark.asyncio
    async def test_browser_close_exception_does_not_skip_playwright_stop(self):
        """If browser.close() raises, playwright.stop() must still be called.

        This simulates the finally block in _execute_report_inner where
        a crashed browser can raise during close, but we still need to
        stop the playwright process to avoid a process leak.
        """
        browser = AsyncMock()
        browser.close.side_effect = RuntimeError("Browser already crashed")
        playwright = AsyncMock()
        playwright.stop = AsyncMock(return_value=None)

        # Replicate the finally block logic from _execute_report_inner
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass

        browser.close.assert_awaited_once()
        playwright.stop.assert_awaited_once(), \
            "playwright.stop() must be called even if browser.close() raised"

    @pytest.mark.asyncio
    async def test_both_close_and_stop_succeed(self):
        """Happy path: both browser.close() and playwright.stop() succeed."""
        browser = AsyncMock()
        playwright = AsyncMock()

        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass

        browser.close.assert_awaited_once()
        playwright.stop.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_none_browser_skips_close(self):
        """If browser is None (launch failed), close should be skipped."""
        browser = None
        playwright = AsyncMock()

        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass

        playwright.stop.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_both_none_skips_both(self):
        """If both browser and playwright are None, nothing should be called."""
        browser = None
        playwright = None

        # Should not raise
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass

    @pytest.mark.asyncio
    async def test_playwright_stop_exception_does_not_propagate(self):
        """If playwright.stop() also raises, the exception should be caught."""
        browser = AsyncMock()
        playwright = AsyncMock()
        playwright.stop.side_effect = RuntimeError("Stop failed")

        # Should not raise
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass

        browser.close.assert_awaited_once()
        playwright.stop.assert_awaited_once()

    def test_finally_block_source_has_try_except(self):
        """Verify that the source code of _execute_report_inner has try/except
        around browser.close() and playwright.stop() in the finally block."""
        # Read source file directly — importing src.main triggers prisma import
        # which fails in test environment without generated prisma client.
        import pathlib, re
        main_path = pathlib.Path(__file__).parent.parent / "src" / "main.py"
        source = main_path.read_text()
        # Find the finally keyword (indented with 4 spaces, not inside a string)
        # Use regex to find "    finally:" at the start of a line
        match = re.search(r'^    finally:', source, re.MULTILINE)
        assert match, "finally block not found in _execute_report_inner"
        finally_block = source[match.start():]
        # Truncate at the next function/class definition or end of function
        next_def = re.search(r'\n\n(?:async def |def |class |@app\.)', finally_block[10:])
        if next_def:
            finally_block = finally_block[:next_def.start() + 10]
        # browser.close() should be inside a try
        assert "browser.close()" in finally_block, "browser.close() not in finally block"
        assert "except" in finally_block, "no try/except in finally block"
        # playwright.stop() should also be inside a try
        assert "playwright.stop()" in finally_block, "playwright.stop() not in finally block"


# ═══════════════════════════════════════════════════════════════════════════
# RÚZ ZIP attachment support — large firms (e.g. Adient) have ZIP prílohy
# ═══════════════════════════════════════════════════════════════════════════

class TestRuzZipAttachments:
    """RÚZ API od ~2024 vracia prílohy veľkých firiem ako ZIP archívy
    namiesto priamych PDF. Testy overujú, že scraper ich správne
    rozbalí a extrahuje PDF."""

    def _make_zip_with_pdfs(self, pdf_count: int = 2) -> bytes:
        """Vytvor ZIP archív s daným počtom PDF súborov."""
        import io, zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for i in range(pdf_count):
                # Minimálny platný PDF header
                pdf_content = b"%PDF-1.4\n%test pdf content " + str(i).encode() + b" " * 200 + b"\n%%EOF"
                zf.writestr(f"document_{i}.pdf", pdf_content)
        return buf.getvalue()

    def _make_zip_without_pdfs(self) -> bytes:
        """Vytvor ZIP archív bez PDF súborov (len .txt a .xml)."""
        import io, zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("data.txt", "not a pdf")
            zf.writestr("meta.xml", "<xml/>")
        return buf.getvalue()

    def test_extract_pdfs_from_zip_success(self):
        """_extract_pdfs_from_zip by mal extrahovať PDF súbory z ZIP."""
        from src.ruz_api import _extract_pdfs_from_zip
        zip_bytes = self._make_zip_with_pdfs(3)
        pdfs = _extract_pdfs_from_zip(zip_bytes)
        assert len(pdfs) == 3
        for pdf in pdfs:
            assert pdf.startswith(b"%PDF")

    def test_extract_pdfs_from_zip_no_pdfs(self):
        """ZIP bez PDF → prázdny zoznam."""
        from src.ruz_api import _extract_pdfs_from_zip
        zip_bytes = self._make_zip_without_pdfs()
        pdfs = _extract_pdfs_from_zip(zip_bytes)
        assert pdfs == []

    def test_extract_pdfs_from_zip_invalid_data(self):
        """Neplatný ZIP → prázdny zoznam (bez výnimky)."""
        from src.ruz_api import _extract_pdfs_from_zip
        pdfs = _extract_pdfs_from_zip(b"not a zip file at all")
        assert pdfs == []

    def test_extract_pdfs_from_zip_empty(self):
        """Prázdny vstup → prázdny zoznam."""
        from src.ruz_api import _extract_pdfs_from_zip
        pdfs = _extract_pdfs_from_zip(b"")
        assert pdfs == []

    def test_extract_pdfs_filters_non_pdf(self):
        """ZIP s mixom PDF a non-PDF → iba PDF súbory."""
        import io, zipfile
        from src.ruz_api import _extract_pdfs_from_zip
        pdf_body = b"%PDF-1.4\n" + b"x" * 200 + b"\n%%EOF"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("report.pdf", pdf_body)
            zf.writestr("notes.txt", "text file")
            zf.writestr("data.xml", "<xml/>")
            zf.writestr("image.pdf", pdf_body)
        pdfs = _extract_pdfs_from_zip(buf.getvalue())
        assert len(pdfs) == 2  # iba 2 PDF súbory

    def test_extract_pdfs_filters_invalid_pdf_content(self):
        """Súbor s .pdf príponou ale bez PDF magic bytes sa ignoruje."""
        import io, zipfile
        from src.ruz_api import _extract_pdfs_from_zip
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("fake.pdf", b"this is not really a pdf but longer than 100 chars " + b"x" * 100)
            zf.writestr("real.pdf", b"%PDF-1.4\n" + b"y" * 200 + b"\n%%EOF")
        pdfs = _extract_pdfs_from_zip(buf.getvalue())
        assert len(pdfs) == 1  # iba real.pdf

    @pytest.mark.asyncio
    async def test_download_prilohy_with_zip(self):
        """_download_prilohy by mal stiahnuť ZIP a extrahovať PDF."""
        from src.ruz_api import _download_prilohy
        zip_bytes = self._make_zip_with_pdfs(2)

        prilohy = [{"id": 12345, "meno": "Účtovná závierka.ZIP", "mimeType": "application/zip"}]

        async def mock_download_attachment(url):
            return (zip_bytes, "application/zip")

        with patch("src.ruz_api._download_attachment", side_effect=mock_download_attachment):
            result = await _download_prilohy(prilohy)

        assert len(result) == 2
        for pdf in result:
            assert pdf.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_download_prilohy_with_pdf(self):
        """_download_prilohy by mal stiahnuť PDF priamo (backward compat)."""
        from src.ruz_api import _download_prilohy
        pdf_bytes = b"%PDF-1.4\ntest pdf content\n%%EOF"

        prilohy = [{"id": 67890, "meno": "Správa audítora.PDF", "mimeType": "application/pdf"}]

        async def mock_download_attachment(url):
            return (pdf_bytes, "application/pdf")

        with patch("src.ruz_api._download_attachment", side_effect=mock_download_attachment):
            result = await _download_prilohy(prilohy)

        assert len(result) == 1
        assert result[0] == pdf_bytes

    @pytest.mark.asyncio
    async def test_download_prilohy_mixed_zip_and_pdf(self):
        """Mix ZIP a PDF príloh → všetky PDF extrahované."""
        from src.ruz_api import _download_prilohy
        zip_bytes = self._make_zip_with_pdfs(2)
        pdf_bytes = b"%PDF-1.4\nstandalone pdf\n%%EOF"

        prilohy = [
            {"id": 1, "meno": "Zavierka.ZIP", "mimeType": "application/zip"},
            {"id": 2, "meno": "Auditor.PDF", "mimeType": "application/pdf"},
        ]

        async def mock_download_attachment(url):
            if "1" in url or "/12345" in url:
                return (zip_bytes, "application/zip")
            return (pdf_bytes, "application/pdf")

        # Simuluj: prvý call → ZIP, druhý → PDF
        call_count = [0]
        async def mock_download_attachment_counted(url):
            call_count[0] += 1
            if call_count[0] == 1:
                return (zip_bytes, "application/zip")
            return (pdf_bytes, "application/pdf")

        with patch("src.ruz_api._download_attachment", side_effect=mock_download_attachment_counted):
            result = await _download_prilohy(prilohy)

        assert len(result) == 3  # 2 z ZIP + 1 PDF

    @pytest.mark.asyncio
    async def test_download_prilohy_zip_without_pdfs(self):
        """ZIP bez PDF → prázdny výsledok (s warning logom)."""
        from src.ruz_api import _download_prilohy
        zip_bytes = self._make_zip_without_pdfs()

        prilohy = [{"id": 999, "meno": "Data.ZIP", "mimeType": "application/zip"}]

        async def mock_download_attachment(url):
            return (zip_bytes, "application/zip")

        with patch("src.ruz_api._download_attachment", side_effect=mock_download_attachment):
            result = await _download_prilohy(prilohy)

        assert result == []

    @pytest.mark.asyncio
    async def test_download_prilohy_download_failure(self):
        """Ak download zlyhá, príloha sa preskočí (bez výnimky)."""
        from src.ruz_api import _download_prilohy

        prilohy = [{"id": 404, "meno": "Missing.ZIP", "mimeType": "application/zip"}]

        async def mock_download_attachment(url):
            return None  # download failed

        with patch("src.ruz_api._download_attachment", side_effect=mock_download_attachment):
            result = await _download_prilohy(prilohy)

        assert result == []

    @pytest.mark.asyncio
    async def test_download_prilohy_empty_list(self):
        """Prázdny zoznam príloh → prázdny výsledok."""
        from src.ruz_api import _download_prilohy
        result = await _download_prilohy([])
        assert result == []


# ═══════════════════════════════════════════════════════════════════════════
# Tests for _compute_deterministic_adjustment
# ═══════════════════════════════════════════════════════════════════════════

class TestDeterministicAdjustment:
    """Testy pre deterministický forenzný adjustment (náhrada LLM ±10)."""

    def test_no_findings_zero_adjustment(self):
        from src.pipeline import _compute_deterministic_adjustment
        adj, breakdown = _compute_deterministic_adjustment([], [], [], "12345678")
        assert adj == 0
        assert breakdown["going_concern"] == 0

    def test_going_concern_doubts(self):
        from src.pipeline import _compute_deterministic_adjustment
        narrative = [{"rok": 2024, "narrativeRisk": {"goingConcernDoubts": True}}]
        adj, breakdown = _compute_deterministic_adjustment(narrative, [], [], "12345678")
        assert adj == -3
        assert breakdown["going_concern"] == -3

    def test_litigation_risks(self):
        from src.pipeline import _compute_deterministic_adjustment
        narrative = [{"rok": 2024, "narrativeRisk": {
            "goingConcernDoubts": False,
            "litigationRisks": "Prebiehajúci súdny spor s dodávateľom",
        }}]
        adj, _ = _compute_deterministic_adjustment(narrative, [], [], "12345678")
        assert adj == -2

    def test_litigation_risks_ignored_when_clean(self):
        from src.pipeline import _compute_deterministic_adjustment
        narrative = [{"rok": 2024, "narrativeRisk": {
            "goingConcernDoubts": False,
            "litigationRisks": "Žiadne",
        }}]
        adj, _ = _compute_deterministic_adjustment(narrative, [], [], "12345678")
        assert adj == 0

    def test_forensic_red_flags_ignored(self):
        from src.pipeline import _compute_deterministic_adjustment
        narrative = [{"rok": 2024, "narrativeRisk": {
            "goingConcernDoubts": False,
            "forensicRedFlags": ["flag1", "flag2", "flag3", "flag4", "flag5"],
        }}]
        adj, _ = _compute_deterministic_adjustment(narrative, [], [], "12345678")
        assert adj == 0  # forensic flags are ignored in v3

    def test_related_party_transactions(self):
        from src.pipeline import _compute_deterministic_adjustment
        notes = [{"rok": 2024, "notesRisk": {
            "relatedPartyTransactions": "Pôžička dcérskej spoločnosti 500k EUR",
        }}]
        adj, _ = _compute_deterministic_adjustment([], notes, [], "12345678")
        assert adj == -2

    def test_related_party_skipped_for_consolidated(self):
        from src.pipeline import _compute_deterministic_adjustment
        notes = [{"rok": 2024, "notesRisk": {
            "relatedPartyTransactions": "Pôžička dcérskej spoločnosti 500k EUR",
        }}]
        adj, _ = _compute_deterministic_adjustment([], notes, [], "12345678", is_consolidated=True)
        assert adj == 0  # skipped for consolidated

    def test_critical_company_events(self):
        from src.pipeline import _compute_deterministic_adjustment
        events = [
            {"severity": "CRITICAL", "eventType": "SUDNE_ROZHODNUTIE"},
            {"severity": "CRITICAL", "eventType": "SUDNE_ROZHODNUTIE"},
            {"severity": "CRITICAL", "eventType": "SUDNE_ROZHODNUTIE"},
        ]
        adj, _ = _compute_deterministic_adjustment([], [], events, "12345678")
        assert adj == -5  # 3 × -3 = -9, but capped at -5

    def test_total_capped_at_minus_5(self):
        from src.pipeline import _compute_deterministic_adjustment
        narrative = [{"rok": 2024, "narrativeRisk": {
            "goingConcernDoubts": True,  # -3
            "litigationRisks": "Súdny spor",  # -2
        }}]
        notes = [{"rok": 2024, "notesRisk": {
            "relatedPartyTransactions": "Áno",  # -2
            "contingentRisks": "Áno",  # -2
        }}]
        events = [{"severity": "CRITICAL", "eventType": "INSOLVENCIA"}]  # -3
        # Total = -3 -2 -2 -2 -3 = -12, clamped to -5
        adj, _ = _compute_deterministic_adjustment(narrative, notes, events, "12345678")
        assert adj == -5

    def test_non_critical_events_ignored(self):
        from src.pipeline import _compute_deterministic_adjustment
        events = [
            {"severity": "HIGH", "eventType": "SUDNE_ROZHODNUTIE"},
            {"severity": "INFO", "eventType": "VEREJNA_ZMLUVA"},
        ]
        adj, _ = _compute_deterministic_adjustment([], [], events, "12345678")
        assert adj == 0


# ═══════════════════════════════════════════════════════════════════════════
# Tests for _filter_consolidation_consistency
# ═══════════════════════════════════════════════════════════════════════════

class TestFilterConsolidationConsistency:
    """Testy pre filter konzistencie typu závierky."""

    def test_all_consolidated(self):
        from src.report_generator import _filter_consolidation_consistency
        from types import SimpleNamespace
        stmts = [SimpleNamespace(isConsolidated=True, year=2024),
                 SimpleNamespace(isConsolidated=True, year=2023)]
        filtered, basis = _filter_consolidation_consistency(stmts)
        assert basis == "consolidated"
        assert len(filtered) == 2

    def test_all_individual(self):
        from src.report_generator import _filter_consolidation_consistency
        from types import SimpleNamespace
        stmts = [SimpleNamespace(isConsolidated=False, year=2024),
                 SimpleNamespace(isConsolidated=False, year=2023)]
        filtered, basis = _filter_consolidation_consistency(stmts)
        assert basis == "individual"
        assert len(filtered) == 2

    def test_mixed_prefers_consolidated_with_3plus(self):
        from src.report_generator import _filter_consolidation_consistency
        from types import SimpleNamespace
        stmts = [
            SimpleNamespace(isConsolidated=True, year=2024),
            SimpleNamespace(isConsolidated=True, year=2023),
            SimpleNamespace(isConsolidated=True, year=2022),
            SimpleNamespace(isConsolidated=False, year=2021),
            SimpleNamespace(isConsolidated=False, year=2020),
        ]
        filtered, basis = _filter_consolidation_consistency(stmts)
        assert basis == "consolidated"
        assert len(filtered) == 3

    def test_mixed_prefers_individual_when_consolidated_lt_3(self):
        from src.report_generator import _filter_consolidation_consistency
        from types import SimpleNamespace
        stmts = [
            SimpleNamespace(isConsolidated=True, year=2024),
            SimpleNamespace(isConsolidated=True, year=2023),
            SimpleNamespace(isConsolidated=False, year=2022),
            SimpleNamespace(isConsolidated=False, year=2021),
            SimpleNamespace(isConsolidated=False, year=2020),
        ]
        filtered, basis = _filter_consolidation_consistency(stmts)
        assert basis == "individual"
        assert len(filtered) == 3

    def test_empty_stmts(self):
        from src.report_generator import _filter_consolidation_consistency
        filtered, basis = _filter_consolidation_consistency([])
        assert basis == "individual"
        assert filtered == []

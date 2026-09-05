from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, Callable, Awaitable, TypeVar, Any
import asyncio
import functools
import logging
import random
import re
import time

from playwright.async_api import Page, Browser, async_playwright, TimeoutError as PlaywrightTimeout, Error as PlaywrightError

from ..config import settings
from ..models import ScrapedSource
from ..stealth import (
    get_rotating_proxy,
    get_random_user_agent,
    get_random_viewport,
    get_random_locale,
    STEALTH_JS,
)
from .exceptions import ScraperUnavailableError, ScraperInputError
from .mixins import PdfGeneratorMixin, StealthDebtorMixin, TableExtractorMixin, CaptchaSolverMixin

logger = logging.getLogger(__name__)

T = TypeVar("T")


# ── Retry metrics ─────────────────────────────────────────────────────
# Jednoduché in-memory countery pre observability. Dostupné cez get_retry_metrics().
_RETRY_METRICS: dict[str, dict[str, int]] = {}


def _record_retry_metric(source_type: str, key: str) -> None:
    """Zaznamená retry event do in-memory counterov."""
    if source_type not in _RETRY_METRICS:
        _RETRY_METRICS[source_type] = {
            "attempts": 0, "retries": 0, "recoveries": 0,
            "exhausted": 0, "permanent_skips": 0,
        }
    _RETRY_METRICS[source_type][key] = _RETRY_METRICS[source_type].get(key, 0) + 1


def get_retry_metrics() -> dict[str, dict[str, int]]:
    """Vráti snapshot retry metrík pre všetky source types."""
    return dict(_RETRY_METRICS)


def log_retry_metrics() -> None:
    """Zaloguje súhrn retry metrík (volaj na konci pipeline alebo periodicke).
    Loguje do štandardného loggera (ktorý sa už persistuje do súboru v produkcii)."""
    for src, m in _RETRY_METRICS.items():
        if m["retries"] > 0 or m["exhausted"] > 0:
            logger.info(
                f"[RetryMetrics] {src}: attempts={m['attempts']} "
                f"retries={m['retries']} recoveries={m['recoveries']} "
                f"exhausted={m['exhausted']} permanent_skips={m['permanent_skips']}"
            )


def reset_retry_metrics() -> None:
    """Reset metrics po dokončení reportu (volaj z main.py po pipeline)."""
    _RETRY_METRICS.clear()


# ── Unified retry helper ──────────────────────────────────────────────
# Zjednotená retry logika pre všetky scrapery. Nahradza ad-hoc implementácie
# v SP, ORSR, FS, Dovera, ZRSR, Rozhodnutia.
# Použitie:
#   1. Ako dekorátor: @retry_async(source_type="SP_DLZNICI")
#   2. Ako helper:    await retry_async_call(my_func, source_type="ORSR")
#
# Pokročilé features:
#   - content_check: callback(page) -> bool, ak vráti False = retry (pre "Server je nedostupný")
#   - on_retry: callback(attempt) -> None, volá sa pred sleep (pre FS fresh-page pattern)

# Exceptiony ktoré sa NEmajú retryovať (permanent errors)
_PERMANENT_EXCEPTIONS = (
    ScraperInputError,
    ValueError,
    KeyError,
    AttributeError,
    KeyboardInterrupt,
    asyncio.CancelledError,
)


def _is_transient_error(exc: Exception) -> bool:
    """Vráti True ak je chyba transient (network/timeout/server) — retry má zmysel."""
    if isinstance(exc, _PERMANENT_EXCEPTIONS):
        return False
    # Playwright timeout/error = transient
    if isinstance(exc, (PlaywrightTimeout, PlaywrightError)):
        return True
    # asyncio timeout = transient
    if isinstance(exc, asyncio.TimeoutError):
        return True
    # httpx/network errors = transient
    exc_name = type(exc).__name__
    if exc_name in ("TimeoutException", "ConnectError", "ConnectTimeout",
                    "ReadTimeout", "WriteTimeout", "PoolTimeout",
                    "RemoteProtocolError", "HTTPStatusError"):
        return True
    # ScraperUnavailableError = transient (register down)
    if isinstance(exc, ScraperUnavailableError):
        return True
    # ContentCheckError / TransientHTTPError = transient
    if isinstance(exc, (ContentCheckError, TransientHTTPError)):
        return True
    # Default: retry (safe side — lepšie skúsiť znova ako vzdať sa)
    return True


class ContentCheckError(Exception):
    """Raised when content check fails (e.g. 'Server je nedostupný' in page body).
    Táto chyba je vždy transient — content sa môže zmeniť pri retry."""

    def __init__(self, message: str, result: Any = None):
        super().__init__(message)
        self.result = result  # voliteľný result ktorý sa má vrátiť pri exhaust


class TransientHTTPError(Exception):
    """Raised for transient HTTP errors (5xx, 429) — retry má zmysel.
    Používa sa v httpx-based scraperoch (ORSR, Rozhodnutia) kde retry_async
    nevidí HTTP status code, len exception."""

    def __init__(self, message: str, status_code: int = 0, rate_limited: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.rate_limited = rate_limited


def retry_async(
    *,
    source_type: str = "",
    max_attempts: int = None,
    base_delay: float = None,
    jitter: float = 0.3,
    transient_only: bool = True,
    on_retry: Optional[Callable[[int], Awaitable[None]]] = None,
):
    """Dekorátor pre async funkcie s exponential backoff + jitter.

    Args:
        source_type: Pre logovanie a metrics (napr. "SP_DLZNICI")
        max_attempts: Počet pokusov (default: settings.scraper_retries + 1 = 3)
        base_delay: Base delay v sekundách (default: settings.scraper_retry_delay = 1.5)
        jitter: ±fraction pre anti-thundering-herd (0.3 = ±30%)
        transient_only: Ak True, retryuje len transient errors (nie ValueError etc.)
        on_retry: Async callback volaný pred sleep (pre FS fresh-page pattern).
                  Dostáva attempt číslo (1-based).
    """
    attempts = max_attempts or (settings.scraper_retries + 1)
    delay = base_delay or settings.scraper_retry_delay
    label = source_type or "scraper"

    def decorator(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            last_exc: Optional[Exception] = None
            _record_retry_metric(label, "attempts")
            for attempt in range(1, attempts + 1):
                try:
                    result = await func(*args, **kwargs)
                    if attempt > 1:
                        _record_retry_metric(label, "recoveries")
                    return result
                except Exception as exc:
                    last_exc = exc
                    # ContentCheckError = vždy transient (content sa môže zmeniť)
                    if isinstance(exc, ContentCheckError):
                        pass
                    elif transient_only and not _is_transient_error(exc):
                        _record_retry_metric(label, "permanent_skips")
                        raise
                    if attempt >= attempts:
                        break
                    _record_retry_metric(label, "retries")
                    # Exponential backoff: delay * 2^(attempt-1) * (1 ± jitter)
                    wait = delay * (2 ** (attempt - 1)) * random.uniform(1 - jitter, 1 + jitter)
                    # Rate-limited (429)? 3x delay
                    if isinstance(exc, TransientHTTPError) and exc.rate_limited:
                        wait *= 3
                    logger.warning(
                        f"[{label}] {func.__name__} attempt {attempt}/{attempts} "
                        f"failed: {type(exc).__name__}: {exc} — retry in {wait:.1f}s"
                    )
                    # on_retry callback (napr. FS: close page → create fresh page)
                    if on_retry:
                        try:
                            await on_retry(attempt)
                        except Exception as cb_err:
                            logger.warning(f"[{label}] on_retry callback failed: {cb_err}")
                    await asyncio.sleep(wait)
            _record_retry_metric(label, "exhausted")
            # Ak ContentCheckError mal result, vráť ho (pre SP "Server nedostupný")
            if isinstance(last_exc, ContentCheckError) and last_exc.result is not None:
                return last_exc.result
            raise ScraperUnavailableError(
                f"[{label}] {func.__name__} failed after {attempts} attempts: {last_exc}"
            )
        return wrapper
    return decorator


async def retry_async_call(
    func: Callable[..., Awaitable[T]],
    *args,
    source_type: str = "",
    max_attempts: int = None,
    base_delay: float = None,
    jitter: float = 0.3,
    transient_only: bool = True,
    on_retry: Optional[Callable[[int], Awaitable[None]]] = None,
    **kwargs,
) -> T:
    """Helper pre one-off retry volania (bez dekorátora)."""
    decorated = retry_async(
        source_type=source_type,
        max_attempts=max_attempts,
        base_delay=base_delay,
        jitter=jitter,
        transient_only=transient_only,
        on_retry=on_retry,
    )(func)
    return await decorated(*args, **kwargs)


# ── Circuit breaker per source type ──────────────────────────────────
# Ak API/register zlyhá N krát za sebou, označí sa ako "open" a ďalšie
# reporty ho preskočia (UNAVAILABLE) až do cooldownu.
_CIRCUIT_FAILURES: dict[str, int] = {}
_CIRCUIT_OPEN_UNTIL: dict[str, float] = {}
_CIRCUIT_THRESHOLD = 3       # po 3 po sebe idúcich zlyhaniach sa otvorí
_CIRCUIT_COOLDOWN = 300      # 5 minút cooldown


def circuit_is_open(source_type: str) -> bool:
    """Vráti True ak je circuit breaker otvorený (register/API je nedostupný)."""
    import time as _time
    open_until = _CIRCUIT_OPEN_UNTIL.get(source_type, 0)
    if _time.monotonic() < open_until:
        return True
    # Cooldown vypršal — reset
    if source_type in _CIRCUIT_OPEN_UNTIL:
        del _CIRCUIT_OPEN_UNTIL[source_type]
        _CIRCUIT_FAILURES[source_type] = 0
    return False


def circuit_record_success(source_type: str) -> None:
    """Reset counter po úspechu."""
    _CIRCUIT_FAILURES[source_type] = 0
    _CIRCUIT_OPEN_UNTIL.pop(source_type, None)


def circuit_record_failure(source_type: str) -> None:
    """Inkrement failure counter, otvor circuit ak dosiahnutý threshold."""
    import time as _time
    _CIRCUIT_FAILURES[source_type] = _CIRCUIT_FAILURES.get(source_type, 0) + 1
    if _CIRCUIT_FAILURES[source_type] >= _CIRCUIT_THRESHOLD:
        _CIRCUIT_OPEN_UNTIL[source_type] = _time.monotonic() + _CIRCUIT_COOLDOWN
        logger.warning(
            f"[CircuitBreaker] {source_type} otvorený na {_CIRCUIT_COOLDOWN}s "
            f"po {_CIRCUIT_FAILURES[source_type]} po sebe idúcich zlyhaniach."
        )


class BaseScraper(PdfGeneratorMixin, StealthDebtorMixin, TableExtractorMixin, CaptchaSolverMixin, ABC):
    """
    Base class for all register scrapers.
    Subclasses implement `run()` and use the shared Playwright helpers below.
    """

    source_type: str = "ABSTRACT"

    def __init__(self, browser: Optional[Browser] = None):
        self.browser = browser
        self._owned_browser = False
        self._contexts: list = []

    @abstractmethod
    async def run(self, **kwargs) -> ScrapedSource:
        """Execute the scraper and return a ScrapedSource."""
        raise NotImplementedError

    async def _get_page(self, block_images: bool = True, locale: Optional[str] = None) -> Page:
        """Lazily start a browser if one was not injected.
        block_images: ak True, blokuje obrázky/fonty/media pre rýchlosť (text-only scraping).
        Scrapery ktoré generujú PDF s obrázkami (ORSR, RPVS) musia dať block_images=False.
        locale: ak je zadané, použije sa namiesto náhodnej rotácie — pre scrapery závislé
        na slovenských UI textoch (cookie bannery, tlačidlá).
        Každý scraper dostáva vlastný browser context (izolované cookies/session)
        s rotáciou User-Agent, proxy a stealth JS pre anti-detekciu."""
        if self.browser is None:
            self._playwright = await async_playwright().start()
            from src.browser_manager import browser_manager
            self.browser = await browser_manager.get_browser(self._playwright)
            self._owned_browser = True

        context_kwargs = {
            "user_agent": get_random_user_agent(),
            "viewport": get_random_viewport(),
            "locale": locale or get_random_locale(),
        }
        proxy = get_rotating_proxy()
        if proxy:
            context_kwargs["proxy"] = proxy

        # Browser crash guard — browserless kontajner môže crashnúť pod súbežnou
        # záťažou (OOM, context limit). new_context() potom zlyhá s
        # "Target page, context or browser has been closed".
        # Bez tohto guardu scraper vráti FAILED s "Interná chyba scrapera: ..."
        # čo nie je retryable podľa retry filtra v main.py.
        # S týmto guardom scraper vráti UNAVAILABLE → automaticky sa retryne.
        try:
            context = await self.browser.new_context(**context_kwargs)
        except PlaywrightError as e:
            err_str = str(e).lower()
            if "has been closed" in err_str or "target page" in err_str:
                try:
                    from src.browser_manager import browser_manager
                    browser_manager.report_browser_crash(e)
                except Exception:
                    pass
                raise ScraperUnavailableError(
                    f"Browser context unavailable (browserless crash): {e}"
                )
            raise
        self._contexts.append(context)

        # Stealth JS — injektuje sa pred každou stránkou v tomto contexte
        # (STEALTH_JS nahradza playwright_stealth.stealth_async — dvojitá injekcia spôsobovala
        # konflikty a potenciálnu detekciu na anti-bot systémoch)
        await context.add_init_script(STEALTH_JS)

        page = await context.new_page()

        # Block unnecessary resources to speed up page loads (len ak block_images=True).
        # Obrázky blokujeme pri text-only scraperoch; fonty/media vždy (nepotrebné pre PDF).
        if block_images:
            async def _block_resources(route):
                if route.request.resource_type in ("image", "font", "media"):
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", _block_resources)
        else:
            async def _block_media_only(route):
                if route.request.resource_type in ("font", "media"):
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", _block_media_only)
        return page

    async def _close(self) -> None:
        """Close browser contexts and browser if we created it."""
        for ctx in self._contexts:
            try:
                await ctx.close()
            except Exception:
                pass
        self._contexts.clear()
        if self._owned_browser and self.browser:
            await self.browser.close()
            if hasattr(self, "_playwright"):
                await self._playwright.stop()

    async def _safe_goto(self, page: Page, url: str, retries: int = None) -> None:
        """Go to URL with unified retry; mark as UNAVAILABLE on persistent failures.

        Používa exponential backoff s jitterom zo unified retry helpera.
        Timeout: 40s goto — slovenské štátne registre (RPO, Dovera, SP, FS)
        často odpovedajú 15-30s, najmä počas pracovných hodín.
        Zvýšené z 20s na 40s pre maximálnu úspešnosť scraperov.
        """
        attempts = (retries or settings.scraper_retries) + 1
        delay = settings.scraper_retry_delay
        last_error: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            try:
                await page.goto(url, timeout=40000, wait_until="domcontentloaded")
                return
            except Exception as e:
                last_error = e
                # Nahlás browser/context crash BrowserManageru pre circuit breaker
                err_str = str(e).lower()
                if "has been closed" in err_str or "target page" in err_str:
                    try:
                        from src.browser_manager import browser_manager
                        browser_manager.report_browser_crash(e)
                    except Exception:
                        pass
                if not _is_transient_error(e):
                    raise
                if attempt >= attempts:
                    break
                wait = delay * (2 ** (attempt - 1)) * random.uniform(0.7, 1.3)
                logger.warning(f"[{self.source_type}] goto attempt {attempt}/{attempts} failed: {type(e).__name__}: {e} — retry in {wait:.1f}s")
                await asyncio.sleep(wait)
        raise ScraperUnavailableError(f"Register {url} unreachable after {attempts} attempts: {last_error}")

    async def _dismiss_cookie_banner(self, page: Page) -> None:
        """Skúsi zavrieť cookie banner ak existuje — bežné na slovenských štátnych portáloch.
        Nezlyhá ak banner nie je prítomný. Loguje warning ak žiadny selector nezabral."""
        cookie_selectors = [
            "button:has-text('Povoliť všetko')",
            "button:has-text('Súhlasím')",
            "button:has-text('Rozumiem')",
            "button:has-text('Accept all')",
            "button:has-text('Prijať všetko')",
            "button:has-text('Prijať všetky')",
            "button:has-text('Akceptovať všetky cookies')",
            "button:has-text('OK')",
            "#consent-accept-all",
            "#cookie-accept",
            ".cookie-banner button",
            "[id*='cookie'] button:first-child",
            "[id*='consent'] button:first-child",
        ]
        for selector in cookie_selectors:
            try:
                btn = page.locator(selector).first
                await btn.wait_for(state="visible", timeout=3000)
                await btn.click()
                logger.debug(f"[{self.source_type}] Cookie banner zatvorený: {selector}")
                return
            except Exception:
                continue
        logger.debug(f"[{self.source_type}] Cookie banner sa nenašiel (žiadny selector nezabral).")

    def _make_result(
        self,
        status: str,
        file_path: Optional[str] = None,
        page_count: Optional[int] = None,
        status_message: Optional[str] = None,
        findings: Optional[str] = None,
        company_name: Optional[str] = None,
        ic_dph: Optional[str] = None,
        persons: Optional[list] = None,
        raw_data: Optional[list] = None,
        full_extract_text: Optional[str] = None,
        share_capital: Optional[float] = None,
        signing_authority: Optional[str] = None,
        business_activity: Optional[str] = None,
    ) -> ScrapedSource:
        return ScrapedSource(
            source_type=self.source_type,
            status=status,
            file_path=file_path,
            page_count=page_count,
            status_message=status_message,
            findings=findings,
            company_name=company_name,
            ic_dph=ic_dph,
            persons=persons,
            raw_data=raw_data,
            full_extract_text=full_extract_text,
            share_capital=share_capital,
            signing_authority=signing_authority,
            business_activity=business_activity,
        )

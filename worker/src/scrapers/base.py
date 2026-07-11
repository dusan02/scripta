from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional
import asyncio
import logging
import re

from playwright.async_api import Page, Browser, async_playwright, TimeoutError as PlaywrightTimeout, Error as PlaywrightError
from playwright_stealth import stealth_async

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

    async def _get_page(self, block_images: bool = True) -> Page:
        """Lazily start a browser if one was not injected.
        block_images: ak True, blokuje obrázky/fonty/media pre rýchlosť (text-only scraping).
        Scrapery ktoré generujú PDF s obrázkami (ORSR, RPVS) musia dať block_images=False.
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
            "locale": get_random_locale(),
        }
        proxy = get_rotating_proxy()
        if proxy:
            context_kwargs["proxy"] = proxy

        context = await self.browser.new_context(**context_kwargs)
        self._contexts.append(context)

        # Stealth JS — injektuje sa pred každou stránkou v tomto contexte
        await context.add_init_script(STEALTH_JS)

        page = await context.new_page()
        await stealth_async(page)

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
        """Go to URL with retry; mark as UNAVAILABLE on persistent failures."""
        if retries is None:
            retries = settings.scraper_retries
        last_error: Optional[Exception] = None
        for attempt in range(retries + 1):
            try:
                await page.goto(url, timeout=10000, wait_until="commit")
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except PlaywrightTimeout:
                    logger.debug(f"[{self.source_type}] DOM load timeout, continuing anyway")
                return
            except (PlaywrightTimeout, PlaywrightError) as e:
                last_error = e
                delay = settings.scraper_retry_delay * (attempt + 1) * 2
                logger.warning(f"[{self.source_type}] goto attempt {attempt + 1}/{retries + 1} failed: {e} — retrying in {delay}s")
                await asyncio.sleep(delay)
        raise ScraperUnavailableError(f"Register {url} unreachable after {retries + 1} attempts: {last_error}")

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
        )

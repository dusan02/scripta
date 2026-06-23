from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional
import asyncio
import logging

from playwright.async_api import Page, Browser, async_playwright, TimeoutError as PlaywrightTimeout, Error as PlaywrightError

from ..config import settings
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class ScraperUnavailableError(Exception):
    """Raised when the target register is unreachable/down."""
    pass


class ScraperInputError(Exception):
    """Raised when the input is invalid for the scraper."""
    pass


class BaseScraper(ABC):
    """
    Base class for all register scrapers.
    Subclasses implement `run()` and use the shared Playwright helpers below.
    """

    source_type: str = "ABSTRACT"

    def __init__(self, browser: Optional[Browser] = None):
        self.browser = browser
        self._owned_browser = False

    @abstractmethod
    async def run(self, **kwargs) -> ScrapedSource:
        """Execute the scraper and return a ScrapedSource."""
        raise NotImplementedError

    async def _get_page(self, block_images: bool = True) -> Page:
        """Lazily start a browser if one was not injected.
        block_images: ak True, blokuje obrázky/fonty/media pre rýchlosť (text-only scraping).
        Scrapery ktoré generujú PDF s obrázkami (ORSR, RPVS) musia dať block_images=False."""
        if self.browser is None:
            self._playwright = await async_playwright().start()
            self.browser = await self._playwright.chromium.launch(headless=settings.playwright_headless)
            self._owned_browser = True
        page = await self.browser.new_page()

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
        """Close browser only if we created it."""
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
                await page.goto(url, timeout=settings.playwright_timeout, wait_until="networkidle")
                return
            except (PlaywrightTimeout, PlaywrightError) as e:
                last_error = e
                delay = settings.scraper_retry_delay * (attempt + 1) * 2
                logger.warning(f"[{self.source_type}] goto attempt {attempt + 1}/{retries + 1} failed: {e} — retrying in {delay}s")
                await asyncio.sleep(delay)
        raise ScraperUnavailableError(f"Register {url} unreachable after {retries + 1} attempts: {last_error}")

    async def _print_page_to_pdf(self, page: Page, output_path: Path) -> int:
        """Print current page to PDF and return page count (1 for HTML prints)."""
        # Počkáme na 'load' event — fírne keď sú dokončené obrázky a zdroje (event-based,
        # na rozdiel od 'networkidle' nečaká na polling/analytics ktoré vládne stránky neukončia).
        try:
            await page.wait_for_load_state("load", timeout=15000)
        except PlaywrightTimeout:
            logger.warning(f"[{self.source_type}] load event timeout — pokračujem s generovaním PDF napriek tomu.")
        # Poistka: počkáme na <img> ktoré ešte nie sú complete — event-based (resolve na 'load'),
        # krátky fallback 3s len pre prípad zaseknutého obrázka.
        try:
            await page.evaluate("""
                async () => {
                    const imgs = Array.from(document.querySelectorAll('img'));
                    await Promise.all(imgs.map(img => {
                        if (img.complete && img.naturalWidth > 0) return;
                        return new Promise(resolve => {
                            img.addEventListener('load', resolve, { once: true });
                            img.addEventListener('error', resolve, { once: true });
                            setTimeout(resolve, 3000);
                        });
                    }));
                }
            """)
        except Exception as img_err:
            logger.warning(f"[{self.source_type}] Nepodarilo sa počkať na obrázky: {img_err}")
        await page.pdf(path=str(output_path), format="A4", print_background=True)
        return 1

    async def _download_pdf(self, page: Page, download_button_selector: str, output_path: Path) -> int:
        """
        Click a button that triggers a PDF download and wait for it to finish.
        Returns the number of pages (placeholder; use PyPDF2 to read real page count).
        """
        async with page.expect_download() as download_info:
            await page.click(download_button_selector)
        download = await download_info.value
        await download.save_as(str(output_path))
        return 1

    def _make_result(
        self,
        status: str,
        file_path: Optional[str] = None,
        page_count: Optional[int] = None,
        status_message: Optional[str] = None,
        findings: Optional[str] = None,
        company_name: Optional[str] = None,
    ) -> ScrapedSource:
        return ScrapedSource(
            source_type=self.source_type,
            status=status,
            file_path=file_path,
            page_count=page_count,
            status_message=status_message,
            findings=findings,
            company_name=company_name,
        )

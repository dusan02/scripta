from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional
import asyncio
import logging
import re

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
            self.browser = await self._playwright.chromium.launch(
                headless=settings.playwright_headless,
                args=['--disable-blink-features=AutomationDetected'],
            )
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
                await page.goto(url, timeout=20000, wait_until="commit")
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                except PlaywrightTimeout:
                    pass
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
        ic_dph: Optional[str] = None,
        persons: Optional[list] = None,
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
        )

    # ── Shared helpers for debtor-list scrapers ──────────────────────

    async def _get_stealth_page(self) -> Page:
        """Vytvorí page s plnou stealth ochranou pre anti-bot detekciu.
        Scrapery ktoré potrebujú stealth mode (VšZP, SP, Dôvera) volajú túto metódu.
        Zahŕňa: rotáciu UA, proxy, viewport, locale + stealth JS injekciu."""
        if self.browser is None:
            self._playwright = await async_playwright().start()
            self.browser = await self._playwright.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationDetected'],
            )
            self._owned_browser = True

        context_kwargs = {
            "user_agent": get_random_user_agent(),
            "viewport": get_random_viewport(),
            "locale": get_random_locale(),
        }
        proxy = get_rotating_proxy()
        if proxy:
            context_kwargs["proxy"] = proxy

        ctx = await self.browser.new_context(**context_kwargs)
        self._contexts.append(ctx)

        # Stealth JS — rovnaký ako v _get_page, ale pre debtor scrapery je kritický
        await ctx.add_init_script(STEALTH_JS)

        page = await ctx.new_page()
        return page

    async def _run_debtor_scraper(
        self,
        scrape_fn,
        *,
        unavailable_msg: str,
    ) -> ScrapedSource:
        """Template wrapper pre debtor-list scrapery.
        Spravuje page lifecycle, error handling a cleanup.
        scrape_fn je async funkcia ktorá prijíma (page: Page) a vracia ScrapedSource."""
        page: Optional[Page] = None
        try:
            page = await self._get_stealth_page()
            return await scrape_fn(page)
        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupné: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"{unavailable_msg}: {e}")
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba pri spracovaní {self.source_type}: {e}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"Neznáma chyba pri spracovaní {self.source_type}: {type(e).__name__}: {e}")
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _extract_table_findings(
        self,
        page: Page,
        ico: str,
        *,
        source_name: str,
        field_map: Optional[dict] = None,
    ) -> Optional[str]:
        """Extrahuje nálezy z tabuľky. Ak je field_map zadaný, použije ho na mapovanie stĺpcov.
        Bez field_map vracia hodnoty oddelené ' | '."""
        try:
            rows = page.locator("table tbody tr")
            count = await rows.count()
            if count == 0:
                logger.warning(f"[{self.source_type}] Tabuľka s výsledkami sa nenašla.")
                return None

            rows_data = []
            for i in range(min(count, 5)):
                cells = rows.nth(i).locator("td")
                cell_count = await cells.count()
                if cell_count == 0:
                    continue
                if field_map:
                    row = {}
                    for c in range(cell_count):
                        try:
                            cell = cells.nth(c)
                            cls = await cell.get_attribute("class") or ""
                            val = (await cell.inner_text(timeout=2000)).strip()
                        except PlaywrightTimeout:
                            val = ""
                            cls = ""
                        val = re.sub(r'\s+', ' ', val).strip()
                        if not val or val == "-":
                            continue
                        for cls_key, cls_label in field_map.items():
                            if cls_key in cls:
                                row[cls_label] = val
                                break
                    if row:
                        rows_data.append(row)
                else:
                    row = []
                    for c in range(cell_count):
                        try:
                            val = (await cells.nth(c).inner_text(timeout=2000)).strip()
                        except PlaywrightTimeout:
                            val = ""
                        val = re.sub(r'\s+', ' ', val).strip()
                        if val and val != "-":
                            row.append(val)
                    if row:
                        rows_data.append(row)

            if not rows_data:
                return None

            parts = [f"POZOR: Subjekt (IČO: {ico}) je v zozname dlžníkov {source_name}."]
            if field_map:
                for row in rows_data:
                    for label, val in row.items():
                        parts.append(f"{label}: {val}")
            else:
                for row in rows_data:
                    parts.append(" | ".join(row))
            findings = "\n".join(parts)
            logger.info(f"[{self.source_type}] Findings extrahované: {findings[:200]}")
            return findings

        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None

    async def _generate_no_results_pdf(
        self, page: Page, output_path: Path, ico: str, *, title: str, message: str
    ) -> None:
        """Vygeneruje PDF s textom, že pre dané IČO sa nenašiel žiadny záznam."""
        await page.set_viewport_size({"width": 1920, "height": 1080})
        await page.evaluate(
            """(params) => {
                const { title, message } = params;
                const body = document.body;
                while (body.firstChild) body.removeChild(body.firstChild);
                const h1 = document.createElement('h1');
                h1.textContent = title;
                h1.style.cssText = 'font-size: 24px; font-weight: 700; margin: 0 0 20px 0; padding: 0; text-align: center;';
                body.appendChild(h1);
                const p = document.createElement('p');
                p.textContent = message;
                p.style.cssText = 'font-size: 16px; text-align: center; margin: 40px 0;';
                body.appendChild(p);
                body.style.margin = '0';
                body.style.padding = '40px';
            }""",
            {"title": title, "message": message},
        )
        await page.pdf(
            path=str(output_path),
            format="A4",
            print_background=True,
            margin={"top": "2cm", "bottom": "2cm", "left": "2cm", "right": "2cm"},
        )
        logger.info(f"[{self.source_type}] Negatívny PDF vygenerovaný: {output_path}")

    async def _extract_table_findings_formatted(
        self, page: Page, ico: str, *, source_name: str
    ) -> Optional[str]:
        """Extrahuje nálezy z tabuľky s prehľadným formátom — jeden údaj na riadok (Názov: hodnota),
        záznamy oddelené prázdnym riadkom. Používa hlavičku tabuľky pre názvy stĺpcov."""
        try:
            rows = page.locator("table tbody tr")
            count = await rows.count()
            if count == 0:
                return None

            header_cells = page.locator("table thead th, table thead td")
            header_count = await header_cells.count()
            headers = []
            for h in range(header_count):
                try:
                    hdr = (await header_cells.nth(h).inner_text(timeout=2000)).strip()
                except Exception:
                    hdr = ""
                headers.append(hdr)

            parts = [f"POZOR: Subjekt (IČO: {ico}) je v zozname dlžníkov {source_name}."]

            for i in range(min(count, 5)):
                cells = rows.nth(i).locator("td")
                cell_count = await cells.count()
                if cell_count == 0:
                    continue

                row_fields = []
                for c in range(cell_count):
                    try:
                        val = (await cells.nth(c).inner_text(timeout=2000)).strip()
                    except Exception:
                        val = ""
                    val = re.sub(r'\s+', ' ', val).strip()
                    if not val or val == "-":
                        continue
                    label = headers[c] if c < len(headers) else None
                    if label:
                        row_fields.append(f"{label}: {val}")
                    else:
                        row_fields.append(val)

                if row_fields:
                    parts.append("\n".join(row_fields))
                    parts.append("")

            findings = "\n".join(parts).strip()
            logger.info(f"[{self.source_type}] Findings extrahované: {findings[:200]}")
            return findings

        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None

    async def _handle_cloudflare_challenge(self, page: Page, max_attempts: int = 3) -> None:
        """Detekuje a skúsi vyriešiť Cloudflare Turnstile challenge (kliknutie na iframe)."""
        for attempt in range(max_attempts):
            try:
                cf_iframe = page.locator("iframe[src*='challenges.cloudflare.com']")
                await cf_iframe.first.wait_for(timeout=5000)
                logger.info(f"[{self.source_type}] Cloudflare challenge detekovaný (pokus {attempt + 1}).")
                frame = cf_iframe.first.content_frame
                if frame:
                    await frame.locator("body").click(timeout=5000)
                    logger.info(f"[{self.source_type}] Cloudflare challenge kliknuté.")
                    await page.wait_for_timeout(3000)
                    await page.wait_for_load_state("domcontentloaded", timeout=15000)
            except PlaywrightTimeout:
                break  # Žiadny Cloudflare challenge — pokračuj
            except Exception as e:
                logger.warning(f"[{self.source_type}] Cloudflare challenge chyba: {e}")
                break

            # Skontroluj či textbox je už dostupný
            try:
                await page.get_by_role("textbox").wait_for(timeout=3000)
                break  # Textbox nájdený — challenge vyriešený
            except PlaywrightTimeout:
                logger.info(f"[{self.source_type}] Textbox stále nedostupný — skúšam znova.")
                continue

    async def _generate_clean_pdf(
        self,
        page: Page,
        output_path: Path,
        title: str,
        disclaimer_html: Optional[str] = None,
        *,
        content_selector: str = "table",
        fallback_selectors: str = "main, .main, .content, .results, .search-results, [class*='result'], [class*='debtor']",
        format: str = "A3",
        scale: float = 0.85,
    ) -> None:
        """Vygeneruje čisté PDF s nadpisom (a voliteľným disclaimerom).
        Odstráni všetko z DOMu okrem content_selector elementu."""
        await page.set_viewport_size({"width": 1920, "height": 1080})

        await page.evaluate(
            """(params) => {
                const {contentSelector, fallbackSelectors, title, disclaimerHtml} = params;
                let content = document.querySelector(contentSelector);
                if (!content) {
                    for (const sel of fallbackSelectors.split(',').map(s => s.trim())) {
                        content = document.querySelector(sel);
                        if (content) break;
                    }
                }

                const body = document.body;

                if (content && content !== body) {
                    while (body.firstChild) body.removeChild(body.firstChild);
                    const h1 = document.createElement('h1');
                    h1.textContent = title;
                    h1.style.cssText = 'font-size: 30px; font-weight: 700; margin: 0 0 10px 0; padding: 0; text-align: center;';
                    body.appendChild(h1);
                    body.appendChild(content);
                    if (disclaimerHtml) {
                        const div = document.createElement('div');
                        div.innerHTML = disclaimerHtml;
                        body.appendChild(div);
                    }
                } else {
                    document.querySelectorAll('header, footer, nav, .header, .footer, .navigation, .menu, .cookie-bar, .breadcrumb, .sidebar, #header, #footer, .page-header, [class*="cookie"], [class*="banner"], [class*="modal"], [id*="cookie"], [id*="banner"]').forEach(el => el.remove());
                    const h1 = document.createElement('h1');
                    h1.textContent = title;
                    h1.style.cssText = 'font-size: 30px; font-weight: 700; margin: 0 0 10px 0; padding: 0; text-align: center;';
                    body.insertBefore(h1, body.firstChild);
                }

                body.style.margin = '0';
                body.style.padding = '0';
            }""",
            {"contentSelector": content_selector, "fallbackSelectors": fallback_selectors, "title": title, "disclaimerHtml": disclaimer_html},
        )

        await page.add_style_tag(content="""
            @page { size: A3 landscape; margin: 0.5cm; }
            body { margin: 0 !important; padding: 0 !important; }
            table {
                width: 100% !important;
                font-size: 11px !important;
                table-layout: auto !important;
                border-collapse: collapse !important;
            }
            th { background: #f3f4f6 !important; font-weight: 600 !important; }
            td, th { padding: 3px 6px !important; word-break: normal !important; white-space: normal !important; overflow-wrap: break-word !important; text-align: left !important; }
        """)
        await page.emulate_media(media="print")
        await page.pdf(
            path=str(output_path),
            format=format,
            landscape=True,
            print_background=True,
            scale=scale,
            margin={"top": "0.5cm", "bottom": "0.5cm", "left": "0.5cm", "right": "0.5cm"},
            prefer_css_page_size=False,
        )
        logger.info(f"[{self.source_type}] PDF vygenerované: {output_path}")

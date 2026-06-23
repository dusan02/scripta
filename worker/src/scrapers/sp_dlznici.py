from __future__ import annotations
import logging
import re
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class SpDlzniciScraper(BaseScraper):
    """
    Scraper pre Sociálnu poisťovňu SR — Zoznam dlžníkov na sociálnom poistení.
    Vyhľadáva podľa IČO. Stránka nemá PDF export — generuje PDF cez print-to-PDF.
    """

    source_type = "SP_DLZNICI"
    base_url = "https://socpoist.sk/nastroje-sluzby/zoznam-dlznikov"

    async def _get_stealth_page(self) -> Page:
        """SP blokuje headless detekciu — vytvorí page s realistickým user-agentom bez resource blocking."""
        if self.browser is None:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            self.browser = await self._playwright.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationDetected'],
            )
            self._owned_browser = True
        ctx = await self.browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            locale='sk-SK',
        )
        self._contexts.append(ctx)
        page = await ctx.new_page()
        return page

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        ctx = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_stealth_page()
            ctx = page.context
            print(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=30000, wait_until='networkidle')
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"SP nedostupná: {e}")
            print(f"[{self.source_type}] ⏱ goto: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()
            logger.info(f"[{self.source_type}] Stránka načítaná, URL: {page.url}")

            # Skontrolovať či nás zablokovali
            body_text = await page.inner_text("body")
            if "Server je nedostupný" in body_text:
                logger.error(f"[{self.source_type}] SP zablokovala prístup (geo/bot detekcia).")
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="Sociálna poisťovňa zablokovala prístup (bot detekcia).",
                )

            # Vyplniť IČO — selektor podľa Drupal form: input[name="ico"]
            ico_input = page.locator('input[name="ico"]')
            try:
                await ico_input.wait_for(timeout=10000)
                await ico_input.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole IČO sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť pole IČO na stránke Sociálnej poisťovne.",
                )

            # Kliknúť na Potvrdiť
            submit_btn = page.get_by_role("button", name="Potvrdiť")
            try:
                await submit_btn.wait_for(timeout=10000)
                await submit_btn.click()
                logger.info(f"[{self.source_type}] Tlačidlo Potvrdiť kliknuté.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo Potvrdiť sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Potvrdiť na stránke Sociálnej poisťovne.",
                )

            print(f"[{self.source_type}] ⏱ fill IČO + Potvrdiť: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # Počkať na výsledky
            await page.wait_for_timeout(2000)
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] networkidle timeout — pokračujem.")
            print(f"[{self.source_type}] ⏱ wait_results: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # Skontrolovať či sú výsledky
            text_content = await page.inner_text("body")
            text_lower = text_content.lower()

            # Prázdne výsledky — žiadne položky
            empty_markers = [
                "zoznam neobsahuje žiadne položky",
                "nenašli sa žiadne",
                "žiadny záznam",
                "bez výsledkov",
                "neboli nájdené žiadne",
                "žiadne výsledky",
            ]
            if any(marker in text_lower for marker in empty_markers):
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov Sociálnej poisťovne.",
                    findings="Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení.",
                )

            # Ak sme prešli empty markers, subjekt JE v zozname dlžníkov
            findings = await self._extract_findings(page, ico)
            if findings is None:
                findings = f"POZOR: Subjekt (IČO: {ico}) je v zozname dlžníkov Sociálnej poisťovne."

            # Generovať PDF z výsledkovej stránky — len tabuľka s výsledkami
            pdf_output = output_dir / f"sp_dlznici_{ico}.pdf"
            try:
                # Skryjeme navigáciu/footer/hlavičku a popisný úvodný obsah, necháme len tabuľku.
                await page.add_style_tag(content="""
                    header, footer, nav, .header, .footer, .navigation, .menu,
                    .breadcrumb, .sidebar, #header, #footer, #navigation,
                    .cookie-bar, .skip-link, .region-header, .region-footer,
                    .page-header, .field--name-body, .text-content, .intro,
                    .block-system-breadcrumb-block, .tabs, h1, .page-title,
                    form .description, .form-item--description {
                        display: none !important;
                    }
                    main, .main-content, .content, .region-content {
                        margin: 0 !important; padding: 0 !important;
                    }
                    /* Tabuľka na celú šírku, menšie písmo aby sa zmestila */
                    table { width: 100% !important; font-size: 10px !important; table-layout: auto !important; }
                    td, th { padding: 3px 5px !important; word-break: break-word !important; }
                """)
                await page.emulate_media(media="print")
                await page.pdf(
                    path=str(pdf_output),
                    format="A4",
                    landscape=True,
                    print_background=True,
                    scale=0.9,
                    margin={"top": "0.8cm", "bottom": "0.8cm", "left": "0.8cm", "right": "0.8cm"},
                )
                logger.info(f"[{self.source_type}] PDF vygenerované: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                if findings:
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message=f"Subjekt {ico} je v zozname dlžníkov Sociálnej poisťovne (PDF zlyhalo).",
                        findings=findings,
                    )
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF: {e}",
                )

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Subjekt {ico} je v zozname dlžníkov Sociálnej poisťovne.",
                findings=findings,
            )

        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupné: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register Sociálnej poisťovne je nedostupný: {e}",
            )
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Sieťová chyba pri spracovaní {self.source_type}: {e}",
            )
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(
                status="FAILED",
                status_message=f"Neznáma chyba pri spracovaní {self.source_type}: {type(e).__name__}: {e}",
            )
        finally:
            if page:
                await page.close()
            if ctx:
                await ctx.close()

    async def _extract_findings(self, page: Page, ico: str) -> Optional[str]:
        """Extrahuje nálezy z výsledkovej tabuľky — volané len ak sme prešli empty markers (subjekt JE dlžník)."""
        try:
            # Skúsime rôzne selektory — Drupal tabuľky nemusia mať tbody
            rows = page.locator("table tbody tr, table tr")
            count = await rows.count()
            if count == 0:
                logger.warning(f"[{self.source_type}] Tabuľka s výsledkami sa nenašla.")
                return None

            clean_headers = ["Názov / Meno", "IČO", "Adresa", "Mesto", "Dlžná suma", "Chýbajúce podklady za obdobie"]

            result_lines = []
            for i in range(min(count, 5)):
                cells = rows.nth(i).locator("td")
                cell_count = await cells.count()
                if cell_count == 0:
                    continue
                row_data = []
                for c in range(cell_count):
                    try:
                        val = (await cells.nth(c).inner_text(timeout=2000)).strip()
                    except PlaywrightTimeoutError:
                        val = ""
                    val = re.sub(r'\s*zoradiť podľa\s+.*$', '', val).strip()
                    if val:
                        row_data.append(val)

                if not row_data:
                    continue

                if len(clean_headers) >= len(row_data):
                    parts = [f"  {clean_headers[h_idx]}: {val}" for h_idx, val in enumerate(row_data) if val]
                else:
                    parts = [f"  • {val}" for val in row_data if val]
                result_lines.append("\n".join(parts))

            if not result_lines:
                return None

            findings = f"POZOR: Subjekt (IČO: {ico}) je v zozname dlžníkov Sociálnej poisťovne.\n" + "\n\n".join(result_lines)
            logger.info(f"[{self.source_type}] Findings extrahované: {findings[:200]}")
            return findings

        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None

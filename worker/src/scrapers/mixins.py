from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, async_playwright, TimeoutError as PlaywrightTimeout, Error as PlaywrightError

from ..config import settings
from ..models import ScrapedSource
from ..stealth import (
    get_rotating_proxy,
    get_random_user_agent,
    get_random_viewport,
    get_random_locale,
    STEALTH_JS,
)
from .exceptions import ScraperUnavailableError

logger = logging.getLogger(__name__)

class PdfGeneratorMixin:
    async def _print_page_to_pdf(self, page: Page, output_path: Path) -> int:
        try:
            await page.wait_for_load_state("load", timeout=15000)
        except PlaywrightTimeout:
            logger.warning(f"[{getattr(self, 'source_type', 'UNKNOWN')}] load event timeout — pokračujem s generovaním PDF napriek tomu.")
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
            logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Nepodarilo sa počkať na obrázky: {img_err}")
        await page.pdf(path=str(output_path), format="A4", print_background=True)
        return 1

    async def _download_pdf(self, page: Page, download_button_selector: str, output_path: Path) -> int:
        async with page.expect_download() as download_info:
            await page.click(download_button_selector)
        download = await download_info.value
        await download.save_as(str(output_path))
        return 1

    async def _generate_no_results_pdf(
        self, page: Page, output_path: Path, ico: str, *, title: str, message: str
    ) -> None:
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
        logger.info(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Negatívny PDF vygenerovaný: {output_path}")

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
        logger.info(f"[{getattr(self, 'source_type', 'UNKNOWN')}] PDF vygenerované: {output_path}")


class StealthDebtorMixin:
    async def _get_stealth_page(self) -> Page:
        if not hasattr(self, 'browser') or self.browser is None:
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
        if not hasattr(self, '_contexts'):
            self._contexts = []
        self._contexts.append(ctx)

        await ctx.add_init_script(STEALTH_JS)
        page = await ctx.new_page()
        return page

    async def _run_debtor_scraper(
        self,
        scrape_fn,
        *,
        unavailable_msg: str,
    ) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            page = await self._get_stealth_page()
            return await scrape_fn(page)
        except ScraperUnavailableError as e:
            logger.error(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Nedostupné: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"{unavailable_msg}: {e}")
        except PlaywrightError as e:
            logger.error(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Playwright chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba pri spracovaní: {e}")
        except Exception as e:
            logger.error(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"Neznáma chyba pri spracovaní: {type(e).__name__}: {e}")
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass


class TableExtractorMixin:
    async def _extract_table_findings(
        self,
        page: Page,
        ico: str,
        *,
        source_name: str,
        field_map: Optional[dict] = None,
    ) -> Optional[str]:
        try:
            rows = page.locator("table tbody tr")
            count = await rows.count()
            if count == 0:
                logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Tabuľka s výsledkami sa nenašla.")
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
                            logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Timeout počas inner_text na bunke {c}")
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
                            logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Timeout počas inner_text na bunke {c}")
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
            return findings

        except Exception as e:
            logger.warning(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Extrakcia nálezov zlyhala: {e}")
            return None

    async def _extract_table_findings_formatted(
        self, page: Page, ico: str, *, source_name: str
    ) -> Optional[str]:
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
                    except PlaywrightTimeout:
                        logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Timeout počas inner_text formátovanej bunky {c}")
                        val = ""
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
            return findings

        except Exception as e:
            logger.warning(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Extrakcia formátovaných nálezov zlyhala: {e}")
            return None


class CaptchaSolverMixin:
    async def _handle_cloudflare_challenge(self, page: Page, max_attempts: int = 3) -> None:
        for attempt in range(max_attempts):
            try:
                cf_iframe = page.locator("iframe[src*='challenges.cloudflare.com']")
                await cf_iframe.first.wait_for(timeout=5000)
                logger.info(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Cloudflare challenge detekovaný (pokus {attempt + 1}).")
                frame = cf_iframe.first.content_frame
                if frame:
                    await frame.locator("body").click(timeout=5000)
                    logger.info(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Cloudflare challenge kliknuté.")
                    await page.wait_for_timeout(3000)
                    await page.wait_for_load_state("domcontentloaded", timeout=15000)
            except PlaywrightTimeout:
                break
            except Exception as e:
                logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Cloudflare challenge chyba: {e}")
                break

            try:
                await page.get_by_role("textbox").wait_for(timeout=3000)
                break
            except PlaywrightTimeout:
                logger.debug(f"[{getattr(self, 'source_type', 'UNKNOWN')}] Textbox stále nedostupný — skúšam znova.")
                continue

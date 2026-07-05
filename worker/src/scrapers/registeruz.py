from __future__ import annotations
import asyncio
import base64
import logging
import re
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_NO_RESULTS_TEXT = "neboli nájdené žiadne"

# (tab_id, tab_name) — URL pattern: /financialreport/show/{report_id}/{tab_id}
_TABS = [
    (0,   "Titulná strana"),
    (550, "Strana aktív"),
    (551, "Strana pasív"),
    (552, "Výkaz ziskov a strát"),
]

_REPORT_URL = "https://www.registeruz.sk/cruz-public/domain/financialreport/show/{rid}/{tid}"


class RegisterUzScraper(BaseScraper):
    """Scraper pre Register účtovných závierok (registeruz.sk)."""

    source_type = "REGISTER_UZ"
    base_url = "https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch"
    _title = "Register účtovných závierok (registeruz.sk)"
    _no_results_msg = "Subjekt nie je evidovaný v Registri účtovných závierok."

    # ── public ──────────────────────────────────────────────────────────

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Start IČO={ico}")
            page = await self._get_page(block_images=False)

            report_id = await self._navigate_to_report(page, ico)
            if not report_id:
                if await self._has_no_results(page):
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message=f"IČO {ico} nebolo nájdené v {self._title}.",
                        findings=self._no_results_msg,
                    )
                
                file_path = output_dir / f"{self.source_type}_{ico}.pdf"
                await self._generate_clean_pdf(
                    page, file_path, title=self._title,
                    content_selector="main, .main, .content, table",
                    format="A4", scale=0.9,
                )
                return self._make_result(
                    status="SUCCESS", file_path=str(file_path), page_count=1,
                    status_message=f"Účtovná závierka pre IČO {ico} vygenerovaná (obmedzený obsah).",
                    findings=f"Účtovná závierka nájdená v {self._title}.",
                )

            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            tab_labels = await self._scrape_tabs(page, report_id, ico, output_dir, file_path)
            findings = await self._extract_findings(page, ico, tab_labels)

            return self._make_result(
                status="SUCCESS", file_path=str(file_path), page_count=1,
                status_message=f"Účtovná závierka pre IČO {ico} úspešne vygenerovaná ({len(tab_labels)} záložiek).",
                findings=findings or f"Účtovná závierka nájdená v {self._title}.",
            )
        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Chyba pri IČO {ico}: {e}")
            return self._make_result(status="FAILED", file_path=None,
                                     status_message=f"Interná chyba scrapera: {str(e)}")
        finally:
            if page:
                await page.close()

    # ── navigation ──────────────────────────────────────────────────────

    async def _navigate_to_report(self, page: Page, ico: str) -> Optional[str]:
        """Prejde: search → result → collapse → najnovšia závierka → vráti report_id."""
        await self._safe_goto(page, self.base_url)
        await self._accept_cookies(page)

        await self._fill_search(page, ico)
        # Počkáme kým sa objaví výsledok (detail link) alebo text o žiadnych výsledkoch
        try:
            result_link = page.locator("a[href*='accountingentity/show']")
            no_results = page.locator("text=Neboli nájdené žiadne výsledky")
            await no_results.or_(result_link).first.wait_for(timeout=5000)
        except PlaywrightTimeoutError:
            pass

        if await self._has_no_results(page):
            return None

        await self._click_first_result(page)
        # Počkáme kým sa načíta detail stránka s collapse sekciami
        try:
            await page.wait_for_selector("span.js-collapse, a.js-collapse", timeout=5000)
        except PlaywrightTimeoutError:
            pass

        await self._click_collapse_arrow(page)
        # Počkáme kým sa rozbalí sekcia s linkami na závierky
        try:
            await page.wait_for_selector("a[href*='financialreport/show']", timeout=3000)
        except PlaywrightTimeoutError:
            pass

        await self._click_ucpod(page)
        # Počkáme kým sa načíta URL s reportom (event-driven)
        try:
            await page.wait_for_url("**/financialreport/show/**", timeout=5000)
        except PlaywrightTimeoutError:
            pass

        url = page.url
        m = re.search(r'/financialreport/show/(\d+)', url)
        if m:
            logger.info(f"[{self.source_type}] Report ID: {m.group(1)}")
            return m.group(1)

        html = await page.content()
        m = re.search(r'/financialreport/show/(\d+)', html)
        if m:
            logger.info(f"[{self.source_type}] Report ID (z HTML): {m.group(1)}")
            return m.group(1)

        logger.warning(f"[{self.source_type}] Report ID nenájdené (URL={url}).")
        return None

    async def _accept_cookies(self, page: Page) -> None:
        try:
            btn = page.get_by_role("link", name="Povoliť všetko")
            await btn.wait_for(state="visible", timeout=3000)
            await btn.click()
        except PlaywrightTimeoutError:
            pass

    async def _fill_search(self, page: Page, ico: str) -> None:
        try:
            inp = page.locator("#input_search")
            await inp.wait_for(state="visible", timeout=5000)
            await inp.fill(ico)
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError(f"{self.source_type}: Nenájdené #input_search.")

        try:
            btn = page.locator("button:has-text('Vyhľadať')")
            await btn.wait_for(state="visible", timeout=5000)
            await btn.click()
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError(f"{self.source_type}: Nenájdené tlačidlo Vyhľadať.")

    async def _has_no_results(self, page: Page) -> bool:
        text = (await page.inner_text("body")).lower()
        return _NO_RESULTS_TEXT in text

    async def _click_first_result(self, page: Page) -> None:
        clicked = await page.evaluate("""() => {
            let el = document.querySelector("a[href*='accountingentity/show']");
            if (el) { el.click(); return 'entity'; }
            el = document.querySelector("table a[href*='show']");
            if (el) { el.click(); return 'table'; }
            const a = Array.from(document.querySelectorAll('a'))
                .find(a => a.textContent.trim() === 'Detail');
            if (a) { a.click(); return 'detail'; }
            return null;
        }""")
        logger.info(f"[{self.source_type}] Výsledok: {clicked or 'nenájdený'}")

    async def _click_collapse_arrow(self, page: Page) -> None:
        # Rozbalíme VŠETKY collapse sekcie, nie len prvú — inak
        # _click_ucpod nevidí závierky z neskorších rokov.
        count = await page.evaluate("""() => {
            let n = 0;
            document.querySelectorAll('span.js-collapse, a.js-collapse').forEach(el => {
                try { el.click(); n++; } catch(e) {}
            });
            document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"]').forEach(el => {
                try { el.click(); n++; } catch(e) {}
            });
            return n;
        }""")
        if count == 0:
            logger.warning(f"[{self.source_type}] Žiadny collapse element nenájdený.")
        else:
            logger.info(f"[{self.source_type}] Expandovaných {count} sekcií.")
            await asyncio.sleep(1)

    async def _click_ucpod(self, page: Page) -> None:
        # Nájdi VŠETKY linky na závierky naprieč rozbalenými sekciami,
        # extrahuj rok z kontextu a klikni na ten najnovší.
        # Podporuje: Úč POD, Úč MUJ, IFRS individuálna, IFRS konsolidovaná, atď.

        # Najprv klikni na "Zobraziť viac" pre pagination (staršie roky môžu byť skryté)
        for _ in range(5):
            try:
                show_more = page.locator(
                    "a:has-text('Zobraziť viac'), a:has-text('Zobraziť všetky'), button:has-text('Zobraziť viac')"
                )
                if await show_more.count() > 0 and await show_more.first.is_visible():
                    await show_more.first.click()
                    await asyncio.sleep(1)
                    logger.info(f"[{self.source_type}] Kliknuté na 'Zobraziť viac'")
                else:
                    break
            except Exception:
                break

        clicked = await page.evaluate(r"""() => {
            const candidates = [];

            // 1. Hľadaj všetky klikateľné linky na financialreport v collapse sekciách
            //    Podporuje: Úč POD, Úč MUJ, IFRS individuálna, IFRS konsolidovaná, atď.
            document.querySelectorAll(
                "[id^='collapse-o-'] a[href*='financialreport/show']"
            ).forEach(el => {
                const section = el.closest("[id^='collapse-o-']");
                const sectionText = section ? section.innerText : '';
                const yearMatch = sectionText.match(/(20\d{2})/);
                const year = yearMatch ? parseInt(yearMatch[1]) : 0;
                const text = el.textContent.trim();
                candidates.push({el, year, text, src: 'collapse'});
            });

            // 2. Fallback: text-decoration-underline span-y (pôvodný selector pre Úč POD)
            if (candidates.length === 0) {
                document.querySelectorAll(
                    "[id^='collapse-o-'] span.font-weight-medium.text-primary.text-decoration-underline"
                ).forEach(el => {
                    const section = el.closest("[id^='collapse-o-']");
                    const sectionText = section ? section.innerText : '';
                    const yearMatch = sectionText.match(/(20\d{2})/);
                    const text = el.textContent.trim();
                    candidates.push({el, year: yearMatch ? parseInt(yearMatch[1]) : 0, text, src: 'span'});
                });
            }

            // 3. Fallback: všetky linky na financialreport na stránke
            if (candidates.length === 0) {
                document.querySelectorAll("a[href*='financialreport/show']").forEach(el => {
                    const section = el.closest("[id^='collapse-o-']")
                        || el.closest('.item') || el.closest('tr') || el.closest('li');
                    const sectionText = section ? section.innerText : '';
                    const yearMatch = sectionText.match(/(20\d{2})/);
                    const text = el.textContent.trim();
                    candidates.push({el, year: yearMatch ? parseInt(yearMatch[1]) : 0, text, src: 'fallback'});
                });
            }

            if (candidates.length === 0) return null;

            // Zoraď zostupne podľa roku — klikni na najnovší
            candidates.sort((a, b) => b.year - a.year);
            const best = candidates[0];
            best.el.click();
            return best.src + '_' + best.year + '_' + best.text;
        }""")
        logger.info(f"[{self.source_type}] Závierka: {clicked or 'nenájdený'}")

    # ── PDF generation ──────────────────────────────────────────────────

    async def _cdp_print_pdf(self, page: Page, file_path: Path) -> None:
        """CDP Page.printToPDF — nečaká na networkidle ako page.pdf()."""
        cdp = await page.context.new_cdp_session(page)
        try:
            result = await asyncio.wait_for(
                cdp.send("Page.printToPDF", {
                    "printBackground": True,
                    "paperWidth": 8.27,
                    "paperHeight": 11.69,
                    "marginTop": 0.79,
                    "marginBottom": 0.79,
                    "marginLeft": 0.59,
                    "marginRight": 0.59,
                }),
                timeout=15,
            )
            pdf_bytes = base64.b64decode(result["data"])
            with open(file_path, "wb") as f:
                f.write(pdf_bytes)
        finally:
            await cdp.detach()

    async def _scrape_single_tab(
        self, page: Page, url: str, tab_id: int, tab_name: str, ico: str, output_dir: Path,
    ) -> None:
        """Naviguje na tab a vygeneruje PDF cez CDP. Skryje riadky s nulovými hodnotami."""
        await page.goto(url, wait_until="commit", timeout=15000)
        try:
            await page.wait_for_selector("table, .table", timeout=5000)
        except PlaywrightTimeoutError:
            pass

        # Skryť riadky kde všetky číselné hodnoty sú 0 alebo prázdne
        hidden_count = await page.evaluate(r"""() => {
            let hidden = 0;
            document.querySelectorAll('table tr').forEach(tr => {
                // Preskoč hlavičkové riadky
                const ths = tr.querySelectorAll('th');
                if (ths.length > 0) return;

                const tds = tr.querySelectorAll('td');
                if (tds.length < 2) return;

                // Skontroluj či riadok obsahuje aspoň jednu nenulovú číselnú hodnotu
                let hasNonZero = false;
                let hasNumeric = false;
                tds.forEach(td => {
                    const text = td.innerText.trim();
                    // Normalizuj čísla: odstráň medzery, &nbsp;, nahraď čiarku bodkou
                    const normalized = text.replace(/[\s\xa0]/g, '').replace(',', '.');
                    const num = parseFloat(normalized);
                    if (!isNaN(num)) {
                        hasNumeric = true;
                        if (Math.abs(num) > 0.01) hasNonZero = true;
                    }
                });

                // Skry len ak má číselné hodnoty a všetky sú nulové
                if (hasNumeric && !hasNonZero) {
                    tr.style.display = 'none';
                    hidden++;
                }
            });
            return hidden;
        }""")
        if hidden_count > 0:
            logger.info(f"[{self.source_type}] Tab '{tab_name}': skrytých {hidden_count} nulových riadkov")

        tab_pdf = output_dir / f"{self.source_type}_{ico}_tab{tab_id}.pdf"
        await self._cdp_print_pdf(page, tab_pdf)

    async def _scrape_tabs(
        self, page: Page, report_id: str, ico: str,
        output_dir: Path, file_path: Path,
    ) -> list:
        """Pre každú záložku vygeneruje PDF a zlúči ich."""
        from PyPDF2 import PdfReader, PdfWriter

        tab_pdfs: list[Path] = []
        tab_labels: list[str] = []

        for tab_id, tab_name in _TABS:
            url = _REPORT_URL.format(rid=report_id, tid=tab_id)
            try:
                await asyncio.wait_for(
                    self._scrape_single_tab(page, url, tab_id, tab_name, ico, output_dir),
                    timeout=30,
                )
                tab_pdfs.append(output_dir / f"{self.source_type}_{ico}_tab{tab_id}.pdf")
                tab_labels.append(tab_name)
                logger.info(f"[{self.source_type}] Záložka '{tab_name}' OK")
            except asyncio.TimeoutError:
                logger.warning(f"[{self.source_type}] Záložka '{tab_name}' timeout 30s — skip.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Záložka '{tab_name}' zlyhala: {e}")

        if not tab_pdfs:
            await self._generate_clean_pdf(
                page, file_path, title=self._title,
                content_selector="main, .main, .content, table",
                format="A4", scale=0.9,
            )
            return []

        # Zlúčenie
        writer = PdfWriter()
        for tp in tab_pdfs:
            for p in PdfReader(str(tp)).pages:
                writer.add_page(p)
        with open(file_path, "wb") as f:
            writer.write(f)
        for tp in tab_pdfs:
            try: tp.unlink()
            except Exception: pass
        logger.info(f"[{self.source_type}] Zlúčené {len(tab_labels)} záložiek.")
        return tab_labels

    # ── findings ────────────────────────────────────────────────────────

    async def _extract_findings(self, page: Page, ico: str, tab_labels: list) -> Optional[str]:
        try:
            parts = [f"Účtovná závierka nájdená pre IČO {ico} v Registri účtovných závierok."]
            if tab_labels:
                parts.append(f"Záchytné záložky: {', '.join(tab_labels)}")
            text = await page.inner_text("body")
            m = re.search(r'(\d{2}/\d{4}\s*[-–]\s*\d{2}/\d{4})', text)
            if m:
                parts.append(f"Obdobie: {m.group(1)}")
            if "Individuá" in text:
                parts.append("Typ: Individuálna účtovná závierka")
            elif "Konsolidovaná" in text:
                parts.append("Typ: Konsolidovaná účtovná závierka")
            return "\n".join(parts)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None

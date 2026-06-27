from __future__ import annotations
import asyncio
import logging
import re
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..config import settings
from ..models import ScrapedSource

_PDF_TITLE_AVAILABLE = True
try:
    from PyPDF2 import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import io
    import io
except ImportError:
    _PDF_TITLE_AVAILABLE = False

_FONT_REGISTERED = False

logger = logging.getLogger(__name__)


class FinancnaSpravaBase(BaseScraper):
    """
    Base scraper pre všetky zoznamy z financnasprava.sk.
    Zdieľa: modal dismissal, navigáciu na konkrétny zoznam, vyhľadávanie, PDF download.

    Subclassy musia definovať:
      - source_type: identifikátor v registri
      - zoznam_link_name: text linku v zozname (napr. "Zoznam daňových dlžníkov")
      - file_prefix: prefix pre PDF súbor (napr. "financna_sprava_dlznici")
      - _extract_findings(): špecifická extrakcia nálezov
    """

    base_url = "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy"
    zoznam_link_name: str = ""
    file_prefix: str = "financna_sprava"
    pdf_title: str = ""
    # 'ico' = vyhľadávanie podľa IČO (nie je potrebný ORSR)
    # 'name' = vyhľadávanie podľa názvu subjektu (vyžaduje ORSR pre company_name)
    search_by: str = "name"

    async def _safe_goto(self, page: Page, url: str, retries: int = None) -> Page:
        """FS server občas zasekne konkrétne spojenie (page), zatiaľ čo iné fungujú.
        Preto pri timeoute zatvoríme zaseknutú page a retryneme na čerstvej page
        (= čerstvé spojenie), ktorá zvyčajne prejde do 1s.
        Vracia funkčnú page (môže byť iná než vstupná)."""
        if retries is None:
            retries = settings.scraper_retries + 2  # FS je flaky — viac pokusov
        last_error: Optional[Exception] = None
        for attempt in range(retries + 1):
            try:
                await page.goto(url, timeout=7000, wait_until="commit")
                # Po commit počkáme na DOM, ale s krátkym limitom — obsah už beží
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                except PlaywrightTimeoutError:
                    pass
                return page
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                last_error = e
                delay = settings.scraper_retry_delay * (attempt + 1)
                logger.warning(f"[{self.source_type}] goto attempt {attempt + 1}/{retries + 1} failed: {e} — čerstvá page, retry o {delay}s")
                # Zatvoríme zaseknutú page a vytvoríme čerstvú (nové spojenie)
                if attempt < retries:
                    try:
                        await page.close()
                    except Exception:
                        pass
                    await asyncio.sleep(delay)
                    page = await self._get_page()
        raise ScraperUnavailableError(f"Register {url} unreachable after {retries + 1} attempts: {last_error}")

    # Zoznam textov indikujúcich prázdny výsledok — zdieľané medzi run() a _extract_findings()
    EMPTY_MARKERS: list[str] = [
        "zoznam neobsahuje žiadne položky",
        "nenašli sa žiadne",
        "žiadny záznam",
        "bez výsledkov",
        "neboli nájdené žiadne",
    ]

    async def _pre_link_click(self, page: Page) -> None:
        """Hook pre subclassy — volá sa pred hľadaním linku na zoznam.
        Defaultne nerobí nič; popup/modal už rieši _dismiss_modal.
        Subclassy môžu prepísať pre špecifickú interakciu pred kliknutím na link."""
        return None

    async def _is_empty_page(self, page: Page) -> bool:
        """Skontroluje či stránka obsahuje text indikujúci prázdny zoznam."""
        try:
            text = (await page.inner_text("body")).lower()
            return any(marker in text for marker in self.EMPTY_MARKERS)
        except Exception:
            return False

    async def _parse_table_rows(self, page: Page, max_rows: int = 5) -> list[list[str]]:
        """Extrahuje riadky z výsledkovej tabuľky. Vráti zoznam riadkov, kde každý riadok je zoznam hodnôt buniek."""
        try:
            rows = page.locator("table tbody tr, .table tbody tr, .datagrid tbody tr")
            count = await rows.count()
            if count == 0:
                return []

            result = []
            for i in range(min(count, max_rows)):
                cells = rows.nth(i).locator("td")
                cell_count = await cells.count()
                row_data = []
                for c in range(cell_count):
                    try:
                        # Krátky timeout — tabuľka sa môže ešte dopĺňať, nečakáme default 30s
                        val = (await cells.nth(c).inner_text(timeout=2000)).strip()
                    except PlaywrightTimeoutError:
                        val = ""
                    if val and val.lower() != "hľadať":
                        row_data.append(val)
                if row_data:
                    result.append(row_data)
            return result
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia riadkov tabuľky zlyhala: {e}")
            return []

    async def _parse_table_with_headers(self, page: Page, max_rows: int = 5, skip_columns: set[str] | None = None) -> list[str]:
        """Extrahuje riadky z tabuľky s hlavičkou. Vráti zoznam formátovaných reťazcov 'Stĺpec: hodnota'.

        Args:
            skip_columns: názvy stĺpcov (lowercase), ktoré sa majú vynechať (napr. redundantné údaje o firme).
        """
        try:
            headers = []
            header_loc = page.locator("table thead tr th, .table thead tr th, table thead tr td")
            header_count = await header_loc.count()
            for h in range(header_count):
                try:
                    headers.append((await header_loc.nth(h).inner_text(timeout=2000)).strip())
                except PlaywrightTimeoutError:
                    headers.append("")

            rows = await self._parse_table_rows(page, max_rows)
            if not rows:
                return []

            skip = skip_columns or set()
            formatted = []
            for row_data in rows:
                if headers and len(headers) >= len(row_data):
                    parts = []
                    for h_idx, val in enumerate(row_data):
                        if val and headers[h_idx].lower() not in skip:
                            parts.append(f"  {headers[h_idx]}: {val}")
                    formatted.append("\n".join(parts))
                else:
                    parts = [f"  • {val}" for val in row_data if val]
                    formatted.append("\n".join(parts))
            return formatted
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia tabuľky s hlavičkou zlyhala: {e}")
            return []

    async def run(self, *, ico: str, output_dir: Path, company_name: Optional[str] = None, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            if self.search_by == "name" and not company_name:
                logger.info(f"[{self.source_type}] Preskakujem — chýba názov subjektu (ORSR ho neposkytol).")
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="Názov subjektu nie je k dispozícii — vyžaduje sa najprv ORSR.",
                )

            if self.search_by == "ico" and not ico:
                logger.info(f"[{self.source_type}] Preskakujem — chýba IČO.")
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="IČO nie je k dispozícii.",
                )

            search_term = ico if self.search_by == "ico" else company_name
            # Pre vyhľadávanie podľa mena — očistíme právnu formu pre fulltext vyhľadávanie
            # (Finančná správa podporuje čiastočnú zhodu, stačí "FERRWOOD" nie "FERRWOOD spol. s r.o.")
            search_query = search_term
            if self.search_by == "name" and company_name:
                # Odstránime právnu formu a "v likvidácii" / "v konkurze" dodatky
                search_query = re.sub(
                    r'\s+(?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.)\.?$',
                    '',
                    company_name,
                    flags=re.IGNORECASE,
                )
                search_query = re.sub(
                    r'\s+(?:v\s+likvidácii|v\s+konkurze|v\s+reštrukturalizácii)$',
                    '',
                    search_query,
                    flags=re.IGNORECASE,
                )
                search_query = search_query.strip().strip('"').strip()
                logger.info(f"[{self.source_type}] Pôvodné meno: '{company_name}' → fulltext query: '{search_query}'")

            logger.info(f"[{self.source_type}] Začínam pre: {search_query} (search_by={self.search_by})")
            _t = time.perf_counter()
            _t0 = _t
            page = await self._get_page()
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            page = await self._safe_goto(page, self.base_url)
            logger.debug(f"[{self.source_type}] ⏱ goto base_url: {time.perf_counter() - _t:.2f}s (URL: {page.url})")
            _t = time.perf_counter()

            # Modal dismissal
            await self._dismiss_modal(page)
            # Pre-link-click hook (napr. klik na button ktorý otvorí popup)
            await self._pre_link_click(page)
            logger.debug(f"[{self.source_type}] ⏱ dismiss_modal + pre_link: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # Navigácia na konkrétny zoznam
            logger.info(f"[{self.source_type}] Hľadám link '{self.zoznam_link_name}'...")
            try:
                link = page.get_by_role("link", name=self.zoznam_link_name).first
                await link.wait_for(timeout=10000)
                await link.click()
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
                logger.info(f"[{self.source_type}] Na stránke zoznamu, URL: {page.url}")
            except PlaywrightTimeoutError:
                # Skúsime partial match — get_by_role robí exact match
                logger.info(f"[{self.source_type}] Exact link match zlyhal, skúšam partial...")
                try:
                    partial_link = page.get_by_role("link", name=self.zoznam_link_name, exact=False).first
                    await partial_link.wait_for(timeout=5000)
                    await partial_link.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=15000)
                    logger.info(f"[{self.source_type}] Na stránke zoznamu (partial match), URL: {page.url}")
                except PlaywrightTimeoutError:
                    logger.info(f"[{self.source_type}] ⏱ link_click (FAILED): {time.perf_counter() - _t:.2f}s")
                    logger.error(f"[{self.source_type}] Link '{self.zoznam_link_name}' sa nenašiel!")
                    await self._debug_screenshot(page, output_dir, ico, "no_link")
                    return self._make_result(
                        status="FAILED",
                        status_message=f"Nepodarilo sa nájsť link '{self.zoznam_link_name}'.",
                    )

            logger.debug(f"[{self.source_type}] ⏱ link_click: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # Debug screenshot
            await self._debug_screenshot(page, output_dir, ico, "after_modal")

            # Vyplniť vyhľadávanie — podľa search_by
            logger.info(f"[{self.source_type}] Hľadám input (search_by={self.search_by})...")
            search_input = await self._find_search_input(page, self.search_by)
            if not search_input:
                logger.error(f"[{self.source_type}] Input sa nenašiel!")
                await self._debug_screenshot(page, output_dir, ico, "no_input", full_page=True)
                html_snippet = await page.inner_text("body")
                logger.error(f"[{self.source_type}] Page text (prvých 500 znakov): {html_snippet[:500]}")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť vyhľadávacie pole na stránke Finančnej správy.",
                )

            logger.info(f"[{self.source_type}] Vyplňujem: {search_query}")
            await search_input.fill(search_query)
            await page.wait_for_timeout(500)

            # Kliknúť na Vyhľadať
            logger.info(f"[{self.source_type}] Hľadám tlačidlo Vyhľadať...")
            search_clicked = await self._click_search(page)
            if not search_clicked:
                logger.error(f"[{self.source_type}] Tlačidlo Vyhľadať sa nenašlo!")
                await self._debug_screenshot(page, output_dir, ico, "no_search", full_page=True)
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Vyhľadať na stránke Finančnej správy.",
                )

            logger.debug(f"[{self.source_type}] ⏱ fill + click_search: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            logger.info(f"[{self.source_type}] Vyhľadávanie spustené, čakám na výsledky...")
            # Smart wait — skončíme hneď ako sa objaví výsledková tabuľka (zvyčajne <1s).
            # Ak sa neobjaví do 3.5s, je to pravdepodobne prázdny výsledok — pokračujeme.
            try:
                await page.wait_for_selector(
                    "table tbody tr, .table tbody tr, .datagrid tbody tr",
                    timeout=3500,
                )
            except PlaywrightTimeoutError:
                pass
            await self._debug_screenshot(page, output_dir, ico, "results")
            logger.debug(f"[{self.source_type}] ⏱ wait_results: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # Skontrolujeme či sú vôbec nejaké výsledky
            is_empty = await self._is_empty_page(page)

            if is_empty:
                logger.info(f"[{self.source_type}] Zoznam je prázdny — subjekt nie je v registri.")
                await self._debug_screenshot(page, output_dir, ico, "empty_results")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Subjekt nie je v zozname ({self.source_type}).",
                    findings=self._empty_findings(),
                    company_name=company_name,
                )

            # Extrahovať findings
            findings = await self._extract_findings(page, search_query)
            if findings:
                # Pre scrapery hľadajúce podľa IČO — overíme, že IČO je skutočne v náleze
                # (zabraňuje false positives keď tabuľka obsahuje dáta z iného vyhľadávania)
                if self.search_by == "ico" and "POZOR" in findings and ico and ico not in findings:
                    logger.warning(f"[{self.source_type}] Tabuľka nájdená, ale IČO {ico} nie je v náleze — pravdepodobne false positive.")
                    findings = self._empty_findings()
                logger.info(f"[{self.source_type}] Findings: {findings[:200]}")
            else:
                logger.info(f"[{self.source_type}] Findings: nepodarilo sa extrahovať, pokračujem s PDF.")
                findings = None

            # Extrahovať IČ DPH (ak scraper podporuje)
            ic_dph = None
            if hasattr(self, '_extract_ic_dph'):
                ic_dph = await self._extract_ic_dph(page)
                if ic_dph:
                    logger.info(f"[{self.source_type}] IČ DPH extrahované: {ic_dph}")

            # Ak sú výsledky, skúsime PDF export
            pdf_output = output_dir / f"{self.file_prefix}_{ico}.pdf"
            downloaded = await self._download_pdf(page, pdf_output)
            logger.debug(f"[{self.source_type}] ⏱ download_pdf: {time.perf_counter() - _t:.2f}s | CELKOM: {time.perf_counter() - _t0:.2f}s")

            if downloaded:
                logger.info(f"[{self.source_type}] PDF úspešne stiahnuté: {pdf_output}")
                self._prepend_title_page(pdf_output, self.pdf_title or self.zoznam_link_name)
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Výpis z {self.source_type} úspešne stiahnutý.",
                    findings=findings or f"Výpis úspešne stiahnutý z {self.source_type}.",
                    company_name=company_name,
                    ic_dph=ic_dph,
                )
            else:
                # PDF sa nepodarilo — ak sú findings, stále SUCCESS bez PDF
                if findings and "žiadny záznam" not in (findings or "").lower():
                    logger.info(f"[{self.source_type}] PDF export zlyhal, ale findings extrahované.")
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message="Výsledky nájdené, ale PDF export zlyhal.",
                        findings=findings,
                        company_name=company_name,
                        ic_dph=ic_dph,
                    )
                else:
                    # Negatívny scenár — nič nenašlo, PDF nie je dostupné
                    logger.info(f"[{self.source_type}] Žiadne výsledky — PDF export nie je dostupný.")
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message=findings or "Žiadny záznam v registri.",
                        findings=findings,
                        company_name=company_name,
                        ic_dph=ic_dph,
                    )

        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupné: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register {self.source_type} je nedostupný: {e}",
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

    # ── Zdieľané helper metódy ──────────────────────────────────────────

    async def _debug_screenshot(self, page: Page, output_dir: Path, ico: str, label: str, full_page: bool = False) -> None:
        """Uloží debug screenshot do results/<id>/debug/ — len ak je zapnuté debug_screenshots."""
        if not settings.debug_screenshots:
            return
        try:
            debug_dir = output_dir / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            path = str(debug_dir / f"{self.file_prefix}_{ico}_{label}.png")
            await page.screenshot(path=path, full_page=full_page)
            logger.info(f"[{self.source_type}] Screenshot: debug/{self.file_prefix}_{ico}_{label}.png")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Screenshot zlyhal: {e}")

    async def _dismiss_modal(self, page: Page) -> None:
        """Zavrie modálny dialog — klikne na 'www.info-efaktura.sk' button."""
        try:
            efaktura_btn = page.get_by_role("button", name="www.info-efaktura.sk")
            await efaktura_btn.wait_for(timeout=5000)
            async with page.context.expect_page(timeout=5000) as popup_info:
                await efaktura_btn.click()
            popup = await popup_info.value
            logger.info(f"[{self.source_type}] Modal zatvorený, popup otvorený — zatváram ho.")
            await popup.close()
            logger.info(f"[{self.source_type}] Popup zatvorený, pokračujem na hlavnej stránke.")
        except PlaywrightTimeoutError:
            logger.info(f"[{self.source_type}] 'www.info-efaktura.sk' button sa nenašiel, skúšam 'Rozumiem'...")
            try:
                rozumiem_btn = page.get_by_role("button", name="Rozumiem")
                await rozumiem_btn.wait_for(timeout=3000)
                await rozumiem_btn.click()
                logger.info(f"[{self.source_type}] Modálny dialog — kliknuté 'Rozumiem'.")
                await page.wait_for_timeout(1000)
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Žiadny modal sa nenašiel, pokračujem.")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Modal handling chyba: {e}")

    async def _find_search_input(self, page: Page, search_by: str = "name"):
        """Nájde input pre vyhľadávanie — podľa search_by (ico/name). Skúša aj iframes."""
        if search_by == "ico":
            selectors = [
                ('role-ico', page.get_by_role("textbox", name="IČO")),
                ('placeholder-ico', page.locator('input[placeholder*="IČO"]')),
                ('placeholder-ico-lower', page.locator('input[placeholder*="ičo"]')),
                ('id-ico', page.locator('#txtICO')),
                ('name-ico', page.locator('input[name*="ico" i]')),
                ('label-ico', page.locator('input[aria-label*="IČO" i]')),
                ('label-ico2', page.locator('input[title*="IČO" i]')),
                ('any-text-first', page.locator('input[type="text"]').first),
            ]
        else:
            selectors = [
                ('role', page.get_by_role("textbox", name="Názov subjektu")),
                ('placeholder', page.locator('input[placeholder*="Názov subjektu"]')),
                ('placeholder-lower', page.locator('input[placeholder*="názov"]')),
                ('id', page.locator('#txtNazovSubjektu')),
                ('css', page.locator('input[type="text"]').first),
            ]

        # Skúsime najprv na hlavnej stránke
        for name, locator in selectors:
            try:
                if await locator.count() > 0:
                    logger.info(f"[{self.source_type}] Input nájdený cez selector: {name}")
                    await locator.first.wait_for(timeout=5000)
                    return locator.first
            except Exception:
                continue

        # Skúsime v iframe-och
        try:
            frames = page.frames
            for frame in frames:
                if frame == page.main_frame:
                    continue
                for name, selector in [
                    ('iframe-role-ico', frame.get_by_role("textbox", name="IČO")),
                    ('iframe-placeholder-ico', frame.locator('input[placeholder*="IČO"]')),
                    ('iframe-name-ico', frame.locator('input[name*="ico" i]')),
                    ('iframe-any-text', frame.locator('input[type="text"]').first),
                ]:
                    try:
                        if await selector.count() > 0:
                            logger.info(f"[{self.source_type}] Input nájdený v iframe: {name}")
                            await selector.first.wait_for(timeout=5000)
                            return selector.first
                    except Exception:
                        continue
        except Exception as e:
            logger.warning(f"[{self.source_type}] Iframe search zlyhal: {e}")

        return None

    async def _click_search(self, page: Page) -> bool:
        """Klikne na tlačidlo Vyhľadať — skúša viacero selectorov."""
        selectors = [
            ('role', page.get_by_role("button", name="Vyhľadať")),
            ('text', page.get_by_text("Vyhľadať", exact=True)),
            ('css-btn', page.locator('button:has-text("Vyhľadať")')),
            ('css-input', page.locator('input[value="Vyhľadať"]')),
            ('css-a', page.locator('a:has-text("Vyhľadať")')),
        ]
        for name, locator in selectors:
            try:
                if await locator.count() > 0:
                    logger.info(f"[{self.source_type}] Vyhľadať tlačidlo nájdené cez selector: {name}")
                    await locator.first.click()
                    return True
            except Exception:
                continue
        return False

    async def _download_pdf(self, page: Page, output_path: Path) -> bool:
        """Klikne na 'Export do PDF' a uloží stiahnutý súbor. Podporuje popup + download + PDF print fallback."""
        try:
            export_locators = [
                page.get_by_role("link", name="Export do PDF"),
                page.locator('a:has-text("Export do PDF")'),
                page.locator('a:has-text("PDF")'),
                page.locator('button:has-text("PDF")'),
            ]
            export_link = None
            for loc in export_locators:
                if await loc.count() > 0:
                    export_link = loc.first
                    logger.info(f"[{self.source_type}] PDF export link nájdený")
                    break
            if not export_link:
                logger.warning(f"[{self.source_type}] PDF export link sa nenašiel")
                return False
            await export_link.wait_for(timeout=10000)

            # Stratégia 1: popup + download (podľa recording skriptu)
            try:
                async with page.expect_download(timeout=30000) as download_info:
                    async with page.context.expect_page(timeout=10000) as popup_info:
                        await export_link.click()
                    popup = await popup_info.value
                    logger.info(f"[{self.source_type}] PDF popup otvorený — čakám na download.")
                # Download zachytený — až teraz zatvoríme popup
                download = await download_info.value
                await download.save_as(str(output_path))
                try:
                    await popup.close()
                except Exception:
                    pass
                logger.info(f"[{self.source_type}] PDF uložené (download), popup zatvorený.")
                return True
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Download timeout, skúšam PDF print z popupu...")
            except Exception as e:
                logger.info(f"[{self.source_type}] Download zlyhal ({e}), skúšam PDF print z popupu...")

            # Stratégia 2: popup sa otvoril s PDF viewerom — uložíme ako PDF
            try:
                popup = page.context.pages[-1] if len(page.context.pages) > 1 else None
                if popup and popup != page:
                    await popup.wait_for_load_state("domcontentloaded", timeout=10000)
                    await popup.pdf(path=str(output_path))
                    await popup.close()
                    logger.info(f"[{self.source_type}] PDF uložené (print z popupu).")
                    return True
            except Exception as e:
                logger.warning(f"[{self.source_type}] PDF print z popupu zlyhal: {e}")

            # Stratégia 3: priamy download bez popupu
            try:
                async with page.expect_download(timeout=15000) as download_info:
                    await export_link.click()
                download = await download_info.value
                await download.save_as(str(output_path))
                logger.info(f"[{self.source_type}] PDF uložené (priamy download).")
                return True
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Timeout pri priamom PDF download.")
                return False
        except PlaywrightTimeoutError:
            logger.warning(f"[{self.source_type}] Timeout pri čakaní na PDF download.")
            return False
        except Exception as e:
            logger.warning(f"[{self.source_type}] PDF download zlyhal: {e}")
            return False

    async def _extract_findings(self, page: Page, search_term: str) -> Optional[str]:
        """Override v subclassi pre špecifickú extrakciu nálezov."""
        return None

    def _empty_findings(self) -> str:
        """Override v subclassi pre špecifický text prázdneho zoznamu."""
        return "Žiadny záznam — subjekt nie je v zozname."

    def _prepend_title_page(self, pdf_path: Path, title: str) -> None:
        """Pridá nadpis do hornej časti prvej stránky PDF (overlay, nie samostatná stránka)."""
        if not _PDF_TITLE_AVAILABLE:
            logger.warning(f"[{self.source_type}] PyPDF2/ReportLab nedostupné — preskakujem nadpis.")
            return
        try:
            global _FONT_REGISTERED
            if not _FONT_REGISTERED:
                fonts_dir = Path(__file__).parent.parent / "pdf" / "fonts"
                pdfmetrics.registerFont(TTFont("Inter", str(fonts_dir / "Inter-Regular.ttf")))
                pdfmetrics.registerFont(TTFont("Inter-Bold", str(fonts_dir / "Inter-Bold.ttf")))
                _FONT_REGISTERED = True

            reader = PdfReader(str(pdf_path))
            first_page = reader.pages[0]
            page_w = float(first_page.mediabox.width)
            page_h = float(first_page.mediabox.height)

            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
            c.setFont("Inter-Bold", 13)
            c.drawCentredString(page_w / 2, page_h - 25, title)
            c.showPage()
            c.save()
            buf.seek(0)

            overlay_reader = PdfReader(buf)
            first_page.merge_page(overlay_reader.pages[0])

            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            with open(pdf_path, "wb") as f:
                writer.write(f)
            logger.info(f"[{self.source_type}] Nadpis pridaný do PDF: {pdf_path}")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Pridanie nadpisu zlyhalo: {e}")

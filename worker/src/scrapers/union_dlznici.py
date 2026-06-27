from __future__ import annotations
import logging
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class UnionDlzniciScraper(BaseScraper):
    """
    Scraper pre UNION zdravotnú poisťovňu — Zoznam dlžníkov na zdravotnom poistení.
    Vyhľadáva podľa IČO. Stránka nemá PDF export — generuje PDF cez print-to-PDF.
    """

    source_type = "UNION_DLZNICI"
    base_url = "https://portal.unionzp.sk/pub/dlznici"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=45000, wait_until='domcontentloaded')
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"UNION nedostupná: {e}")

            # Vyplniť IČO do textového poľa
            try:
                textbox = page.get_by_role("textbox", name="Zadajte priezvisko, IČO,")
                await textbox.wait_for(timeout=10000)
                await textbox.click()
                await textbox.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Textové pole sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť textové pole na stránke UNION.",
                )

            # Kliknúť "Hľadať"
            try:
                search_btn = page.get_by_role("button", name="Hľadať")
                await search_btn.wait_for(timeout=10000)
                await search_btn.click()
                logger.info(f"[{self.source_type}] Tlačidlo Hľadať kliknuté.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo Hľadať sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Hľadať na stránke UNION.",
                )

            # Počkať na výsledky — čakáme na tabuľku alebo text o prázdnych výsledkoch
            empty_locator = page.locator("text=Nenašli sa žiadne záznamy")
            table_locator = page.locator("table tbody tr, .table tbody tr, .result-table tr")
            try:
                await empty_locator.or_(table_locator).first.wait_for(timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem.")

            # Skontrolovať výsledky
            body_text = await page.inner_text("body")

            # UNION zobrazuje "Nenašli sa žiadne záznamy" alebo podobné keď nie sú výsledky
            empty_markers = [
                "nenašli sa žiadne",
                "žiadne výsledky",
                "bez výsledkov",
                "neboli nájdené žiadne",
            ]
            is_empty = any(marker in body_text.lower() for marker in empty_markers)

            # Najprv skúsime extrahovať nálezy z tabuľky — to je spoľahlivé
            # (na rozdiel od kontroly "ico in body_text" ktorá môže matchnúť
            # IČO v hlavičke/footri/JS kóde stránky)
            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_table_findings(page, ico, source_name="UNION")
                # _extract_table_findings vracia POZOR len ak našla riadky v tabuľke
                is_debtor = findings is not None and "POZOR" in findings
                # Dodatočná kontrola: IČO by malo byť v extrahovaných nálezoch
                if is_debtor and ico not in findings:
                    logger.warning(f"[{self.source_type}] Tabuľka nájdená, ale IČO {ico} nie je v náleze — pravdepodobne false positive.")
                    is_debtor = False
                    findings = None

            # Ak subjekt nie je dlžník, rovno vygenerujeme 'No results' PDF a returneme
            pdf_output = output_dir / f"union_dlznici_{ico}.pdf"
            if not is_debtor or findings is None:
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov UNION.")
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov UNION."
                try:
                    await self._generate_no_results_pdf(
                        page, pdf_output, ico,
                        title="Zoznam dlžníkov UNION",
                        message=f"Pre IČO {ico} sa v Zozname dlžníkov UNION nenašli žiadne nedoplatky.",
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo generovanie no-results PDF: {e}")
                    return self._make_result(status="FAILED", status_message=f"Chyba pri PDF: {e}")

                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov UNION.",
                    findings=findings,
                )

            # Inak sme našli subjekt v tabuľke (is_debtor = True).
            # Pred tlačením PDF schováme riadky, ktoré neobsahujú naše IČO (pre istotu)
            try:
                await page.evaluate("""(ico) => {
                    const rows = document.querySelectorAll('table tbody tr, .table tbody tr, .result-table tr');
                    for (const row of rows) {
                        if (!row.innerText.includes(ico)) {
                            row.style.display = 'none';
                        }
                    }
                }""", ico)
            except Exception as e:
                logger.warning(f"[{self.source_type}] DOM filter riadkov zlyhal: {e}")

            # Generovať PDF z vyfiltrovanej výsledkovej stránky
            try:
                await self._generate_clean_pdf(
                    page, pdf_output,
                    title="Zoznam dlžníkov UNION",
                    content_selector="table, .table, .result-table",
                )
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF: {e}",
                )

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Subjekt {ico} je v zozname dlžníkov UNION.",
                findings=findings,
            )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register UNION je nedostupný")

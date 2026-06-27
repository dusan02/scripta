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

_BASE_URL = "https://rpo.statistics.sk/new/"

_NO_RESULTS_MARKERS = [
    "nenašli sa žiadne",
    "žiadne výsledky",
    "bez výsledkov",
    "neboli nájdené žiadne",
    "zadaným kritériám nezodpovedajú",
]


class RpoScraper(BaseScraper):
    """
    Scraper pre Register právnických osôb, podnikateľov a orgánov verejnej moci (rpo.statistics.sk).
    Vyhľadáva podľa IČO (do poľa "Identifikátor"), ale záznam sa nedá rozkliknúť podľa IČO —
    iba podľa názvu subjektu. Názov sa získava z ORSR (company_name).

    Po kliknutí na záznam sa zobrazí detail s rozbaľovacími sekciami ("Počet položiek: N" + "+").
    Scraper klikne na všetky "+" tlačidlá, overí že žiadne nie je nezbalené, a potom vygeneruje PDF.
    """

    source_type = "RPO"

    async def run(
        self,
        *,
        ico: str,
        output_dir: Path,
        company_name: Optional[str] = None,
        **kwargs,
    ) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            if not company_name:
                logger.info(f"[{self.source_type}] Preskakujem — chýba názov subjektu (ORSR ho neposkytol).")
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="Názov subjektu nie je k dispozícii — vyžaduje sa najprv ORSR.",
                )

            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico}, názov: {company_name}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=True)

            # 1. Navigovať na stránku
            logger.info(f"[{self.source_type}] Navigujem na {_BASE_URL}")
            try:
                await page.goto(_BASE_URL, timeout=30000, wait_until="domcontentloaded")
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"RPO nedostupné: {e}")

            # 2. Vyplniť IČO do poľa "Identifikátor"
            try:
                textbox = page.get_by_role("textbox", name="Identifikátor")
                await textbox.wait_for(timeout=10000)
                await textbox.click()
                await textbox.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole 'Identifikátor' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť pole 'Identifikátor' na stránke RPO.",
                )

            # 3. Kliknúť "Vyhľadať"
            try:
                search_btn = page.get_by_role("button", name="Vyhľadať")
                await search_btn.wait_for(timeout=10000)
                await search_btn.click()
                logger.info(f"[{self.source_type}] Tlačidlo Vyhľadať kliknuté.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo Vyhľadať sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Vyhľadať na stránke RPO.",
                )

            # 4. Počkať na výsledky — RPO je React SPA, potrebné počkať na render
            # Skúsime počkať na tabuľku výsledkov alebo text o prázdnych výsledkoch
            result_link = page.locator("td.idsk-table__cell a.govuk-link")
            empty_locator = page.locator("text=Nenašli sa žiadne")
            try:
                await result_link.or_(empty_locator).first.wait_for(timeout=20000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem.")
            await page.wait_for_timeout(500)

            # 5. Skontrolovať prázdne výsledky
            body_text = await page.inner_text("body")
            lowered = body_text.lower()
            is_empty = any(marker in lowered for marker in _NO_RESULTS_MARKERS)

            if is_empty:
                logger.info(f"[{self.source_type}] Žiadne výsledky pre IČO {ico}.")
                pdf_output = output_dir / f"rpo_{ico}.pdf"
                await self._generate_pdf(page, pdf_output, ico, company_name)
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v Registri právnických osôb.",
                    findings="Žiadny záznam — subjekt nie je v Registri právnických osôb.",
                    company_name=company_name,
                )

            # 6. Kliknúť na prvý výsledok — IČO je jednoznačné, takže prvý link je správny
            # CSS selektor: td.idsk-table__cell a.govuk-link
            link_clicked = False
            try:
                result_links = page.locator("td.idsk-table__cell a.govuk-link")
                count = await result_links.count()
                if count > 0:
                    await result_links.first.click()
                    link_clicked = True
                    logger.info(f"[{self.source_type}] Kliknuté na prvý výsledok (z {count}).")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Kliknutie na výsledok zlyhalo.")

            if not link_clicked:
                # Fallback: skúsiť akýkoľvek link v tabuľke
                try:
                    any_link = page.locator("table tbody tr td a")
                    count = await any_link.count()
                    if count > 0:
                        await any_link.first.click()
                        link_clicked = True
                        logger.info(f"[{self.source_type}] Kliknuté na prvý link v tabuľke (fallback).")
                except PlaywrightTimeoutError:
                    pass

            if not link_clicked:
                logger.warning(f"[{self.source_type}] Nepodarilo sa kliknúť na záznam.")
                pdf_output = output_dir / f"rpo_{ico}.pdf"
                await self._generate_pdf(page, pdf_output, ico, company_name)
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Záznam pre {ico} nájdený, ale nepodarilo sa otvoriť detail.",
                    findings=f"Subjekt (IČO: {ico}) nájdený v zozname, ale detail sa nepodarilo otvoriť.",
                    company_name=company_name,
                )

            # 7. Počkať na načítanie detailu — RPO SPA zmení URL na /organization/{id}/withHistory
            try:
                await page.wait_for_url("**/organization/**", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] URL sa nezmenila na detail, pokračujem.")

            # Počkať na networkidle — React SPA potrebuje čas na render detailu
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] networkidle timeout, pokračujem.")
            await page.wait_for_timeout(2000)

            # 8. Rozbaliť všetky "+" sekcie
            # Počkať na rozbaľovacie tlačidlá
            try:
                await page.locator("button.mc-expandable-list-item__header-items-count").first.wait_for(timeout=10000)
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Žiadne rozbaľovacie tlačidlá — možno detail bez sekcií.")

            await self._expand_all_sections(page)

            # Počkať na networkidle po rozbalení — dynamický obsah sa naťahuje
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(1000)

            # 9. Extrahovať findings z detailu
            findings = await self._extract_findings(page, ico, company_name)

            # 10. Vygenerovať PDF
            pdf_output = output_dir / f"rpo_{ico}.pdf"
            pdf_ok = await self._generate_pdf(page, pdf_output, ico, company_name)

            if not pdf_ok or not pdf_output.exists():
                logger.error(f"[{self.source_type}] PDF sa nepodarilo vygenerovať — vraciam bez prílohy.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    page_count=0,
                    status_message=f"Výpis z RPO pre {ico} — findings extrahované, ale PDF sa nepodarilo vygenerovať.",
                    findings=findings,
                    company_name=company_name,
                )

            logger.info(f"[{self.source_type}] Hotovo za {time.perf_counter() - _t:.1f}s")
            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Výpis z Registra právnických osôb pre {ico}.",
                findings=findings,
                company_name=company_name,
            )

        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupné: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register právnických osôb je nedostupný: {e}",
            )
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Sieťová chyba pri spracovaní RPO: {e}",
            )
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Neznáma chyba pri spracovaní RPO: {type(e).__name__}: {e}",
            )
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _expand_all_sections(self, page: Page) -> None:
        """Klikne na všetky rozbaľovacie tlačidlá v detaile subjektu.
        Tlačidlá majú CSS triedu 'mc-expandable-list-item__header-items-count'.
        Nerazbalené tlačidlá majú aria-expanded='false' a SVG ikonu data-icon='plus'.
        Rozbalené majú aria-expanded='true' a data-icon='minus'.
        Zastaví sa keď nezostane žiadne s aria-expanded='false'."""
        max_rounds = 15
        for round_num in range(max_rounds):
            all_buttons = page.locator("button.mc-expandable-list-item__header-items-count")
            total = await all_buttons.count()

            if total == 0:
                logger.info(f"[{self.source_type}] Žiadne rozbaľovacie tlačidlá — detail bez sekcií.")
                return

            # Nerazbalené: aria-expanded="false"
            collapsed = page.locator("button.mc-expandable-list-item__header-items-count[aria-expanded='false']")
            expanded = page.locator("button.mc-expandable-list-item__header-items-count[aria-expanded='true']")

            collapsed_count = await collapsed.count()
            expanded_count = await expanded.count()

            logger.info(f"[{self.source_type}] Round {round_num}: {total} tlačidiel, nerozbalených: {collapsed_count}, rozbalených: {expanded_count}")

            if collapsed_count == 0:
                logger.info(f"[{self.source_type}] Všetky sekcie rozbalené ({expanded_count} rozbalených).")
                return

            # Kliknúť len na nerozbalené tlačidlá
            clicked = 0
            for i in range(collapsed_count):
                try:
                    btn = collapsed.nth(i)
                    if await btn.is_visible():
                        await btn.click(timeout=5000)
                        clicked += 1
                        await page.wait_for_timeout(300)
                except PlaywrightTimeoutError:
                    continue
                except Exception:
                    continue

            if clicked == 0:
                logger.info(f"[{self.source_type}] Žiadne viditeľné nerozbalené tlačidlo (round {round_num}).")
                return

            await page.wait_for_timeout(500)

        logger.warning(f"[{self.source_type}] Dosiahnutý maximálny počet kôl rozbalovania ({max_rounds}).")

    async def _extract_findings(self, page: Page, ico: str, company_name: str) -> str:
        """Extrahuje kľúčové findings z detailu subjektu v RPO pomocou DOM extrakcie."""
        try:
            body_text = await page.inner_text("body")

            if ico not in body_text:
                logger.warning(f"[{self.source_type}] IČO {ico} nie je v detaile — možno nesprávny záznam.")
                return f"Subjekt (IČO: {ico}) — záznam v Registri právnických osôb (detail v PDF)."

            # Extrahovať dáta priamo z DOMu — RPO používa dl > div > dt (label) + dd (value)
            data = await page.evaluate("""() => {
                const result = {};
                const dts = document.querySelectorAll('dt');
                for (const dt of dts) {
                    const label = dt.innerText.trim();
                    // Nájdeme nasledujúci dd v rovnakom parent div
                    const parent = dt.parentElement;
                    const dd = parent ? parent.querySelector('dd') : null;
                    if (dd) {
                        // Odstrániť text tlačidiel a "Platnosť od" z hodnoty
                        let val = dd.innerText.trim();
                        val = val.replace(/Počet položiek:\\s*\\d+/g, '').trim();
                        // Vziať prvý riadok (bez historických platností)
                        val = val.split('\\n')[0].trim();
                        if (val && label) {
                            result[label] = val.replace(/\s+/g, ' ');
                        }
                    }
                }
                return result;
            }""")

            lines = []
            lines.append(f"Subjekt (IČO: {ico}) je v Registri právnických osôb, podnikateľov a orgánov verejnej moci.")

            if data.get("Názov"):
                lines.append(f"Názov: {data['Názov']}")

            if data.get("Právny stav"):
                stav = data["Právny stav"]
                lines.append(f"Právny stav: {stav}")
                if "likvid" in stav.lower():
                    lines.append("POZOR: Subjekt je v likvidácii!")

            if data.get("Adresa sídla"):
                lines.append(f"Adresa sídla: {data['Adresa sídla']}")

            if data.get("Právna forma"):
                lines.append(f"Právna forma: {data['Právna forma']}")

            if data.get("Dátum vzniku"):
                lines.append(f"Dátum vzniku: {data['Dátum vzniku']}")

            if data.get("Štatutárny orgán"):
                lines.append(f"Štatutárny orgán: {data['Štatutárny orgán']}")

            if data.get("Základné imanie"):
                lines.append(f"Základné imanie: {data['Základné imanie']}")

            if data.get("Hlavná ekonomická činnosť"):
                lines.append(f"Hlavná ekonomická činnosť (NACE): {data['Hlavná ekonomická činnosť']}")

            if data.get("Registrový úrad"):
                lines.append(f"Registrový úrad: {data['Registrový úrad']}")

            findings = "\n".join(lines)
            logger.info(f"[{self.source_type}] Findings: {findings[:300]}")
            return findings

        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return f"Subjekt (IČO: {ico}) — záznam v Registri právnických osôb (detail v PDF)."

    async def _generate_pdf(self, page: Page, output_path: Path, ico: str, company_name: str) -> bool:
        """Vygeneruje PDF z aktuálnej stránky — print-to-PDF s nadpisom.
        Vráti True ak sa podarilo, False ak zlyhalo."""
        try:
            await page.set_viewport_size({"width": 1920, "height": 1080})

            # Počkať na stabilizáciu DOMu (React SPA môže re-renderovať)
            await page.wait_for_timeout(500)

            # Odstrániť navigáciu/header/footer pre čisté PDF
            await page.evaluate("""(title) => {
                document.querySelectorAll('header, footer, nav, .header, .footer, .navigation, .menu, .cookie-bar, .breadcrumb, .sidebar, #header, #footer, [class*="cookie"], [class*="banner"]').forEach(el => el.remove());
                const h1 = document.createElement('h1');
                h1.textContent = 'Register právnických osôb — ' + title;
                h1.style.cssText = 'font-size: 20px; font-weight: 700; margin: 0 0 10px 0; padding: 0; text-align: center;';
                document.body.insertBefore(h1, document.body.firstChild);
                document.body.style.margin = '0';
                document.body.style.padding = '10px';
            }""", f"{company_name} (IČO: {ico})")

            # Donútiť obsah zmestiť sa do A4 šírky — štátne weby majú často min-width v pixeloch
            await page.evaluate("document.body.style.width = '1000px'")

            await page.add_style_tag(content="""
                @page { size: A4; margin: 1cm; }
                body { width: 100% !important; margin: 0 !important; padding: 0 !important; font-size: 12px !important; }
                .mc-expandable-list-item { width: 100% !important; }
                header, footer, nav, .idsk-header, .idsk-footer { display: none !important; }
                table { width: 100% !important; font-size: 11px !important; border-collapse: collapse !important; }
                th { background: #f3f4f6 !important; font-weight: 600 !important; }
                td, th { padding: 4px 8px !important; word-break: break-word !important; white-space: normal !important; }
            """)

            await page.wait_for_timeout(300)

            await page.pdf(
                path=str(output_path),
                format="A4",
                print_background=True,
                scale=0.8,
                margin={"top": "1cm", "bottom": "1cm", "left": "1cm", "right": "1cm"},
            )

            if output_path.exists() and output_path.stat().st_size > 0:
                logger.info(f"[{self.source_type}] PDF vygenerované: {output_path} ({output_path.stat().st_size} bytes)")
                return True
            else:
                logger.error(f"[{self.source_type}] PDF súbor je prázdny alebo neexistuje: {output_path}")
                return False

        except Exception as e:
            logger.error(f"[{self.source_type}] PDF generovanie zlyhalo: {e}", exc_info=True)
            return False

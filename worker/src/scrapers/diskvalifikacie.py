from __future__ import annotations

import logging
import time
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource, PersonInfo, strip_titles, ZIP_RE

logger = logging.getLogger(__name__)

_BASE_URL = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/"
_SEARCH_URL = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10"

_NO_RESULTS_MARKERS = [
    "žiadne výsledky",
    "neboli nájdené žiadne",
    "zadaným kritériám nezodpovedajú",
    "nenašli sa žiadne záznamy",
]


def _fuzzy_ratio(a: str, b: str) -> float:
    """Fuzzy match ratio medzi dvoma reťazcami (0.0 – 1.0)."""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


class DiskvalifikacieScraper(BaseScraper):
    """Scraper pre Register diskvalifikácií (justice.gov.sk).
    Závisí na ORSR — potrebuje zoznam osôb (štatutárov a spoločníkov).
    Pre každú osobu vyhľadá v registri, porovná meno a adresu.
    """

    source_type = "DISKVALIFIKACIE"

    async def run(self, *, ico: str, output_dir: Path, persons: Optional[list[PersonInfo]] = None, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            if not persons:
                logger.info(f"[{self.source_type}] Žiadne osoby z ORSR — preskakujem.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message="Žiadne osoby na kontrolu (ORSR neposkytol osoby).",
                    findings="Neboli k dispozícii žiadne osoby z ORSR na porovnanie s registrom diskvalifikácií.",
                )

            logger.info(f"[{self.source_type}] Začínam pre {len(persons)} osôb (IČO: {ico})")
            _t = time.perf_counter()
            page = await self._get_page(block_images=True)

            results: list[dict] = []
            for person in persons:
                clean_name = person.clean_name or strip_titles(person.raw_name)
                if not clean_name or len(clean_name.split()) < 2:
                    logger.warning(f"[{self.source_type}] Preskakujem osobu s neplatným menom: {person.raw_name}")
                    continue

                logger.info(f"[{self.source_type}] Hľadám: {clean_name} ({person.role})")
                result = await self._check_person(page, clean_name, person)
                results.append(result)

            # Generovanie PDF so zhrnutím
            pdf_output = output_dir / f"diskvalifikacie_{ico}.pdf"
            await self._generate_summary_pdf(page, pdf_output, ico, results)

            findings = self._build_findings(results)
            has_red_flag = any(r["status"] == "red_flag" for r in results)
            has_warning = any(r["status"] == "warning" for r in results)

            if has_red_flag:
                status_message = f"POZOR! Nájdená diskvalifikovaná osoba pre IČO {ico}!"
            elif has_warning:
                status_message = f"Upozornenie: Zhoda mena, ale adresa sa nezhoduje — potrebné manuálne overenie."
            else:
                status_message = f"Žiadne diskvalifikácie nájdené pre {len(persons)} osôb."

            logger.info(f"[{self.source_type}] Hotovo za {time.perf_counter() - _t:.1f}s")
            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=status_message,
                findings=findings,
            )

        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupný: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"Register diskvalifikácií je nedostupný: {e}")
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Interná chyba scrapera: {str(e)}")
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _check_person(self, page: Page, clean_name: str, person: PersonInfo) -> dict:
        """Vyhľadá osobu v registri diskvalifikácií a porovná adresu."""
        result = {
            "name": clean_name,
            "role": person.role,
            "orsr_city": person.city,
            "orsr_zip": person.zip_code,
            "status": "clean",
            "detail_url": None,
            "match_city": None,
            "match_zip": None,
            "match_ratio": 0.0,
        }

        try:
            # Navigácia na search stránku
            await self._safe_goto(page, _SEARCH_URL)

            # Vyčistenie a vyplnenie search boxu
            search_input = page.get_by_role("textbox", name="Vyhľadajte podľa mena alebo")
            try:
                await search_input.wait_for(state="visible", timeout=10000)
                await search_input.click()
                await search_input.fill(clean_name)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Search box nenájdený, skúšam CSS selector.")
                search_input = page.locator("input[type='text'], input[placeholder*='mena']").first
                await search_input.fill(clean_name)

            # Kliknúť Search tlačidlo
            search_btn = page.get_by_role("button", name="Search")
            try:
                await search_btn.wait_for(state="visible", timeout=5000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Search tlačidlo nenájdené, skúšam CSS.")
                await page.locator("button:has-text('Search'), button[type='submit']").first.click()

            # Čakať na výsledky
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(1500)

            body_text = await page.inner_text("body")
            lowered = body_text.lower()

            # Skontrolovať či nie sú výsledky
            if any(marker in lowered for marker in _NO_RESULTS_MARKERS):
                logger.info(f"[{self.source_type}] Žiadne výsledky pre: {clean_name}")
                return result

            # Hľadať odkazy s menom osoby
            result_links = page.get_by_role("link", name=clean_name)
            link_count = await result_links.count()

            if link_count == 0:
                # Skúsiť prehodené poradie mena (Kurucz Peter namiesto Peter Kurucz)
                name_parts = clean_name.split()
                if len(name_parts) >= 2:
                    reversed_name = " ".join([name_parts[-1]] + name_parts[:-1])
                    result_links = page.get_by_role("link", name=reversed_name)
                    link_count = await result_links.count()
                    if link_count > 0:
                        logger.info(f"[{self.source_type}] Nájdené s prehodeným menom: {reversed_name}")

            if link_count == 0:
                # Skúsiť čiastočnú zhodu — hľadať odkazy ktoré obsahujú priezvisko
                surname = clean_name.split()[-1] if len(clean_name.split()) > 1 else clean_name
                all_links = page.locator(f"a:has-text('{surname}')")
                link_count = await all_links.count()
                if link_count == 0:
                    logger.info(f"[{self.source_type}] Žiadne výsledky pre: {clean_name}")
                    return result
                result_links = all_links

            # Prejsť všetky nájdené odkazy a porovnať adresu
            for i in range(min(link_count, 5)):
                link = result_links.nth(i)
                link_text = (await link.inner_text()).strip()

                # Fuzzy match na meno
                name_ratio = _fuzzy_ratio(clean_name, link_text)
                if name_ratio < 0.80:
                    logger.debug(f"[{self.source_type}] Zhoda mena príliš nízka: {link_text} vs {clean_name} ({name_ratio:.2f})")
                    continue

                logger.info(f"[{self.source_type}] Zhoda mena: {link_text} (ratio: {name_ratio:.2f})")

                # Kliknúť na detail
                await link.click()
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                except PlaywrightTimeoutError:
                    pass
                await page.wait_for_timeout(1000)

                detail_url = page.url
                detail_text = await page.inner_text("body")

                # Extrahovať adresu z detailu
                match_city, match_zip = self._extract_address_from_detail(detail_text)

                result["detail_url"] = detail_url
                result["match_city"] = match_city
                result["match_zip"] = match_zip

                # Porovnanie adresy
                city_match = False
                zip_match = False

                if person.city and match_city:
                    city_ratio = _fuzzy_ratio(person.city, match_city)
                    city_match = city_ratio > 0.85
                    result["match_ratio"] = city_ratio

                if person.zip_code and match_zip:
                    zip_match = person.zip_code.replace(" ", "") == match_zip.replace(" ", "")

                if city_match and zip_match:
                    result["status"] = "red_flag"
                    logger.warning(f"[{self.source_type}] RED FLAG: {clean_name} — zhoda mena aj adresy!")
                elif city_match or zip_match:
                    result["status"] = "warning"
                    logger.warning(f"[{self.source_type}] WARNING: {clean_name} — čiastočná zhoda adresy.")
                else:
                    result["status"] = "warning"
                    logger.info(f"[{self.source_type}] WARNING: {clean_name} — zhoda mena, ale adresa sa nezhoduje.")

                # Návrat na výsledky vyhľadávania
                await page.go_back()
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except PlaywrightTimeoutError:
                    pass
                await page.wait_for_timeout(500)

                return result

            logger.info(f"[{self.source_type}] Žiadna dostatočná zhoda pre: {clean_name}")
            return result

        except Exception as e:
            logger.warning(f"[{self.source_type}] Chyba pri kontrole osoby {clean_name}: {e}")
            result["status"] = "warning"
            result["detail_url"] = _SEARCH_URL
            return result

    @staticmethod
    def _extract_address_from_detail(detail_text: str) -> tuple[Optional[str], Optional[str]]:
        """Extrahuje mesto a PSČ z detailu osoby v registri diskvalifikácií."""
        city = None
        zip_code = None

        # Hľadať PSČ v texte
        zip_match = ZIP_RE.search(detail_text)
        if zip_match:
            zip_code = zip_match.group(1).replace(" ", "")

            # Mesto = text okolo PSČ
            # Formát: "Mesto 123 45" alebo "123 45 Mesto"
            start = max(0, zip_match.start() - 50)
            end = min(len(detail_text), zip_match.end() + 50)
            context = detail_text[start:end]

            # Skúsiť "PSČ Mesto" (911 05 Trenčín)
            after_zip = detail_text[zip_match.end():end].strip()
            if after_zip and not after_zip[0].isdigit():
                city = after_zip.split("\n")[0].strip(" ,;")
                if len(city) > 3:
                    return city, zip_code

            # Skúsiť "Mesto PSČ" (Trenčín 911 05)
            before_zip = detail_text[start:zip_match.start()].strip()
            if before_zip:
                # Zobrať posledné slovo pred PSČ
                words = before_zip.split()
                if words:
                    city = words[-1].strip(" ,;")
                    if len(city) > 2:
                        return city, zip_code

        return city, zip_code

    @staticmethod
    def _build_findings(results: list[dict]) -> str:
        """Vybuduje findings text z výsledkov kontroly osôb."""
        if not results:
            return "Žiadne osoby na kontrolu."

        parts = []
        red_flags = [r for r in results if r["status"] == "red_flag"]
        warnings = [r for r in results if r["status"] == "warning"]
        clean = [r for r in results if r["status"] == "clean"]

        if red_flags:
            parts.append(f"POZOR! Nájdených {len(red_flags)} diskvalifikovaných osôb:")
            for r in red_flags:
                parts.append(
                    f"  • {r['name']} ({r['role']}) — zhoda mena aj adresy "
                    f"(ORSR: {r['orsr_city']} {r['orsr_zip']} | Register: {r['match_city']} {r['match_zip']})"
                )
                if r["detail_url"]:
                    parts.append(f"    URL: {r['detail_url']}")

        if warnings:
            parts.append(f"\nUpozornenie: {len(warnings)} osôb s zhodou mena (adresa sa nezhoduje — manuálne overenie):")
            for r in warnings:
                parts.append(
                    f"  • {r['name']} ({r['role']}) — ORSR: {r['orsr_city']} {r['orsr_zip']} | "
                    f"Register: {r['match_city'] or '?'} {r['match_zip'] or '?'}"
                )
                if r["detail_url"]:
                    parts.append(f"    URL: {r['detail_url']}")

        if clean:
            parts.append(f"\nV poriadku: {len(clean)} osôb bez nálezu v registri diskvalifikácií.")
            for r in clean:
                parts.append(f"  • {r['name']} ({r['role']})")

        return "\n".join(parts)

    async def _generate_summary_pdf(self, page: Page, output_path: Path, ico: str, results: list[dict]) -> None:
        """Vygeneruje PDF so zhrnutím výsledkov."""
        try:
            # Naviguj na prázdnu stránku aby sme sa vyhli SPA/React interferencii
            await page.goto("about:blank", timeout=5000)
            await page.set_viewport_size({"width": 1920, "height": 1080})

            html_parts = ["<h1>Register diskvalifikácií</h1>"]
            html_parts.append(f"<p style='text-align:center;color:#666;'>IČO: {ico}</p>")
            html_parts.append("<table style='width:100%;border-collapse:collapse;font-size:12px;'>")
            html_parts.append("<tr style='background:#f4f4f5;'><th style='padding:6px;border:1px solid #ddd;text-align:left;'>Osoba</th><th style='padding:6px;border:1px solid #ddd;'>Rola</th><th style='padding:6px;border:1px solid #ddd;'>Stav</th><th style='padding:6px;border:1px solid #ddd;'>ORSR adresa</th><th style='padding:6px;border:1px solid #ddd;'>Register adresa</th></tr>")

            for r in results:
                if r["status"] == "red_flag":
                    color = "#ef4444"
                    label = "POZOR! Diskvalifikovaný"
                elif r["status"] == "warning":
                    color = "#f59e0b"
                    label = "Upozornenie"
                else:
                    color = "#10b981"
                    label = "V poriadku"

                orsr_addr = f"{r['orsr_city'] or '?'} {r['orsr_zip'] or '?'}"
                match_addr = f"{r['match_city'] or '—'} {r['match_zip'] or '—'}"

                html_parts.append(
                    f"<tr>"
                    f"<td style='padding:6px;border:1px solid #ddd;'>{r['name']}</td>"
                    f"<td style='padding:6px;border:1px solid #ddd;text-align:center;'>{r['role']}</td>"
                    f"<td style='padding:6px;border:1px solid #ddd;text-align:center;color:{color};font-weight:bold;'>{label}</td>"
                    f"<td style='padding:6px;border:1px solid #ddd;'>{orsr_addr}</td>"
                    f"<td style='padding:6px;border:1px solid #ddd;'>{match_addr}</td>"
                    f"</tr>"
                )

            html_parts.append("</table>")

            if any(r["detail_url"] for r in results if r["status"] != "clean"):
                html_parts.append("<h3>Odkazy na detaily:</h3><ul>")
                for r in results:
                    if r["detail_url"] and r["status"] != "clean":
                        html_parts.append(f"<li>{r['name']}: <a href='{r['detail_url']}'>{r['detail_url']}</a></li>")
                html_parts.append("</ul>")

            html_content = "\n".join(html_parts)

            await page.set_content(f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body {{ margin: 0; padding: 40px; font-family: Inter, Arial, sans-serif; }}
  h1 {{ font-size: 24px; font-weight: 700; margin: 0 0 8px 0; text-align: center; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th {{ background: #f4f4f5; padding: 6px; border: 1px solid #ddd; }}
  td {{ padding: 6px; border: 1px solid #ddd; }}
  h3 {{ margin-top: 24px; font-size: 14px; }}
  a {{ color: #2563eb; }}
</style></head>
<body>
{html_content}
</body>
</html>""", wait_until="load")

            await page.pdf(
                path=str(output_path),
                format="A4",
                print_background=True,
                margin={"top": "2cm", "bottom": "2cm", "left": "2cm", "right": "2cm"},
            )
            logger.info(f"[{self.source_type}] PDF vygenerované: {output_path}")

        except Exception as e:
            logger.error(f"[{self.source_type}] PDF generovanie zlyhalo: {e}")

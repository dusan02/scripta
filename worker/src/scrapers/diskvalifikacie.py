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

            results: list[dict] = []
            seen_names: set[str] = set()
            for person in persons:
                clean_name = person.clean_name or strip_titles(person.raw_name)
                if not clean_name or len(clean_name.split()) < 2:
                    logger.warning(f"[{self.source_type}] Preskakujem osobu s neplatným menom: {person.raw_name}")
                    continue

                # Deduplikácia — tá istá osoba môže byť aj štatutár aj spoločník
                name_key = clean_name.lower().strip()
                if name_key in seen_names:
                    logger.info(f"[{self.source_type}] Preskakujem duplicitu: {clean_name} ({person.role})")
                    continue
                seen_names.add(name_key)

                logger.info(f"[{self.source_type}] Hľadám: {clean_name} ({person.role})")
                person_page = await self._get_page(block_images=True)
                try:
                    result = await self._check_person(person_page, clean_name, person)
                    results.append(result)
                finally:
                    await person_page.close()

            # Zdieľaná page pre generovanie sumárneho PDF
            page = await self._get_page(block_images=True)
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
                await search_input.wait_for(state="visible", timeout=5000)
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
            # Počkáme kým sa objaví zoznam výsledkov alebo text o žiadnych výsledkoch
            no_results_loc = page.locator("text=žiadne výsledky, text=neboli nájdené žiadne, text=zadaným kritériám nezodpovedajú, text=nenašli sa žiadne záznamy")
            results_loc = page.locator("table tbody tr, .result-table tr, .search-results tr")
            try:
                await no_results_loc.or_(results_loc).first.wait_for(timeout=5000)
            except PlaywrightTimeoutError:
                pass

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
                # Počkáme kým sa načíta detail stránka (event-driven)
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except PlaywrightTimeoutError:
                    pass

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
                # Počkáme kým sa načíta zoznam výsledkov (event-driven)
                try:
                    await page.wait_for_selector("table tbody tr, .result-table tr, text=žiadne výsledky", timeout=5000)
                except PlaywrightTimeoutError:
                    pass

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

        _ROLE_LABELS = {"statutar": "Štatutár", "spolocnik": "Spoločník"}

        def _role(role: str) -> str:
            return _ROLE_LABELS.get(role, role)

        def _addr(city: Optional[str], zip_code: Optional[str]) -> str:
            parts = []
            if city:
                parts.append(city)
            if zip_code:
                parts.append(zip_code)
            return " ".join(parts) if parts else "neznáma"

        def _plural(n: int, singular: str, few: str, many: str) -> str:
            if n == 1:
                return f"1 {singular}"
            if 2 <= n <= 4:
                return f"{n} {few}"
            return f"{n} {many}"

        parts = []
        red_flags = [r for r in results if r["status"] == "red_flag"]
        warnings = [r for r in results if r["status"] == "warning"]
        clean = [r for r in results if r["status"] == "clean"]

        if red_flags:
            parts.append(f"POZOR! Nájdená {_plural(len(red_flags), 'diskvalifikovaná osoba', 'diskvalifikované osoby', 'diskvalifikovaných osôb')}:")
            for r in red_flags:
                parts.append(
                    f"  • {r['name']} ({_role(r['role'])}) — zhoda mena aj adresy "
                    f"(ORSR: {_addr(r['orsr_city'], r['orsr_zip'])} | Register: {_addr(r['match_city'], r['match_zip'])})"
                )
                if r["detail_url"]:
                    parts.append(f"    URL: {r['detail_url']}")

        if warnings:
            parts.append(f"\nUpozornenie: {_plural(len(warnings), 'osoba', 'osoby', 'osôb')} s zhodou mena (adresa sa nezhoduje — manuálne overenie):")
            for r in warnings:
                parts.append(
                    f"  • {r['name']} ({_role(r['role'])}) — "
                    f"ORSR: {_addr(r['orsr_city'], r['orsr_zip'])} | "
                    f"Register: {_addr(r['match_city'], r['match_zip'])}"
                )
                if r["detail_url"]:
                    parts.append(f"    URL: {r['detail_url']}")

        if clean:
            parts.append(f"\nV poriadku: {_plural(len(clean), 'osoba', 'osoby', 'osôb')} bez nálezu v registri diskvalifikácií.")
            for r in clean:
                parts.append(f"  • {r['name']} ({_role(r['role'])})")

        return "\n".join(parts)

    async def _generate_summary_pdf(self, page: Page, output_path: Path, ico: str, results: list[dict]) -> None:
        """Vygeneruje PDF — Executive Summary formát s sekciami pre riziká a osoby v poriadku."""
        try:
            await page.goto("about:blank", timeout=5000)
            await page.set_viewport_size({"width": 1920, "height": 1080})

            red_flags = [r for r in results if r["status"] == "red_flag"]
            warnings = [r for r in results if r["status"] == "warning"]
            clean = [r for r in results if r["status"] == "clean"]

            risk_count = len(red_flags) + len(warnings)

            # Hlavička
            if red_flags:
                summary_text = f"Nájdených {len(red_flags)} potvrdených rizík (zhoda mena aj adresy)"
                summary_color = "#ef4444"
            elif warnings:
                summary_text = f"Nájdené {len(warnings)} potenciálne riziká (zhoda mien — potrebné overenie)"
                summary_color = "#f59e0b"
            else:
                summary_text = f"Všetkých {len(clean)} osôb je v poriadku — žiadne diskvalifikácie"
                summary_color = "#10b981"

            _ROLE_LABELS = {"statutar": "Štatutár", "spolocnik": "Spoločník"}

            import html as html_lib
            safe_ico = html_lib.escape(ico)
            
            html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: Inter, -apple-system, Arial, sans-serif; padding: 40px; color: #1a1a1a; font-size: 13px; line-height: 1.6; }}
h1 {{ font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 4px; }}
.subtitle {{ text-align: center; color: #666; font-size: 13px; margin-bottom: 24px; }}
.summary-box {{ padding: 16px 20px; border-radius: 8px; margin-bottom: 24px; font-size: 15px; font-weight: 600; }}
.summary-box.red {{ background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }}
.summary-box.orange {{ background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }}
.summary-box.green {{ background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }}
.intro {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 28px; font-size: 12px; color: #475569; }}
.section-title {{ font-size: 15px; font-weight: 700; margin: 28px 0 14px 0; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }}
.risk-card {{ border-radius: 8px; padding: 16px 20px; margin-bottom: 14px; }}
.risk-card.red {{ background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #ef4444; }}
.risk-card.orange {{ background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; }}
.risk-name {{ font-size: 15px; font-weight: 700; margin-bottom: 4px; }}
.risk-role {{ font-size: 12px; color: #666; font-weight: 400; }}
.risk-status {{ font-size: 13px; font-weight: 600; margin: 8px 0; }}
.risk-status.red {{ color: #991b1b; }}
.risk-status.orange {{ color: #92400e; }}
.risk-explanation {{ font-size: 12px; color: #64748b; margin: 8px 0 12px 0; line-height: 1.7; }}
.addr-row {{ display: flex; gap: 20px; margin: 6px 0; font-size: 12px; }}
.addr-label {{ color: #666; min-width: 140px; }}
.addr-value {{ font-weight: 500; }}
.risk-link {{ margin-top: 10px; }}
.risk-link a {{ color: #2563eb; text-decoration: none; font-size: 12px; word-break: break-all; }}
.clean-list {{ list-style: none; padding: 0; }}
.clean-list li {{ padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }}
.clean-list li:last-child {{ border-bottom: none; }}
.clean-dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; margin-right: 8px; }}
.footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }}
</style></head>
<body>

<h1>Register diskvalifikácií</h1>
<p class="subtitle">Previerka osôb z ORSR (IČO: {safe_ico})</p>

<div class="summary-box" style="background: {summary_color}15; color: {summary_color}; border: 1px solid {summary_color}40;">
Výsledok previerky: {summary_text}
</div>

<div class="intro">
<strong>Čo je Register diskvalifikácií?</strong> Obsahuje osoby, ktoré súdom dostali zákaz výkonu funkcie
štatutárneho orgánu alebo člena predstavenstva. Ak je štatutár diskvalifikovaný, jeho úkony za spoločnosť
môžu byť neplatné. Tento report porovnáva osoby z ORSR (štatutári a spoločníci) s registrom diskvalifikácií.
</div>
"""

            # Sekcia 1: Riziká a upozornenia
            if red_flags or warnings:
                html += '<div class="section-title">Riziká a upozornenia</div>\n'

                for r in red_flags:
                    role_label = html_lib.escape(_ROLE_LABELS.get(r["role"], r["role"]))
                    safe_name = html_lib.escape(r['name'])
                    orsr_addr = html_lib.escape(f"{r['orsr_city'] or 'neznáma'} {r['orsr_zip'] or ''}".strip())
                    match_addr = html_lib.escape(f"{r['match_city'] or 'neznáma'} {r['match_zip'] or ''}".strip())
                    safe_url = html_lib.escape(r['detail_url'] or "")
                    html += f"""<div class="risk-card red">
<div class="risk-name">🔴 {safe_name} <span class="risk-role">({role_label})</span></div>
<div class="risk-status red">Potvrdené riziko: Zhoda mena aj adresy</div>
<div class="risk-explanation">
    Táto osoba sa nachádza v Registri diskvalifikácií a jej adresa sa zhoduje s adresou v ORSR.
    Odporúčame okamžite overiť platnosť jej úkonov za spoločnosť.
</div>
<div class="addr-row"><span class="addr-label">Adresa v ORSR:</span><span class="addr-value">{orsr_addr}</span></div>
<div class="addr-row"><span class="addr-label">Adresa v Registri:</span><span class="addr-value">{match_addr}</span></div>
<div class="risk-link"><a href="{safe_url}">{safe_url}</a></div>
</div>
"""

                for r in warnings:
                    role_label = html_lib.escape(_ROLE_LABELS.get(r["role"], r["role"]))
                    safe_name = html_lib.escape(r['name'])
                    orsr_addr = html_lib.escape(f"{r['orsr_city'] or 'neznáma'} {r['orsr_zip'] or ''}".strip())
                    match_addr = html_lib.escape(f"{r['match_city'] or 'neznáma / iná'} {r['match_zip'] or ''}".strip())
                    safe_url = html_lib.escape(r['detail_url'] or "")
                    html += f"""<div class="risk-card orange">
<div class="risk-name">🟠 {safe_name} <span class="risk-role">({role_label})</span></div>
<div class="risk-status orange">Upozornenie na možnú zhodu (menovec)</div>
<div class="risk-explanation">
    V registri sme našli osobu s rovnakým menom, ale evidovanou na inej adrese.
    Vzhľadom na to, že osoby si často po problémoch menia trvalý pobyt, odporúčame
    overiť totožnosť podľa dátumu narodenia alebo rodného čísla v detaile registra.
</div>
<div class="addr-row"><span class="addr-label">Adresa v ORSR:</span><span class="addr-value">{orsr_addr}</span></div>
<div class="addr-row"><span class="addr-label">Adresa v Registri:</span><span class="addr-value">{match_addr}</span></div>
<div class="risk-link"><a href="{safe_url}">{safe_url}</a></div>
</div>
"""

            # Sekcia 2: Osoby v poriadku
            if clean:
                html += '<div class="section-title">Osoby bez zistení (v poriadku)</div>\n'
                html += '<p style="font-size:12px;color:#666;margin-bottom:12px;">Nasledujúce osoby neboli nájdené v Registri diskvalifikácií:</p>\n'
                html += '<ul class="clean-list">\n'
                for r in clean:
                    role_label = html_lib.escape(_ROLE_LABELS.get(r["role"], r["role"]))
                    safe_name = html_lib.escape(r["name"])
                    html += f'  <li><span class="clean-dot"></span>{safe_name} <span style="color:#666;font-size:12px;">({role_label})</span></li>\n'
                html += '</ul>\n'

            if not red_flags and not warnings and not clean:
                html += '<p style="text-align:center;color:#666;margin:40px 0;">Neboli k dispozícii žiadne osoby z ORSR na porovnanie.</p>\n'

            html += f"""<div class="footer">
Generované {time.strftime("%d.%m.%Y %H:%M")} · Register diskvalifikácií · justice.gov.sk
</div>

</body>
</html>"""

            await page.set_content(html, wait_until="load")

            await page.pdf(
                path=str(output_path),
                format="A4",
                print_background=True,
                margin={"top": "1.5cm", "bottom": "1.5cm", "left": "1.5cm", "right": "1.5cm"},
            )
            logger.info(f"[{self.source_type}] PDF vygenerované: {output_path}")

        except Exception as e:
            logger.error(f"[{self.source_type}] PDF generovanie zlyhalo: {e}")

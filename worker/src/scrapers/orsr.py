from __future__ import annotations
import logging
import re
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource, PersonInfo, ACADEMIC_TITLES, ZIP_RE

logger = logging.getLogger(__name__)

_EMPTY_MARKERS = ("Nenašli sa žiadne", "Podmienkam nevyhovuje žiadny", "Záznamy: 0 - 0 / 0", "Kritériám vyhľadávania nezodpovedá žiadny záznam")
_OUTDATED_MARKER = "Výpis je neaktuálny"
_TRANSFERRED_MARKER = "Spis odstúpený na iný registrový súd"

_LEGAL_FORM_RE = re.compile(
    r'((?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.|družstvo|š\.?\s*p\.))\.?\s.*$',
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r'^["\']+(.+?)["\']+')


class OrsrScraper(BaseScraper):
    """Scraper pre Obchodný register SR (ORSR). Hľadá firmu podľa IČO a sťahuje PDF výpis."""

    source_type = "ORSR"
    base_url = "https://www.orsr.sk/hladaj_ico.asp"

    # ── Public ───────────────────────────────────────────────────────

    async def run(self, *, ico: str, output_dir: Path, orsr_extract_type: str = "CURRENT", **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico} (typ: {orsr_extract_type})")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")

            await self._navigate_to_search(page, ico)
            logger.debug(f"[{self.source_type}] ⏱ goto: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            if await self._is_empty_results(page):
                logger.warning(f"[{self.source_type}] IČO {ico} neexistuje v ORSR — zastavujem report.")
                return self._make_result(
                    status="FAILED",
                    file_path=None,
                    status_message=f"IČO {ico} neexistuje v Obchodnom registri SR (ORSR). Report bol zastavený.",
                    findings="Kritériám vyhľadávania nezodpovedá žiadny záznam — IČO neexistuje v ORSR.",
                )

            link_name = "Úplný" if orsr_extract_type == "FULL" else "Aktuálny"
            company_name = await self._click_extract_link(page, link_name, ico)
            if company_name is None:
                # Fallback: skús extrahovať meno z vyhľadávacej tabuľky
                company_name = await self._extract_company_name_from_search(page, ico)
            if company_name is None:
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Výpis pre IČO {ico} nebol nájdený.",
                    findings="Záznam neexistuje alebo nebol nájdený.",
                )
            logger.debug(f"[{self.source_type}] ⏱ detail_click + meno: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            pdf_output = output_dir / f"orsr_{ico}.pdf"
            try:
                await self._print_page_to_pdf(page, pdf_output)
                logger.debug(f"[{self.source_type}] ⏱ print_pdf: {time.perf_counter() - _t:.2f}s")
                logger.info(f"[{self.source_type}] PDF: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] PDF zlyhalo: {e}")
                return self._make_result(status="FAILED", status_message=f"Chyba pri generovaní PDF z ORSR: {e}")

            findings = await self._extract_findings(page)
            persons = await self._extract_persons(page)
            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message="Výpis z ORSR úspešne stiahnutý.",
                findings=findings,
                company_name=company_name,
                persons=persons,
            )
        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupný: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"Register ORSR je nedostupný: {e}")
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba pri spracovaní ORSR: {e}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"{type(e).__name__}: {e}")
        finally:
            if page:
                await page.close()

    # ── Private helpers ──────────────────────────────────────────────

    async def _navigate_to_search(self, page: Page, ico: str) -> None:
        search_url = f"{self.base_url}?ICO={ico}&SID=0"
        logger.info(f"[{self.source_type}] Navigujem na {search_url}")
        try:
            await page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ORSR.")

    async def _is_empty_results(self, page: Page) -> bool:
        text = await page.inner_text("body")
        return any(marker in text for marker in _EMPTY_MARKERS)

    async def _click_extract_link(self, page: Page, link_name: str, ico: str) -> Optional[str]:
        """Nájde odkaz 'Aktuálny'/'Úplný', klikne naň a extrahuje company_name z detailnej stránky.
        Ak výpis obsahuje 'Výpis je neaktuálny', nasleduje odkaz na aktuálny výpis.
        Ak výpis obsahuje 'Spis odstúpený', skúsi ďalší odkaz v zozname výsledkov."""
        links = page.get_by_role("link", name=link_name)
        link_count = await links.count()
        if link_count == 0:
            logger.warning(f"[{self.source_type}] Odkaz '{link_name}' nenájdený.")
            return None

        for attempt in range(link_count):
            logger.info(f"[{self.source_type}] Klikám '{link_name}' (riadok {attempt + 1}/{link_count}).")
            detail_link = links.nth(attempt)
            await detail_link.click()
            await page.wait_for_load_state("domcontentloaded", timeout=45000)

            body_text = await page.inner_text("body")

            # Ak je výpis neaktuálny (zmena právnej formy), nasleduj reťaz odkazov na aktuálny výpis
            if _OUTDATED_MARKER in body_text:
                logger.info(f"[{self.source_type}] Výpis je neaktuálny — nasledujem odkaz na aktuálny výpis.")
                for _depth in range(5):  # max 5 skokov, aby sme sa nezacyklili
                    current_link = page.locator("a:has-text('aktuálny výpis')")
                    try:
                        await current_link.wait_for(timeout=5000)
                        await current_link.first.click()
                        await page.wait_for_load_state("domcontentloaded", timeout=45000)
                        body_text = await page.inner_text("body")
                        if _OUTDATED_MARKER not in body_text and _TRANSFERRED_MARKER not in body_text:
                            logger.info(f"[{self.source_type}] Nájdený platný výpis po {_depth + 1} skokoch.")
                            break
                        if _TRANSFERRED_MARKER in body_text:
                            logger.info(f"[{self.source_type}] Nasledovaný výpis je odstúpený — skúšam ďalší odkaz.")
                            await self._navigate_to_search(page, ico)
                            break
                        logger.info(f"[{self.source_type}] Nasledovaný výpis je tiež neaktuálny — pokračujem v reťazi.")
                    except PlaywrightTimeoutError:
                        logger.warning(f"[{self.source_type}] Odkaz na aktuálny výpis sa nenašiel — skúšam ďalší odkaz v zozname.")
                        await self._navigate_to_search(page, ico)
                        break
                else:
                    logger.warning(f"[{self.source_type}] Prekročený limit skokov — skúšam ďalší odkaz v zozname.")
                    await self._navigate_to_search(page, ico)
                    continue

            # Ak je spis odstúpený na iný súd, skús ďalší odkaz
            if _TRANSFERRED_MARKER in body_text:
                logger.info(f"[{self.source_type}] Spis odstúpený — skúšam ďalší odkaz.")
                await self._navigate_to_search(page, ico)
                continue

            # Výpis je OK — extrahuj company_name
            company_name = await self._extract_company_name_from_detail(page)
            logger.info(f"[{self.source_type}] Company name z detailu: {company_name}")
            return company_name

        logger.warning(f"[{self.source_type}] Všetky odkazy majú spis odstúpený — používam posledný.")
        await self._navigate_to_search(page, ico)
        links = page.get_by_role("link", name=link_name)
        await links.last.click()
        await page.wait_for_load_state("domcontentloaded", timeout=45000)
        company_name = await self._extract_company_name_from_detail(page)
        return company_name

    async def _extract_company_name_from_detail(self, page: Page) -> Optional[str]:
        """Extrahuje obchodné meno z detailnej stránky výpisu ORSR.
        Na detailnej stránke je aktuálny názov vždy uvedený ako hodnota v tabuľke."""
        try:
            name_val = await page.evaluate("""() => {
                // Hľadaj iba v prvej tabuľke (hlavička výpisu s aktuálnym menom)
                const firstTable = document.querySelector("table");
                if (!firstTable) return null;
                const rows = firstTable.querySelectorAll("tr");
                for (const row of rows) {
                    const cells = row.querySelectorAll("td");
                    for (let i = 0; i < cells.length; i++) {
                        const text = cells[i].innerText || "";
                        if (text.toLowerCase().includes("obchodné meno") && i + 1 < cells.length) {
                            return cells[i + 1].innerText.trim();
                        }
                    }
                }
                // Fallback: prehľadaj všetky tabuľky
                const allRows = document.querySelectorAll("table tr");
                for (const row of allRows) {
                    const cells = row.querySelectorAll("td");
                    for (let i = 0; i < cells.length; i++) {
                        const text = cells[i].innerText || "";
                        if (text.toLowerCase().includes("obchodné meno") && i + 1 < cells.length) {
                            return cells[i + 1].innerText.trim();
                        }
                    }
                }
                return null;
            }""")
            if name_val:
                return self._clean_company_name(name_val)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia mena z detailu zlyhala: {e}")
        return None

    @staticmethod
    def _clean_company_name(raw: str) -> str:
        """Očistí obchodné meno — úvodzovky, trailing obec za právnou formou."""
        name = raw.strip()
        m = _QUOTE_RE.match(name)
        if m:
            return m.group(1).strip()
        return _LEGAL_FORM_RE.sub(r'\1', name).strip()

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text = (await page.inner_text("body")).lower()
            if "v likvidácii" in text:
                return "POZOR: Spoločnosť je v likvidácii."
            # ORSR pri výmaze spoločnosti zobrazuje špecifický text
            # "vymazaná z obchodného registra" — nesmie sa spúšťať na výskyte
            # slova "vymazaná" v historických záznamoch o osobách.
            if "vymazaná z obchodného registra" in text:
                return "POZOR: Spoločnosť je vymazaná z ORSR."
            return "Aktívna spoločnosť v ORSR (bez zistených anomálií)."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nálezy zlyhali: {e}")
            return "Nálezy sa nepodarilo extrahovať."

    async def _extract_persons(self, page: Page) -> list[PersonInfo]:
        """Extrahuje osoby z sekcií 'Štatutárny orgán' a 'Spoločníci' z ORSR výpisu."""
        persons: list[PersonInfo] = []
        try:
            text = await page.inner_text("body")
            persons.extend(self._parse_persons_from_section(text, "Štatutárny orgán", "statutar"))
            persons.extend(self._parse_persons_from_section(text, "Spoločníci", "spolocnik"))
            if persons:
                logger.info(f"[{self.source_type}] Extrahovaných {len(persons)} osôb z ORSR výpisu.")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia osôb zlyhala: {e}")
        return persons

    @staticmethod
    def _parse_persons_from_section(text: str, section_label: str, role: str) -> list[PersonInfo]:
        """Parsovanie osôb z konkrétnej sekcie ORSR výpisu.
        ORSR výpis má formát:
          Štatutárny orgán:    konatelia
            (od: 11.03.2025)
            Peter Kurucz
            Kožušnícka 2661/23
            Trenčín 911 05
        """
        persons: list[PersonInfo] = []
        # Nájdeme sekciu — label je na začiatku riadku, nasleduje obsah
        # Hľadáme ďalší label sekcie pre ukončenie
        section_start = text.find(section_label + ":")
        if section_start == -1:
            return persons

        # Získame text sekcie — od labelu do ďalšieho labelu (riadok začínajúci slovom a končiaci ':')
        after_section = text[section_start + len(section_label) + 1:]
        lines = after_section.split("\n")

        # Nájdeme koniec sekcie — ďalší riadok ktorý vyzerá ako label (slovo + ':')
        section_lines: list[str] = []
        _LABEL_RE = re.compile(r'^[A-ZÁ-Ž][a-zá-ž]+\s*[a-zá-ž]*:')
        for line in lines[1:]:  # preskočíme prvý riadok (label)
            stripped = line.strip()
            if not stripped:
                if section_lines:
                    # prázdny riadok môže byť medzi záznamami, ale ak už máme osoby, sekcia môže pokračovať
                    continue
                continue
            if _LABEL_RE.match(stripped) and len(stripped) < 60:
                break  # ďalší label — koniec sekcie
            section_lines.append(stripped)

        # Parsovanie osôb z section_lines
        # Osoba = meno (obsahuje písmená, môže mať tituly), nasleduje adresa (ulica, mesto PSČ)

        # Blacklist fráz zo štruktúry ORSR výpisu, ktoré nie sú mená osôb
        _BLACKLIST_PHRASES = {
            "konanie", "konanie menom", "za spoločnosť", "za spolocnost",
            "výška", "vyska", "vklad", "imanie", "splatené", "splatene",
            "základné", "zakladne", "podpisovanie", "podpis",
            "spôsob", "spôsob konania", " obchodné", "obchodne meno",
            "pripojí", "pripoji", "vykonáva", "vykonava",
            "samostatne", "spoločne", "spolocne",
            "záložné", "zalozne", "záložné právo", "zalozne pravo",
            "prevod", "prevod podielu", "zmena",
        }

        # Názvy štátov a právnických osôb, ktoré sa môžu objaviť ako spoločníci
        # v ORSR výpise — nie sú to fyzické osoby a nesmú sa kontrolovať v registri diskvalifikácií
        _NON_PERSON_KEYWORDS = {
            "republika", "spolková", "veľkovojvodstvo", "vojvodstvo",
            "kráľovstvo", "kralovstvo", "federácia", "federacia",
            "štáty", "staty", "štát", "stat",
            "spoločnosť", "spolocnost", "corporation", "corp", "inc",
            "gmbh", "ag", "sarl", "ltd", "limited", "llc", "sa", "nv", "bv",
            "holding", "holdings", "group", "partners", "capital",
            "trust", "foundation", "stiftung", "gesmbH",
        }

        def _is_human_name(line: str) -> bool:
            """Validuje či riadok vyzerá ako reálne meno fyzickej osoby (nie štát, firma ani štrukturálny text ORSR)."""
            lowered = line.lower().strip()
            # Nesmie obsahovať dvojbodku (štrukturálne labely)
            if ":" in lowered:
                return False
            # Nesmie obsahovať čísla (ulice, výšky, dátumy)
            if any(c.isdigit() for c in line):
                return False
            # Nesmie byť príliš dlhé (vety z ORSR štruktúry)
            if len(line) > 60:
                return False
            # Blacklist fráz
            for phrase in _BLACKLIST_PHRASES:
                if phrase in lowered:
                    return False
            # Nesmie obsahovať kľúčové slová štátov/právnických osôb
            for keyword in _NON_PERSON_KEYWORDS:
                if keyword in lowered:
                    return False
            # Musí obsahovať aspoň 2 slová po odstránení titulov
            words = line.split()
            name_words = [w for w in words if w.lower().rstrip(".,") not in ACADEMIC_TITLES]
            if len(name_words) < 2:
                return False
            # Všetky slová (okrem titulov) musia byť alfabetické
            for w in name_words:
                if not w.isalpha():
                    return False
            return True

        i = 0
        while i < len(section_lines):
            line = section_lines[i]
            # Preskočiť funkcie (konatelia, predstavenstvo, etc.) a dátumy (od: ...)
            if line.lower().startswith("od:") or line.startswith("("):
                i += 1
                continue
            # Skontrolovať či to vyzerá ako meno (obsahuje písmená, nie číslo na začiatku)
            if line[0].isdigit():
                i += 1
                continue
            # Validovať či je to reálne meno osoby
            if not _is_human_name(line):
                i += 1
                continue
            # Rozdeliť na slová
            words = line.split()
            # Odstrániť tituly
            name_words = [w for w in words if w.lower().rstrip(".,") not in ACADEMIC_TITLES]
            if len(name_words) < 2:
                i += 1
                continue
            raw_name = line
            clean_name = " ".join(name_words)

            # Hľadať adresu v nasledujúcich riadkoch
            city = None
            zip_code = None
            for j in range(i + 1, min(i + 4, len(section_lines))):
                addr_line = section_lines[j]
                # Ak ďalší riadok vyzerá ako ďalšie meno (nie adresa), skonči
                if addr_line[0].isalpha() and not ZIP_RE.search(addr_line) and "," not in addr_line and " " in addr_line:
                    # Skontroluj či to nie je len mestský názov bez PSČ
                    if not any(c.isdigit() for c in addr_line):
                        # Mohlo by to byť mesto — skontroluj ďalší riadok
                        continue
                    break
                zip_match = ZIP_RE.search(addr_line)
                if zip_match:
                    zip_code = zip_match.group(1).replace(" ", "")
                    # Mesto = zvyšok riadku bez PSČ
                    city_part = ZIP_RE.sub("", addr_line).strip(" ,")
                    if city_part:
                        city = city_part
                    break
                # Ak riadok obsahuje len písmená a je to posledný pred PSČ
                if addr_line[0].isalpha() and not any(c.isdigit() for c in addr_line):
                    city = addr_line.strip()

            persons.append(PersonInfo(
                raw_name=raw_name,
                clean_name=clean_name,
                city=city,
                zip_code=zip_code,
                role=role,
            ))
            i += 1

        return persons

    async def _extract_company_name_from_search(self, page: Page, ico: str) -> Optional[str]:
        """Fallback: extrahuje obchodné meno z vyhľadávacej tabuľky ORSR.
        Volá sa keď extrakcia z detailu zlyhá."""
        try:
            # Naviguj späť na vyhľadávanie
            search_url = f"{self.base_url}?ICO={ico}&SID=0"
            await page.goto(search_url, timeout=30000, wait_until="domcontentloaded")
            
            name_val = await page.evaluate("""(ico) => {
                const links = Array.from(document.querySelectorAll("a"));
                for (const link of links) {
                    const href = link.getAttribute("href") || "";
                    if (href.includes("vypis.asp") && !link.innerText.includes("Aktuálny") && !link.innerText.includes("Úplný")) {
                        const text = link.innerText.trim();
                        if (text.length > 0) return text;
                    }
                }
                
                const rows = document.querySelectorAll("table tr");
                for (const row of rows) {
                    if (row.innerText.includes(ico)) {
                        const a = row.querySelector("a");
                        if (a && !a.innerText.includes("Aktuálny") && !a.innerText.includes("Úplný")) {
                            return a.innerText.trim();
                        }
                        const b = row.querySelector("b");
                        if (b) return b.innerText.trim();
                    }
                }
                return null;
            }""", ico)
            if name_val:
                return self._clean_company_name(name_val)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Fallback extrakcia mena zlyhala: {e}")
        return None

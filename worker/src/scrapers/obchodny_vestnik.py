from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import List, Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeout, Error as PlaywrightError
from PyPDF2 import PdfWriter, PdfReader

from .base import BaseScraper, ScraperUnavailableError, ScraperInputError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

OV_URL = "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Web/Zoznam.aspx"

# ── KRITICKÁ úroveň 🔴 ────────────────────────────────────────────────────────
# Priame indikátory finančnej / právnej nestability — vždy sťahovať Detail PDF.
CRITICAL_KEYWORDS = [
    # Likvidácia
    "likvidátor",           # Oznámenia a výzvy likvidátora/likvidátorov
                            # → likvidátora, likvidátorov, likvidátori
    "dodatočnej likvidácii",  # Oznámenie o dodatočnej likvidácii

    # Konkurz a úpadok
    "konkurz",              # Konkurzy a vyrovnania
    "vyrovnan",             # Konkurzy a vyrovnania → vyrovnania, vyrovnanie
    "reštrukturaliz",       # Preventívne reštrukturalizácie

    # Exekúcie
    "exekútor",             # Súdni exekútori + Upovedomenia a výzvy exekútorov
                            # → exekútori, exekútorov, exekútora

    # Súdne postihy
    "trest zverejnenia",    # Rozsudky súdov – trest zverejnenia odsudzujúceho rozsudku
    "odsudzujúci rozsudok",

    # Oznámenia súdov súvisiace so zrušením spoločnosti
    "zrušení spoločnosti",
    "zrušeniu spoločnosti",
    "zrušenie spoločnosti",
    "zrušením spoločnosti",

    # Dražby
    "správcovia dane",      # Dražby – správcovia dane
    "dražobn",              # Dražobná vyhláška → dražobná, dražobné, dražobnej
    "dražb",                # Oznámenie o výsledku dobrovoľnej dražby + Dražby
                            # → dražby, dražba, dražbu (ale NIE dražobná — to je dražobn)
]

# ── MONITOROVACIA úroveň 🟡 ──────────────────────────────────────────────────
# Potenciálne právne komplikácie — sledovať, ale nie bezprostredne likvidačné.
MONITORING_KEYWORDS = [
    "rozsudok súdu",        # Rozsudky súdov (všeobecné)
    "rozsudky súdov",
    "žalobný zámer",        # Žalobný zámer
    "vydržanie",            # Vydržanie – vyzývacie uznesenie
    "vyzývacie uznesenie",
]


def _is_relevant(typ_podania: str) -> bool:
    """Vráti True ak typ podania patrí do kritickej alebo monitorovacej úrovne."""
    typ_lower = typ_podania.lower().strip()
    for keyword in CRITICAL_KEYWORDS + MONITORING_KEYWORDS:
        if keyword in typ_lower:
            return True
    return False


def _get_severity(typ_podania: str) -> str:
    """Vráti '🔴 KRITICKÉ' alebo '🟡 MONITORING' podľa typu podania."""
    typ_lower = typ_podania.lower().strip()
    for keyword in CRITICAL_KEYWORDS:
        if keyword in typ_lower:
            return "🔴 KRITICKÉ"
    return "🟡 MONITORING"


class ObchodnyVestnikScraper(BaseScraper):
    """Scraper pre Obchodný vestník SR (justice.gov.sk).

    Vyhľadá záznamy podľa IČO, filtruje relevantné typy podaní,
    pre každý relevantný záznam klikne na Detail, urobí screenshot,
    a vráti sa späť do zoznamu.
    """

    source_type: str = "OBCHODNY_VESTNIK"

    async def run(self, **kwargs) -> ScrapedSource:
        output_dir: Path = kwargs["output_dir"]
        ico: Optional[str] = kwargs.get("ico")

        if not ico:
            raise ScraperInputError("Obchodný vestník vyžaduje IČO")

        output_path = output_dir / "OBCHODNY_VESTNIK.pdf"
        screenshots_dir = output_dir / "ov_screenshots"
        screenshots_dir.mkdir(exist_ok=True)

        page: Optional[Page] = None
        try:
            page = await self._get_page(block_images=False)
            await self._safe_goto(page, OV_URL)

            # Kliknúť na "Vyhľadávanie v OV"
            await page.get_by_role("link", name="Vyhľadávanie v OV").click()
            await page.wait_for_load_state("domcontentloaded", timeout=10000)

            # Vyplniť IČO do vyhľadávacieho poľa
            search_box = page.get_by_role("textbox", name="Značka, číslo a kód/IČO")
            await search_box.click()
            await search_box.fill(ico)

            # Kliknúť "Vyhľadať"
            await page.get_by_role("button", name="Vyhľadať").click()

            # Počkať na výsledky tabuľky
            try:
                await page.wait_for_selector("table tbody tr", timeout=15000)
            except PlaywrightTimeout:
                logger.info(f"[OV] Žiadne výsledky pre IČO {ico}")
                await self._generate_no_results_pdf(
                    page, output_path, ico,
                    title="Obchodný vestník SR",
                    message=f"Pre IČO {ico} sa nenašli žiadne záznamy v Obchodnom vestníku.",
                )
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(output_path),
                    page_count=1,
                    status_message="Žiadne záznamy v Obchodnom vestníku.",
                )

            await self._hide_keyword_highlights(page)

            # Prečítať všetky riadky tabuľky a filtrovať relevantné
            relevant_rows = await self._find_relevant_rows(page)

            if not relevant_rows:
                logger.info(f"[OV] Žiadne relevantné záznamy pre IČO {ico}")
                # Vygenerovať PDF zo zoznamu (negatívny výsledok)
                await self._generate_clean_pdf(
                    page, output_path,
                    title=f"Obchodný vestník SR — IČO {ico}",
                    content_selector="table",
                )
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(output_path),
                    page_count=1,
                    status_message="Žiadne relevantné záznamy v Obchodnom vestníku.",
                )

            logger.info(f"[OV] Nájdených {len(relevant_rows)} relevantných záznamov pre IČO {ico}")

            # Pre každý relevantný záznam: kliknúť na Detail, screenshot, späť
            screenshots: List[Path] = []
            findings_parts: List[str] = []

            for idx, row_info in enumerate(relevant_rows):
                row_index, typ_podania, subjekt, vestnik, cislo, datum = row_info
                logger.info(f"[OV] Spracovávam záznam {idx + 1}/{len(relevant_rows)}: {typ_podania}")

                try:
                    # Extrahovať Detail href priamo z riadku (spoľahlivejšie ako klik v headless)
                    detail_href = await page.evaluate(f"""() => {{
                        const row = document.querySelector('table tbody tr:nth-child({row_index + 1})');
                        if (!row) return null;
                        const link = row.querySelector('a[href*="FormularDetail"]');
                        return link ? link.getAttribute('href') : null;
                    }}""")

                    if not detail_href:
                        logger.warning(f"[OV] Detail link sa nenašiel pre riadok {row_index + 1}")
                        continue

                    # Navigovať priamo na detail URL v NOVOM Tabe, aby sme nestratili POST state zoznamu.
                    # POZOR: FormularDetail.aspx vracia priamo application/pdf — goto() padá s ERR_ABORTED.
                    # Preto PDF stahujeme cez page.request.get() (nesie session cookies) bez navigácie.
                    detail_url = f"https://obchodnyvestnik.justice.gov.sk{detail_href}"
                    logger.info(f"[OV] Detail URL: {detail_url}")

                    detail_pdf_path = screenshots_dir / f"ov_detail_{idx + 1}.pdf"
                    await self._download_detail_pdf(page, detail_url, detail_pdf_path)

                    if detail_pdf_path.exists():
                        screenshots.append(detail_pdf_path)  # PDF sa priamo zlúči, nie screenshot
                        logger.info(f"[OV] Detail PDF pripravené: {detail_pdf_path.name}")
                    else:
                        logger.warning(f"[OV] Detail PDF sa nepodarilo získať pre záznam {idx + 1}")

                    # Findings z tabuľkových dát — s úrovňou závažnosti
                    severity = _get_severity(typ_podania)
                    findings_parts.append(
                        f"[{severity}]\n"
                        f"Typ: {typ_podania}\n"
                        f"Subjekt: {subjekt}\n"
                        f"Obchodný vestník: {vestnik}\n"
                        f"Číslo zverejnenia: {cislo}\n"
                        f"Dátum zverejnenia: {datum}\n"
                        f"Detail: {detail_url}"
                    )

                except PlaywrightTimeout as e:
                    logger.warning(f"[OV] Timeout pri spracovaní záznamu {idx + 1}: {e}")
                    continue
                except Exception as e:
                    logger.warning(f"[OV] Chyba pri spracovaní záznamu {idx + 1}: {e}")
                    continue


            # Zabezpečiť, že sme na stránke so zoznamom výsledkov pred generovaním PDF
            try:
                await page.wait_for_selector("table tbody tr", timeout=5000)
            except PlaywrightTimeout:
                logger.warning("[OV] Tabuľka sa nenašla pred generovaním PDF, skúšem sa vrátiť na zoznam")
                try:
                    await page.go_back()
                    await page.wait_for_selector("table tbody tr", timeout=10000)
                except Exception:
                    logger.error("[OV] Nepodarilo sa vrátiť na zoznam výsledkov")

            # Vygenerovať PDF zo zoznamu + screenshotov
            # Najprv PDF z finálneho stavu zoznamu
            await self._generate_clean_pdf(
                page, output_path,
                title=f"Obchodný vestník SR — IČO {ico}",
                content_selector="table",
            )

            # Pripojiť detail PDF a screenshoty do hlavného PDF
            if screenshots or any((screenshots_dir / f"ov_detail_{i + 1}.pdf").exists() for i in range(len(relevant_rows))):
                self._merge_details_into_pdf(output_path, screenshots_dir, len(relevant_rows))
                # Vyčistiť medzitýmne súbory — už sú zlúčené v hlavnom PDF
                try:
                    shutil.rmtree(screenshots_dir, ignore_errors=True)
                    logger.info(f"[OV] Vyčistené medzitýmne screenshoty: {screenshots_dir}")
                except Exception:
                    pass

            findings = None
            if findings_parts:
                critical_count = sum(1 for p in findings_parts if "🔴 KRITICKÉ" in p)
                monitoring_count = sum(1 for p in findings_parts if "🟡 MONITORING" in p)

                header_parts = []
                if critical_count:
                    header_parts.append(f"{critical_count}x 🔴 KRITICKÉ")
                if monitoring_count:
                    header_parts.append(f"{monitoring_count}x 🟡 MONITORING")
                header = ", ".join(header_parts)

                findings = (
                    f"POZOR: V Obchodnom vestníku sa našli záznamy pre IČO {ico}: {header}.\n\n"
                    + "\n\n".join(findings_parts)
                )

            # Spočítať skutočný počet strán v finálnom PDF
            try:
                page_count = len(PdfReader(str(output_path)).pages)
            except Exception:
                page_count = 1 + len(screenshots)

            critical_count_total = sum(1 for _, typ, *_ in relevant_rows if _get_severity(typ) == "🔴 KRITICKÉ")
            monitoring_count_total = len(relevant_rows) - critical_count_total
            status_parts = []
            if critical_count_total:
                status_parts.append(f"{critical_count_total}x 🔴 kritických")
            if monitoring_count_total:
                status_parts.append(f"{monitoring_count_total}x 🟡 monitorovacích")
            status_msg = f"OV: {', '.join(status_parts)} záznamov." if status_parts else "OV: Žiadne relevantné záznamy."
            logger.info(f"[OV] Hotovo: {len(screenshots)} stiahnutých PDF, {page_count} strán — {status_msg}")

            return self._make_result(
                status="SUCCESS",
                file_path=str(output_path),
                page_count=page_count,
                status_message=status_msg,
                findings=findings,
            )

        except ScraperUnavailableError as e:
            logger.error(f"[OV] Nedostupné: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"Obchodný vestník nedostupný: {e}")
        except ScraperInputError as e:
            logger.error(f"[OV] Chybný vstup: {e}")
            return self._make_result(status="FAILED", status_message=f"Chybný vstup: {e}")
        except PlaywrightError as e:
            logger.error(f"[OV] Playwright chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba: {e}")
        except Exception as e:
            logger.error(f"[OV] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"Neznáma chyba: {type(e).__name__}: {e}")
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _hide_keyword_highlights(self, page: Page, delay: int = 500) -> None:
        """Skryť výskyty nájdených kľúčových slov pre čistejšie zobrazenie."""
        try:
            skryt_btn = page.get_by_text("Skryť výskyty nájdených kľúč")
            if await skryt_btn.count() > 0:
                await skryt_btn.click()
                await page.wait_for_timeout(delay)
        except Exception:
            pass

    async def _download_detail_pdf(self, page: Page, detail_url: str, output_path: Path) -> None:
        """Stiahne PDF z detail stránky.

        FormularDetail.aspx vracia priamo application/pdf — nie HTML stránku.
        Preto navigácia cez goto() padá (ERR_ABORTED). Správny postup:
        1. page.request.get() — používa session cookies z aktuálneho contextu
        2. Overiť Content-Type alebo magic bytes %PDF
        3. Záloha: vyskúšať bez csrt tokenu (niektoré verzie ho nepotrebujú)
        """
        async def _fetch_and_save(url: str) -> bool:
            try:
                response = await page.request.get(url, timeout=30000)
                if not response.ok:
                    logger.debug(f"[OV] PDF request failed: HTTP {response.status} for {url[:80]}")
                    return False
                content_type = response.headers.get("content-type", "")
                body = await response.body()
                if body[:4] == b'%PDF' or "pdf" in content_type.lower():
                    output_path.write_bytes(body)
                    logger.info(f"[OV] Detail PDF stiahnuté ({len(body)} bytes): {output_path.name}")
                    return True
                else:
                    logger.debug(f"[OV] Odpoveď nie je PDF — content-type={content_type}, first4={body[:4]}")
                    return False
            except Exception as e:
                logger.debug(f"[OV] PDF fetch zlyhal pre {url[:80]}: {e}")
                return False

        # Pokus 1: originálna URL so csrt tokenom
        ok = await _fetch_and_save(detail_url)

        # Pokus 2: URL bez csrt tokenu
        if not ok:
            url_no_csrt = re.sub(r'[&?]csrt=[^&]*', '', detail_url)
            logger.debug(f"[OV] Skúšam bez csrt: {url_no_csrt[:80]}")
            ok = await _fetch_and_save(url_no_csrt)

        if not ok:
            logger.warning(f"[OV] PDF sa nepodarilo stiahnuť pre: {detail_url[:80]}")



    async def _find_relevant_rows(self, page: Page) -> List[tuple]:
        """Prečíta tabuľku výsledkov a vráti zoznam relevantných riadkov.

        Returns: List of (row_index, typ_podania, subjekt, vestnik, cislo, datum)
        """
        rows = page.locator("table tbody tr")
        count = await rows.count()
        if count == 0:
            logger.warning("[OV] Tabuľka s výsledkami sa nenašla.")
            return []

        logger.info(f"[OV] Tabuľka má {count} riadkov.")

        relevant = []
        for i in range(count):
            cells = rows.nth(i).locator("td")
            cell_count = await cells.count()
            if cell_count < 6:
                continue

            try:
                # Stĺpec 2 = Typ podania (index 1)
                typ_podania = (await cells.nth(1).inner_text(timeout=3000)).strip()
                typ_podania = re.sub(r'\s+', ' ', typ_podania).strip()

                logger.debug(f"[OV] Riadok {i + 1}: typ='{typ_podania}'")

                if not _is_relevant(typ_podania):
                    continue

                # Stĺpce: 0=#, 1=Typ, 2=Subjekt, 3=Vestník, 4=Číslo, 5=Dátum, 6=Detail
                subjekt = ""
                vestnik = ""
                cislo = ""
                datum = ""
                if cell_count > 2:
                    subjekt = re.sub(r'\s+', ' ', (await cells.nth(2).inner_text(timeout=2000)).strip())
                if cell_count > 3:
                    vestnik = re.sub(r'\s+', ' ', (await cells.nth(3).inner_text(timeout=2000)).strip())
                if cell_count > 4:
                    cislo = re.sub(r'\s+', ' ', (await cells.nth(4).inner_text(timeout=2000)).strip())
                if cell_count > 5:
                    datum = re.sub(r'\s+', ' ', (await cells.nth(5).inner_text(timeout=2000)).strip())

                relevant.append((i, typ_podania, subjekt, vestnik, cislo, datum))
                logger.info(f"[OV] Relevantný riadok {i + 1}: {typ_podania} | {subjekt} | {vestnik} | {cislo} | {datum}")

            except Exception as e:
                logger.warning(f"[OV] Chyba pri čítaní riadku {i + 1}: {e}")
                continue

        return relevant

    def _merge_details_into_pdf(self, main_pdf: Path, screenshots_dir: Path, num_details: int) -> None:
        """Pripojí detail PDF (ak existuje) alebo screenshot PNG (ako PDF stránku) do hlavného PDF.

        Pre každý relevantný záznam skúsi:
        1. ov_detail_N.pdf (ak sa podarilo stiahnuť PDF z embed elementu)
        2. ov_detail_N.png (screenshot — konvertovaný na PDF stránku cez reportlab)
        """
        try:
            writer = PdfWriter()
            writer.append(str(main_pdf))

            for idx in range(1, num_details + 1):
                detail_pdf = screenshots_dir / f"ov_detail_{idx}.pdf"
                screenshot_png = screenshots_dir / f"ov_detail_{idx}.png"

                if detail_pdf.exists():
                    try:
                        writer.append(str(detail_pdf))
                        logger.info(f"[OV] Pripojené detail PDF {idx} do hlavného PDF")
                        continue
                    except Exception as e:
                        logger.warning(f"[OV] Nepodarilo sa pripojiť detail PDF {idx}: {e}")

                if screenshot_png.exists():
                    try:
                        detail_pdf_page = self._screenshot_to_pdf(screenshot_png, screenshots_dir / f"ov_detail_{idx}_page.pdf")
                        writer.append(str(detail_pdf_page))
                        logger.info(f"[OV] Pripojený screenshot {idx} ako PDF stránka")
                    except Exception as e:
                        logger.warning(f"[OV] Nepodarilo sa konvertovať screenshot {idx}: {e}")

            with open(main_pdf, "wb") as f:
                writer.write(f)
            writer.close()
            logger.info(f"[OV] Detaily zlúčené do hlavného PDF: {main_pdf}")

        except Exception as e:
            logger.error(f"[OV] Zlúčenie detailov zlyhalo: {e}")

    @staticmethod
    def _screenshot_to_pdf(png_path: Path, output_pdf: Path) -> Path:
        """Konvertuje PNG screenshot na jednostranové PDF (A4 landscape)."""
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.utils import ImageReader
        from reportlab.platypus import SimpleDocTemplate, Image, Spacer
        from reportlab.lib.units import cm

        img = ImageReader(str(png_path))
        img_w, img_h = img.getSize()

        page_w, page_h = landscape(A4)
        margin = 1 * cm
        avail_w = page_w - 2 * margin
        avail_h = page_h - 2 * margin

        scale = min(avail_w / img_w, avail_h / img_h)
        scaled_w = img_w * scale
        scaled_h = img_h * scale

        doc = SimpleDocTemplate(
            str(output_pdf),
            pagesize=landscape(A4),
            leftMargin=margin, rightMargin=margin,
            topMargin=margin, bottomMargin=margin,
        )
        story = [Image(str(png_path), width=scaled_w, height=scaled_h)]
        doc.build(story)
        return output_pdf

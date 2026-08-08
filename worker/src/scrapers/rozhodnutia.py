import asyncio
import json
import logging
import re
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import httpx
from playwright.async_api import Page

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_API_URL = "https://obcan.justice.sk/pilot/api/ress-isu-service/v1/rozhodnutie"
_API_TIMEOUT = 30
_API_RETRIES = 2
_API_RETRY_DELAY = 2.0


def _fix_mojibake(text: str) -> str:
    """Opraví double-encoded UTF-8 text z ISU API.

    ISU API vracia text, ktorý bol pôvodne UTF-8, ale bol interpretovaný
    ako Windows-1250 a znova encodovaný do UTF-8.
    Príklad: 'MĂˇ' → 'Má', 'zamestnĂˇvateÄľa' → 'zamestnávateľa'

    Fix: encode do cp1250 (získame pôvodné UTF-8 bajty), decode ako UTF-8.

    Dôležité: Fix sa aplikuje LEN ak text obsahuje 'Ă' — znak ktorý
    nikdy nie je v správnom slovenskom texte. Niektoré záznamy (napr.
    BILLA) API vracia správne UTF-8 a fix by ich pokazil.
    """
    if not text:
        return text
    # 'Ă' (U+0102) je signatúra double-encodingu — nikdy nie v správnom texte
    if 'Ă' not in text:
        return text
    try:
        return text.encode('cp1250').decode('utf-8', errors='replace')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def _clean_zvyraznenie(text: str) -> str:
    """Vyčistí highlight snippet z ISU API:
    - opraví mojibake (double-encoded UTF-8)
    - odstráni HTML tagy (<span class="highlight-substring">...)
    - odstráni ECLI kódy
    - odstráni nadbytočné prázdne riadky
    - skráti príliš dlhé texty
    """
    if not text:
        return ""
    # Oprav mojibake (ISU API vracia double-encoded text)
    text = _fix_mojibake(text)
    # Odstráni HTML tagy
    text = re.sub(r'<[^>]+>', '', text)
    # Odstráni ECLI kódy (ECLI:SK:OSTT:2026:... alebo ECLI: ECLI:SK:...)
    text = re.sub(r'ECLI:\s*ECLI:[\w:.]+', '', text)
    text = re.sub(r'\bECLI:[\w:.]+', '', text)
    # Normalizuje prázdne riadky a medzery
    text = re.sub(r'\n\s*\n', '\n', text)
    text = re.sub(r' +', ' ', text)
    text = text.strip()
    # Skráti na max 300 znakov (odseknuté fragmenty sú často dlhé a neúplné)
    if len(text) > 300:
        text = text[:297] + "..."
    return text

class RozhodnutiaScraper(BaseScraper):
    source_type = "ROZHODNUTIA"
    _title = "Rozhodnutia súdov"
    _BASE_URL = "https://www.justice.gov.sk/sudy-a-rozhodnutia/sudy/rozhodnutia/"

    async def _fetch_api(self, ico: str) -> dict:
        """Stiahne rozhodnutia z ISU API cez httpx s unified retry logikou."""
        import random as _rand
        params = {
            "page": 1,
            "size": 50,
            "sortDirection": "DESC",
            "sortProperty": "datum_vydania_rozhodnutia",
            "query": ico,
        }
        headers = {"User-Agent": "Mozilla/5.0 (compatible; Verifa/1.0)"}

        attempts = _API_RETRIES + 1  # 3 pokusy
        for attempt in range(1, attempts + 1):
            try:
                async with httpx.AsyncClient(
                    timeout=_API_TIMEOUT, headers=headers, follow_redirects=True
                ) as client:
                    resp = await client.get(_API_URL, params=params)

                    if resp.status_code == 200:
                        try:
                            return resp.json()
                        except json.JSONDecodeError:
                            logger.error(f"[{self.source_type}] Neplatný JSON z API (attempt {attempt}/{attempts})")
                            if attempt < attempts:
                                delay = _API_RETRY_DELAY * (2 ** (attempt - 1)) * _rand.uniform(0.7, 1.3)
                                await asyncio.sleep(delay)
                                continue
                            return {}

                    # Retryable errors
                    if resp.status_code >= 500 or resp.status_code == 429:
                        if attempt < attempts:
                            delay = _API_RETRY_DELAY * (2 ** (attempt - 1)) * _rand.uniform(0.7, 1.3)
                            if resp.status_code == 429:
                                delay *= 3
                            logger.warning(
                                f"[{self.source_type}] API HTTP {resp.status_code} (attempt {attempt}/{attempts}), retry za {delay:.1f}s"
                            )
                            await asyncio.sleep(delay)
                            continue

                    logger.error(f"[{self.source_type}] API HTTP {resp.status_code}: {resp.text[:200]}")
                    return {}

            except httpx.TimeoutException:
                logger.warning(f"[{self.source_type}] API timeout (attempt {attempt}/{attempts})")
                if attempt < attempts:
                    delay = _API_RETRY_DELAY * (2 ** (attempt - 1)) * _rand.uniform(0.7, 1.3)
                    await asyncio.sleep(delay)
                    continue
                raise ScraperUnavailableError("ISU API timeout")

            except httpx.HTTPError as e:
                logger.warning(f"[{self.source_type}] API network error (attempt {attempt}/{attempts}): {e}")
                if attempt < attempts:
                    delay = _API_RETRY_DELAY * (2 ** (attempt - 1)) * _rand.uniform(0.7, 1.3)
                    await asyncio.sleep(delay)
                    continue
                raise ScraperUnavailableError(f"ISU API network error: {e}")

        return {}

    async def run(
        self, *, ico: str, output_dir: Path, rozhodnutia_date_from: Optional[str] = None, **kwargs
    ) -> ScrapedSource:
        try:
            logger.info(f"[{self.source_type}] Start IČO={ico}")

            cutoff_date = self._get_cutoff_date(rozhodnutia_date_from)
            logger.info(f"[{self.source_type}] Cutoff date: {cutoff_date}")

            # Fetch API cez httpx (bez Playwright)
            data = await self._fetch_api(ico)
            decisions = data.get("rozhodnutieList", [])
            
            if not decisions:
                # Žiadne rozhodnutia vôbec
                logger.info(f"[{self.source_type}] Žiadne rozhodnutia pre IČO {ico}.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Pre IČO {ico} sa nenašli rozhodnutia za ostatné obdobie.",
                    findings="Za ostatné obdobie sa nenašli rozhodnutia súdov.",
                )

            # Skontrolovať či sú rozhodnutia novšie ako cutoff
            recent_decisions = []
            for d in decisions:
                d_str = d.get("datumVydania", "")
                try:
                    d_obj = datetime.strptime(d_str, "%d.%m.%Y").date()
                    if d_obj >= cutoff_date:
                        recent_decisions.append(d)
                except ValueError:
                    continue
                    
            if not recent_decisions:
                logger.info(f"[{self.source_type}] Rožhodnutia pre IČO {ico} existujú ale sú staršie ako {cutoff_date}.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Pre IČO {ico} sa nenašli rozhodnutia za ostatné obdobie.",
                    findings="Za ostatné obdobie sa nenašli rozhodnutia súdov.",
                )

            # Vytvoríme findings
            rozsudky = sum(1 for d in recent_decisions if "Rozsudok" in d.get("formaRozhodnutia", ""))
            uznesenia = sum(1 for d in recent_decisions if "Uznesenie" in d.get("formaRozhodnutia", ""))
            
            parts = []
            if rozsudky > 0:
                parts.append(f"Rozsudok ({rozsudky}x)")
            if uznesenia > 0:
                parts.append(f"Uznesenie ({uznesenia}x)")
            
            findings = f"POZOR: Za ostatné obdobie sa našli rozhodnutia súdov ({', '.join(parts)}). Odporúčame urobiť kontrolu."

            # Vygenerovať HTML a PDF
            html_rows = []
            for d in recent_decisions:
                zvyraznenie_parts = [_clean_zvyraznenie(z) for z in d.get("zvyraznenie", [])]
                zvyraznenie_parts = [z for z in zvyraznenie_parts if z]  # vynechaj prázdne
                zvyraznenie = "<br/>".join(zvyraznenie_parts)
                html_rows.append(f'''
                <div class="isu-list-item">
                    <div class="isu-list-item-title-link">{d.get("formaRozhodnutia", "")} {d.get("spisovaZnacka", "")} - {d.get("datumVydania", "")}</div>
                    <div><strong>Súd:</strong> {d.get("sud", {}).get("nazov", "")}</div>
                    <div><strong>Sudca:</strong> {d.get("sudca", {}).get("meno", "")}</div>
                    <div style="margin-top: 8px; font-style: italic;">{zvyraznenie}</div>
                </div>
                ''')
            
            html_content = f'''
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: 'Arial', sans-serif; padding: 40px 20px 20px 20px; }}
                    h1 {{ font-size: 20px; font-weight: 700; margin: 0 0 16px 0; color: #0f172a; text-align: center; }}
                    .isu-list-item {{ page-break-inside: avoid; margin-bottom: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
                    .isu-list-item-title-link {{ font-weight: 600; color: #1e40af; font-size: 14px; margin-bottom: 4px; }}
                    strong {{ color: #475569; }}
                    .highlight-substring {{ background-color: #fef08a; font-weight: bold; }}
                </style>
            </head>
            <body>
                <h1>Rozhodnutia súdov — IČO {ico}</h1>
                {"".join(html_rows)}
            </body>
            </html>
            '''
            
            pdf_path = output_dir / f"{self.source_type}_{ico}.pdf"

            # PDF generovanie cez Playwright set_content (bez navigácie)
            page: Optional[Page] = None
            try:
                page = await self._get_page(block_images=False)
                await page.set_content(html_content, wait_until="domcontentloaded")
                await page.pdf(
                    path=str(pdf_path),
                    format="A4",
                    print_background=True,
                    margin={"top": "1cm", "bottom": "1cm", "left": "1cm", "right": "1cm"},
                )
            finally:
                if page:
                    try:
                        await page.close()
                    except Exception as close_err:
                        logger.debug(f"[{self.source_type}] Page close zlyhal: {close_err}")

            logger.info(f"[{self.source_type}] PDF vygenerované: {pdf_path}")

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_path),
                page_count=1,
                status_message=f"Nájdené rozhodnutia pre IČO {ico} za ostatné obdobie.",
                findings=findings,
                raw_data=recent_decisions,
            )

        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Chyba pri IČO {ico}: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Interná chyba scrapera: {str(e)}"
            )

    def _get_cutoff_date(self, date_str: Optional[str]) -> date:
        if date_str:
            try:
                return datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                pass
        today = date.today()
        try:
            return today.replace(year=today.year - 1)
        except ValueError:
            return today.replace(year=today.year - 1, day=28)

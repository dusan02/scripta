import json
import logging
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class RozhodnutiaScraper(BaseScraper):
    source_type = "ROZHODNUTIA"
    _title = "Rozhodnutia súdov"
    _BASE_URL = "https://www.justice.gov.sk/sudy-a-rozhodnutia/sudy/rozhodnutia/"

    async def run(
        self, *, ico: str, output_dir: Path, rozhodnutia_date_from: Optional[str] = None, **kwargs
    ) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Start IČO={ico}")

            cutoff_date = self._get_cutoff_date(rozhodnutia_date_from)
            logger.info(f"[{self.source_type}] Cutoff date: {cutoff_date}")

            # Priamy API prístup
            api_url = f"https://obcan.justice.sk/pilot/api/ress-isu-service/v1/rozhodnutie?page=1&size=50&sortDirection=DESC&sortProperty=datum_vydania_rozhodnutia&query={ico}"
            logger.info(f"[{self.source_type}] Fetching API {api_url}")

            page = await self._get_page(block_images=False)
            await self._safe_goto(page, api_url)
            
            # Extrahuje text z body (bude to JSON stringified v prehliadači)
            json_text = await page.evaluate("() => document.body.innerText")
            
            try:
                data = json.loads(json_text)
            except json.JSONDecodeError:
                logger.error(f"[{self.source_type}] Neplatný JSON z API: {json_text[:200]}")
                data = {}

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
                zvyraznenie = "<br/>".join(d.get("zvyraznenie", []))
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
            await page.set_content(html_content)
            
            await page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                margin={"top": "1cm", "bottom": "1cm", "left": "1cm", "right": "1cm"},
            )
            
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
        finally:
            if page:
                await page.close()

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

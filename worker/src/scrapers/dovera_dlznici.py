from __future__ import annotations
import asyncio
import logging
import re
from pathlib import Path
from typing import Literal, Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError, retry_async_call
from ..config import settings
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_SCRAPER_TIMEOUT = 45  # max seconds per attempt (3 attempts fit inside 120s outer timeout)
_MAX_RETRIES = 3
_RETRY_DELAY = settings.scraper_retry_delay


class DoveraDlzniciScraper(BaseScraper):
    """Scraper pre Dôveru zdravotnú poisťovňu — Zoznam dlžníkov na zdravotnom poistení."""

    source_type = "DOVERA_DLZNICI"
    base_url = "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico}")
            pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"

            # Dôvera search form submits GET ?q=<ico> and SSR-renders results into
            # ul > li.dlznici__item (debtor) or "sme nenašli žiadne výsledky" (clean).
            # Navigating directly with ?q= avoids cookie-banner / double-input-q
            # form interactions and cuts ~25s of timeouts per run.
            from .mixins import SKIP_PDF_VAR
            if SKIP_PDF_VAR.get():
                async def _block_heavy(route):
                    req = route.request
                    if req.resource_type in ("image", "media", "font", "stylesheet") or any(
                        d in req.url for d in ("usercentrics", "googletagmanager", "google-analytics", "facebook", "hotjar", "doubleclick")
                    ):
                        await route.abort()
                    else:
                        await route.continue_()
                await page.route("**/*", _block_heavy)

            search_url = f"{self.base_url}?q={ico}"
            try:
                await page.goto(search_url, timeout=25000, wait_until="domcontentloaded")
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                logger.warning(f"[{self.source_type}] Dôvera nedostupná ({e}) — fallback PDF.")
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=False, has_no_results_text=False)
                return self._make_result(status="UNAVAILABLE", file_path=str(pdf_output), page_count=1, status_message="Dôvera: dáta dočasne nedostupné.", findings="Dáta dočasne nedostupné — skúste vygenerovať report znovu.")

            # Wait for SSR result list or empty-result message (NOT 'table tbody tr',
            # which never existed on Dôvera and previously wasted 15s every call).
            no_results = page.locator("text=sme nenašli žiadne výsledky")
            debtor_item = page.locator("li.dlznici__item")
            try:
                await no_results.or_(debtor_item).first.wait_for(timeout=8000)
            except PlaywrightTimeoutError:
                # Only if SSR results did not render, check whether Cloudflare blocked us
                if await page.locator("iframe[src*='challenges.cloudflare.com']").count() > 0:
                    await self._handle_cloudflare_challenge(page, max_attempts=1)
                    try:
                        await no_results.or_(debtor_item).first.wait_for(timeout=8000)
                    except PlaywrightTimeoutError:
                        pass

            # Dismiss cookie banner only when we actually need a clean PDF screenshot
            from .mixins import SKIP_PDF_VAR
            if not SKIP_PDF_VAR.get():
                await self._accept_cookies(page)

            body_text = await page.inner_text("body")
            is_empty = "sme nenašli žiadne výsledky" in body_text
            has_ico_on_page = ico in re.findall(r"\d+", body_text)

            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_findings(page, ico)
                is_debtor = findings is not None and "POZOR" in (findings or "")
                if is_debtor and findings and not self._ico_in_findings(ico, findings):
                    is_debtor = False
                    findings = None

            # Ambiguous guard: neither empty message nor debtor row rendered
            if not is_debtor and not is_empty:
                logger.warning(f"[{self.source_type}] Nejednoznačná odpoveď Dôvery pre IČO {ico}.")
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=has_ico_on_page, has_no_results_text=False)
                return self._make_result(status="UNAVAILABLE", file_path=str(pdf_output), page_count=1, status_message="Dôvera: nepodarilo sa potvrdiť výsledok vyhľadávania.", findings="Dáta dočasne nedostupné — skúste vygenerovať report znovu.")

            if not is_debtor or findings is None:
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov Dôvery.")
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov Dôvery."
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=has_ico_on_page, has_no_results_text=is_empty)
                return self._make_result(status="SUCCESS", file_path=str(pdf_output), page_count=1, status_message=f"Subjekt {ico} nie je v zozname dlžníkov Dôvery.", findings=findings, has_finding=False)

            # Debtor found — hide ad banner, generate clean PDF
            try:
                await page.evaluate("""() => {
                    const allEls = document.querySelectorAll('div, section, article');
                    for (const el of allEls) {
                        if (el.innerText && el.innerText.includes('Nenašli ste sa v zozname dlžníkov') && el.innerText.length < 500) {
                            el.style.display = 'none';
                        }
                    }
                }""")
            except Exception:
                pass

            await self._generate_clean_pdf(page, pdf_output, title="Zoznam dlžníkov Dôvera")
            return self._make_result(status="SUCCESS", file_path=str(pdf_output), page_count=1, status_message=f"Subjekt {ico} je v zozname dlžníkov Dôvery.", findings=findings, has_finding=True)

        async def _do_scrape() -> ScrapedSource:
            result = await asyncio.wait_for(
                self._run_debtor_scraper(_scrape, unavailable_msg="Register Dôvery je nedostupný", max_attempts=1),
                timeout=_SCRAPER_TIMEOUT,
            )
            if result.status == "SUCCESS":
                return result
            raise ScraperUnavailableError(f"Dôvera: pokus vrátil {result.status}")

        from .mixins import SKIP_PDF_VAR
        is_live = SKIP_PDF_VAR.get()
        max_attempts = 1 if is_live else _MAX_RETRIES
        try:
            return await retry_async_call(
                _do_scrape,
                source_type=self.source_type,
                max_attempts=max_attempts,
                base_delay=1.0 if is_live else _RETRY_DELAY,
            )
        except ScraperUnavailableError:
            logger.error(f"[{self.source_type}] Všetky {max_attempts} pokusy zlyhali pre IČO {ico}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message="Dôvera: dočasne nedostupné — skúste vygenerovať report znovu.",
            )

    async def _accept_cookies(self, page: Page) -> None:
        """Usercentrics CMP — tlačidlo '#accept' je v shadow DOM."""
        for sel in ["#accept", "button.uc-accept-button"]:
            try:
                btn = page.locator(sel).first
                await btn.wait_for(state="visible", timeout=2000)
                await btn.click()
                logger.info(f"[{self.source_type}] Cookies prijaté cez '{sel}'.")
                return
            except (PlaywrightTimeoutError, PlaywrightError):
                continue

    async def _extract_findings(self, page: Page, ico: str) -> Optional[str]:
        """Extrahuje nálezy zo zoznamu li.dlznici__item (vrátane dlžnej sumy v .item-sum)."""
        try:
            items = page.locator("li.dlznici__item")
            item_count = await items.count()
            texts: list[str] = []
            for i in range(min(item_count, 5)):
                try:
                    raw = (await items.nth(i).inner_text(timeout=2000)).strip()
                    if ico not in raw:
                        continue
                    # Strip UI action button labels ("Riešiť dlh", "Namietať")
                    cleaned = re.sub(r"\b(Riešiť dlh|Namietať)\b", "", raw)
                    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in cleaned.splitlines()]
                    cleaned = " | ".join(ln for ln in lines if ln)
                    if cleaned:
                        texts.append(cleaned)
                except PlaywrightTimeoutError:
                    continue

            # Fallback if Dôvera changes list markup
            if not texts:
                elements = page.locator(f"text={ico}")
                count = await elements.count()
                for i in range(min(count, 5)):
                    try:
                        parent = elements.nth(i).locator("xpath=../..")
                        parent_text = re.sub(r"\s+", " ", (await parent.inner_text(timeout=2000)).strip())
                        if parent_text and ico in parent_text:
                            texts.append(parent_text)
                    except PlaywrightTimeoutError:
                        continue

            if not texts:
                return None

            parts = [f"POZOR: Subjekt (IČO: {ico}) je v zozname dlžníkov Dôvery."] + texts
            findings = "\n".join(parts)
            logger.info(f"[{self.source_type}] Findings extrahované: {findings[:200]}")
            return findings
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None

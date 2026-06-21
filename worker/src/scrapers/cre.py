from __future__ import annotations
"""
CreScraper — Centrálny register exekúcií (www.cre.sk)

Platený register — implementovaný ako web form scraper.

# POZNÁMKA: Produkčné použitie vyžaduje prihlásenie na cre.sk (účet / API kľúč).
# Bez platného prihlásenia vyhľadávanie vráti status UNAVAILABLE.
# Prihlasovacie údaje nastavte cez environment premenné:
#   CRE_USERNAME, CRE_PASSWORD
# alebo použite API kľúč cez hlavičku (ak cre.sk ponúka API v budúcnosti).
"""
from pathlib import Path
from typing import Optional

from playwright.async_api import Page

from .base import BaseScraper, ScraperUnavailableError
from ..config import settings
from ..models import ScrapedSource


class CreScraper(BaseScraper):
    """
    Scraper pre Centrálny register exekúcií SR (cre.sk).

    - COMPANY: vyhľadáva podľa IČO
    - PERSON:  vyhľadáva podľa mena + priezviska + dátumu narodenia

    Selektory sú skeleton — je potrebné ich overiť oproti aktuálnej verzii webu.
    Produkčné použitie vyžaduje platný účet / API kľúč na cre.sk.
    """

    source_type = "CRE"
    base_url = "https://www.cre.sk"
    _search_url = "https://www.cre.sk/vyhladavanie"
    _login_url = "https://www.cre.sk/prihlasenie"

    async def run(
        self,
        *,
        output_dir: Path,
        target_type: str,
        ico: Optional[str] = None,
        name: Optional[str] = None,
        surname: Optional[str] = None,
        birth_date: Optional[str] = None,
        **kwargs,
    ) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            page = await self._get_page()

            # Prihlásenie — vyžaduje platný účet.
            login_success = await self._login(page)
            if not login_success:
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message=(
                        "Register CRE je platený. Prihlásenie sa nepodarilo. "
                        "Nastavte CRE_USERNAME a CRE_PASSWORD v konfigurácii."
                    ),
                )

            if target_type == "COMPANY":
                result = await self._search_company(page, ico=ico, output_dir=output_dir)
            else:
                result = await self._search_person(
                    page,
                    name=name,
                    surname=surname,
                    birth_date=birth_date,
                    output_dir=output_dir,
                )
            return result

        except ScraperUnavailableError as e:
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register CRE je nedostupný: {e}",
            )
        except Exception as e:
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri spracovaní CRE: {type(e).__name__}: {e}",
            )
        finally:
            if page:
                await page.close()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _login(self, page: Page) -> bool:
        """
        Prihlási sa do cre.sk pomocou konfigurácie.
        Vráti True ak prihlásenie prebehlo úspešne.
        """
        cre_username: Optional[str] = getattr(settings, "cre_username", None)
        cre_password: Optional[str] = getattr(settings, "cre_password", None)

        if not cre_username or not cre_password:
            return False

        try:
            await self._safe_goto(page, self._login_url)
            await page.fill("input[name='username'], input[type='email']", cre_username, timeout=10_000)
            await page.fill("input[name='password'], input[type='password']", cre_password, timeout=10_000)
            await page.click("button[type='submit'], input[type='submit']", timeout=10_000)
            await page.wait_for_load_state("networkidle", timeout=30_000)

            # Overenie prihlásenia — odhlasovací prvok / chybová hláška.
            login_error = await page.locator("text=Nesprávne prihlasovacie údaje").count()
            if login_error > 0:
                return False

            return True
        except Exception:
            return False

    async def _search_company(
        self,
        page: Page,
        *,
        ico: Optional[str],
        output_dir: Path,
    ) -> ScrapedSource:
        """Vyhľadá firmu podľa IČO v CRE."""
        if not ico:
            return self._make_result(
                status="FAILED",
                status_message="IČO je povinné pre vyhľadávanie firmy v CRE.",
            )

        try:
            await self._safe_goto(page, self._search_url)
            await page.fill("input[name='ico'], input[id*='ico']", ico, timeout=10_000)
            await page.click("button[type='submit'], input[type='submit']", timeout=10_000)
            await page.wait_for_load_state("networkidle", timeout=30_000)
        except Exception as e:
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri vyhľadávaní v CRE (firma, IČO={ico}): {e}",
            )

        return await self._process_results(page, label=f"ico_{ico}", output_dir=output_dir)

    async def _search_person(
        self,
        page: Page,
        *,
        name: Optional[str],
        surname: Optional[str],
        birth_date: Optional[str],
        output_dir: Path,
    ) -> ScrapedSource:
        """Vyhľadá fyzickú osobu v CRE."""
        if not name or not surname:
            return self._make_result(
                status="FAILED",
                status_message="Meno a priezvisko sú povinné pre vyhľadávanie osoby v CRE.",
            )

        try:
            await self._safe_goto(page, self._search_url)
            await page.fill("input[name='meno'], input[id*='meno']", name, timeout=10_000)
            await page.fill("input[name='priezvisko'], input[id*='priezvisko']", surname, timeout=10_000)
            if birth_date:
                await page.fill("input[name='datumNarodenia'], input[id*='datumNar']", birth_date, timeout=5_000)
            await page.click("button[type='submit'], input[type='submit']", timeout=10_000)
            await page.wait_for_load_state("networkidle", timeout=30_000)
        except Exception as e:
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri vyhľadávaní v CRE (osoba, {surname} {name}): {e}",
            )

        safe_label = f"{surname.lower()}_{name.lower()}".replace(" ", "_")
        return await self._process_results(page, label=safe_label, output_dir=output_dir)

    async def _process_results(
        self,
        page: Page,
        *,
        label: str,
        output_dir: Path,
    ) -> ScrapedSource:
        """Spracuje výsledkovú stránku CRE — parsuje exekúcie a uloží PDF."""
        findings = await self._extract_findings(page)

        pdf_output = output_dir / f"cre_{label}.pdf"
        await self._print_page_to_pdf(page, pdf_output)

        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message="Výsledok vyhľadávania v CRE uložený.",
            findings=findings,
        )

    async def _extract_findings(self, page: Page) -> Optional[str]:
        """
        Parsuje výsledky CRE — počet exekúcií a ich stav.

        Vráti textové zhrnutie:
          - "Žiadne exekúcie"
          - "X aktívnych exekúcií"
          - "X ukončených exekúcií"
        """
        try:
            # Detekcia prázdneho výsledku.
            no_result_indicators = [
                "text=Žiadne záznamy",
                "text=Neboli nájdené žiadne exekúcie",
                "text=0 exekúcií",
            ]
            for indicator in no_result_indicators:
                count = await page.locator(indicator).count()
                if count > 0:
                    return "Žiadne exekúcie v Centrálnom registri exekúcií."

            # Počítanie aktívnych exekúcií.
            active_rows = await page.locator("tr:has-text('aktívna'), tr:has-text('Aktívna')").count()
            ended_rows = await page.locator("tr:has-text('ukončená'), tr:has-text('Ukončená')").count()
            all_rows = await page.locator("table tbody tr").count()

            parts = []
            if active_rows > 0:
                parts.append(f"{active_rows} aktívna/-ych exekúcia/-í — POZOR!")
            if ended_rows > 0:
                parts.append(f"{ended_rows} ukončená/-ych exekúcia/-í.")
            if not parts and all_rows > 0:
                parts.append(f"Nájdených {all_rows} záznamov v CRE.")

            if parts:
                return " ".join(parts)

            return "Žiadne exekúcie v Centrálnom registri exekúcií."

        except Exception:
            return None

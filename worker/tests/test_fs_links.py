"""
Smoke testy pre Finančnú správu — overia že linky a input polia
na stránke zoznamov stále existujú a nezmenili sa.

Spustenie:
    .venv/bin/pytest tests/test_fs_links.py -v

Alebo len jeden scraper:
    .venv/bin/pytest tests/test_fs_links.py -v -k fs_dph_vymazani
"""
import asyncio
import pytest
from playwright.async_api import async_playwright

from src.scrapers.fs import FinancnaSpravaScraper
from src.scrapers.fs_dph_rusenie import FsDphRusenieScraper
from src.scrapers.fs_dph_vymazani import FsDphVymazaniScraper
from src.scrapers.fs_danove_subjekty import FsDanoveSubjektyScraper
from src.scrapers.fs_dan_z_prijmov import FsDanZPrijmovScraper
from src.scrapers.fs_dph_nadmerny_odpocet import FsDphNadmernyOdpocetScraper
from src.scrapers.fs_dph_registrovani import FsDphRegistrovaniScraper
from src.scrapers.fs_dan_prijmov_reg import FsDanPrijmovRegistrovaniScraper

FS_BASE_URL = "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy"

ALL_FS_SCRAPERS = [
    FinancnaSpravaScraper,
    FsDphRusenieScraper,
    FsDphVymazaniScraper,
    FsDanoveSubjektyScraper,
    FsDanZPrijmovScraper,
    FsDphNadmernyOdpocetScraper,
    FsDphRegistrovaniScraper,
    FsDanPrijmovRegistrovaniScraper,
]

# Semaphore — FS rate-limituje pri paralelných requestoch
_fs_test_lock = asyncio.Lock()


async def _get_fs_page():
    """Načíta FS zoznamy stránku a zavrie modaly. Vráti (pw, browser, page)."""
    async with _fs_test_lock:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(FS_BASE_URL, timeout=60000, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        try:
            btn = page.get_by_role("button", name="www.info-efaktura.sk")
            await btn.wait_for(timeout=5000)
            async with page.context.expect_page(timeout=5000) as popup_info:
                await btn.click()
            popup = await popup_info.value
            await popup.close()
            await page.wait_for_timeout(1000)
        except Exception:
            pass

        try:
            roz = page.get_by_role("button", name="Rozumiem")
            await roz.wait_for(timeout=3000)
            await roz.click()
            await page.wait_for_timeout(1000)
        except Exception:
            pass

        return pw, browser, page


async def _cleanup(pw, browser, page):
    try:
        await page.close()
    except Exception:
        pass
    try:
        await browser.close()
    except Exception:
        pass
    try:
        await pw.stop()
    except Exception:
        pass


@pytest.mark.asyncio
async def test_fs_site_loads():
    """Overí že FS zoznamy stránka načíta bez blokácie."""
    pw, browser, page = await _get_fs_page()
    try:
        text = await page.inner_text("body")
        assert "Server je nedostupný" not in text, "FS zablokovala prístup"
        assert len(text) > 100, "Stránka je prázdna"
    finally:
        await _cleanup(pw, browser, page)


@pytest.mark.asyncio
async def test_fs_site_has_links():
    """Overí že na stránke sú vôbec nejaké linky s 'Zoznam'."""
    pw, browser, page = await _get_fs_page()
    try:
        links = page.locator("a:has-text('Zoznam')")
        cnt = await links.count()
        assert cnt > 0, "Na stránke sa nenašli žiadne linky obsahujúce 'Zoznam'"
    finally:
        await _cleanup(pw, browser, page)


@pytest.mark.asyncio
@pytest.mark.parametrize("scraper_cls", ALL_FS_SCRAPERS, ids=[s.source_type for s in ALL_FS_SCRAPERS])
async def test_fs_link_exists(scraper_cls):
    """Overí že konkrétny zoznam_link_name existuje ako link na FS stránke."""
    pw, browser, page = await _get_fs_page()
    try:
        link = page.get_by_role("link", name=scraper_cls.zoznam_link_name, exact=False)
        cnt = await link.count()
        assert cnt > 0, (
            f"Link '{scraper_cls.zoznam_link_name}' sa nenašiel na FS stránke. "
            f"Pravdepodobne FS zmenila názov — aktualizuj zoznam_link_name v {scraper_cls.__module__}"
        )
    finally:
        await _cleanup(pw, browser, page)


@pytest.mark.asyncio
@pytest.mark.parametrize("scraper_cls", ALL_FS_SCRAPERS, ids=[s.source_type for s in ALL_FS_SCRAPERS])
async def test_fs_detail_page_has_search_input(scraper_cls):
    """Overí že po kliknutí na link sa na detailnej stránke nájde vyhľadávacie pole."""
    pw, browser, page = await _get_fs_page()
    try:
        link = page.get_by_role("link", name=scraper_cls.zoznam_link_name, exact=False).first
        await link.wait_for(timeout=10000)
        await link.click()
        await page.wait_for_load_state("domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)

        inputs = page.locator("input[type='text'], input:not([type])")
        cnt = await inputs.count()
        assert cnt > 0, (
            f"Na detailnej stránke pre {scraper_cls.source_type} sa nenašiel žiadny text input. "
            f"Možno FS zmenila formulár."
        )
    finally:
        await _cleanup(pw, browser, page)

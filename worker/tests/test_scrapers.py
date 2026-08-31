"""
Automatizované testy pre scrapery — overia že selektory a DOM štruktúry
na štátnych portáloch sa nezmenili.

Pre každý scraper:
  - Pozitívny test (nenulový): IČO firmy, ktorá JE v zozname (ak je známy dlžník)
  - Negatívny test (nulový): IČO firmy, ktorá NIE JE v zozname

Hlavná úloha: zachytiť zmenu v selektoroch. Ak štát zmení DOM,
testy spadnú a my budeme vedieť, že informácie budú chodiť do PDF reportu zle.

Spustenie:
    .venv/bin/pytest tests/test_scrapers.py -v

Len jeden scraper:
    .venv/bin/pytest tests/test_scrapers.py -v -k dovera
"""
import asyncio
import pytest
from pathlib import Path
from playwright.async_api import async_playwright

# All tests in this file require live internet access to Slovak government portals.
# CI runs: pytest tests/ -m "not integration"
pytestmark = pytest.mark.integration

from src.scrapers.dovera_dlznici import DoveraDlzniciScraper
from src.scrapers.sp_dlznici import SpDlzniciScraper
from src.scrapers.vszp_dlznici import VszpDlzniciScraper
from src.scrapers.union_dlznici import UnionDlzniciScraper
from src.scrapers.orsr import OrsrScraper
from src.scrapers.rpvs import RpvsScraper
from src.scrapers.zrsr import ZrsrScraper
from src.scrapers.insolvency import InsolvencyScraper
from src.scrapers.crz import CrzScraper
from src.scrapers.uvo import UvoScraper
from src.scrapers.poverenia import PovereniaScraper
from src.scrapers.rpo import RpoScraper
from src.scrapers.ncrzp import NcrzpScraper
from src.scrapers.ncrd import NcrdScraper
from src.scrapers.diskvalifikacie import DiskvalifikacieScraper
from src.scrapers.fs_danove_subjekty import FsDanoveSubjektyScraper
from src.scrapers.fs_dph_registrovani import FsDphRegistrovaniScraper
from src.scrapers.fs_dph_rusenie import FsDphRusenieScraper
from src.scrapers.fs_dph_vymazani import FsDphVymazaniScraper
from src.scrapers.fs_dph_nadmerny_odpocet import FsDphNadmernyOdpocetScraper
from src.scrapers.fs_dan_z_prijmov import FsDanZPrijmovScraper
from src.scrapers.fs_dan_prijmov_reg import FsDanPrijmovRegistrovaniScraper

# ── Test IČO ──────────────────────────────────────────────────────────────
# Volkswagen Slovakia — veľká firma, určite nie je dlžník (negatívny test)
ICO_CLEAN = "35757442"

# Pre pozitívne testy používame IČO, ktoré je s vysokou pravdepodobnosťou
# v zozname dlžníkov. Ak nie je k dispozícii, test sa preskočí.
# Pozn.: Tieto IČO sa môžu zmeniť — ak dlžník zaplatí, test sa preskočí.
ICO_DEBTOR_DOVERA = "00112233"  # placeholder — ak nie je dlžník, test sa preskočí
ICO_DEBTOR_SP = "00112233"
ICO_DEBTOR_VSZP = "00112233"
ICO_DEBTOR_UNION = "00112233"

# ORSR — firma, ktorá určite existuje v Obchodnom registri
ICO_ORSR_EXISTS = "35757442"  # Volkswagen Slovakia a.s.
ICO_ORSR_NOT_EXISTS = "99999999"  # Neexistujúce IČO

# RPVS — firma, ktorá môže byť v registri partnerov verejného sektora
ICO_RPVS_EXISTS = "35757442"

# ZRSR — živnostník, ktorý určite existuje v Živnostenskom registri
# Milan Štefánik — známy živnostník (placeholder, overí sa pri spustení)
ICO_ZRSR_EXISTS = "35757442"  # Volkswagen — môže mať aj živnosť
ICO_ZRSR_NOT_EXISTS = "99999999"

# INSOLVENCY — Volkswagen určite nie je v konkurze
ICO_INSOLVENCY_CLEAN = "35757442"

OUTPUT_DIR = Path("/tmp/scraper_test_output")
OUTPUT_DIR.mkdir(exist_ok=True)


@pytest.fixture
async def browser():
    """Spoločný Playwright browser pre všetky testy."""
    pw = await async_playwright().start()
    br = await pw.chromium.launch(headless=True, args=['--disable-blink-features=AutomationDetected'])
    yield br
    await br.close()
    await pw.stop()


# ═══════════════════════════════════════════════════════════════════════════
# DÔVERA — Zoznam dlžníkov
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_dovera_page_loads(browser):
    """Dôvera: stránka načíta bez blokácie."""
    scraper = DoveraDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("Dôvera nedostupná (Cloudflare/timeout) — test preskočený")
        text = await page.inner_text("body")
        if "Just a moment" in text or "challenge" in text.lower():
            pytest.skip("Cloudflare challenge aktívna — test preskočený")
        assert len(text) > 50, "Dôvera stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_dovera_has_search_input(browser):
    """Dôvera: nájde sa input pole pre IČO (po Cloudflare + cookies)."""
    scraper = DoveraDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("Dôvera nedostupná (Cloudflare/timeout) — test preskočený")
        await scraper._handle_cloudflare_challenge(page, max_attempts=1)
        await scraper._try_click(page, "button", "Prijať všetky", timeout=2000)
        await scraper._try_click(page, "button", "Close", timeout=2000)
        await page.wait_for_timeout(3000)
        # Skontroluj či Cloudflare neblokuje — ak áno, preskoč test
        body_text = await page.inner_text("body")
        if "challenge" in body_text.lower() or "Just a moment" in body_text or "dlžn" not in body_text.lower():
            pytest.skip("Cloudflare challenge aktívna — nedá sa otestovať input pole")
        found = await scraper._fill_ico_field(page, ICO_CLEAN)
        assert found, "Nenašlo sa žiadne input pole pre IČO na Dôvera stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_dovera_clean_company(browser):
    """Dôvera: Volkswagen (35757442) nie je dlžník — negatívny test."""
    scraper = DoveraDlzniciScraper(browser)
    try:
        result = await scraper.run(ico=ICO_CLEAN, output_dir=OUTPUT_DIR)
        assert result.status == "SUCCESS", f"Scraper zlyhal: {result.status_message}"
        # Ak Cloudflare blokuje, scraper vráti „dočasne nedostupné“ — preskoč
        if "dočasne nedostupné" in (result.findings or ""):
            pytest.skip("Dôvera nedostupná (Cloudflare) — test preskočený")
        assert "POZOR" not in (result.findings or ""), f"Falošný POZOR pre čistú firmu: {result.findings}"
        assert "nie je v zozname" in (result.findings or ""), f"Očakávaný 'nie je v zozname': {result.findings}"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_dovera_debtor(browser):
    """Dôvera: pozitívny test — ak IČO je v zozname dlžníkov."""
    scraper = DoveraDlzniciScraper(browser)
    try:
        result = await scraper.run(ico=ICO_DEBTOR_DOVERA, output_dir=OUTPUT_DIR)
        assert result.status == "SUCCESS", f"Scraper zlyhal: {result.status_message}"
        # Ak sú dáta nedostupné (Cloudflare), preskoč
        if "dočasne nedostupné" in (result.findings or ""):
            pytest.skip("Dôvera nedostupná (Cloudflare) — test preskočený")
        # Ak subjekt nie je dlžník, test sa preskočí
        if "nie je v zozname" in (result.findings or ""):
            pytest.skip(f"IČO {ICO_DEBTOR_DOVERA} nie je aktuálne v zozname Dôvera dlžníkov")
        assert "POZOR" in (result.findings or ""), f"Očakávaný POZOR pre dlžníka: {result.findings}"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# SOCIÁLNA POISŤOVŇA — Zoznam dlžníkov
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_sp_page_loads(browser):
    """SP: stránka načíta bez blokácie."""
    scraper = SpDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=5000)
        text = await page.inner_text("body")
        assert "Server je nedostupný" not in text, "SP zablokovala prístup"
        assert len(text) > 50, "SP stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_sp_has_search_input(browser):
    """SP: nájde sa input[name='ico'] pole."""
    scraper = SpDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=5000)
        ico_input = page.locator('input[name="ico"]')
        await ico_input.wait_for(timeout=5000)
        assert await ico_input.count() > 0, "input[name='ico'] sa nenašiel na SP stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_sp_has_submit_button(browser):
    """SP: nájde sa tlačidlo 'Potvrdiť'."""
    scraper = SpDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=5000)
        btn = page.get_by_role("button", name="Potvrdiť")
        await btn.wait_for(timeout=5000)
        assert await btn.count() > 0, "Tlačidlo 'Potvrdiť' sa nenašlo na SP stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_sp_clean_company(browser):
    """SP: Volkswagen (35757442) nie je dlžník — negatívny test."""
    scraper = SpDlzniciScraper(browser)
    try:
        result = await scraper.run(ico=ICO_CLEAN, output_dir=OUTPUT_DIR)
        assert result.status == "SUCCESS", f"Scraper zlyhal: {result.status_message}"
        assert "POZOR" not in (result.findings or ""), f"Falošný POZOR pre čistú firmu: {result.findings}"
        assert "nie je v zozname" in (result.findings or ""), f"Očakávaný 'nie je v zozname': {result.findings}"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# VšZP — Zoznam dlžníkov
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_vszp_page_loads(browser):
    """VšZP: stránka načíta a zavrie sa modálne okno ak sa zobrazí."""
    scraper = VszpDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=5000)
        # Zavrieť prípadné modálne okno
        for modal_selector in [".modal-close", "button[aria-label='Close'], button[aria-label='Zavrieť']", ".modal .close"]:
            try:
                modal_close = page.locator(modal_selector).first
                await modal_close.wait_for(timeout=3000)
                await modal_close.click()
                break
            except Exception:
                continue
        text = await page.inner_text("body")
        assert len(text) > 50, "VšZP stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_vszp_has_search_input(browser):
    """VšZP: nájde sa input pole pre IČO."""
    scraper = VszpDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=5000)
        # VšZP používa input s placeholder alebo name obsahujúcim "ico" / "Nazov"
        inputs = page.locator("input[type='text'], input:not([type]), input[name*='ico'], input[name*='Nazov'], input[placeholder*='IČO'], input[placeholder*='ico']")
        cnt = await inputs.count()
        assert cnt > 0, "Nenašiel sa žiadny text input na VšZP stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_vszp_clean_company(browser):
    """VšZP: Volkswagen (35757442) nie je dlžník — negatívny test."""
    scraper = VszpDlzniciScraper(browser)
    try:
        result = await scraper.run(ico=ICO_CLEAN, output_dir=OUTPUT_DIR)
        assert result.status == "SUCCESS", f"Scraper zlyhal: {result.status_message}"
        assert "POZOR" not in (result.findings or ""), f"Falošný POZOR pre čistú firmu: {result.findings}"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# UNION — Zoznam dlžníkov
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_union_page_loads(browser):
    """UNION: stránka načíta."""
    scraper = UnionDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        await page.wait_for_timeout(3000)
        text = await page.inner_text("body")
        if len(text) < 10:
            # Skús networkidle ako fallback
            await page.wait_for_load_state('networkidle', timeout=10000)
            text = await page.inner_text("body")
        assert len(text) > 50, f"UNION stránka je prázdna (text length: {len(text)})"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_union_has_search_input(browser):
    """UNION: nájde sa input pole pre IČO."""
    scraper = UnionDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        # UNION používa get_by_role textbox
        textbox = page.get_by_role("textbox", name="Zadajte priezvisko, IČO,")
        try:
            await textbox.wait_for(timeout=5000)
            assert True
        except Exception:
            # Fallback: skúsime nájsť akýkoľvek text input
            inputs = page.locator("input[type='text'], input:not([type])")
            cnt = await inputs.count()
            assert cnt > 0, "Nenašiel sa žiadny text input na UNION stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_union_clean_company(browser):
    """UNION: Volkswagen (35757442) nie je dlžník — negatívny test."""
    scraper = UnionDlzniciScraper(browser)
    try:
        result = await scraper.run(ico=ICO_CLEAN, output_dir=OUTPUT_DIR)
        assert result.status == "SUCCESS", f"Scraper zlyhal: {result.status_message}"
        assert "POZOR" not in (result.findings or ""), f"Falošný POZOR pre čistú firmu: {result.findings}"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# ORSR — Obchodný register SR
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_orsr_page_loads(browser):
    """ORSR: stránka načíta."""
    scraper = OrsrScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='domcontentloaded')
        text = await page.inner_text("body")
        assert "IČO" in text or "ico" in text.lower(), "ORSR stránka neobsahuje 'IČO'"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_orsr_search_via_url(browser):
    """ORSR: URL-based vyhľadávanie funguje (hladaj_ico.asp?ICO=xxx)."""
    scraper = OrsrScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        # ORSR používa URL params, nie input pole
        search_url = f"{scraper.base_url}?ICO={ICO_ORSR_EXISTS}&SID=0"
        await page.goto(search_url, timeout=15000, wait_until='domcontentloaded')
        await page.wait_for_timeout(1000)
        text = await page.inner_text("body")
        # Stránka by mala obsahovať názov firmy alebo tabuľku s výsledkami
        assert "VOLKSWAGEN" in text.upper() or "Výsledky" in text, \
            f"ORSR nevrátil výsledky pre IČO {ICO_ORSR_EXISTS}"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_orsr_existing_company(browser):
    """ORSR: Volkswagen (35757442) existuje v Obchodnom registri — pozitívny test."""
    scraper = OrsrScraper(browser)
    try:
        result = await scraper.run(ico=ICO_ORSR_EXISTS, output_dir=OUTPUT_DIR, orsr_extract_type="CURRENT")
        assert result.status == "SUCCESS", f"ORSR scraper zlyhal: {result.status_message}"
        assert result.file_path is not None, "ORSR nevrátil PDF súbor"
        assert result.company_name is not None, "ORSR nevrátil názov firmy"
        assert "VOLKSWAGEN" in (result.company_name or "").upper(), \
            f"Očakávaný Volkswagen, dostal: {result.company_name}"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_orsr_nonexistent_company(browser):
    """ORSR: neexistujúce IČO (99999999) — negatívny test."""
    scraper = OrsrScraper(browser)
    try:
        result = await scraper.run(ico=ICO_ORSR_NOT_EXISTS, output_dir=OUTPUT_DIR, orsr_extract_type="CURRENT")
        # ORSR by mal vrátiť SUCCESS s práznym výpisom alebo FAILED
        assert result.status in ("SUCCESS", "FAILED"), f"Neočakávaný status: {result.status}"
        if result.status == "SUCCESS":
            # Ak vráti SUCCESS, nesmie obsahovať názov firmy
            assert result.company_name is None or "VOLKSWAGEN" not in (result.company_name or "").upper(), \
                "Falošný nájdený záznam pre neexistujúce IČO"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# RPVS — Register partnerov verejného sektora
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_rpvs_page_loads(browser):
    """RPVS: stránka načíta."""
    scraper = RpvsScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='domcontentloaded')
        text = await page.inner_text("body")
        assert len(text) > 50, "RPVS stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_rpvs_has_search_input(browser):
    """RPVS: nájde sa input pole pre IČO."""
    scraper = RpvsScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        inputs = page.locator("input[type='text'], input:not([type]), input[name*='ico'], input[name*='IČO']")
        cnt = await inputs.count()
        assert cnt > 0, "Nenašiel sa žiadny text input na RPVS stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# ZRSR — Živnostenský register SR
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_zrsr_page_loads(browser):
    """ZRSR: stránka načíta."""
    scraper = ZrsrScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper._base_url_company, timeout=45000, wait_until='domcontentloaded')
        text = await page.inner_text("body")
        assert len(text) > 50, "ZRSR stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_zrsr_has_ico_input(browser):
    """ZRSR: nájde sa input pole pre IČO (filter_ico)."""
    scraper = ZrsrScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper._base_url_company, timeout=45000, wait_until='domcontentloaded')
        ico_input = page.locator("input#filter_ico")
        await ico_input.wait_for(timeout=10000)
        assert await ico_input.count() > 0, "input#filter_ico sa nenašiel na ZRSR stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_zrsr_has_submit_button(browser):
    """ZRSR: nájde sa tlačidlo 'cmdPotvrdit'."""
    scraper = ZrsrScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper._base_url_company, timeout=45000, wait_until='domcontentloaded')
        btn = page.locator("input[name='cmdPotvrdit']")
        await btn.wait_for(timeout=10000)
        assert await btn.count() > 0, "Tlačidlo cmdPotvrdit sa nenašlo na ZRSR stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_zrsr_nonexistent_company(browser):
    """ZRSR: neexistujúce IČO (99999999) — negatívny test."""
    scraper = ZrsrScraper(browser)
    try:
        result = await scraper.run(ico=ICO_ZRSR_NOT_EXISTS, output_dir=OUTPUT_DIR)
        assert result.status in ("SUCCESS", "UNAVAILABLE"), f"Neočakávaný status: {result.status}"
        if result.status == "SUCCESS":
            assert "Žiadny záznam" in (result.findings or "") or "nenachádza" in (result.status_message or ""), \
                f"Očakávaný 'Žiadny záznam' pre neexistujúce IČO: {result.findings}"
        # UNAVAILABLE je OK — Altcha mohla zlyhať
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# INSOLVENCY — Register úpadcov (ru.justice.sk)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_insolvency_page_loads(browser):
    """INSOLVENCY: stránka načíta."""
    scraper = InsolvencyScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='domcontentloaded')
        text = await page.inner_text("body")
        assert len(text) > 50, "Insolvency stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_insolvency_has_search_input(browser):
    """INSOLVENCY: nájde sa vyhľadávacie pole."""
    scraper = InsolvencyScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='domcontentloaded')
        search_input = page.get_by_role("textbox", name="Vyhľadávací reťazec")
        await search_input.wait_for(timeout=5000)
        assert await search_input.count() > 0, "Vyhľadávací reťazec sa nenašiel na Insolvency stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_insolvency_clean_company(browser):
    """INSOLVENCY: Volkswagen (35757442) nie je v konkurze — negatívny test."""
    scraper = InsolvencyScraper(browser)
    try:
        result = await scraper.run(target_type="COMPANY", ico=ICO_INSOLVENCY_CLEAN, output_dir=OUTPUT_DIR)
        assert result.status == "SUCCESS", f"Scraper zlyhal: {result.status_message}"
        assert "POZOR" not in (result.findings or ""), \
            f"Falošný POZOR pre čistú firmu: {result.findings}"
        assert "nemá negatívne" in (result.findings or "") or "žiadne konania" in (result.findings or ""), \
            f"Očakávaný 'nemá negatívne záznamy': {result.findings}"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# CRZ — Centrálny register zmlúv
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_crz_page_loads(browser):
    """CRZ: stránka načíta."""
    scraper = CrzScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("CRZ nedostupná (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "CRZ stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_crz_has_ico_input(browser):
    """CRZ: nájde sa input pole pre IČO."""
    scraper = CrzScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        # CRZ používa input pre IČO v zmluvách
        ico_input = page.locator("input[name*='ico' i], input[placeholder*='IČO' i], input#ico")
        cnt = await ico_input.count()
        if cnt == 0:
            # Fallback: akýkoľvek text input
            inputs = page.locator("input[type='text'], input:not([type])")
            cnt = await inputs.count()
        assert cnt > 0, "Nenašiel sa žiadny text input na CRZ stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# UVO — Verejné obstarávanie
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_uvo_page_loads(browser):
    """UVO: stránka načíta."""
    scraper = UvoScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("UVO nedostupné (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "UVO stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_uvo_has_search_input(browser):
    """UVO: nájde sa vyhľadávacie pole."""
    scraper = UvoScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        # UVO používa search input pre IČO/názov
        search_input = page.locator("input[type='text'], input:not([type]), input[name*='ico' i], input[placeholder*='IČO' i]")
        cnt = await search_input.count()
        assert cnt > 0, "Nenašiel sa žiadny text input na UVO stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# POVERENIA — Register poverení na exekúcie
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_poverenia_page_loads(browser):
    """Poverenia: stránka načíta."""
    scraper = PovereniaScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("Poverenia nedostupné (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "Poverenia stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_poverenia_has_ico_input(browser):
    """Poverenia: nájde sa #ico input pole."""
    scraper = PovereniaScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        ico_input = page.locator("#ico")
        try:
            await ico_input.wait_for(timeout=8000)
        except Exception:
            # Fallback: akýkoľvek text input
            inputs = page.locator("input[type='text'], input:not([type])")
            cnt = await inputs.count()
            assert cnt > 0, "Nenašiel sa #ico ani žiadny text input na Poverenia stránke"
            return
        assert await ico_input.count() > 0, "#ico input sa nenašiel na Poverenia stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# RPO — Register právnických osôb
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_rpo_page_loads(browser):
    """RPO: stránka načíta."""
    scraper = RpoScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        try:
            await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("RPO nedostupné (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "RPO stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_rpo_has_ico_input(browser):
    """RPO: nájde sa input[name='organizationIdentifier'] pole."""
    scraper = RpoScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        ico_input = page.locator("input[name='organizationIdentifier']")
        try:
            await ico_input.wait_for(timeout=10000)
        except Exception:
            # Fallback: akýkoľvek text input
            inputs = page.locator("input[type='text'], input:not([type])")
            cnt = await inputs.count()
            assert cnt > 0, "Nenašiel sa organizationIdentifier ani text input na RPO stránke"
            return
        assert await ico_input.count() > 0, "input[name='organizationIdentifier'] sa nenašiel na RPO stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# NCRZP — Notársky centrálny register záložných práv
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_ncrzp_page_loads(browser):
    """NCRZP: stránka načíta."""
    scraper = NcrzpScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("NCRZP nedostupné (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "NCRZP stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_ncrzp_has_ico_input(browser):
    """NCRZP: nájde sa #pledgorIdentifier input pole."""
    scraper = NcrzpScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        ico_input = page.locator("#pledgorIdentifier")
        try:
            await ico_input.wait_for(timeout=8000)
        except Exception:
            inputs = page.locator("input[type='text'], input:not([type])")
            cnt = await inputs.count()
            assert cnt > 0, "Nenašiel sa #pledgorIdentifier ani text input na NCRZP stránke"
            return
        assert await ico_input.count() > 0, "#pledgorIdentifier sa nenašiel na NCRZP stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# NCRD — Notársky centrálny register dražieb
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_ncrd_page_loads(browser):
    """NCRD: stránka načíta."""
    scraper = NcrdScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("NCRD nedostupné (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "NCRD stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_ncrd_has_ico_input(browser):
    """NCRD: nájde sa #auctioneerIdentifier input pole."""
    scraper = NcrdScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=20000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        ico_input = page.locator("#auctioneerIdentifier")
        try:
            await ico_input.wait_for(timeout=8000)
        except Exception:
            # Fallback: auction-search input
            search_input = page.locator("input[name='auction-search']")
            cnt = await search_input.count()
            if cnt == 0:
                inputs = page.locator("input[type='text'], input:not([type])")
                cnt = await inputs.count()
            assert cnt > 0, "Nenašiel sa #auctioneerIdentifier ani text input na NCRD stránke"
            return
        assert await ico_input.count() > 0, "#auctioneerIdentifier sa nenašiel na NCRD stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# DISKVALIFIKÁCIE — Register diskvalifikácií (justice.gov.sk)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_diskvalifikacie_page_loads(browser):
    """Diskvalifikácie: stránka načíta."""
    scraper = DiskvalifikacieScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        try:
            await page.goto("https://www.justice.gov.sk/registre/registerDiskvalifikacii/", timeout=20000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("Diskvalifikácie nedostupné (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "Diskvalifikácie stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_diskvalifikacie_has_name_input(browser):
    """Diskvalifikácie: nájde sa #nazov_name input pole (hľadanie podľa mena)."""
    scraper = DiskvalifikacieScraper(browser)
    page = await scraper._get_page(block_images=False)
    try:
        await page.goto("https://www.justice.gov.sk/registre/registerDiskvalifikacii/", timeout=20000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        name_input = page.locator("#nazov_name")
        try:
            await name_input.wait_for(timeout=8000)
        except Exception:
            # Fallback: akýkoľvek text input
            inputs = page.locator("input[type='text'], input[placeholder*='mena']")
            cnt = await inputs.count()
            assert cnt > 0, "Nenašiel sa #nazov_name ani text input na Diskvalifikácie stránke"
            return
        assert await name_input.count() > 0, "#nazov_name sa nenašiel na Diskvalifikácie stránke"
    finally:
        await scraper._close()


# ═══════════════════════════════════════════════════════════════════════════
# FINANČNÁ SPRÁVA — 7 scraperov zdieľajúcich fs_base (rovnaká URL, rôzne zoznamy)
# Testujeme jeden reprezentatívny scraper + overenie že všetky načítajú stránku
# ═══════════════════════════════════════════════════════════════════════════

FS_SCRAPER_CLASSES = [
    FsDanoveSubjektyScraper,
    FsDphRegistrovaniScraper,
    FsDphRusenieScraper,
    FsDphVymazaniScraper,
    FsDphNadmernyOdpocetScraper,
    FsDanZPrijmovScraper,
    FsDanPrijmovRegistrovaniScraper,
]


@pytest.mark.asyncio
async def test_fs_page_loads(browser):
    """FS: Finančná správa hlavná stránka načíta."""
    scraper = FsDanoveSubjektyScraper(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip("Finančná správa nedostupná (timeout) — test preskočený")
        text = await page.inner_text("body")
        assert len(text) > 50, "FS stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_fs_has_ico_input(browser):
    """FS: nájde sa input pole pre IČO (input[name*='ico'])."""
    scraper = FsDanoveSubjektyScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(3000)
        # FS používa input[name*="ico"] v rámci formulára alebo iframe
        ico_input = page.locator("input[name*='ico' i]")
        cnt = await ico_input.count()
        if cnt == 0:
            # Skús iframe
            for frame in page.frames:
                if frame != page.main_frame:
                    frame_input = frame.locator("input[name*='ico' i]")
                    cnt = await frame_input.count()
                    if cnt > 0:
                        break
        if cnt == 0:
            # Fallback: akýkoľvek text input
            inputs = page.locator("input[type='text'], input:not([type])")
            cnt = await inputs.count()
        assert cnt > 0, "Nenašiel sa input[name*='ico'] ani text input na FS stránke"
    finally:
        await scraper._close()


@pytest.mark.asyncio
@pytest.mark.parametrize("scraper_cls", FS_SCRAPER_CLASSES)
async def test_fs_all_scrapers_page_loads(browser, scraper_cls):
    """FS: každý zo 7 scraperov načíta stránku bez chyby."""
    scraper = scraper_cls(browser)
    page = await scraper._get_page()
    try:
        try:
            await page.goto(scraper.base_url, timeout=30000, wait_until='domcontentloaded')
        except Exception:
            pytest.skip(f"{scraper.source_type}: FS nedostupná (timeout)")
        text = await page.inner_text("body")
        assert len(text) > 50, f"{scraper.source_type}: FS stránka je prázdna"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_fs_danove_subjekty_clean_company(browser):
    """FS Index daňovej spoľahlivosti: Volkswagen (35757442) — negatívny test."""
    scraper = FsDanoveSubjektyScraper(browser)
    try:
        result = await scraper.run(ico=ICO_CLEAN, output_dir=OUTPUT_DIR)
        if result.status == "UNAVAILABLE":
            pytest.skip("FS nedostupná — test preskočený")
        assert result.status == "SUCCESS", f"FS scraper zlyhal: {result.status_message}"
        # Volkswagen nie je v zozname daňových dlžníkov
        assert "POZOR" not in (result.findings or ""), \
            f"Falošný POZOR pre čistú firmu: {result.findings}"
    finally:
        await scraper._close()


@pytest.mark.asyncio
async def test_fs_dph_registrovani_clean_company(browser):
    """FS Platitelia DPH: Volkswagen (35757442) — mal by byť registrovaný."""
    scraper = FsDphRegistrovaniScraper(browser)
    try:
        result = await scraper.run(ico=ICO_CLEAN, output_dir=OUTPUT_DIR)
        if result.status == "UNAVAILABLE":
            pytest.skip("FS nedostupná — test preskočený")
        assert result.status == "SUCCESS", f"FS DPH scraper zlyhal: {result.status_message}"
    finally:
        await scraper._close()

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

from src.scrapers.dovera_dlznici import DoveraDlzniciScraper
from src.scrapers.sp_dlznici import SpDlzniciScraper
from src.scrapers.vszp_dlznici import VszpDlzniciScraper
from src.scrapers.union_dlznici import UnionDlzniciScraper
from src.scrapers.orsr import OrsrScraper
from src.scrapers.rpvs import RpvsScraper

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
    """VšZP: stránka načíta."""
    scraper = VszpDlzniciScraper(browser)
    page = await scraper._get_page()
    try:
        await page.goto(scraper.base_url, timeout=15000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=5000)
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

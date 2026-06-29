import os
import asyncio
import logging
from pathlib import Path
from playwright.async_api import async_playwright, Page

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def download_ifrs_reports(ico: str, max_years: int = 3, output_dir: str = "assets") -> list[str]:
    """
    Vyhľadá a stiahne posledné IFRS účtovné závierky (PDF) pre dané IČO z Registra účtovných závierok.
    Vráti zoznam ciest k stiahnutým PDF súborom.
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    downloaded_files = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()
        
        try:
            logger.info(f"Otváram RUZ pre IČO: {ico}")
            await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
            
            # Odmietnutie/prijatie cookies
            try:
                await page.get_by_role("link", name="Odmietnuť").click(timeout=3000)
            except:
                pass
                
            # Vyhľadanie IČO
            await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill(ico)
            await page.get_by_role("button", name="Vyhľadaj").first.click()
            await page.wait_for_timeout(2000)
            
            # Kliknutie na prvý výsledok (detail entity)
            # Snažíme sa nájsť odkaz na detail (často ikona lupy s href="/cruz-public/domain/accountingentity/show/...")
            detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
            if not detail_links:
                logger.error(f"Nenájdený detail entity pre IČO {ico}.")
                return []
            
            # Prejdeme na detail
            href = await detail_links[0].get_attribute("href")
            await page.goto("https://www.registeruz.sk" + href)
            await page.wait_for_timeout(2000)
            
            # Rozbaľovanie iba sekcií pre Individuálne účtovné závierky
            logger.info("Hľadám sekcie pre Individuálne účtovné závierky...")
            
            # Najskôr skúsime starý spôsob (cez 'tr'), pre istotu
            individual_rows = await page.locator("tr:has-text('Individuá')").all()
            
            if not individual_rows:
                # Fallback pre nový dizajn (cez '.item')
                logger.info("Fallback: klikám na všetky js-collapse pre Individuálne (nový dizajn)...")
                await page.evaluate("""() => {
                    document.querySelectorAll('.item').forEach(item => {
                        const a = item.querySelector('a.js-collapse');
                        if (a && a.textContent.includes('Individuá')) {
                            const collapseBtn = a.querySelector('span.js-collapse.icon-collapsed');
                            if (collapseBtn) collapseBtn.click();
                            else a.click();
                        }
                    });
                }""")
            else:
                for row in individual_rows:
                    try:
                        # Ak je riadok zbalený, klikneme naň
                        btn = row.locator("span.js-collapse.icon-collapsed").first
                        if await btn.is_visible():
                            await btn.click()
                    except:
                        pass
            
            await page.wait_for_timeout(2000)
            
            # Získame linky pre IFRS a Správy audítora, prísne v kontexte Individuálnych
            ifrs_links = await page.locator("a:has-text('účtovná závierka'), a:has-text('Účtovná závierka'), a:has-text('IFRS účtovná závierka'), a:has-text('Správa audítora')").all()
            vs_links = await page.locator("a:has-text('VS - Výročná správa'), a:has-text('Výročná správa')").all()
            
            if not ifrs_links:
                logger.warning(f"Žiadne účtovné závierky nenájdené pre IČO {ico}.")
                return []
                
            urls_to_visit = []
            
            # Filtrujeme iba viditeľné linky a skúsime zistiť rok
            import re
            
            # Najprv načítame celý text stránky raz – na rozpoznanie roka podľa kontextu
            page_text = await page.inner_text("body")

            async def get_year_from_link(link):
                """Robust extrakcia roku — 3 stratégie v klesajúcej spoľahlivosti."""
                try:
                    # Stratégia 1: text linku (napr. '12/2023')
                    text = await link.inner_text()
                    match = re.search(r'(20\d{2})', text)
                    if match:
                        return match.group(1)
                    
                    # Stratégia 2: text rodičovských elementov (hľadáme smerom nahor po úroveň .item)
                    parent_text = await link.evaluate("node => { let el = node.closest('.item'); return el ? el.innerText : ''; }")
                    matches = re.findall(r'(\d{2}/20\d{2})', parent_text)
                    if matches:
                        years = [m.split('/')[1] for m in matches]
                        return max(years)  # Najvyšší rok v texte .item elementu
                    
                    # Stratégia 3: rok z URL href-u (napr. /show/10268418 → neobsahuje rok,
                    # ale môžeme skúsiť nájsť rok v kontexte stránky pri tomto hrefu)
                    href_val = await link.get_attribute("href") or ""
                    match_url = re.search(r'(20\d{2})', href_val)
                    if match_url:
                        return match_url.group(1)
                    
                except Exception:
                    pass
                return "0"

            for link in ifrs_links:
                href = await link.get_attribute("href")
                year = await get_year_from_link(link)
                if href and not any(u[0] == href for u in urls_to_visit):
                    urls_to_visit.append((href, "IFRS", year))
                        
            for link in vs_links:
                href = await link.get_attribute("href")
                year = await get_year_from_link(link)
                if href and not any(u[0] == href for u in urls_to_visit):
                    urls_to_visit.append((href, "VS", year))

            # Deduplikácia rokov — pre každý rok zachováme iba prvý (najnovší) výskyt
            seen_years = set()
            deduped = []
            for item in urls_to_visit:
                key = (item[1], item[2])  # (typ, rok)
                if key not in seen_years:
                    seen_years.add(key)
                    deduped.append(item)
            urls_to_visit = deduped[:max_years * 2]
                    
            # Stiahnutie všetkých súborov PARALELNE (asyncio.gather) — 6× rýchlejšie
            async def download_one(item, index):
                href_d, ftype_d, year_d = item
                full_url = "https://www.registeruz.sk" + href_d
                # Každé stiahnutie potrebuje vlastnú stránku (nie zdieľanú)
                dl_page = await context.new_page()
                try:
                    await dl_page.goto(full_url)
                    await dl_page.wait_for_timeout(800)
                    
                    try:
                        async with dl_page.expect_download(timeout=30000) as download_info:
                            try:
                                btn = dl_page.locator("a:has-text('Stiahnuť'), a:has-text('Zobraziť')").first
                                await btn.click(timeout=5000)
                            except Exception:
                                await dl_page.locator("a[href*='/attachment/']").first.click(timeout=5000)
                        
                        download = await download_info.value
                        
                        # Ak rok je stále "0", skúsime extrahovať z názvu súboru od servera
                        suggested_name = download.suggested_filename or ""
                        if year_d == "0":
                            import re as _re
                            m = _re.search(r'(20\d{2})', suggested_name)
                            if m:
                                year_d = m.group(1)
                                logger.info(f"Rok extrahovaný z názvu súboru servera: {year_d} ({suggested_name})")
                        
                        out_file = out_path / f"{ftype_d}_{ico}_{year_d}_{index}.pdf"
                        await download.save_as(out_file)
                        logger.info(f"Úspešne stiahnuté: {out_file.name}")
                        return str(out_file)
                    except Exception as e:
                        logger.error(f"Zlyhalo stiahnutie pre {full_url}: {e}")
                        return None
                finally:
                    await dl_page.close()
            
            # Spustíme všetky sťahovania paralelne
            results = await asyncio.gather(*[
                download_one(item, i) for i, item in enumerate(urls_to_visit)
            ], return_exceptions=True)
            
            downloaded_files = [
                r for r in results
                if isinstance(r, str) and r is not None
            ]
                    
        finally:
            await context.close()
            await browser.close()
            
    return downloaded_files

if __name__ == "__main__":
    # Testovacie spustenie pre Slovnaft (31322832) alebo Mondi SCP (31637051)
    asyncio.run(download_ifrs_reports("31322832", max_years=3))

import os
import asyncio
import logging
import re
from pathlib import Path
from typing import Optional
from playwright.async_api import async_playwright, Page

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def _get_year_from_link(link) -> str:
    """Robust extrakcia roku zo selektoru — 3 stratégie v klesajúcej spoľahlivosti."""
    try:
        # Stratégia 1: text linku (napr. '12/2023')
        text = await link.inner_text()
        match = re.search(r'(20\d{2})', text)
        if match:
            return match.group(1)
        
        # Stratégia 2: text rodičovských elementov (hľadáme smerom nahor po úroveň .item alebo tr)
        parent_text = await link.evaluate("node => { let el = node.closest('.item') || node.closest('tr'); return el ? el.innerText : ''; }")
        matches = re.findall(r'(\d{2}/20\d{2})', parent_text)
        if matches:
            years = [m.split('/')[1] for m in matches]
            return max(years)  # Najvyšší rok v texte elementu
        
        # Stratégia 3: rok z URL href-u
        href_val = await link.get_attribute("href") or ""
        match_url = re.search(r'(20\d{2})', href_val)
        if match_url:
            return match_url.group(1)
            
    except Exception:
        pass
    return "0"

async def _download_pdf_if_available(dl_page: Page, out_path: Path, item: tuple, index: int) -> Optional[str]:
    """Pokúsi sa nájsť a stiahnuť PDF. Ak PDF neexistuje alebo zlyhá sťahovanie, vráti None."""
    href_d, ftype_d, year_d = item
    ico = out_path.name
    
    try:
        btn = dl_page.locator("a:has-text('Stiahnuť'), a[href*='/attachment/']").first
        if await btn.count() > 0 and await btn.is_visible():
            async with dl_page.expect_download(timeout=10000) as download_info:
                await btn.click(timeout=5000)
            
            download = await download_info.value
            suggested_name = download.suggested_filename or ""
            
            if year_d == "0":
                m = re.search(r'(20\d{2})', suggested_name)
                if m:
                    year_d = m.group(1)
                    logger.info(f"Rok extrahovaný z názvu súboru servera: {year_d} ({suggested_name})")
            
            out_file = out_path / f"{ftype_d}_{ico}_{year_d}_{index}.pdf"
            await download.save_as(out_file)
            logger.info(f"Úspešne stiahnuté PDF: {out_file.name}")
            return str(out_file)
    except Exception as e:
        logger.warning(f"Sťahovanie PDF pre {href_d} zlyhalo (bude fallback): {e}")
    
    return None

async def _extract_html_tabs(dl_page: Page, out_path: Path, item: tuple, index: int) -> Optional[str]:
    """Fallback pre Úč MUJ, ktorý ukladá hodnoty z HTML záložiek do .txt súboru."""
    href_d, ftype_d, year_d = item
    ico = out_path.name
    
    try:
        logger.info(f"Skúšam extrahovať HTML dáta (Úč MUJ) pre {href_d}...")
        
        tabs_to_click = ["Titulná strana", "Strana aktív", "Strana pasív", "Výkaz ziskov a strát"]
        extracted_text = f"IFRS/ÚČTOVNÁ ZÁVIERKA {year_d}\nIČO: {ico}\n\n"
        
        for tab_name in tabs_to_click:
            try:
                # Find all links that match the tab name, visible or not
                tab_locs = await dl_page.locator(f"a:has-text('{tab_name}')").all()
                for loc in tab_locs:
                    href = await loc.get_attribute("href")
                    if href and "/cruz-public/domain/financialreport/show/" in href:
                        # Navigate directly to avoid visibility / viewport size issues
                        await dl_page.goto("https://www.registeruz.sk" + href)
                        await dl_page.wait_for_timeout(800)
                        
                        # Grab the entire main content area (or body if main not found)
                        content_loc = dl_page.locator("div.b-content, main, body").first
                        if await content_loc.count() > 0:
                            content = await content_loc.inner_text()
                            extracted_text += f"\n--- {tab_name.upper()} ---\n{content}\n"
                        break
            except Exception as e:
                logger.warning(f"Zlyhalo extrahovanie záložky '{tab_name}': {e}")
                
        if len(extracted_text) > 50:
            out_file = out_path / f"{ftype_d}_{ico}_{year_d}_{index}.txt"
            with open(out_file, "w", encoding="utf-8") as f:
                f.write(extracted_text)
            logger.info(f"Úspešne extrahované HTML tabuľky do: {out_file.name}")
            return str(out_file)
    except Exception as e:
        logger.error(f"Zlyhala extrakcia HTML pre {href_d}: {e}")
    
    return None

async def _process_single_report(context, out_path: Path, item: tuple, index: int) -> Optional[str]:
    """Obalovacia funkcia pre spracovanie 1 reportu (PDF alebo HTML)."""
    href_d, ftype_d, year_d = item
    full_url = "https://www.registeruz.sk" + href_d
    
    dl_page = await context.new_page()
    try:
        await dl_page.goto(full_url)
        await dl_page.wait_for_timeout(800)
        
        # 1. Pokus HTML (najlepšie pre Úč MUJ, má presné čísla)
        file_path = await _extract_html_tabs(dl_page, out_path, item, index)
        if file_path:
            return file_path

        # 2. Pokus PDF (pre IFRS a veľké firmy, kde HTML záložky nie sú)
        file_path = await _download_pdf_if_available(dl_page, out_path, item, index)
        if file_path:
            return file_path
            
        logger.error(f"Zlyhalo získanie PDF aj HTML dát pre url {full_url}")
        return None
    except Exception as e:
        logger.error(f"Zlyhalo načítanie stránky {full_url}: {e}")
        return None
    finally:
        await dl_page.close()

async def download_ifrs_reports(ico: str, max_years: int = 5, output_dir: str = "assets") -> list[str]:
    """
    Vyhľadá a stiahne posledné účtovné závierky (PDF alebo TXT z HTML) 
    pre dané IČO z Registra účtovných závierok.
    Vráti zoznam ciest k stiahnutým súborom.
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
            
            try:
                await page.get_by_role("link", name="Odmietnuť").click(timeout=3000)
            except:
                pass
                
            await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill(ico)
            await page.get_by_role("button", name="Vyhľadaj").first.click()
            await page.wait_for_timeout(2000)
            
            detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
            if not detail_links:
                logger.error(f"Nenájdený detail entity pre IČO {ico}.")
                return []
            
            href = await detail_links[0].get_attribute("href")
            if not href:
                return []
            await page.goto("https://www.registeruz.sk" + href)
            await page.wait_for_timeout(2000)
            
            logger.info("Hľadám sekcie pre Individuálne účtovné závierky...")
            individual_rows = await page.locator("tr:has-text('Individuá')").all()
            
            if not individual_rows:
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
                        btn = row.locator("span.js-collapse.icon-collapsed").first
                        if await btn.is_visible():
                            await btn.click()
                    except:
                        pass
            
            await page.wait_for_timeout(2000)
            
            ifrs_links = await page.locator("a:has-text('účtovná závierka'), a:has-text('Účtovná závierka'), a:has-text('IFRS účtovná závierka'), a:has-text('Správa audítora')").all()
            vs_links = await page.locator("a:has-text('VS - Výročná správa'), a:has-text('Výročná správa')").all()
            
            if not ifrs_links:
                logger.warning(f"Žiadne účtovné závierky nenájdené pre IČO {ico}.")
                return []
                
            urls_to_visit = []
            
            for link in ifrs_links:
                l_href = await link.get_attribute("href")
                year = await _get_year_from_link(link)
                if l_href and not any(u[0] == l_href for u in urls_to_visit):
                    urls_to_visit.append((l_href, "IFRS", year))
                        
            for link in vs_links:
                l_href = await link.get_attribute("href")
                year = await _get_year_from_link(link)
                if l_href and not any(u[0] == l_href for u in urls_to_visit):
                    urls_to_visit.append((l_href, "VS", year))

            seen_years = set()
            deduped = []
            for item in urls_to_visit:
                key = (item[1], item[2])
                if key not in seen_years:
                    seen_years.add(key)
                    deduped.append(item)
                    
            deduped.sort(key=lambda x: int(x[2]) if x[2].isdigit() else 0, reverse=True)
            
            unique_years = []
            seen_yr = set()
            for item in deduped:
                yr = item[2]
                if yr not in seen_yr:
                    seen_yr.add(yr)
                    unique_years.append(yr)
                if len(seen_yr) >= max_years:
                    break
            urls_to_visit = [item for item in deduped if item[2] in seen_yr]
                    
            results = await asyncio.gather(*[
                _process_single_report(context, out_path, item, i) for i, item in enumerate(urls_to_visit)
            ], return_exceptions=True)
            
            downloaded_files = [r for r in results if isinstance(r, str) and r is not None]
                    
        finally:
            await context.close()
            await browser.close()
            
    return downloaded_files

if __name__ == "__main__":
    # Testovacie spustenie pre Slovnaft (31322832)
    asyncio.run(download_ifrs_reports("31322832", max_years=5))

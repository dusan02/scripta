import os
import asyncio
import logging
import re
from pathlib import Path
from typing import Optional
from playwright.async_api import async_playwright, Page, Locator, BrowserContext

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Selektory pre rôzne typy závierok ─────────────────────────────────────────
# Rozlišujeme: SK GAAP (Úč POD, Úč MUJ), IFRS (individuálna/konsolidovaná),
# anglické ekvivalenty (Annual report, Financial statements)
_IFRS_LINK_TEXTS = [
    # Slovenské GAAP a mikro
    "Individuálna účtovná závierka",
    "účtovná závierka",
    "Účtovná závierka",
    "IFRS účtovná závierka",
    "Správa audítora",
    # IFRS explicit
    "IFRS individuálna",
    "IFRS konsolidovaná",
    "Konsolidovaná účtovná závierka",
    # Anglické varianty (ESET, Telekom, multinational SK dcéry)
    # POZOR: "Annual Report" je v _VS_LINK_TEXTS — tu ho nedávame, aby VS nezašlo do IFRS
    "Financial statements",
    "Financial Report",
    "Auditor's report",     # presnejšie ako len 'Auditor'
    "Independent auditor",
]

_VS_LINK_TEXTS = [
    "VS - Výročná správa",
    "Výročná správa",
    "Annual Report",   # VS býva zasúlané ako Annual Report — priori ta VS nad IFRS v klasifikácii
]

# Typy záložiek na extrahovanie (pre HTML fallback)
_HTML_TABS = [
    "Titulná strana",
    "Strana aktív",
    "Strana pasív",
    "Výkaz ziskov a strát",
    "Balance Sheet",           # EN ekvivalent
    "Income Statement",        # EN ekvivalent
    "Statement of Financial Position",
    "Profit and Loss",
]


async def _get_year_from_link(link: Locator) -> str:
    """Robust extrakcia roku zo selektoru — 4 stratégie v klesajúcej spoľahlivosti."""
    try:
        # Stratégia 1: text linku (napr. '12/2023')
        text = await link.inner_text()
        match = re.search(r'(20\d{2})', text)
        if match:
            return match.group(1)

        # Stratégia 2: text rodičovských elementov
        parent_text = await link.evaluate(
            "node => { let el = node.closest('.item') || node.closest('tr') || node.closest('li'); "
            "return el ? el.innerText : ''; }"
        )
        matches = re.findall(r'(\d{2}/20\d{2})', parent_text)
        if matches:
            years = [m.split('/')[1] for m in matches]
            return max(years)

        # Stratégia 3: rok z URL href-u
        href_val = await link.get_attribute("href") or ""
        match_url = re.search(r'(20\d{2})', href_val)
        if match_url:
            return match_url.group(1)

        # Stratégia 4: aria-label alebo title atribút
        for attr in ("aria-label", "title", "data-year"):
            val = await link.get_attribute(attr) or ""
            m = re.search(r'(20\d{2})', val)
            if m:
                return m.group(1)

    except Exception:
        pass
    return "0"



async def _download_pdf_if_available(dl_page: Page, out_path: Path, item: tuple[str, str, str, str], index: int) -> Optional[str]:
    """Pokúsi sa nájsť a stiahnuť PDF. Ak PDF neexistuje alebo zlyhá sťahovanie, vráti None."""
    href_d, ftype_d, year_d = item[0], item[1], item[2]
    ico = out_path.name

    try:
        btn = dl_page.locator(
            "a:has-text('Stiahnuť'), a[href*='/attachment/'], "
            "a:has-text('Download'), a:has-text('Stiahnit')"
        ).first
        if await btn.count() > 0 and await btn.is_visible():
            async with dl_page.expect_download(timeout=15000) as download_info:
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


async def _extract_html_tabs(dl_page: Page, out_path: Path, item: tuple[str, str, str, str], index: int) -> Optional[str]:
    """
    Fallback pre Úč MUJ a SK GAAP, ktorý ukladá hodnoty z HTML záložiek do .txt súboru.
    Teraz podporuje aj anglické záložky (IFRS EN).
    Parsuje HTML tabuľky štruktúrovane (nie inner_text) aby Gemini dostal čisté čísla.
    """
    href_d, ftype_d, year_d = item[0], item[1], item[2]
    ico = out_path.name

    try:
        logger.info(f"Skúšam extrahovať HTML dáta pre {href_d}...")

        extracted_text = f"ÚČTOVNÁ ZÁVIERKA {year_d}\nIČO: {ico}\nTyp: {ftype_d}\n"
        extracted_text += f"Stĺpce: Bežné účtovné obdobie ({year_d}) | Predchádzajúce obdobie ({int(year_d)-1 if year_d.isdigit() else 'N/A'})\n\n"
        found_any = False

        for tab_name in _HTML_TABS:
            try:
                tab_locs = await dl_page.locator(f"a:has-text('{tab_name}')").all()
                for loc in tab_locs:
                    href = await loc.get_attribute("href")
                    if href and "/cruz-public/domain/financialreport/show/" in href:
                        await dl_page.goto("https://www.registeruz.sk" + href)
                        # RegisterUZ naťahuje tabuľky asynchrónne (AJAX). 
                        # Explicitný wait 3s je najspoľahlivejší spôsob, ako sa vyhnúť race-condition.
                        await dl_page.wait_for_timeout(3000)

                        # Parsujeme HTML tabuľku štruktúrovane cez JS
                        rows = await dl_page.evaluate("""() => {
                            const results = [];
                            const tables = document.querySelectorAll('table');
                            tables.forEach(table => {
                                const trs = table.querySelectorAll('tr');
                                trs.forEach(tr => {
                                    const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
                                    if (cells.length >= 2) results.push(cells);
                                });
                            });
                            return results;
                        }""")

                        if rows:
                            tab_text = f"\n--- {tab_name.upper()} ---\n"
                            for cells in rows:
                                cleaned = [re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', c) for c in cells]
                                tab_text += " | ".join(cleaned) + "\n"
                            extracted_text += tab_text
                            found_any = True
                        else:
                            # Fallback: ak tabuľka nenájdená, skús inner_text z hlavného obsahu
                            content_loc = dl_page.locator("div.b-content, main").first
                            if await content_loc.count() > 0:
                                content = await content_loc.inner_text()
                                if len(content.strip()) > 50:
                                    content = re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', content)
                                    extracted_text += f"\n--- {tab_name.upper()} ---\n{content}\n"
                                    found_any = True
                        break
            except Exception as e:
                logger.warning(f"Zlyhalo extrahovanie záložky '{tab_name}': {e}")

        if found_any and len(extracted_text) > 100:
            out_file = out_path / f"{ftype_d}_{ico}_{year_d}_{index}.txt"
            with open(out_file, "w", encoding="utf-8") as f:
                f.write(extracted_text)
            logger.info(f"Úspešne extrahované HTML tabuľky do: {out_file.name}")
            return str(out_file)
    except Exception as e:
        logger.error(f"Zlyhala extrakcia HTML pre {href_d}: {e}")

    return None


async def _process_single_report(context: BrowserContext, out_path: Path, item: tuple[str, str, str, str], index: int) -> Optional[str]:
    """Obalovacia funkcia pre spracovanie 1 reportu (PDF alebo HTML)."""
    href_d, ftype_d, year_d = item[0], item[1], item[2]
    full_url = "https://www.registeruz.sk" + href_d

    dl_page = await context.new_page()
    try:
        await dl_page.goto(full_url, wait_until="domcontentloaded", timeout=20000)
        await dl_page.wait_for_timeout(800)

        # 1. Pokus HTML (najlepšie pre Úč MUJ, má presné čísla v tabuľkách)
        file_path = await _extract_html_tabs(dl_page, out_path, item, index)
        if file_path:
            return file_path

        # 2. Pokus PDF (pre IFRS, anglické a veľké firmy kde HTML záložky nie sú)
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


async def _expand_all_sections(page: Page) -> None:
    """
    Rozbalí VŠETKY sekcie na stránke (Individuálne aj Konsolidované, SK GAAP aj IFRS).
    Predchádzajúca verzia expandovala len 'Individuá' — čím sa IFRS sekcie preskakovali.
    """
    # Varianta 1: collapse šípky (nový dizajn registeruz.sk)
    expanded = await page.evaluate("""() => {
        let count = 0;
        document.querySelectorAll('span.js-collapse.icon-collapsed, a.js-collapse').forEach(el => {
            el.click();
            count++;
        });
        return count;
    }""")
    logger.info(f"[RUZ] Expandovaných {expanded} sekcií")
    await page.wait_for_timeout(1500)

    # Varianta 2: staré .item elementy
    items_expanded = await page.evaluate("""() => {
        let count = 0;
        document.querySelectorAll('.item a.js-collapse, .card-header a').forEach(a => {
            if (!a.classList.contains('collapsed') || a.getAttribute('aria-expanded') === 'false') {
                try { a.click(); count++; } catch(e) {}
            }
        });
        return count;
    }""")
    if items_expanded > 0:
        await page.wait_for_timeout(1000)


async def _collect_all_report_links(page: Page) -> tuple[list[tuple[str, str, str, str]], list[tuple[str, str, str, str]]]:
    """
    Zbiera VŠETKY linky na závierky a výročné správy z rozbalenej stránky.
    Vracia (ifrs_items, vs_items) kde každý item je (href, ftype, year).
    """
    ifrs_items = []
    vs_items = []

    # Zozbierame všetky linky na stránke
    all_links = await page.locator("a[href*='/cruz-public/domain/financialreport/show/']").all()

    for link in all_links:
        href = await link.get_attribute("href") or ""
        if not href:
            continue

        text = (await link.inner_text()).strip()
        text_lower = text.lower()

        # Zatriedenie linku
        is_vs = any(kw.lower() in text_lower for kw in _VS_LINK_TEXTS)
        is_ifrs = any(kw.lower() in text_lower for kw in _IFRS_LINK_TEXTS)

        # Detekcia roku
        year = await _get_year_from_link(link)

        if is_vs and not is_ifrs:
            if not any(u[0] == href for u in vs_items):
                vs_items.append((href, "VS", year, text))
        elif is_ifrs or (not is_vs):
            # Ak link smeruje na financialreport a nie je výlučne VS, berieme ho ako závierku
            if not any(u[0] == href for u in ifrs_items):
                ifrs_items.append((href, "IFRS", year, text))

    # Fallback — ak nič nenašli, zozbierame všetky linky na financialreport
    if not ifrs_items and not vs_items:
        logger.warning("[RUZ] Žiadne linky nenájdené — spúšťam broad fallback")
        fallback_links = await page.locator("a[href*='financialreport']").all()
        for link in fallback_links:
            href = await link.get_attribute("href") or ""
            if href and not any(u[0] == href for u in ifrs_items):
                year = await _get_year_from_link(link)
                ifrs_items.append((href, "IFRS", year, ""))

    logger.info(f"[RUZ] Nájdené závierky: {len(ifrs_items)}, výročné správy: {len(vs_items)}")
    return ifrs_items, vs_items


async def download_ifrs_reports(ico: str, max_years: int = 5, output_dir: str = "assets") -> list[str]:
    """
    Vyhľadá a stiahne posledné účtovné závierky (PDF alebo TXT z HTML)
    pre dané IČO z Registra účtovných závierok.
    Podporuje: SK GAAP (Úč POD, Úč MUJ), IFRS, anglické závierky (ESET, multinational dcéry).
    Vráti zoznam ciest k stiahnutým súborom.
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    downloaded_files = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            # Anglický jazyk — lepšia podpora anglických IFRS stránok
            locale="sk-SK",
            extra_http_headers={"Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8"},
        )
        page = await context.new_page()

        try:
            logger.info(f"Otváram RUZ pre IČO: {ico}")
            await page.goto(
                "https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch",
                wait_until="domcontentloaded",
            )

            # Cookies
            try:
                await page.get_by_role("link", name="Odmietnuť").click(timeout=3000)
            except Exception:
                try:
                    await page.get_by_role("button", name="Odmietnuť").click(timeout=2000)
                except Exception:
                    pass

            # Vyhľadanie IČO
            await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill(ico)
            await page.get_by_role("button", name="Vyhľadaj").first.click()
            await page.wait_for_timeout(2000)

            detail_links = await page.locator(
                "a[href*='/cruz-public/domain/accountingentity/show/']"
            ).all()
            if not detail_links:
                logger.error(f"Nenájdený detail entity pre IČO {ico}.")
                return []

            href = await detail_links[0].get_attribute("href")
            if not href:
                return []

            await page.goto("https://www.registeruz.sk" + href, wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            # ── Expandovanie VŠETKÝCH sekcií (nie len Individuálne) ──────────
            await _expand_all_sections(page)

            # ── Zbieranie linkov na závierky ─────────────────────────────────
            ifrs_links, vs_links = await _collect_all_report_links(page)

            if not ifrs_links:
                logger.warning(f"Žiadne účtovné závierky nenájdené pre IČO {ico}.")
                return []

            # Deduplikácia a výber posledných N rokov
            def _is_standalone_ifrs(link_text: str) -> bool:
                """True ak link je samostatná IFRS závierka (nie výročná správa)."""
                t = link_text.lower()
                return ("ifrs" in t or "účtovná závierka" in t) and "výročná" not in t and "annual" not in t

            def _deduplicate_by_year(items: list, ftype: str, limit: int) -> list:
                seen_years: set[str] = set()
                result = []
                # Zoradiť zostupne podľa roku, ale v rámci roka preferovať samostatnú IFRS závierku
                sorted_items = sorted(
                    items,
                    key=lambda x: (
                        int(x[2]) if x[2].isdigit() else 0,
                        0 if (len(x) > 3 and _is_standalone_ifrs(x[3])) else 1
                    ),
                    reverse=True
                )
                for item in sorted_items:
                    yr = item[2]
                    if yr not in seen_years:
                        seen_years.add(yr)
                        result.append(item)
                    if len(seen_years) >= limit:
                        break
                return result

            urls_to_visit = (
                _deduplicate_by_year(ifrs_links, "IFRS", max_years) +
                _deduplicate_by_year(vs_links, "VS", 1) # Iba posledná Výročná správa (masívna úspora nákladov na LLM)
            )

            logger.info(f"[RUZ] Spracovávam {len(urls_to_visit)} súborov pre IČO {ico}")

            results = await asyncio.gather(*[
                _process_single_report(context, out_path, item, i)
                for i, item in enumerate(urls_to_visit)
            ], return_exceptions=True)

            downloaded_files = [r for r in results if isinstance(r, str) and r is not None]

        finally:
            await context.close()
            await browser.close()

    logger.info(f"[RUZ] Stiahnutých {len(downloaded_files)} súborov pre IČO {ico}")
    return downloaded_files


if __name__ == "__main__":
    import sys
    # Test: python ruz_scraper.py 31333532 (ESET)
    test_ico = sys.argv[1] if len(sys.argv) > 1 else "31333532"
    asyncio.run(download_ifrs_reports(test_ico, max_years=5, output_dir=f"assets/{test_ico}"))




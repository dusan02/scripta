import os
import asyncio
import logging
import re
from pathlib import Path
from typing import Optional
from playwright.async_api import async_playwright, Page, Locator, BrowserContext, TimeoutError as PlaywrightTimeout

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
    "Úč POD",
    "Úč MUJ",
    "Účtovná závierka (Zdroj údajov: FRSR)",
    "Účtovná závierka (Zdroj údajov: ÚRSR)",
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
    "Výkaz peňažných tokov",
    "Cash Flow Statement",
    "Statement of Cash Flows",
    "Balance Sheet",           # EN ekvivalent
    "Income Statement",        # EN ekvivalent
    "Statement of Financial Position",
    "Profit and Loss",
]


def _parse_period_months(period_text: str) -> Optional[int]:
    """Vypočíta počet mesiacov z textu obdobia, napr. '01/2024 - 12/2024' → 12, '01/2024 - 03/2024' → 3.
    Podporuje en-dash (–) a cross-year boundary (10/2023 - 03/2024 = 6)."""
    if not period_text:
        return None
    # Normalizuj en-dash na obyčajný -
    text = period_text.replace('\u2013', '-').strip()
    m = re.match(r'(\d{2})/(\d{4})\s*-\s*(\d{2})/(\d{4})', text)
    if not m:
        return None
    start_month, start_year = int(m.group(1)), int(m.group(2))
    end_month, end_year = int(m.group(3)), int(m.group(4))
    months = (end_year - start_year) * 12 + (end_month - start_month) + 1
    if months < 1 or months > 24:
        return None
    return months


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
    """Pokúsi sa nájsť a stiahnuť PDF. Skúša 2 stratégie: direct attachment URL, expect_download on click."""
    href_d, ftype_d, year_d = item[0], item[1], item[2]
    ico = out_path.name

    # Stratégia 1: Priame stiahnutie z attachment URL cez HTTP GET
    import urllib.request, ssl
    try:
        attachment_links = await dl_page.locator("a[href*='/attachment/']").all()
        logger.info(f"[RUZ] Počet attachment linkov na stránke: {len(attachment_links)}")
        # Deduplikácia podľa href
        seen_hrefs = set()
        unique_links = []
        for alink in attachment_links:
            h = await alink.get_attribute("href") or ""
            if h and h not in seen_hrefs:
                seen_hrefs.add(h)
                unique_links.append((h, alink))
        logger.info(f"[RUZ] Unikátnych attachment linkov: {len(unique_links)}")
        
        downloaded_pdfs = []
        
        for att_href, alink in unique_links:
            att_url = "https://www.registeruz.sk" + att_href
            logger.info(f"[RUZ] Skúšam priame stiahnutie z: {att_url}")

            def _fetch_pdf(url=att_url):
                ctx = ssl.create_default_context()
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, context=ctx) as resp:
                    ct = resp.headers.get("content-type", "")
                    body = resp.read()
                    return body, ct

            try:
                body, content_type = await asyncio.to_thread(_fetch_pdf)
            except Exception as fetch_err:
                logger.warning(f"[RUZ] Stiahnutie {att_url} zlyhalo: {fetch_err}")
                continue

            if len(body) > 100 and "application/pdf" in content_type:
                downloaded_pdfs.append(body)
                if year_d == "0":
                    m = re.search(r'(20\d{2})', att_href)
                    if m:
                        year_d = m.group(1)
            else:
                logger.debug(f"[RUZ] {att_url} nie je PDF (content-type={content_type}, size={len(body)})")
                
        if downloaded_pdfs:
            import fitz
            merged_doc = fitz.open()
            for pdf_body in downloaded_pdfs:
                try:
                    doc = fitz.open(stream=pdf_body, filetype="pdf")
                    merged_doc.insert_pdf(doc)
                except Exception as e:
                    logger.warning(f"[RUZ] Chyba pri mergovaní PDF časti: {e}")
            
            out_file = out_path / f"{ftype_d}_{ico}_{year_d}_{index}.pdf"
            merged_doc.save(out_file)
            logger.info(f"Úspešne stiahnuté a spojené {len(downloaded_pdfs)} PDF (urllib): {out_file.name}")
            return str(out_file)
            
    except Exception as e:
        logger.warning(f"[RUZ] Priame sťahovanie PDF zlyhalo: {e}")

    # Stratégia 2: expect_download na klik
    try:
        btn = dl_page.locator(
            "a:has-text('Stiahnuť'), a[href*='/attachment/'], "
            "a:has-text('Download'), a:has-text('Stiahnit')"
        ).first
        if await btn.count() > 0 and await btn.is_visible():
            async with dl_page.expect_download(timeout=10000) as download_info:
                await btn.click(timeout=3000)

            download = await download_info.value
            suggested_name = download.suggested_filename or ""

            if year_d == "0":
                m = re.search(r'(20\d{2})', suggested_name)
                if m:
                    year_d = m.group(1)
                    logger.info(f"Rok extrahovaný z názvu súboru servera: {year_d} ({suggested_name})")

            out_file = out_path / f"{ftype_d}_{ico}_{year_d}_{index}.pdf"
            await download.save_as(out_file)
            logger.info(f"Úspešne stiahnuté PDF (click): {out_file.name}")
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
    period_d = item[4] if len(item) > 4 and item[4] else ''
    ico = out_path.name

    # Vypočítaj dĺžku obdobia v mesiacoch z textu (napr. "01/2024 - 03/2024" → 3)
    months_in_period = _parse_period_months(period_d)

    try:
        logger.info(f"Skúšam extrahovať HTML dáta pre {href_d}...")

        extracted_text = f"ÚČTOVNÁ ZÁVIERKA {year_d}\nIČO: {ico}\nTyp: {ftype_d}\n"
        if period_d:
            extracted_text += f"Obdobie: {period_d}\n"
        if months_in_period is not None:
            extracted_text += f"Dĺžka obdobia: {months_in_period} mesiacov\n"
            if months_in_period < 12:
                extracted_text += f"UPOZORNENIE: Táto závierka pokrýva len {months_in_period} mesiacov, nie plný rok! Tržby a zisk nie sú porovnateľné s 12-mesačnými obdobiami.\n"
        extracted_text += f"Stĺpce: Bežné účtovné obdobie ({year_d}) | Predchádzajúce obdobie ({int(year_d)-1 if year_d.isdigit() else 'N/A'})\n\n"
        found_any = False

        # Najprv skúsime tabuľky priamo na aktuálnej stránke (IFRS stránky ich často majú)
        try:
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
            if rows and len(rows) > 2:
                tab_text = f"\n--- TABUĽKA ZO STRÁNKY ---\n"
                for cells in rows:
                    cleaned = [re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', c) for c in cells]
                    tab_text += " | ".join(cleaned) + "\n"
                extracted_text += tab_text
                found_any = True
                logger.info(f"[RUZ] Nájdená tabuľka priamo na stránke ({len(rows)} riadkov)")
        except Exception as e:
            logger.warning(f"[RUZ] Chyba pri čítaní tabuľky zo stránky: {e}")

        for tab_name in _HTML_TABS:
            try:
                tab_locs = await dl_page.locator(f"a:has-text('{tab_name}')").all()
                for loc in tab_locs:
                    href = await loc.get_attribute("href")
                    if href and "/cruz-public/domain/financialreport/show/" in href:
                        await dl_page.goto("https://www.registeruz.sk" + href, wait_until="domcontentloaded")
                        # Počkáme kým sa načítajú tabuľky (AJAX) — čakáme na prvý <table> alebo <tbody>
                        try:
                            await dl_page.wait_for_selector("table tbody tr, table tr", timeout=5000)
                        except PlaywrightTimeout:
                            pass

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
        await dl_page.goto(full_url, wait_until="domcontentloaded", timeout=10000)

        # 1. Pokus HTML (najlepšie pre Úč MUJ aj Úč POD — má presné čísla v tabuľkách)
        file_path = await _extract_html_tabs(dl_page, out_path, item, index)
            
        if file_path:
            return file_path

        # 2. Pokus PDF
        # Re-naviguj na pôvodnú URL, lebo _extract_html_tabs mohol zmeniť stránku
        await dl_page.goto(full_url, wait_until="domcontentloaded", timeout=10000)
        pdf_path = await _download_pdf_if_available(dl_page, out_path, item, index)
        if pdf_path:
            return pdf_path

        # 3. Fallback: skús HTML extrakciu aj keď PDF zlyhal
        logger.warning(f"[RUZ] PDF zlyhalo pre {full_url}, skúšam HTML fallback")
        await dl_page.goto(full_url, wait_until="domcontentloaded", timeout=10000)
        html_path = await _extract_html_tabs(dl_page, out_path, item, index)
        if html_path:
            return html_path

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
    Robí 3 pokusy — registeruz.sk má dynamický obsah a niektoré sekcie sa môžu
    načítať oneskorene.
    """
    for attempt in range(3):
        # Klikni na VŠETKY collapse elementy (nielen icon-collapsed)
        expanded = await page.evaluate("""() => {
            let count = 0;
            // Nový dizajn: js-collapse šípky (aj collapsed aj expanded — pre istotu)
            document.querySelectorAll('span.js-collapse, a.js-collapse').forEach(el => {
                try { el.click(); count++; } catch(e) {}
            });
            // Starý dizajn: .item elementy
            document.querySelectorAll('.item a.js-collapse, .card-header a, .accordion-button').forEach(a => {
                if (!a.classList.contains('collapsed') || a.getAttribute('aria-expanded') === 'false') {
                    try { a.click(); count++; } catch(e) {}
                }
            });
            // ID-based collapse elements (collapse-o-*, collapse-k-*, atď.)
            document.querySelectorAll('[id^="collapse-"]').forEach(el => {
                try { el.click(); count++; } catch(e) {}
            });
            // Bootstrap collapse buttons
            document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"]').forEach(el => {
                try { el.click(); count++; } catch(e) {}
            });
            return count;
        }""")
        logger.info(f"[RUZ] Pokus {attempt+1}: Expandovaných {expanded} sekcií")

        # Skrolni nadol pre lazy-loaded obsah
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(1)

        # Počkáme kým sa rozbalené sekcie načítajú
        try:
            await page.wait_for_selector(
                "a[href*='/cruz-public/domain/financialreport/show/']",
                timeout=5000,
            )
            logger.info(f"[RUZ] Linky na závierky nájdené po pokuse {attempt+1}")
            break
        except PlaywrightTimeout:
            if attempt < 2:
                logger.warning(f"[RUZ] Linky sa nenašli po pokuse {attempt+1}, skúšam znova")
            else:
                logger.warning("[RUZ] Linky sa nenašli ani po 3 pokusoch")


async def _collect_all_report_links(page: Page) -> tuple[list[tuple], list[tuple]]:
    """
    Zbiera VŠETKY linky na závierky a výročné správy z rozbalenej stránky.
    Vracia (ifrs_items, vs_items) kde každý item je:
      (href, ftype, year, link_text, period, sa_date, approved_date, submitted_date)

    Extrahuje metadáta z tabuľky: Obdobie, SA uložená dňa, Schválená dňa, Predložená dňa.
    """
    # JavaScript: extrahuje všetky riadky z tabuliek spolu s metadátami
    raw_rows = await page.evaluate("""
        () => {
            const results = [];
            const tables = document.querySelectorAll('table');
            tables.forEach(table => {
                const trs = table.querySelectorAll('tr');
                trs.forEach(tr => {
                    const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
                    if (cells.length < 2) return;
                    const link = tr.querySelector("a[href*='financialreport']");
                    if (!link) return;
                    const href = link.getAttribute('href') || '';
                    const linkText = link.innerText || link.textContent || '';
                    results.push({
                        cells: cells,
                        href: href,
                        linkText: linkText,
                        rowText: tr.innerText
                    });
                });
            });
            return results;
        }
    """)

    ifrs_items = []
    vs_items = []

    for row in raw_rows:
        try:
            row_text = row.get('rowText', '')
            href = row.get('href', '')
            link_text = row.get('linkText', '')

            if not href:
                continue

            # Extrahuj Obdobie z row_text (napr. "01/2023 - 12/2023")
            period_match = re.search(r'(\d{2}/\d{4}\s*[-\u2013]\s*\d{2}/\d{4})', row_text)
            period = period_match.group(1).replace('\u2013', '-') if period_match else ''

            # Extrahuj rok z periodu alebo row_text
            year_match = re.search(r'(20\d{2})', row_text)
            if not year_match:
                continue
            year = year_match.group(1)

            # Extrahuj dátumy z row_text podľa kľúčových slov
            sa_date = ''
            approved_date = ''
            submitted_date = ''

            sa_match = re.search(r'SA\s*ulo[\u017e\u017a]en[\u00e1a]\s*d[\u0148n]a[:\s]*(\d{1,2}\.\d{1,2}\.\d{4})', row_text, re.IGNORECASE)
            if sa_match:
                sa_date = sa_match.group(1)

            appr_match = re.search(r'Schv[\u00e1a]len[\u00e1a]\s*d[\u0148n]a[:\s]*(\d{1,2}\.\d{1,2}\.\d{4})', row_text, re.IGNORECASE)
            if appr_match:
                approved_date = appr_match.group(1)

            sub_match = re.search(r'Predlo[\u017e\u017a]en[\u00e1a]\s*d[\u0148n]a[:\s]*(\d{1,2}\.\d{1,2}\.\d{4})', row_text, re.IGNORECASE)
            if sub_match:
                submitted_date = sub_match.group(1)

            # Fallback: ak nemáme kľúčové slová, skús priradiť dátumy z row_text
            if not sa_date and not approved_date and not submitted_date:
                all_dates = re.findall(r'(\d{1,2}\.\d{1,2}\.\d{4})', row_text)
                if len(all_dates) >= 3:
                    sa_date = all_dates[-3]
                    approved_date = all_dates[-2]
                    submitted_date = all_dates[-1]
                elif len(all_dates) >= 2:
                    approved_date = all_dates[-2]
                    submitted_date = all_dates[-1]
                elif len(all_dates) >= 1:
                    submitted_date = all_dates[-1]

            # Klasifikácia: IFRS vs VS
            text_lower = link_text.lower()
            is_vs = any(kw.lower() in text_lower for kw in _VS_LINK_TEXTS)
            is_ifrs = any(kw.lower() in text_lower for kw in _IFRS_LINK_TEXTS)

            if not is_ifrs and not is_vs:
                fallback_keywords = ["účtovn", "závierk", "úč pod", "úč muj", "ifrs", "financial"]
                if any(kw in text_lower for kw in fallback_keywords):
                    is_ifrs = True

            item = (href, "IFRS" if is_ifrs else "VS", year, link_text, period, sa_date, approved_date, submitted_date)

            if is_vs and not is_ifrs:
                if not any(u[0] == href for u in vs_items):
                    vs_items.append(item)
            else:
                if not any(u[0] == href for u in ifrs_items):
                    ifrs_items.append(item)

        except Exception as e:
            logger.debug(f"[RUZ] Chyba pri spracovaní riadku: {e}")
            continue

    # Fallback — ak nič nenašli, zozbierame všetky linky na financialreport
    if not ifrs_items and not vs_items:
        logger.warning("[RUZ] Žiadne linky nenájdené — spúšťam broad fallback")
        fallback_links = await page.locator("a[href*='financialreport']").all()
        for link in fallback_links:
            href = await link.get_attribute("href") or ""
            if href and not any(u[0] == href for u in ifrs_items):
                year = await _get_year_from_link(link)
                ifrs_items.append((href, "IFRS", year, "", "", "", "", ""))

    logger.info(f"[RUZ] Nájdené závierky: {len(ifrs_items)}, výročné správy: {len(vs_items)}")
    for item in ifrs_items:
        months = _parse_period_months(item[4]) if len(item) > 4 and item[4] else None
        logger.info(f"[RUZ]   IFRS: period={item[4]} months={months} year={item[2]} sa={item[5]} appr={item[6]} sub={item[7]} text='{item[3]}'")
    for item in vs_items:
        months = _parse_period_months(item[4]) if len(item) > 4 and item[4] else None
        logger.info(f"[RUZ]   VS: period={item[4]} months={months} year={item[2]} text='{item[3]}'")
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
            # Počkáme kým sa objaví detail link entity (event-driven)
            try:
                await page.wait_for_selector(
                    "a[href*='/cruz-public/domain/accountingentity/show/']",
                    timeout=5000
                )
            except PlaywrightTimeout:
                # Skontrolujeme, či sa zobrazila správa "Neboli nájdené žiadne výsledky"
                try:
                    no_results = await page.get_by_text("Neboli nájdené žiadne výsledky").count()
                    if no_results > 0:
                        logger.warning(f"[RUZ] Neboli nájdené žiadne výsledky pre IČO {ico}.")
                        return []
                except Exception:
                    pass

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
            # Počkáme kým sa načítajú sekcie s collapse prvkami (event-driven)
            try:
                await page.wait_for_selector("span.js-collapse, a.js-collapse, .item a.js-collapse", timeout=5000)
            except PlaywrightTimeout:
                pass

            # ── Expandovanie VŠETKÝCH sekcií (nie len Individuálne) ──────────
            await _expand_all_sections(page)

            # ── Klikni na "Zobraziť viac" ak existuje (pagination) ──────────
            for _ in range(5):
                try:
                    show_more = page.locator("a:has-text('Zobraziť viac'), a:has-text('Zobraziť všetky'), button:has-text('Zobraziť viac')")
                    if await show_more.count() > 0 and await show_more.first.is_visible():
                        await show_more.first.click()
                        await asyncio.sleep(1)
                        logger.info("[RUZ] Kliknuté na 'Zobraziť viac'")
                    else:
                        break
                except Exception:
                    break

            # ── Zbieranie linkov na závierky ─────────────────────────────────
            ifrs_links, vs_links = await _collect_all_report_links(page)

            if not ifrs_links:
                logger.warning(f"Žiadne účtovné závierky nenájdené pre IČO {ico}.")
                return []

            # Deduplikácia a výber posledných N období podľa priority
            def _is_standalone_ifrs(link_text: str) -> bool:
                t = link_text.lower()
                return ("ifrs" in t or "účtovná závierka" in t) and "výročná" not in t and "annual" not in t

            def _is_konsolidovana(link_text: str) -> bool:
                return "konsolidovaná" in link_text.lower() or "consolidated" in link_text.lower()

            def _parse_date(date_str: str) -> str:
                """Konvertuje DD.MM.YYYY na YYYY-MM-DD pre zoradenie."""
                if not date_str:
                    return ''
                m = re.match(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', date_str)
                if m:
                    return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
                return ''

            def _deduplicate_by_period(items: list, limit: int) -> list:
                """Deduplikuje záznamy podľa Obdobia s priority-based výberom víťaza.

                Priorita pre rovnaké Obdobie:
                  1. Riadok má neprázdnu SA uložená dňa (auditovaná závierka)
                  2. Riadok má neprázdnu Schválená dňa (schválená valným zhromaždením)
                  3. Riadok s najnovším dátumom v Predložená dňa
                Zoradí obdobia zostupne a vráti top `limit` záznamov.
                """
                groups: dict[str, list] = {}
                for item in items:
                    period = item[4] if len(item) > 4 and item[4] else item[2]
                    if period not in groups:
                        groups[period] = []
                    groups[period].append(item)

                winners = []
                for period, group in groups.items():
                    if len(group) == 1:
                        winners.append(group[0])
                        w_months = _parse_period_months(period) if period else None
                        logger.info(f"[RUZ] Dedup obdobie={period} months={w_months}: len=1 (žiadny konflikt)")
                        continue

                    # Priority 1: SA uložená dňa nie je prázdna
                    p1 = [it for it in group if len(it) > 5 and it[5]]
                    if p1:
                        p1.sort(key=lambda x: _parse_date(x[5]), reverse=True)
                        winners.append(p1[0])
                        logger.info(f"[RUZ] Dedup obdobie={period}: víťaz podľa SA uložená ({p1[0][5]})")
                        continue

                    # Priority 2: Schválená dňa nie je prázdna
                    p2 = [it for it in group if len(it) > 6 and it[6]]
                    if p2:
                        p2.sort(key=lambda x: _parse_date(x[6]), reverse=True)
                        winners.append(p2[0])
                        logger.info(f"[RUZ] Dedup obdobie={period}: víťaz podľa Schválená ({p2[0][6]})")
                        continue

                    # Priority 3: Najnovší Predložená dňa
                    p3 = [it for it in group if len(it) > 7 and it[7]]
                    if p3:
                        p3.sort(key=lambda x: _parse_date(x[7]), reverse=True)
                        winners.append(p3[0])
                        logger.info(f"[RUZ] Dedup obdobie={period}: víťaz podľa Predložená ({p3[0][7]})")
                        continue

                    # Fallback: berieme prvý (zoradený podľa konsolidovanej/standalone)
                    group.sort(
                        key=lambda x: (
                            1 if (len(x) > 3 and _is_konsolidovana(x[3])) else 0,
                            1 if (len(x) > 3 and _is_standalone_ifrs(x[3])) else 0
                        ),
                        reverse=True
                    )
                    winners.append(group[0])
                    logger.info(f"[RUZ] Dedup obdobie={period}: víťaz fallback (žiadne dátumy)")

                # Zoraď obdobia zostupne (chronologicky od najnovšieho)
                winners.sort(key=lambda x: x[2] if x[2].isdigit() else '0', reverse=True)

                return winners[:limit]

            urls_to_visit = (
                _deduplicate_by_period(ifrs_links, max_years) +
                _deduplicate_by_period(vs_links, 1)  # Iba posledná Výročná správa
            )

            logger.info(f"[RUZ] Spracovávam {len(urls_to_visit)} súborov pre IČO {ico}")
            for u in urls_to_visit:
                u_months = _parse_period_months(u[4]) if len(u) > 4 and u[4] else None
                logger.info(f"[RUZ]   → {u[1]} year={u[2]} period={u[4] if len(u) > 4 else ''} months={u_months}")

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




import os
import asyncio
import logging
import re
from pathlib import Path
from typing import Optional, Any
from urllib.request import Request, urlopen
import ssl

from playwright.async_api import async_playwright, Page, BrowserContext, TimeoutError as PlaywrightTimeout

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Selektory pre rôzne typy závierok ─────────────────────────────────────────
_IFRS_LINK_TEXTS = [
    "Individuálna účtovná závierka", "účtovná závierka", "Účtovná závierka",
    "Úč POD", "Úč MUJ", "Účtovná závierka (Zdroj údajov: FRSR)",
    "Účtovná závierka (Zdroj údajov: ÚRSR)", "IFRS účtovná závierka",
    "Správa audítora", "IFRS individuálna", "IFRS konsolidovaná",
    "Konsolidovaná účtovná závierka", "Financial statements",
    "Financial Report", "Auditor's report", "Independent auditor",
]

_VS_LINK_TEXTS = [
    "VS - Výročná správa", "Výročná správa", "Annual Report",
]

_HTML_TABS = [
    "Titulná strana", "Strana aktív", "Strana pasív", "Výkaz ziskov a strát",
    "Výkaz peňažných tokov", "Cash Flow Statement", "Statement of Cash Flows",
    "Balance Sheet", "Income Statement", "Statement of Financial Position",
    "Profit and Loss",
]


def _period_sort_key(period: str) -> tuple[int, int]:
    """Odvodí chronologický kľúč (koncový rok, koncový mesiac) z period stringu."""
    if not period:
        return (0, 0)
    text = period.replace('\u2013', '-').lower()
    
    # Podpora pre kvartály a polroky (napr. Q1 2024, 1. polrok 2024)
    m_q = re.search(r'(q[1-4]|[1-2]\.?\s*polrok)\s*(20\d{2})', text)
    if m_q:
        q_val = m_q.group(1).replace(' ', '').replace('.', '')
        y = int(m_q.group(2))
        if 'q' in q_val: return (y, int(q_val.replace('q','')) * 3)
        return (y, 6 if '1' in q_val else 12)

    m = re.search(r'(\d{2})/(\d{4})\s*-\s*(\d{2})/(\d{4})', text)
    if m:
        return (int(m.group(4)), int(m.group(3)))
    if period.isdigit():
        return (int(period), 12)
    ym = re.search(r'(20\d{2})', text)
    if ym:
        return (int(ym.group(1)), 12)
    return (0, 0)


def _parse_period_months(period_text: str) -> Optional[int]:
    """Vypočíta počet mesiacov z textu obdobia."""
    if not period_text:
        return None
    text = period_text.replace('\u2013', '-').strip()
    m = re.match(r'(\d{2})/(\d{4})\s*-\s*(\d{2})/(\d{4})', text)
    if not m:
        return None
    start_month, start_year = int(m.group(1)), int(m.group(2))
    end_month, end_year = int(m.group(3)), int(m.group(4))
    months = (end_year - start_year) * 12 + (end_month - start_month) + 1
    if 1 <= months <= 24:
        return months
    return None


class RuzScraper:
    def __init__(self, ico: str, output_dir: Path, max_years: Optional[int] = None):
        self.ico = ico
        self.out_path = output_dir
        self.max_years = max_years if max_years is not None else 100 # Všetky dostupné, ak nie je limit
        self.downloaded_files: list[str] = []
        
        self.playwright: Any = None
        self.browser: Any = None
        self.context: Optional[BrowserContext] = None

    async def start(self):
        self.out_path.mkdir(parents=True, exist_ok=True)
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=True)
        self.context = await self.browser.new_context(
            accept_downloads=True,
            locale="sk-SK",
            extra_http_headers={"Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8"},
        )
        try:
            await self._run_scraping()
        finally:
            if self.context: await self.context.close()
            if self.browser: await self.browser.close()
            if self.playwright: await self.playwright.stop()
        
        return self.downloaded_files

    async def _safe_goto(self, page: Page, url: str, retries: int = 3) -> bool:
        """Bezpečné prejdenie na URL s retry mechanizmom a anti-bot detekciou."""
        for attempt in range(retries):
            try:
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                
                # Check for HTTP errors or Captcha
                if resp and resp.status in [403, 429, 503, 504]:
                    logger.warning(f"[RUZ] HTTP {resp.status} na {url} (pokus {attempt+1}/{retries})")
                
                content = await page.content()
                content_lower = content.lower()
                if "captcha" in content_lower or "prístup zamietnutý" in content_lower or "access denied" in content_lower:
                    logger.error(f"[RUZ] Detekovaná CAPTCHA / Anti-bot na {url}")
                    raise Exception(f"RÚZ zablokoval prístup (Anti-bot/CAPTCHA) na {url}")
                
                return True
            except PlaywrightTimeout:
                logger.warning(f"[RUZ] Timeout pri navigácii na {url} (pokus {attempt+1}/{retries})")
            except Exception as e:
                if "Anti-bot" in str(e):
                    raise
                logger.warning(f"[RUZ] Chyba pri navigácii na {url}: {e} (pokus {attempt+1}/{retries})")
            
            if attempt < retries - 1:
                wait_time = 2 ** (attempt + 1)
                await asyncio.sleep(wait_time)
        
        logger.error(f"[RUZ] Nepodarilo sa načítať {url} po {retries} pokusoch.")
        return False

    async def _run_scraping(self):
        logger.info(f"[RUZ] Otváram RUZ pre IČO: {self.ico}")
        page = await self.context.new_page()
        try:
            success = await self._safe_goto(page, "https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
            if not success: return
            
            await self._accept_cookies(page)

            # Robustnejší selektor namiesto name="Zadajte názov účtovnej"
            await page.locator("#input_search").fill(self.ico)
            await page.locator("#input_search").press("Enter")
            
            try:
                await page.wait_for_selector("a[href*='/cruz-public/domain/accountingentity/show/']", state="attached", timeout=10000)
            except PlaywrightTimeout:
                if await page.get_by_text("Neboli nájdené žiadne výsledky").count() > 0:
                    logger.warning(f"[RUZ] Neboli nájdené žiadne výsledky pre IČO {self.ico}.")
                else:
                    logger.error(f"[RUZ] Timeout pri hľadaní výsledkov pre IČO {self.ico}")
                return

            detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
            if not detail_links:
                logger.error(f"[RUZ] Detail link nenájdený pre IČO {self.ico}")
                return
            href = await detail_links[0].get_attribute("href")
            logger.info(f"[RUZ] Idem na detail entity: {href}")
            
            success = await self._safe_goto(page, "https://www.registeruz.sk" + (href or ""))
            if not success: return
            
            await self._accept_cookies(page)

            # Expand and collect tabs
            ifrs_links, vs_links = await self._collect_all_tabs(page)
            logger.info(f"[RUZ] Zozbierané linky: IFRS={len(ifrs_links)}, VS={len(vs_links)}")

            # Získaj všetky unikátne obdobia zo všetkých dokumentov
            all_periods = set()
            for item in ifrs_links + vs_links:
                all_periods.add(item[4] if item[4] else item[2])
            
            # Vyber top 'max_years' najnovších období
            top_periods = sorted(list(all_periods), key=lambda p: _period_sort_key(p), reverse=True)[:self.max_years]
            
            # Odfiltruj len tie linky, ktoré patria do top_periods
            ifrs_links = [x for x in ifrs_links if (x[4] if x[4] else x[2]) in top_periods]
            vs_links = [x for x in vs_links if (x[4] if x[4] else x[2]) in top_periods]

            # Vytvoríme skupiny pre IFRS aj VS
            period_groups = self._group_by_period(ifrs_links, self.max_years) + self._group_by_period(vs_links, self.max_years)
            logger.info(f"[RUZ] Zozbierané linky: IFRS={len(ifrs_links)}, VS={len(vs_links)} (pre max {self.max_years} období)")
            logger.info(f"[RUZ] Bude sa spracovávať {len(period_groups)} skupín.")
            
            # Spracuj paralelne s obmedzením (Semaphore)
            sem = asyncio.Semaphore(3)
            async def bounded_process(group, index):
                async with sem:
                    return await self._process_period_group(group, index)

            tasks = [bounded_process(group, i) for i, group in enumerate(period_groups)]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for res in results:
                if isinstance(res, str) and res:
                    self.downloaded_files.append(res)
                elif isinstance(res, Exception):
                    logger.error(f"[RUZ] Chyba pri spracovaní skupiny: {res}")
                    
        except Exception as run_e:
            logger.error(f"[RUZ] Kritická chyba počas behu scrapera: {run_e}")
            for file_path in self.downloaded_files:
                try: os.remove(file_path)
                except OSError: pass
            self.downloaded_files.clear()
        finally:
            await page.close()

    async def _accept_cookies(self, page: Page):
        try:
            # Fallback pre cookies
            if await page.locator(".cb-btn-accept").count() > 0:
                await page.locator(".cb-btn-accept").first.click(timeout=1000)
            elif await page.get_by_role("link", name=re.compile("Prijať|Povoliť", re.I)).count() > 0:
                await page.get_by_role("link", name=re.compile("Prijať|Povoliť", re.I)).first.click(timeout=1000)
        except Exception:
            pass

    async def _collect_all_tabs(self, page: Page) -> tuple[list[tuple], list[tuple]]:
        all_ifrs, all_vs = [], []
        
        # Extrahuj entity ID z URL (napr. /show/4078 -> 4078)
        entity_id = None
        import re as _re
        m = _re.search(r'/accountingentity/show/(\d+)', page.url)
        if m:
            entity_id = m.group(1)
        
        # Taby na entity stránke: "Individuálne účtovné závierky", "Výročné správy"
        # Používame priamu URL navigáciu (showTabNoJS) namiesto JS click,
        # pretože JS click často zlyhá na neviditeľných elementoch.
        tab_urls = []
        if entity_id:
            tab_urls = [
                (f"https://www.registeruz.sk/cruz-public/domain/accountingentity/showTabNoJS/{entity_id}/INDIVIDUAL", "Individuálne účtovné závierky"),
                (f"https://www.registeruz.sk/cruz-public/domain/accountingentity/showTabNoJS/{entity_id}/ANNUAL_REPORT", "Výročné správy"),
            ]
        
        for tab_url, tab_name in tab_urls:
            try:
                logger.info(f"[RUZ] Navigácia na tab '{tab_name}'")
                await page.goto(tab_url, wait_until="domcontentloaded")
                await self._accept_cookies(page)
                i_links, v_links = await self._expand_and_collect(page)
                all_ifrs.extend(i_links)
                all_vs.extend(v_links)
                logger.info(f"[RUZ] Tab '{tab_name}': IFRS={len(i_links)}, VS={len(v_links)}")
            except Exception as e:
                logger.warning(f"[RUZ] Tab '{tab_name}' zlyhalo: {e}")
        
        # Ak žiadny tab neexistuje (jednoduché firmy), zbieraj z default stránky
        if not all_ifrs and not all_vs:
            logger.info("[RUZ] Žiadne taby, zbieram z default stránky")
            i1, v1 = await self._expand_and_collect(page)
            all_ifrs.extend(i1)
            all_vs.extend(v1)
            
        return all_ifrs, all_vs

    async def _expand_and_collect(self, page: Page) -> tuple[list[tuple], list[tuple]]:
        """Rozbalí sekcie a zozbiera linky na danom tabe."""
        for attempt in range(2):
            await page.evaluate("""() => {
                document.querySelectorAll('span.js-collapse, a.js-collapse').forEach(el => { try { el.click(); } catch(e) {} });
                document.querySelectorAll('.item a.js-collapse, .accordion-button').forEach(a => {
                    if (!a.classList.contains('collapsed') || a.getAttribute('aria-expanded') === 'false') { try { a.click(); } catch(e) {} }
                });
            }""")
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            try:
                await page.wait_for_selector("a[href*='financialreport'], a[href*='/attachment/']", timeout=2000)
            except PlaywrightTimeout:
                pass

        for _ in range(5):
            try:
                show_more = page.locator("a:has-text('Zobraziť viac'), button:has-text('Zobraziť viac')")
                if await show_more.count() > 0:
                    is_vis = await show_more.first.is_visible()
                    if is_vis:
                        prev_count = await page.locator("a[href*='financialreport'], a[href*='/attachment/']").count()
                        await show_more.first.click(timeout=3000)
                        try:
                            await page.wait_for_function(
                                f"() => document.querySelectorAll(\"a[href*='financialreport'], a[href*='/attachment/']\").length > {prev_count}",
                                timeout=3000,
                            )
                        except PlaywrightTimeout:
                            pass
                    else:
                        break
                else:
                    break
            except Exception:
                break
                
        return await self._parse_report_links(page)

    async def _parse_report_links(self, page: Page) -> tuple[list[tuple], list[tuple]]:
        raw_rows = await page.evaluate("""() => {
            const results = [];
            const items = document.querySelectorAll('.item, table tr');
            items.forEach(item => {
                const links = item.querySelectorAll("a[href*='financialreport'], a[href*='/attachment/']");
                if (links.length === 0) return;
                const rowText = item.innerText || '';
                links.forEach(link => {
                    results.push({
                        href: link.getAttribute('href') || '',
                        linkText: link.innerText || link.textContent || '',
                        rowText: rowText.replace(/\\n/g, ' ')
                    });
                });
            });
            return results;
        }""")

        ifrs_items, vs_items = [], []
        for row in raw_rows:
            href, row_text, link_text = row.get('href', ''), row.get('rowText', ''), row.get('linkText', '')
            if not href: continue

            period_match = re.search(r'(\d{2}/\d{4}\s*[-\u2013]\s*\d{2}/\d{4})', row_text)
            period = period_match.group(1).replace('\u2013', '-') if period_match else ''
            
            if period:
                year = str(_period_sort_key(period)[0])
            else:
                year_match = re.search(r'(20\d{2})', row_text)
                if not year_match: continue
                year = year_match.group(1)

            text_lower = link_text.lower()
            is_vs = any(kw.lower() in text_lower for kw in _VS_LINK_TEXTS) or "výročná" in text_lower or "annual report" in text_lower
            is_ifrs = any(kw.lower() in text_lower for kw in _IFRS_LINK_TEXTS) or "závierk" in text_lower or "konsolidovaná" in text_lower
            
            # Nechceme klasifikovať "správa audítora" alebo "správa o vzťahoch" nasilu do IFRS ak neobsahujú kľúčové slová
            if not is_ifrs and not is_vs:
                if any(kw in text_lower for kw in ["úč pod", "úč muj", "ifrs", "financial statement"]):
                    is_ifrs = True

            item = (href, "IFRS" if is_ifrs else "VS", year, link_text, period)
            
            # Ak to nevyzerá ani ako VS ani ako IFRS, radšej to ignorujeme, aby sme nesťahovali smeti
            if is_vs and not is_ifrs:
                if not any(u[0] == href for u in vs_items): vs_items.append(item)
            elif is_ifrs:
                if not any(u[0] == href for u in ifrs_items): ifrs_items.append(item)

        return ifrs_items, vs_items

    def _group_by_period(self, items: list[tuple], limit: int) -> list[list[tuple]]:
        groups: dict[str, list] = {}
        for item in items:
            period = item[4] if item[4] else item[2]
            if period not in groups:
                groups[period] = []
            groups[period].append(item)

        # Odstránenie duplikátov: vyberieme len najlepšiu verziu pre každé obdobie
        deduped_groups = []
        for p, group_items in groups.items():
            if len(group_items) > 1:
                def type_score(text):
                    t = text.lower()
                    if "opravná" in t: return 3
                    if "riadna" in t: return 2
                    if "mimoriadna" in t: return 1
                    return 0
                # Python stabilný sort: ak majú rovnaké skóre, zachová prvé (najnovšie) z listu
                best_item = sorted(group_items, key=lambda x: type_score(x[3]), reverse=True)[0]
                deduped_groups.append((p, [best_item]))
            else:
                deduped_groups.append((p, group_items))

        sorted_periods = sorted(deduped_groups, key=lambda x: _period_sort_key(x[0]), reverse=True)
        return [g[1] for g in sorted_periods[:limit]]

    async def _process_period_group(self, group: list[tuple], index: int) -> Optional[str]:
        first_item = group[0]
        ftype_d, year_d, period_d = first_item[1], first_item[2], first_item[4]
        
        logger.info(f"[RUZ] Obdobie {year_d} ({ftype_d}): Sťahujem {len(group)} dokumentov")
        
        downloaded_pdfs: list[bytes] = []
        downloaded_texts: list[str] = []

        for item in group:
            href_d = item[0]
            full_url = "https://www.registeruz.sk" + href_d

            # 1. Priamy HTTP GET pre attachment links
            if "/attachment/" in href_d:
                pdf_bytes = await self._fetch_pdf_direct(full_url)
                if pdf_bytes: downloaded_pdfs.append(pdf_bytes)
                continue

            # 2. Otvorenie HTML detailu (Playwright)
            dl_page = await self.context.new_page()
            try:
                await dl_page.goto(full_url, wait_until="domcontentloaded", timeout=15000)
                
                try:
                    await dl_page.wait_for_selector("table, .item, .content, .main", timeout=5000)
                except PlaywrightTimeout:
                    pass
                
                content_text = await dl_page.content()
                
                # Check for unstructured (OMV, VW) -> Skús nájsť PDF prílohy priamo na tejto stránke
                if "Údaje nie sú dostupné v štruktúrovanej" in content_text:
                    found_pdf_bytes = await self._extract_attachments_from_page(dl_page)
                    if found_pdf_bytes:
                        downloaded_pdfs.extend(found_pdf_bytes)
                else:
                    # Štandardné HTML štruktúrované (Úč POD)
                    text_content = await self._extract_html_tabs(dl_page, item)
                    if text_content:
                        downloaded_texts.append(text_content)
                    else:
                        # Fallback na stiahnutie príloh, ak HTML nefungovalo správne
                        found_pdf_bytes = await self._extract_attachments_from_page(dl_page)
                        if found_pdf_bytes:
                            downloaded_pdfs.extend(found_pdf_bytes)
            except Exception as e:
                logger.warning(f"[RUZ] Chyba pri sťahovaní {full_url}: {e}")
            finally:
                await dl_page.close()

        # Merge results: Uprednostníme TEXT (HTML), ak máme bohaté tabuľky
        if downloaded_texts:
            return self._merge_texts(downloaded_texts, ftype_d, year_d, index, period_d)
            
        if downloaded_pdfs:
            return self._merge_pdfs(downloaded_pdfs, ftype_d, year_d, index)

        return None

    async def _fetch_pdf_direct(self, url: str) -> Optional[bytes]:
        def _fetch():
            ctx = ssl.create_default_context()
            req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(req, context=ctx) as resp:
                body = resp.read()
                content_type = resp.headers.get("content-type", "").lower()
                if "application/pdf" in content_type or body.startswith(b"%PDF"):
                    return body
                return None
        try:
            body = await asyncio.to_thread(_fetch)
            if body and len(body) > 100:
                return body
        except Exception as e:
            logger.warning(f"[RUZ] Zlyhal direct download {url}: {e}")
        return None

    async def _extract_attachments_from_page(self, page: Page) -> list[bytes]:
        """Kľukne dropdown, nájde linky a stiahne ich."""
        pdfs = []
        try:
            # Dropdowns pre OMV
            dropdowns = await page.locator(".icon.dropdown-icon").all()
            for dd in dropdowns:
                try: await dd.click(timeout=1000)
                except Exception: pass

            try:
                await page.wait_for_selector("a[href*='/attachment/']", timeout=2000)
            except PlaywrightTimeout:
                pass

            attachment_links = await page.locator("a[href*='/attachment/'], a:has-text('Stiahnuť')").all()
            unique_hrefs = set()
            for alink in attachment_links:
                h = await alink.get_attribute("href") or ""
                if h and "/attachment/" in h:
                    unique_hrefs.add(h)
            
            for h in unique_hrefs:
                url = "https://www.registeruz.sk" + h
                pdf_bytes = await self._fetch_pdf_direct(url)
                if pdf_bytes:
                    pdfs.append(pdf_bytes)
        except Exception as e:
            logger.warning(f"[RUZ] Zlyhalo hľadanie attachments na stránke: {e}")
        return pdfs

    async def _extract_html_tabs(self, page: Page, item: tuple) -> Optional[str]:
        year_d = item[2]
        extracted_text = ""
        tables_found = 0

        # Tabuľky priamo na stránke
        rows = await self._parse_html_table(page)
        if rows and len(rows) > 2:
            extracted_text += "\n--- TABUĽKA ZO STRÁNKY ---\n" + self._format_table(rows)
            tables_found += 1

        # Jednotlivé taby
        for tab_name in _HTML_TABS:
            try:
                tab_locs = await page.locator(f"a:has-text('{tab_name}')").all()
                for loc in tab_locs:
                    href = await loc.get_attribute("href")
                    if href and "/cruz-public/domain/financialreport/show/" in href:
                        tab_page = await self.context.new_page()
                        try:
                            success = await self._safe_goto(tab_page, "https://www.registeruz.sk" + href)
                            if success:
                                try: await tab_page.wait_for_selector("table tbody tr, table tr", timeout=3000)
                                except PlaywrightTimeout: pass
                                
                                rows = await self._parse_html_table(tab_page)
                                if rows and len(rows) > 2:
                                    extracted_text += f"\n--- {tab_name.upper()} ---\n" + self._format_table(rows)
                                    tables_found += 1
                        finally:
                            await tab_page.close()
                        break
            except Exception:
                pass
        
        # Ak sme našli aspoň 2 zmysluplné tabuľky, vrátime to, inak necháme padnúť do fallbacku na PDF
        if tables_found >= 2 and len(extracted_text) > 300:
            return extracted_text
        return None

    async def _parse_html_table(self, page: Page) -> list[list[str]]:
        try:
            return await page.evaluate("""() => {
                const results = [];
                document.querySelectorAll('table').forEach(table => {
                    table.querySelectorAll('tr').forEach(tr => {
                        const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
                        if (cells.length >= 2) results.push(cells);
                    });
                });
                return results;
            }""")
        except Exception:
            return []

    def _format_table(self, rows: list[list[str]]) -> str:
        text = ""
        for cells in rows:
            cleaned = [re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', c) for c in cells]
            text += " | ".join(cleaned) + "\n"
        return text

    def _merge_pdfs(self, pdfs: list[bytes], ftype: str, year: str, index: int) -> str:
        import fitz
        merged_doc = fitz.open()
        for pdf_body in pdfs:
            try:
                doc = fitz.open(stream=pdf_body, filetype="pdf")
                merged_doc.insert_pdf(doc)
                doc.close()
            except Exception as e:
                logger.warning(f"[RUZ] Chyba pri mergovaní PDF: {e}")
        
        out_file = self.out_path / f"{ftype}_{self.ico}_{year}_{index}.pdf"
        merged_doc.save(out_file)
        merged_doc.close()
        logger.info(f"[RUZ] Zmergované {len(pdfs)} PDF → {out_file.name}")
        return str(out_file)

    def _merge_texts(self, texts: list[str], ftype: str, year: str, index: int, period: str) -> str:
        # Odstránené hardcoded stĺpce, hlavičky sa ťahajú priamo z HTML tabuliek
        full_text = f"DOKUMENT: {ftype}\nOBDOBIE: {period or year}\n\n"
        full_text += "\n\n".join(texts)
        
        out_file = self.out_path / f"{ftype}_{self.ico}_{year}_{index}.txt"
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(full_text)
        logger.info(f"[RUZ] Uložený text -> {out_file.name}")
        return str(out_file)


async def download_ifrs_reports(ico: str, max_years: int = 10, output_dir: str = "assets") -> list[str]:
    scraper = RuzScraper(ico=ico, output_dir=Path(output_dir), max_years=max_years)
    return await scraper.start()

if __name__ == "__main__":
    import sys
    test_ico = sys.argv[1] if len(sys.argv) > 1 else "31333532"
    asyncio.run(download_ifrs_reports(test_ico, max_years=10, output_dir=f"test_results/{test_ico}"))

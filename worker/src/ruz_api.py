"""
RÚZ Open API client — nahradza Playwright-based ruz_scraper.py.

Používa oficiálne JSON API na registeruz.sk/cruz-public/api/.
Bez API kľúča, bez Playwright, bez anti-bot.

Flow:
  1. GET /api/uctovne-jednotky?ico=XXX → entity IDs
  2. GET /api/uctovna-jednotka?id=XXX  → idUctovnychZavierok + idVyrocnychSprav
  3. GET /api/uctovna-zavierka?id=XXX  → obdobie + idUctovnychVykazov
  4. GET /api/uctovny-vykaz?id=XXX     → JSON tabuľky (ak sú) + prilohy (PDF)
  5. GET /domain/financialreport/attachment/{id} → PDF download
  6. GET /api/vyrocna-sprava?id=XXX    → prilohy (PDF)
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Optional
from urllib.request import Request, urlopen
import ssl

import httpx

logger = logging.getLogger(__name__)

_RUZ_BASE = "https://www.registeruz.sk/cruz-public"
_RUZ_API = f"{_RUZ_BASE}/api"
_RUZ_ATTACHMENT = f"{_RUZ_BASE}/domain/financialreport/attachment"
_UA = "Verifa.sk/1.0 (+https://verifa.sk)"
_TIMEOUT = 30.0
_CONCURRENCY = 5
_FETCH_CONCURRENCY = 10


# ── Helpers ──────────────────────────────────────────────────────────────────

def _period_sort_key(period: str) -> tuple[int, int]:
    """Odvodí chronologický kľúč (koncový rok, koncový mesiac) z period stringu."""
    if not period:
        return (0, 0)
    text = period.replace('\u2013', '-').lower()
    m_q = re.search(r'(q[1-4]|[1-2]\.?\s*polrok)\s*(20\d{2})', text)
    if m_q:
        q_val = m_q.group(1).replace(' ', '').replace('.', '')
        y = int(m_q.group(2))
        if 'q' in q_val:
            return (y, int(q_val.replace('q', '')) * 3)
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


def _period_from_dict(d: dict) -> str:
    """Skonštruuje period string z údajov závierky alebo výročnej správy."""
    od = d.get("obdobieOd", "")
    do = d.get("obdobieDo", "")
    if od and do:
        return f"{od}-{do}"
    if do:
        return do
    if od:
        return od
    return d.get("datumZostaveniaK", "")


def _year_from_period(period: str) -> str:
    """Extrahuje rok z period stringu."""
    if not period:
        return ""
    m = re.search(r'(20\d{2})', period)
    return m.group(1) if m else ""


def _dedup_by_period(items: list[dict], max_count: int) -> list[dict]:
    """Vyber unikátne obdobia (top max_count), zoradené najnovšie prvé."""
    seen: set[str] = set()
    result = []
    for item in items:
        p = _period_from_dict(item)
        if p not in seen:
            seen.add(p)
            result.append(item)
        if len(result) >= max_count:
            break
    return result


# ── API calls ────────────────────────────────────────────────────────────────

_API_RETRIES = 2
_API_RETRY_DELAY = 2.0


async def _api_get(client: httpx.AsyncClient, endpoint: str, params: Optional[dict] = None) -> Optional[dict]:
    """Vykonná GET na RÚZ API s error handling a retry."""
    url = f"{_RUZ_API}/{endpoint}"
    last_error: Optional[Exception] = None
    for attempt in range(_API_RETRIES + 1):
        try:
            resp = await client.get(url, params=params, timeout=_TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            logger.warning(f"[RUZ_API] {endpoint} HTTP {resp.status_code} (attempt {attempt + 1}/{_API_RETRIES + 1})")
            if (resp.status_code >= 500 or resp.status_code == 429) and attempt < _API_RETRIES:
                retry_delay = _API_RETRY_DELAY * 3 if resp.status_code == 429 else _API_RETRY_DELAY
                await asyncio.sleep(retry_delay)
                continue
            return None
        except Exception as e:
            last_error = e
            logger.warning(f"[RUZ_API] {endpoint} exception (attempt {attempt + 1}/{_API_RETRIES + 1}): {e}")
            if attempt < _API_RETRIES:
                await asyncio.sleep(_API_RETRY_DELAY)
                continue
    return None


async def _fetch_details(
    client: httpx.AsyncClient,
    endpoint: str,
    ids: list[int],
) -> list[dict]:
    """Stiahne detaily všetkých záznamov paralelne (unifikované pre závierky aj VS)."""
    sem = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def fetch_one(rid: int) -> Optional[dict]:
        async with sem:
            return await _api_get(client, endpoint, {"id": rid})

    results = await asyncio.gather(*[fetch_one(rid) for rid in ids], return_exceptions=True)
    return [r for r in results if isinstance(r, dict)]


async def _download_pdf(url: str) -> Optional[bytes]:
    """Stiahne PDF z URL (pre attachment/prílohy).

    Deprecated — prefer _download_attachment which handles ZIP archives too.
    Kept for backward compatibility with Playwright fallback code.
    """
    def _fetch():
        ctx = ssl.create_default_context()
        req = Request(url, headers={"User-Agent": _UA})
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
        logger.warning(f"[RUZ_API] PDF download failed {url}: {e}")
    return None


async def _download_attachment(url: str) -> Optional[tuple[bytes, str]]:
    """Stiahne prílohu z URL — podporuje PDF aj ZIP archívy.

    RÚZ API od ~2024 vracia prílohy veľkých firiem ako ZIP archívy
    (obsahujúce PDF výkazy) namiesto priamych PDF. Táto funkcia
    rozpozná oba formáty a vráti (body, mime_type) tuple.

    Returns:
        (body, mime_type) alebo None pri zlyhaní/neznámom formáte.
    """
    def _fetch():
        ctx = ssl.create_default_context()
        req = Request(url, headers={"User-Agent": _UA})
        with urlopen(req, context=ctx) as resp:
            body = resp.read()
            content_type = resp.headers.get("content-type", "").lower()
            # Rozpoznaj PDF priamo
            if "application/pdf" in content_type or body.startswith(b"%PDF"):
                return (body, "application/pdf")
            # Rozpoznaj ZIP — RÚZ vracia prílohy veľkých firiem ako ZIP
            if "application/zip" in content_type or body.startswith(b"PK"):
                return (body, "application/zip")
            # Neznámy formát — log pre debug
            logger.debug(f"[RUZ_API] Unknown attachment type: {content_type}, size={len(body)}")
            return None
    try:
        result = await asyncio.to_thread(_fetch)
        if result and len(result[0]) > 100:
            return result
    except Exception as e:
        logger.warning(f"[RUZ_API] Attachment download failed {url}: {e}")
    return None


def _extract_pdfs_from_zip(zip_bytes: bytes) -> list[bytes]:
    """Extrahuje všetky PDF súbory z ZIP archívu.

    RÚZ ZIP prílohy obsahujú typicky:
      - Účtovná závierka.PDF
      - Vybrané údaje.PDF
      - Správa audítora.PDF

    Vráti zoznam PDF bytes (prázdny zoznam ak ZIP neobsahuje PDF).
    """
    import io
    import zipfile
    pdfs = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".pdf"):
                    data = zf.read(name)
                    if data and len(data) > 100 and data.startswith(b"%PDF"):
                        pdfs.append(data)
                        logger.info(f"[RUZ_API] ZIP extrahovaný: {name} ({len(data)} bytes)")
    except Exception as e:
        logger.warning(f"[RUZ_API] ZIP extraction failed: {e}")
    return pdfs


async def _download_prilohy(prilohy: list[dict]) -> list[bytes]:
    """Stiahne všetky prílohy z daného zoznamu paralelne.

    Podporuje PDF aj ZIP prílohy. ZIP archívy sa rozbalia a
    extrahované PDF sa pridajú do výsledného zoznamu.
    """
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def _fetch_one(priloha: dict) -> list[bytes]:
        pid = priloha.get("id")
        if not pid:
            return []
        meno = priloha.get("meno", "")
        mime_hint = priloha.get("mimeType", "").lower()
        async with sem:
            result = await _download_attachment(f"{_RUZ_ATTACHMENT}/{pid}")
        if result is None:
            logger.debug(f"[RUZ_API] Príloha {pid} ({meno}) — nepodarilo sa stiahnuť")
            return []
        body, content_type = result
        if content_type == "application/zip":
            pdfs = _extract_pdfs_from_zip(body)
            if pdfs:
                logger.info(f"[RUZ_API] Príloha {pid} ({meno}): ZIP → {len(pdfs)} PDF extrahovaných")
            else:
                logger.warning(f"[RUZ_API] Príloha {pid} ({meno}): ZIP neobsahuje žiadne PDF")
            return pdfs
        # PDF priamo
        return [body]

    results = await asyncio.gather(*[_fetch_one(p) for p in prilohy], return_exceptions=True)
    # results je list[list[bytes]] alebo Exception — sploštíme
    pdfs: list[bytes] = []
    for r in results:
        if isinstance(r, list):
            pdfs.extend(r)
        elif isinstance(r, Exception):
            logger.warning(f"[RUZ_API] Príloha download error: {r}")
    return pdfs


# ── Main client ──────────────────────────────────────────────────────────────

async def download_ifrs_reports(
    ico: str,
    max_years: int = 10,
    output_dir: str = "assets",
) -> list[str]:
    """
    Stiahne účtovné závierky a výročné správy z RÚZ Open API.

    Pre SK GAAP (nekonsolidované): štruktúrované tabuľky → .txt,
    poznámky a správa audítora → _notes.pdf.
    Pre IFRS (konsolidované): kompletný výkaz v PDF → .pdf.
    Výročné správy: PDF → .pdf.

    Vracia zoznam ciest k stiahnutým súborom,
    kompatibilné s pôvodným ruz_scraper.download_ifrs_reports().
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    downloaded_files: list[str] = []

    # Cache check: ak adresár už obsahuje súbory pre toto IČO (napr. zo scraper fázy),
    # vrátime ich priamo bez nového HTTP downloadu — ale len ak nie sú staršie ako 24h
    # a len ak cache obsahuje aj najnovší rok z API (inak re-download).
    import time as _time
    import re as _re
    _CACHE_MAX_AGE = 86400  # 24 hours
    existing = []
    for f in out_path.iterdir():
        if f.is_file() and ico in f.name and f.suffix in (".pdf", ".txt") and f.stat().st_size > 100:
            file_age = _time.time() - f.stat().st_mtime
            if file_age < _CACHE_MAX_AGE:
                existing.append(str(f))
            else:
                logger.info(f"[RUZ_API] Cache expired ({file_age/3600:.1f}h) pre {f.name}, re-download")

    if existing:
        # Extract years from cached filenames (e.g. SKGAAP_36168301_2025_0.txt → 2025)
        cached_years = set()
        for fp in existing:
            m = _re.search(r'_(20\d{2})_', os.path.basename(fp))
            if m:
                cached_years.add(int(m.group(1)))
        max_cached_year = max(cached_years) if cached_years else 0

        # Quick API check: what's the newest zavierka year?
        try:
            async with httpx.AsyncClient(headers={"User-Agent": _UA}) as _check_client:
                _entity_ids = await _api_get(_check_client, "uctovne-jednotky", {
                    "zmenene-od": "2000-01-01", "ico": ico, "max-zaznamov": 1,
                })
                if _entity_ids and _entity_ids.get("id"):
                    _eid = _entity_ids["id"][0]
                    _entity = await _api_get(_check_client, "uctovna-jednotka", {"id": _eid})
                    if _entity:
                        _zavierka_ids = _entity.get("idUctovnychZavierok", [])
                        if _zavierka_ids:
                            _latest = await _api_get(_check_client, "uctovna-zavierka", {"id": _zavierka_ids[0]})
                            if _latest:
                                _latest_period = _period_from_dict(_latest)
                                _latest_year = _year_from_period(_latest_period)
                                if _latest_year and _latest_year.isdigit():
                                    api_year = int(_latest_year)
                                    if api_year > max_cached_year:
                                        logger.info(
                                            f"[RUZ_API] Cache stale: API má rok {api_year}, "
                                            f"cache má max rok {max_cached_year} — re-download"
                                        )
                                        existing = []  # Invalidate cache
        except Exception as e:
            logger.warning(f"[RUZ_API] Cache validation failed ({e}), pokračujem s cache")

    if existing:
        logger.info(f"[RUZ_API] Cache hit pre IČO {ico}: {len(existing)} súborov v {out_path}, preskakujem download")
        return existing

    async with httpx.AsyncClient(headers={"User-Agent": _UA}) as client:
        # 1. Nájdi entity ID podľa IČO
        entity_ids = await _api_get(client, "uctovne-jednotky", {
            "zmenene-od": "2000-01-01",
            "ico": ico,
            "max-zaznamov": 10,
        })
        if not entity_ids or not entity_ids.get("id"):
            logger.info(f"[RUZ_API] IČO {ico} nie je v Registri účtovných závierok (žiadna účtovná jednotka)")
            return ["__ENTITY_NOT_FOUND__"]  # Sentinel: entity not found (legitimate, no retry needed)

        entity_id = entity_ids["id"][0]
        logger.info(f"[RUZ_API] Entity ID pre IČO {ico}: {entity_id}")

        # 2. Detail entity → zoznam závierok a výročných správ
        entity = await _api_get(client, "uctovna-jednotka", {"id": entity_id})
        if not entity:
            logger.error(f"[RUZ_API] CRITICAL: Entity {entity_id} existuje ale API zlyhalo pri získavaní detailu pre IČO {ico} — možný výpadok RÚZ API")
            return downloaded_files  # Empty list = API failure (should retry)

        zavierka_ids: list[int] = entity.get("idUctovnychZavierok", [])
        vs_ids: list[int] = entity.get("idVyrocnychSprav", [])
        logger.info(f"[RUZ_API] {entity.get('nazovUJ', ico)}: {len(zavierka_ids)} závierok, {len(vs_ids)} výročných správ")

        if not zavierka_ids and not vs_ids:
            logger.warning(f"[RUZ_API] Entita {entity_id} ({entity.get('nazovUJ', ico)}) existuje ale nemá žiadne závierky ani výročné správy")

        # 3. Stiahni detaily paralelne
        zavierky = await _fetch_details(client, "uctovna-zavierka", zavierka_ids)
        vs_reports = await _fetch_details(client, "vyrocna-sprava", vs_ids)

        # Zoradť najnovšie prvé a vyber unikátne obdobia
        zavierky.sort(key=lambda z: _period_sort_key(_period_from_dict(z)), reverse=True)
        vs_reports.sort(key=lambda v: _period_sort_key(_period_from_dict(v)), reverse=True)
        top_zavierky = _dedup_by_period(zavierky, max_years)
        top_vs = _dedup_by_period(vs_reports, max_years)

        logger.info(f"[RUZ_API] Spracovávam {len(top_zavierky)} závierok a {len(top_vs)} výročných správ")

        # 4. Spracuj závierky
        sem = asyncio.Semaphore(_CONCURRENCY)

        async def bounded_zavierka(z, idx):
            async with sem:
                return await _process_zavierka(client, z, ico, out_path, idx)

        results = await asyncio.gather(
            *[bounded_zavierka(z, i) for i, z in enumerate(top_zavierky)],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, list):
                downloaded_files.extend(f for f in r if f)
            elif isinstance(r, Exception):
                logger.error(f"[RUZ_API] Chyba pri spracovaní závierky: {r}")

        # 5. Spracuj výročné správy
        async def bounded_vs(v, idx):
            async with sem:
                return await _process_vs(v, ico, out_path, idx)

        results_vs = await asyncio.gather(
            *[bounded_vs(v, i) for i, v in enumerate(top_vs)],
            return_exceptions=True,
        )
        for r in results_vs:
            if isinstance(r, str) and r:
                downloaded_files.append(r)
            elif isinstance(r, Exception):
                logger.error(f"[RUZ_API] Chyba pri spracovaní VS: {r}")

    logger.info(f"[RUZ_API] Stiahnutých {len(downloaded_files)} súborov pre IČO {ico}")

    # Ak entita existuje, má závierky, ale všetky výkazy sú neverejné —
    # vráť sentinel, aby scraper mohol zobraziť správnu správu (nie "skúste znovu")
    if not downloaded_files and zavierka_ids:
        # Skontrolujeme či všetky závierky mali aspoň jeden výkaz s neverejnými dátami
        # (heuristic: ak mali závierky výkazy ale nič sa nestiahlo, sú neverejné)
        total_vykazov = sum(len(z.get("idUctovnychVykazov", [])) for z in top_zavierky)
        if total_vykazov > 0:
            logger.info(f"[RUZ_API] IČO {ico}: {len(zavierka_ids)} závierok, {total_vykazov} výkazov — všetky neverejné")
            return ["__DATA_NOT_PUBLIC__"]

    # ── Playwright fallback: ak chýba najnovší rok, skús doplniť z webu ──
    if top_zavierky:
        _api_years = set()
        for fp in downloaded_files:
            m = re.search(r'_(20\d{2})_', os.path.basename(fp))
            if m:
                _api_years.add(int(m.group(1)))
        _newest_period = _period_from_dict(top_zavierky[0])
        _newest_year_str = _year_from_period(_newest_period)
        if _newest_year_str and _newest_year_str.isdigit():
            _newest_year = int(_newest_year_str)
            if _newest_year not in _api_years:
                logger.info(
                    f"[RUZ_API] Najnovší rok {_newest_year} chýba v stiahnutých súboroch "
                    f"(máme: {sorted(_api_years)}) — skúšam Playwright fallback"
                )
                try:
                    _pw_files = await _playwright_fallback(
                        ico, top_zavierky[0], _newest_year, out_path, len(downloaded_files)
                    )
                    if _pw_files:
                        downloaded_files.extend(_pw_files)
                        logger.info(f"[RUZ_API] Playwright fallback: pridaných {len(_pw_files)} súborov pre rok {_newest_year}")
                except Exception as e:
                    logger.warning(f"[RUZ_API] Playwright fallback zlyhal: {e}")

    return downloaded_files


# ── Processing ───────────────────────────────────────────────────────────────

async def _playwright_fallback(
    ico: str,
    zavierka: dict,
    year: int,
    out_path: Path,
    index: int,
) -> list[str]:
    """Playwright fallback: scrape financial reports from RUZ website.

    Keď API download zlyhá pre najnovší rok, otvorí RUZ web stránku entity,
    klikne na taby (Strana aktív, Strana pasív, Výkaz ziskov a strát) a
    stiahne ich ako PDF cez print-to-PDF. Tiež skúsi stiahnuť prílohy
    (Správa auditora) cez "Stiahnuť" link.

    Selektory z RUZ webu:
    - Tab links: .js-tabs.switch-tab[href*='/cruz-public/domain/financialreport/show/']
    - Download links: div[class='b-content...'] span[class='d-inline-block...'] a
    """
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout

    vykaz_ids = zavierka.get("idUctovnychVykazov", [])
    if not vykaz_ids:
        logger.warning(f"[RUZ_PW] Závierka {year} nemá žiadne idUctovnychVykazov — preskakujem")
        return []

    # RUZ web URL pre entity detail
    # Najprv získaj entity_id z API (máme ho v zavierka dict? nie, potrebujeme ho z API)
    # Použijeme prímo URL financialreport/show/{vykaz_id}/{tab_id}
    # Tab IDs: 550 = Strana aktív, 551 = Strana pasív, 552 = Výkaz ziskov a strát
    # Tieto ID sa môžu líšiť, tak ich získame z web stránky

    saved_files: list[str] = []
    _pw = None
    try:
        _pw = await async_playwright().start()
        from src.browser_manager import browser_manager
        browser = await browser_manager.get_browser(_pw)

        context = await browser.new_context(
            user_agent=_UA,
            viewport={"width": 1280, "height": 900},
            locale="sk-SK",
        )
        page = await context.new_page()

        # Naviguj na prvý výkaz — RUZ web stránka s taby
        # URL formát: https://www.registeruz.sk/cruz-public/domain/financialreport/show/{vykaz_id}
        first_vykaz_id = vykaz_ids[0]
        web_url = f"{_RUZ_BASE}/domain/financialreport/show/{first_vykaz_id}"
        logger.info(f"[RUZ_PW] Navigujem na {web_url}")
        await page.goto(web_url, wait_until="networkidle", timeout=30000)

        # Prijať cookies ak existujú
        try:
            cookie_btn = page.locator("button:has-text('Prijať'), button:has-text('Súhlasím'), #cookies-accept")
            if await cookie_btn.count() > 0:
                await cookie_btn.first.click()
                await page.wait_for_timeout(500)
        except Exception:
            pass

        # Nájdi všetky taby (.js-tabs.switch-tab)
        tab_links = page.locator(".js-tabs.switch-tab")
        tab_count = await tab_links.count()
        logger.info(f"[RUZ_PW] Nájdených {tab_count} tabov")

        # Zoznam tabov: (názov, href) — preskakujeme "Titulná strana" (active)
        tabs_to_scrape = []
        for i in range(tab_count):
            href = await tab_links.nth(i).get_attribute("href")
            text = (await tab_links.nth(i).inner_text()).strip()
            if href and "financialreport/show" in href and "Tituln" not in text:
                tabs_to_scrape.append((text, href))

        logger.info(f"[RUZ_PW] Taby na scraping: {[t[0] for t in tabs_to_scrape]}")

        # Pre každý tab: naviguj, počkaj, print-to-PDF + extrahuj HTML tabuľky
        pw_tables: list[dict] = []  # Zbierame tabuľky pre JSON parser
        pw_table_names: list[str] = []
        for tab_name, tab_href in tabs_to_scrape:
            try:
                tab_url = f"https://www.registeruz.sk{tab_href}"
                logger.info(f"[RUZ_PW] Otváram tab '{tab_name}': {tab_url}")
                await page.goto(tab_url, wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(1000)

                # Print-to-PDF
                safe_name = tab_name.replace(" ", "_").replace("á", "a").replace("í", "i").lower()
                pdf_file = out_path / f"SKGAAP_{ico}_{year}_{index}_{safe_name}.pdf"
                await page.pdf(path=str(pdf_file), format="A4")
                if pdf_file.exists() and pdf_file.stat().st_size > 1000:
                    saved_files.append(str(pdf_file))
                    logger.info(f"[RUZ_PW] Uložené: {pdf_file.name} ({pdf_file.stat().st_size} bytes)")
                else:
                    logger.warning(f"[RUZ_PW] PDF príliš malé alebo prázdne pre {tab_name}")

                # Extrahuj HTML tabuľku z DOM pre JSON parser
                try:
                    table_data = await page.evaluate("""() => {
                        const tables = document.querySelectorAll('table');
                        const result = [];
                        for (const tbl of tables) {
                            const rows = tbl.querySelectorAll('tr');
                            const tableRows = [];
                            for (const row of rows) {
                                const cells = row.querySelectorAll('td, th');
                                const rowData = [];
                                for (const cell of cells) {
                                    rowData.push(cell.textContent.trim());
                                }
                                if (rowData.length > 0) tableRows.push(rowData);
                            }
                            if (tableRows.length > 0) result.push(tableRows);
                        }
                        return result;
                    }""")
                    if table_data:
                        for td in table_data:
                            pw_tables.append({"nazov": {"sk": tab_name}, "data": td, "_html": True})
                            pw_table_names.append(tab_name)
                        logger.info(f"[RUZ_PW] Extrahovaná HTML tabuľka z '{tab_name}': {len(table_data)} tabuliek")
                except Exception as e:
                    logger.warning(f"[RUZ_PW] HTML extrakcia zlyhala pre '{tab_name}': {e}")

            except PWTimeout:
                logger.warning(f"[RUZ_PW] Timeout pri tab '{tab_name}'")
            except Exception as e:
                logger.warning(f"[RUZ_PW] Chyba pri tab '{tab_name}': {e}")

        # Skús parsovať extrahované HTML tabuľky do metrics
        if pw_tables:
            try:
                from src.ruz_parser import parse_tables_to_metrics, save_metrics_sidecar
                # Titulná strana — skús získať z API alebo konštruuj minimálnu
                titulna = {"ico": ico, "obdobieDo": str(year)}
                # Skús získať titulnú stranu z API
                try:
                    async with httpx.AsyncClient(headers={"User-Agent": _UA}) as _tc:
                        _tv = await _api_get(_tc, "uctovny-vykaz", {"id": vykaz_ids[0]})
                        if _tv:
                            titulna = _tv.get("obsah", {}).get("titulnaStrana", titulna)
                except Exception:
                    pass

                pw_metrics = parse_tables_to_metrics(pw_tables, titulna, ico)
                if pw_metrics is not None and pw_metrics.celkove_aktiva is not None:
                    # Ulož .txt s textovou reprezentáciou
                    txt_lines = []
                    for tn, td in zip(pw_table_names, pw_tables):
                        txt_lines.append(f"=== {tn} ===")
                        for row in td.get("data", []):
                            txt_lines.append("\t".join(str(c) for c in row))
                        txt_lines.append("")
                    txt_file = out_path / f"SKGAAP_{ico}_{year}_{index}_pw.txt"
                    txt_file.write_text("\n".join(txt_lines), encoding="utf-8")
                    saved_files.append(str(txt_file))
                    save_metrics_sidecar(pw_metrics, str(txt_file))
                    logger.info(f"[RUZ_PW] JSON parser: IČO {ico} rok {year} — metrics z HTML (assets={pw_metrics.celkove_aktiva})")
                else:
                    logger.warning(f"[RUZ_PW] JSON parser nedokázal extrahovať metrics z HTML tabuliek")
            except Exception as e:
                logger.warning(f"[RUZ_PW] HTML table parsing zlyhal: {e}")

        # Skús stiahnuť "Stiahnuť" linky (Správa auditora, prílohy)
        try:
            download_links = page.locator(
                "div[class*='b-content'] span[class*='d-inline-block'] a:has-text('Stiahnuť')"
            )
            dl_count = await download_links.count()
            logger.info(f"[RUZ_PW] Nájdených {dl_count} 'Stiahnuť' linkov")
            for i in range(dl_count):
                try:
                    link = download_links.nth(i)
                    href = await link.get_attribute("href")
                    if href:
                        dl_url = f"https://www.registeruz.sk{href}" if href.startswith("/") else href
                        # Stiahni PDF cez httpx
                        async with httpx.AsyncClient(headers={"User-Agent": _UA}) as dl_client:
                            r = await dl_client.get(dl_url, timeout=30)
                            if r.status_code == 200 and len(r.content) > 1000:
                                notes_file = out_path / f"SKGAAP_{ico}_{year}_{index}_notes_{i}.pdf"
                                notes_file.write_bytes(r.content)
                                saved_files.append(str(notes_file))
                                logger.info(f"[RUZ_PW] Stiahnutý notes PDF: {notes_file.name}")
                except Exception as e:
                    logger.warning(f"[RUZ_PW] Chyba pri sťahovaní prílohy {i}: {e}")
        except Exception as e:
            logger.warning(f"[RUZ_PW] Chyba pri hľadaní 'Stiahnuť' linkov: {e}")

        # Explicit page close prevents resource leak
        try:
            await page.close()
        except Exception:
            pass
        await context.close()

    except Exception as e:
        logger.error(f"[RUZ_PW] Playwright fallback chyba: {e}", exc_info=True)
    finally:
        if _pw:
            await _pw.stop()

    return saved_files


# ── HTML table scraper (fallback when JSON API returns empty tables) ──────────

# URL pattern: /domain/financialreport/show/{vykaz_id}/{table_id}
# table_id: 0=titulná, 550=aktív, 551=pasív, 552=PnL
_HTML_TABLE_IDS = {"aktiv": 550, "pasiv": 551, "income": 552}
# Number of data columns per table type (matches RÚZ JSON API format)
_HTML_DATA_COLS = {"aktiv": 4, "pasiv": 2, "income": 2}


def _parse_sk_number(s: str) -> Optional[float]:
    """Parse Slovak-formatted number: '59 833 603' → 59833603.0, '' → None."""
    if not s or s.strip() == '':
        return None
    cleaned = s.replace('\xa0', ' ').replace(' ', '').replace('\u00a0', '')
    cleaned = cleaned.replace(',', '.')  # decimal comma → dot
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_html_table_to_data(html: str, data_cols: int) -> list[list]:
    """Parse HTML <table> from RÚZ show page into 'data' format matching JSON API.

    Returns list of [val1, val2, ...] lists, indexed by (cisloRiadku - 1).
    Empty rows are filled with [None] * data_cols to preserve indexing.
    """
    import re
    trs = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL | re.IGNORECASE)
    # Build dict: cisloRiadku → [values]
    row_map = {}
    max_row = 0
    for tr in trs:
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.DOTALL | re.IGNORECASE)
        texts = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
        if len(texts) < 4:
            continue
        cislo = texts[2]
        if not cislo.isdigit():
            continue
        row_num = int(cislo)
        # Data columns start after oznacenie, text, cisloRiadku (index 3+)
        data_values = []
        for i in range(data_cols):
            idx = 3 + i
            if idx < len(texts):
                data_values.append(_parse_sk_number(texts[idx]))
            else:
                data_values.append(None)
        row_map[row_num] = data_values
        if row_num > max_row:
            max_row = row_num

    # Convert to list indexed by (row_num - 1)
    data = []
    for i in range(1, max_row + 1):
        if i in row_map:
            data.append(row_map[i])
        else:
            data.append([None] * data_cols)
    return data


async def _scrape_html_tables(
    client: httpx.AsyncClient,
    vykazy: list[dict],
    ico: str,
) -> Optional["FinancialMetrics"]:
    """Scrape HTML tables from RÚZ show pages when JSON API returns empty tables.

    Fetches /domain/financialreport/show/{vykaz_id}/{550|551|552} and parses
    the HTML <table> into the same 'data' format as JSON API, then feeds into
    parse_tables_to_metrics.
    """
    from src.ruz_parser import parse_tables_to_metrics, FinancialMetrics

    # Collect titulnaStrana from first výkaz
    ts = {}
    for v in vykazy:
        obsah = v.get("obsah", {})
        if obsah.get("titulnaStrana"):
            ts = obsah["titulnaStrana"]
            break

    # Find the main výkaz ID (the one with tabuľky, even if empty)
    vykaz_id = None
    id_sablony = None
    for v in vykazy:
        if v.get("obsah", {}).get("tabulky"):
            vykaz_id = v.get("id")
            id_sablony = v.get("idSablony")
            break
    if not vykaz_id:
        return None

    # Fetch HTML pages for each table (aktív, pasív, PnL)
    all_tables = []
    for tab_key, tab_id in _HTML_TABLE_IDS.items():
        url = f"{_RUZ_BASE}/domain/financialreport/show/{vykaz_id}/{tab_id}"
        try:
            r = await client.get(url, timeout=15)
            if r.status_code != 200:
                logger.debug(f"[RUZ_HTML] {tab_key} ({tab_id}): HTTP {r.status_code}")
                continue
            data = _parse_html_table_to_data(r.text, _HTML_DATA_COLS[tab_key])
            if data:
                table_dict = {
                    'nazov': {'sk': tab_key, 'en': tab_key},
                    'data': data,
                }
                all_tables.append(table_dict)
                logger.debug(f"[RUZ_HTML] {tab_key} ({tab_id}): {len(data)} rows parsed")
            else:
                logger.debug(f"[RUZ_HTML] {tab_key} ({tab_id}): 0 rows")
        except Exception as e:
            logger.warning(f"[RUZ_HTML] {tab_key} ({tab_id}): {e}")

    if not all_tables:
        return None

    # Use existing parser to convert data → FinancialMetrics
    return parse_tables_to_metrics(all_tables, ts, ico, id_sablony=id_sablony)


async def _process_zavierka(
    client: httpx.AsyncClient,
    z: dict,
    ico: str,
    out_path: Path,
    index: int,
) -> list[str]:
    """Spracuje jednu závierku: extrahuje JSON tabuľky a/alebo stiahne PDF prílohy.

    Pre SK GAAP (nekonsolidované): výkazy s tabuľkami → .txt,
    výkazy bez tabuliek (poznámky, správa audítora) → _notes.pdf.
    Pre IFRS (konsolidované): všetky dáta v jednom PDF → .pdf.
    """
    period = _period_from_dict(z)
    year = _year_from_period(period) or str(z.get("obdobieDo", "")[:4] or "")
    konsolidovana = z.get("konsolidovana", False)
    ftype = "IFRS" if konsolidovana else "SKGAAP"

    vykaz_ids: list[int] = z.get("idUctovnychVykazov", [])
    logger.info(f"[RUZ_API] Závierka {year} (kons={konsolidovana}): {len(vykaz_ids)} výkazov")

    downloaded_pdfs: list[bytes] = []
    extracted_tables: list[str] = []
    saved_files: list[str] = []

    all_vykazy = []
    vykaz_sem = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def _fetch_vykaz(vid: int) -> Optional[dict]:
        async with vykaz_sem:
            return await _api_get(client, "uctovny-vykaz", {"id": vid})

    vykaz_results = await asyncio.gather(
        *[_fetch_vykaz(vid) for vid in vykaz_ids],
        return_exceptions=True,
    )

    for vykaz in vykaz_results:
        if not isinstance(vykaz, dict):
            continue
        all_vykazy.append(vykaz)

        # Detekcia neverejných dát — pobočky zahraničných spoločností,
        # banky a poisťovne majú často výkazy označené ako "Neverejné"
        pristupnost = vykaz.get("pristupnostDat", "")
        if pristupnost and pristupnost.lower().startswith("neverejn"):
            logger.info(f"[RUZ_API] Výkaz {vykaz.get('id')} rok {year}: pristupnostDat={pristupnost} — preskakujem")
            continue

        obsah = vykaz.get("obsah", {})
        tabs = obsah.get("tabulky", [])

        if tabs:
            text = _format_vykaz_tables(vykaz)
            if text:
                extracted_tables.append(text)
            else:
                # Tables exist but are empty (0 rows) — fallback to PDF prílohy
                pdfs = await _download_prilohy(vykaz.get("prilohy", []))
                downloaded_pdfs.extend(pdfs)
        else:
            pdfs = await _download_prilohy(vykaz.get("prilohy", []))
            downloaded_pdfs.extend(pdfs)

    # ── Direct JSON parsing for SK GAAP (non-consolidated) ──
    # Eliminates LLM hallucinations by extracting metrics from structured JSON.
    parsed_metrics = None
    if not konsolidovana and all_vykazy:
        try:
            from src.ruz_parser import parse_zavierka_to_metrics, save_metrics_sidecar
            parsed_metrics = parse_zavierka_to_metrics(all_vykazy, ico)
            if parsed_metrics and parsed_metrics.celkove_aktiva is not None:
                logger.info(f"[RUZ_API] JSON parser: IČO {ico} rok {year} — metrics extracted (assets={parsed_metrics.celkove_aktiva}, revenue={parsed_metrics.trzby_z_hlavnej_cinnosti})")
            else:
                # ── HTML fallback: JSON API returned empty tables ──
                # RÚZ sometimes returns table structures with 0 rows in JSON API,
                # but the HTML page (show/{id}/550,551,552) has full data.
                # Scrape HTML tables before falling back to expensive PDF+LLM.
                logger.info(f"[RUZ_API] JSON parser: IČO {ico} rok {year} — empty tables, trying HTML scrape")
                try:
                    parsed_metrics = await _scrape_html_tables(client, all_vykazy, ico)
                    if parsed_metrics and parsed_metrics.celkove_aktiva is not None:
                        logger.info(f"[RUZ_API] HTML scrape: IČO {ico} rok {year} — metrics extracted (assets={parsed_metrics.celkove_aktiva}, revenue={parsed_metrics.trzby_z_hlavnej_cinnosti})")
                    else:
                        logger.warning(f"[RUZ_API] HTML scrape: IČO {ico} rok {year} — no data found, will use PDF+LLM fallback")
                except Exception as html_err:
                    logger.warning(f"[RUZ_API] HTML scrape failed for IČO {ico} rok {year}: {html_err}")
        except Exception as e:
            logger.warning(f"[RUZ_API] JSON parser failed for IČO {ico} rok {year}: {e}")

    if extracted_tables:
        txt_path = _save_text(extracted_tables, ftype, year, ico, period, index, out_path)
        saved_files.append(txt_path)

        # Save metrics sidecar only if parser extracted real values
        if parsed_metrics is not None and parsed_metrics.celkove_aktiva is not None:
            from src.ruz_parser import save_metrics_sidecar
            save_metrics_sidecar(parsed_metrics, txt_path)
        elif parsed_metrics is not None:
            logger.warning(f"[RUZ_API] JSON parser vrátil prázdne metrics pre IČO {ico} rok {year} — sidecar sa neukladá, LLM extrakcia sa použije")

    if downloaded_pdfs:
        # PDF sa označí ako "notes" len ak máme reálne tabuľky s dátami.
        # Ak extracted_tables obsahuje len hlavičku (prázdne tabuľky z API),
        # PDF je primárny zdroj finančných dát — nesmie sa skipnúť v pipeline.
        has_real_tables = any(
            tab.get("data") for vt in all_vykazy
            for tab in vt.get("obsah", {}).get("tabulky", [])
        )
        suffix = "notes" if has_real_tables else ""
        pdf_path = _merge_pdfs(downloaded_pdfs, ftype, year, ico, index, out_path, suffix=suffix)
        saved_files.append(pdf_path)

    return saved_files


async def _process_vs(
    v: dict,
    ico: str,
    out_path: Path,
    index: int,
) -> Optional[str]:
    """Spracuje výročnú správu: stiahne PDF prílohy."""
    period = _period_from_dict(v)
    year = _year_from_period(period) or str(v.get("obdobieDo", "")[:4] or "")
    ftype = "VS"

    prilohy = v.get("prilohy", [])
    logger.info(f"[RUZ_API] Výročná správa {year}: {len(prilohy)} príloh")

    downloaded_pdfs = await _download_prilohy(prilohy)

    if downloaded_pdfs:
        return _merge_pdfs(downloaded_pdfs, ftype, year, ico, index, out_path)

    return None


# ── Output helpers ───────────────────────────────────────────────────────────

def _format_vykaz_tables(vykaz: dict) -> str:
    """Konvertuje JSON tabuľky z výkazu do textového formátu (kompatibilné s LLM extrakciou).

    Okrem kompletných tabuliek extrahuje aj:
    - Záväzky voči zamestnancom, SP a štátu (riadky 131-133 šablóny Úč POD)
    - Počet zamestnancov z titulnej strany
    """
    obsah = vykaz.get("obsah", {})
    tabs = obsah.get("tabulky", [])
    if not tabs:
        return ""

    ts = obsah.get("titulnaStrana", {})
    obdobie_od = ts.get("obdobieOd", "")
    obdobie_do = ts.get("obdobieDo", "")
    kons = ts.get("konsolidovana", False)

    parts = []
    if obdobie_od or obdobie_do:
        parts.append(f"OBDOBIE: {obdobie_od}-{obdobie_do}")
    if kons:
        parts.append("KONSOLIDOVANÁ: áno")

    # Počet zamestnancov z titulnej strany (ak existuje)
    pocet_zam = ts.get("pocetZamestnancov") or ts.get("priemernyPocetZamestnancov")
    if pocet_zam is not None:
        parts.append(f"PRIEMERNÝ POČET ZAMESTNANCOV: {pocet_zam}")

    for tab in tabs:
        nazov = tab.get("nazov", {}).get("sk", "?")
        data = tab.get("data", [])
        if not data:
            continue
        parts.append(f"\n--- {nazov.upper()} ---")

        # Detect flat data format (scalars instead of lists)
        if data and not isinstance(data[0], list):
            # Determine column count from table name
            nazov_lower = nazov.lower()
            if "akt" in nazov_lower:
                cols = 4
            else:
                cols = 2
            # Reshape flat array into rows
            for i in range(0, len(data), cols):
                row = data[i : i + cols]
                cleaned = [re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', str(c)) for c in row]
                parts.append(" | ".join(cleaned))
        else:
            for row in data:
                if isinstance(row, list):
                    cleaned = [re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', str(c)) for c in row]
                    parts.append(" | ".join(cleaned))
                elif isinstance(row, str):
                    parts.append(row)

    return "\n".join(parts) if len(parts) > 2 else ""


def _merge_pdfs(pdfs: list[bytes], ftype: str, year: str, ico: str, index: int, out_path: Path, suffix: str = "") -> str:
    """Zmerguje PDF bytes do jedného súboru."""
    import fitz
    merged_doc = fitz.open()
    for pdf_body in pdfs:
        try:
            doc = fitz.open(stream=pdf_body, filetype="pdf")
            merged_doc.insert_pdf(doc)
            doc.close()
        except Exception as e:
            logger.warning(f"[RUZ_API] Chyba pri mergovaní PDF: {e}")

    sfx = f"_{suffix}" if suffix else ""
    out_file = out_path / f"{ftype}_{ico}_{year}_{index}{sfx}.pdf"
    merged_doc.save(out_file)
    merged_doc.close()
    logger.info(f"[RUZ_API] Zmergované {len(pdfs)} PDF → {out_file.name}")
    return str(out_file)


def _save_text(texts: list[str], ftype: str, year: str, ico: str, period: str, index: int, out_path: Path) -> str:
    """Uloží extrahované texty do .txt súboru."""
    full_text = f"DOKUMENT: {ftype}\nOBDOBIE: {period or year}\n\n"
    full_text += "\n\n".join(texts)

    out_file = out_path / f"{ftype}_{ico}_{year}_{index}.txt"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(full_text)
    logger.info(f"[RUZ_API] Uložený text → {out_file.name}")
    return str(out_file)


# ── CLI pre testovanie ───────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    test_ico = sys.argv[1] if len(sys.argv) > 1 else "31637051"
    test_dir = f"test_results/{test_ico}"
    files = asyncio.run(download_ifrs_reports(test_ico, max_years=5, output_dir=test_dir))
    print(f"\nStiahnuté súbory ({len(files)}):")
    for f in files:
        print(f"  {f}")

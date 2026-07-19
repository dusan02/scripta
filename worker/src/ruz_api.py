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

async def _api_get(client: httpx.AsyncClient, endpoint: str, params: Optional[dict] = None) -> Optional[dict]:
    """Vykonná GET na RÚZ API s error handling."""
    url = f"{_RUZ_API}/{endpoint}"
    try:
        resp = await client.get(url, params=params, timeout=_TIMEOUT)
        if resp.status_code == 200:
            return resp.json()
        logger.warning(f"[RUZ_API] {endpoint} HTTP {resp.status_code}")
        return None
    except Exception as e:
        logger.warning(f"[RUZ_API] {endpoint} exception: {e}")
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
    """Stiahne PDF z URL (pre attachment/prílohy)."""
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


async def _download_prilohy(prilohy: list[dict]) -> list[bytes]:
    """Stiahne všetky PDF prílohy z daného zoznamu paralelne."""
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def _fetch_one(priloha: dict) -> Optional[bytes]:
        pid = priloha.get("id")
        if not pid:
            return None
        async with sem:
            return await _download_pdf(f"{_RUZ_ATTACHMENT}/{pid}")

    results = await asyncio.gather(*[_fetch_one(p) for p in prilohy], return_exceptions=True)
    return [r for r in results if isinstance(r, bytes) and r]


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
    # vrátime ich priamo bez nového HTTP downloadu
    existing = [
        str(f) for f in out_path.iterdir()
        if f.is_file() and ico in f.name and f.suffix in (".pdf", ".txt") and f.stat().st_size > 100
    ]
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
            logger.warning(f"[RUZ_API] Žiadna účtovná jednotka pre IČO {ico}")
            return downloaded_files

        entity_id = entity_ids["id"][0]
        logger.info(f"[RUZ_API] Entity ID pre IČO {ico}: {entity_id}")

        # 2. Detail entity → zoznam závierok a výročných správ
        entity = await _api_get(client, "uctovna-jednotka", {"id": entity_id})
        if not entity:
            logger.warning(f"[RUZ_API] Nepodarilo sa získať detail entity {entity_id}")
            return downloaded_files

        zavierka_ids: list[int] = entity.get("idUctovnychZavierok", [])
        vs_ids: list[int] = entity.get("idVyrocnychSprav", [])
        logger.info(f"[RUZ_API] {entity.get('nazovUJ', ico)}: {len(zavierka_ids)} závierok, {len(vs_ids)} výročných správ")

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
    return downloaded_files


# ── Processing ───────────────────────────────────────────────────────────────

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
    ftype = "IFRS"

    vykaz_ids: list[int] = z.get("idUctovnychVykazov", [])
    logger.info(f"[RUZ_API] Závierka {year} (kons={konsolidovana}): {len(vykaz_ids)} výkazov")

    downloaded_pdfs: list[bytes] = []
    extracted_tables: list[str] = []
    saved_files: list[str] = []

    for vid in vykaz_ids:
        vykaz = await _api_get(client, "uctovny-vykaz", {"id": vid})
        if not vykaz:
            continue

        obsah = vykaz.get("obsah", {})
        tabs = obsah.get("tabulky", [])

        if tabs:
            text = _format_vykaz_tables(vykaz)
            if text:
                extracted_tables.append(text)
        else:
            pdfs = await _download_prilohy(vykaz.get("prilohy", []))
            downloaded_pdfs.extend(pdfs)

    if extracted_tables:
        txt_path = _save_text(extracted_tables, ftype, year, ico, period, index, out_path)
        saved_files.append(txt_path)

    if downloaded_pdfs:
        suffix = "notes" if extracted_tables else ""
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
        for row in data:
            if isinstance(row, list):
                cleaned = [re.sub(r'(?<=\d)[\s\xa0](?=\d{3}\b)', '', str(c)) for c in row]
                parts.append(" | ".join(cleaned))
            elif isinstance(row, str):
                parts.append(row)

    # ── Extrakcia štátnych záväzkov zo šablóny Úč POD (699 a kompatibilné) ──
    # Šablóna 699 "Strana pasív" Tab 1: pozičné indexy sú deterministické:
    #   index 52 = riadok 131 — Záväzky voči zamestnancom (331, 333, 33X, 479A)
    #   index 53 = riadok 132 — Záväzky zo sociálneho poistenia (336A)
    #   index 54 = riadok 133 — Daňové záväzky a dotácie (341-347, 34X)
    # Toto sú kľúčové rizikové indikátory (trestná zodpovednosť štatutára).
    _PASIV_TAB_INDEX = 1  # "Strana pasív" je vždy druhá tabuľka
    _IDX_ZAMESTNANCI = 52
    _IDX_SP = 53
    _IDX_DAN = 54

    if len(tabs) > _PASIV_TAB_INDEX:
        pasiv_data = tabs[_PASIV_TAB_INDEX].get("data", [])
        state_parts = []

        def _get_val(idx: int) -> Optional[float]:
            if idx < len(pasiv_data):
                raw = pasiv_data[idx]
                try:
                    return float(raw) if raw not in (None, "", " ") else None
                except (ValueError, TypeError):
                    return None
            return None

        zam = _get_val(_IDX_ZAMESTNANCI)
        sp = _get_val(_IDX_SP)
        dan = _get_val(_IDX_DAN)

        if zam is not None and zam > 0:
            state_parts.append(f"Záväzky voči zamestnancom: {int(zam):,} EUR".replace(",", " "))
        if sp is not None and sp > 0:
            state_parts.append(f"Záväzky zo sociálneho poistenia: {int(sp):,} EUR".replace(",", " "))
        if dan is not None and dan > 0:
            state_parts.append(f"Daňové záväzky a dotácie: {int(dan):,} EUR".replace(",", " "))

        if state_parts:
            parts.append("\n--- ZÁVÄZKY VOČI ŠTÁTU A SP (RIZIKOVÉ INDIKÁTORY) ---")
            parts.extend(state_parts)

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

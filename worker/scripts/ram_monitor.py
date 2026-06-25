"""RAM + timing monitor pre scraper run.
Spustí všetky scrapery paralelne a počas behu loguje RAM Chromium procesov."""
import asyncio
import logging
import sys
import time
from pathlib import Path

# Ensure worker root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psutil
from playwright.async_api import async_playwright

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

# Všetky zdroje okrem CRE (vyžaduje login credentials)
ALL_SOURCES = [
    "ORSR", "ZRSR", "INSOLVENCY", "RPVS", "NCRZP", "NCRD",
    "FINANCNA_SPRAVA", "FS_DPH_RUSENIE", "FS_DPH_VYMAZANI",
    "FS_DANOVE_SUBJEKTY", "FS_DAN_Z_PRIJMOV",
    "FS_DPH_NADMERNY_ODPOCET", "FS_DPH_REGISTROVANI", "FS_DAN_PRIJMOV_REG",
    "SP_DLZNICI", "VSZP_DLZNICI", "DOVERA_DLZNICI", "UNION_DLZNICI",
    "REGISTER_UZ",
]

ICO = "35849703"
OUTPUT_DIR = Path("/tmp/test_ram_monitor")


def get_chromium_ram_mb() -> float:
    """Vráti súčet RSS (MB) všetkých Chromium procesov."""
    total = 0
    for proc in psutil.process_iter(["name"]):
        try:
            name = proc.info["name"] or ""
            if "chromium" in name.lower() or "chrome" in name.lower():
                total += proc.memory_info().rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return total / (1024 * 1024)


async def monitor_ram(interval: float, stop_event: asyncio.Event, samples: list):
    """Periodicky vzorkuje RAM a čas."""
    while not stop_event.is_set():
        ram = get_chromium_ram_mb()
        t = time.perf_counter()
        samples.append((t, ram))
        logger.info(f"[RAM] {ram:.0f} MB")
        await asyncio.sleep(interval)


async def main():
    from src.scrapers.registry import run_scrapers

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # Baseline RAM (browser bez scraperov)
        baseline = get_chromium_ram_mb()
        logger.info(f"[RAM] Baseline (prázdny browser): {baseline:.0f} MB")

        samples = []
        stop_event = asyncio.Event()

        # Štart monitoru (0.5s interval)
        monitor_task = asyncio.create_task(monitor_ram(0.5, stop_event, samples))

        t0 = time.perf_counter()

        results = await run_scrapers(
            sources=ALL_SOURCES,
            output_dir=OUTPUT_DIR,
            browser=browser,
            target_type="COMPANY",
            ico=ICO,
        )

        dt = time.perf_counter() - t0
        stop_event.set()
        await monitor_task

        # Výsledky
        logger.info("=" * 60)
        logger.info("VÝSLEDKY SCRAPOVANIA")
        logger.info("=" * 60)

        success = 0
        failed = 0
        for r in results:
            status = r.status
            msg = r.status_message or ""
            file_info = f" → {r.file_path}" if r.file_path else ""
            logger.info(f"  {r.source_type:25s} {status:12s} {msg[:60]}{file_info}")
            if status == "SUCCESS":
                success += 1
            else:
                failed += 1

        logger.info("-" * 60)
        logger.info(f"Úspech: {success} | Zlyhanie: {failed} | Celkom: {len(results)}")
        logger.info(f"Celkový čas: {dt:.1f}s")

        # RAM štatistiky
        if samples:
            rams = [s[1] for s in samples]
            times = [s[0] - t0 for s in samples]
            peak = max(rams)
            avg = sum(rams) / len(rams)
            final = rams[-1]

            logger.info("-" * 60)
            logger.info("RAM ŠTATISTIKY (Chromium procesy)")
            logger.info(f"  Baseline (prázdny browser):  {baseline:>7.0f} MB")
            logger.info(f"  Priemer počas scrapovania:   {avg:>7.0f} MB")
            logger.info(f"  Peak (maximum):              {peak:>7.0f} MB")
            logger.info(f"  Po skončení:                 {final:>7.0f} MB")
            logger.info(f"  Nárast oproti baseline:      {peak - baseline:>7.0f} MB")
            logger.info(f"  Vzoriek: {len(samples)} (interval 0.5s)")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

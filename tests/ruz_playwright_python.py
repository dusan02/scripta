from pathlib import Path
from playwright.sync_api import sync_playwright


def main() -> None:
    download_dir = Path(__file__).resolve().parent / "downloads"
    download_dir.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1200},
            accept_downloads=True,
        )
        context.set_default_timeout(30000)
        page = context.new_page()

        page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch", wait_until="domcontentloaded")

        try:
            page.get_by_role("link", name="Povoliť všetko").click(timeout=10000)
        except Exception:
            pass

        page.get_by_role("textbox", name="Zadajte názov účtovnej").click()
        page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("00604381")
        page.get_by_role("button", name="Vyhľadať").click()

        page.get_by_role("link", name="Detail ÚJ a jej ÚZ").click()
        page.get_by_role("link", name="Individuálne účtovné závierky").click()

        page.locator("a").filter(has_text="01/2016").filter(has_text="Individu").first.click()
        page.locator("a").filter(has_text="IFRS účtovná závierka").first.click()

        page.locator(".icon.dropdown-icon").first.click()
        with page.expect_download() as download_info:
            page.get_by_role("link", name=" Dokument: PDF veľkosť 3 148").click()
        download_info.value.save_as(download_dir / "document_1.pdf")

        page.locator(".icon.dropdown-icon").first.click()
        with page.expect_download() as download_info:
            page.get_by_role("link", name=" Dokument: PDF veľkosť 1 258").click()
        download_info.value.save_as(download_dir / "document_2.pdf")

        page.locator(".icon.dropdown-icon").first.click()
        with page.expect_download() as download_info:
            page.get_by_role("link", name=" Dokument: DOC veľkosť 35 KB").click()
        download_info.value.save_as(download_dir / "document_3.doc")

        page.locator(".icon.dropdown-icon").first.click()
        with page.expect_download() as download_info:
            page.get_by_role("link", name=" Dokument: PDF veľkosť 6 410").click()
        download_info.value.save_as(download_dir / "document_4.pdf")

        page.get_by_role("link", name="Detail ÚJ a jej ÚZ").click()
        page.get_by_role("link", name="Výročné správy").click()
        page.locator("a").filter(has_text="01/2025").filter(has_text="Individu").first.click()
        with page.expect_download() as download_info:
            page.locator("a").filter(has_text="VS - Výročná správa").first.click()
        download_info.value.save_as(download_dir / "annual_report.pdf")

        page.close()
        context.close()
        browser.close()


if __name__ == "__main__":
    main()

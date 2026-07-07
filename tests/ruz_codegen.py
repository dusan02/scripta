import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch")
    page.get_by_role("link", name="Povoliť všetko").click()
    page.get_by_role("textbox", name="Zadajte názov účtovnej").click()
    page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("00604381")
    page.get_by_role("button", name="Vyhľadať").click()
    page.get_by_role("link").filter(has_text=re.compile(r"^$")).click()
    page.get_by_role("textbox", name="Zadajte názov účtovnej").dblclick()
    page.get_by_role("link", name=" 01/2016 - 12/2016 Individuá").click()
    page.get_by_role("link", name="IFRS účtovná závierka: Účtovn").click()
    page.get_by_text("Údaje nie sú dostupné v š").click()
    page.locator(".icon.dropdown-icon").first.click()
    with page.expect_download() as download_info:
        page.get_by_role("link", name=" Dokument: PDF veľkosť 3 148").click()
    download = download_info.value
    page.locator(".icon.dropdown-icon").first.click()
    with page.expect_download() as download1_info:
        page.get_by_role("link", name=" Dokument: PDF veľkosť 1 258").click()
    download1 = download1_info.value
    page.locator(".icon.dropdown-icon").first.click()
    with page.expect_download() as download2_info:
        page.get_by_role("link", name=" Dokument: DOC veľkosť 35 KB").click()
    download2 = download2_info.value
    page.locator(".icon.dropdown-icon").first.click()
    with page.expect_download() as download3_info:
        page.get_by_role("link", name=" Dokument: PDF veľkosť 6 410").click()
    download3 = download3_info.value
    page.get_by_role("link", name="Detail ÚJ a jej ÚZ").click()
    page.get_by_role("link", name="Výročné správy").click()
    page.get_by_role("link", name=" 01/2025 - 12/2025 Individuá").click()
    with page.expect_download() as download4_info:
        page.get_by_role("link", name=" VS - Výročná správa.PDF, veľkosť 1 618 KB (Zdroj údajov: FRSR)").click()
    download4 = download4_info.value
    page.get_by_role("link", name="Oznámenie o dátume schválenia").click()
    page.get_by_role("link", name="Detail ÚJ a jej ÚZ").click()
    page.get_by_role("link", name="Individuálne účtovné závierky").click()
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

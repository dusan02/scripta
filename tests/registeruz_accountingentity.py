import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
    page.get_by_role("link", name="Odmietnuť").click()
    page.get_by_role("textbox", name="Zadajte názov účtovnej").click()
    page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("31322832")
    page.get_by_role("button", name="Vyhľadaj znova").click()
    page.get_by_role("link").filter(has_text=re.compile(r"^$")).click()
    page.get_by_role("link", name=" 01/2024 - 12/2024 Individuá").click()
    page.get_by_role("link", name="IFRS účtovná závierka: Účtovn").click()
    with page.expect_download() as download_info:
        page.get_by_role("link", name="Stiahnuť").click()
    download = download_info.value
    page.get_by_role("link", name=" 01/2023 - 12/2023 Individuá").click()
    page.get_by_role("link", name="IFRS účtovná závierka: Účtovn").click()
    with page.expect_download() as download1_info:
        page.get_by_role("link", name="Stiahnuť").click()
    download1 = download1_info.value
    page.get_by_role("link", name=" 01/2022 - 12/2022 Individuá").click()
    page.get_by_role("link", name="IFRS účtovná závierka: Účtovn").click()
    with page.expect_download() as download2_info:
        page.get_by_role("link", name="Stiahnuť").click()
    download2 = download2_info.value
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy")
    with page.expect_popup() as page1_info:
        page.get_by_role("button", name="www.info-efaktura.sk").click()
    page1 = page1_info.value
    page.get_by_role("link", name="Zoznam daňových subjektov", description="Zoznam daňových subjektov registrovaných na daň z príjmov").click()
    page.get_by_role("textbox", name="IČO").click()
    page.get_by_role("textbox", name="IČO").fill("35697270")
    page.get_by_role("button", name="Vyhľadať").click()
    with page.expect_download() as download_info:
        with page.expect_popup() as page2_info:
            page.get_by_role("link", name="Export do PDF").click()
        page2 = page2_info.value
    download = download_info.value
    page2.close()
    page1.close()
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://portal.unionzp.sk/pub/dlznici")
    page.get_by_role("textbox", name="Zadajte priezvisko, IČO,").click()
    page.get_by_role("textbox", name="Zadajte priezvisko, IČO,").fill("37501453")
    page.get_by_role("button", name="Hľadať").click()
    page.goto("https://portal.unionzp.sk/pub/dlznici")
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

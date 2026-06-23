import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://www.orsr.sk/")
    page.get_by_role("link", name="identifikačného čísla").click()
    page.get_by_role("textbox", name="Sem zadajte celé identifikačn").click()
    page.get_by_role("textbox", name="Sem zadajte celé identifikačn").click()
    page.get_by_role("textbox", name="Sem zadajte celé identifikačn").fill("31562141")
    page.get_by_role("button", name="Hľadaj").click()
    page.get_by_role("link", name="Aktuálny").click()
    page.get_by_role("link", name="Úplný").click()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

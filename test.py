import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://obcan.justice.sk/pilot/poverenia/")
    page.get_by_role("button", name="Prijať analytické cookies").click()
    page.get_by_role("radio", name="podľa IČO, resp. názvu povinn").check()
    page.get_by_role("textbox", name="IČO").click()
    page.get_by_role("textbox", name="IČO").fill("31384315")
    page.get_by_role("button", name="Hľadať poverenie").click()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

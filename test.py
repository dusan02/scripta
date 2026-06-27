import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10")
    page.locator("div").filter(has_text=re.compile(r"^Milan Súkeník$")).click()
    page.get_by_role("textbox", name="Vyhľadajte podľa mena alebo").click()
    page.get_by_role("textbox", name="Vyhľadajte podľa mena alebo").fill("Milan Súkeník")
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name="Milan Súkeník").click()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

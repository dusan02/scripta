import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Web/Zoznam.aspx")
    page.get_by_role("link", name="Vyhľadávanie v OV").click()
    page.get_by_role("textbox", name="Značka, číslo a kód/IČO").click()
    page.get_by_role("textbox", name="Značka, číslo a kód/IČO").fill("52292517")
    page.get_by_role("button", name="Vyhľadať").click()
    page.get_by_text("Skryť výskyty nájdených kľúč").click()
    page.get_by_role("cell", name="Oznámenie o začatí konania o").click()
    page.get_by_role("cell", name="Detail").nth(2).click()
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

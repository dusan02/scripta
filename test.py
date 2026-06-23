import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://socpoist.sk/nastroje-sluzby/zoznam-dlznikov")
    page.get_by_role("textbox", name="IČO").click()
    page.get_by_role("textbox", name="IČO").fill("44023243")
    page.get_by_role("button", name="Potvrdiť").click()
    page.get_by_role("cell", name="380,10 €").click()
    page.get_by_role("cell", name="44023243").dblclick()
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

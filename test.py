import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://rpo.statistics.sk/new/")
    page.get_by_role("textbox", name="Identifikátor").click()
    page.get_by_role("textbox", name="Identifikátor").fill("52292517")
    page.get_by_role("button", name="Vyhľadať").click()
    page.get_by_role("cell", name="52292517").click()
    page.get_by_role("link", name="STREBAU s. r. o. v likvidácii").click()
    page.get_by_role("term").filter(has_text="NázovPočet položiek:").get_by_role("button").click()
    page.get_by_role("button", name="Počet položiek: 14").click()
    page.get_by_role("button", name="Počet položiek: 4").click()
    page.get_by_role("button", name="Počet položiek:").nth(3).click()
    page.get_by_role("button", name="Počet položiek:").nth(4).click()
    page.get_by_role("button", name="Počet položiek:").nth(5).click()
    page.get_by_role("button", name="Počet položiek: 2").nth(4).click()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

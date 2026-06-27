#!/usr/bin/env python3
"""Debug: čo sa deje na FormularDetail stránke — aké requesty idú cez sieť."""
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s]: %(message)s")

DETAIL_URL_1 = "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormularDetail.aspx?IdFormular=4405069&csrt=16695906641699832384"
DETAIL_URL_2 = "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormularDetail.aspx?IdFormular=4266822&csrt=16695906641699832384"

async def debug_detail(url: str, label: str):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context()

        pdf_requests = []

        async def on_request(req):
            if "pdf" in req.url.lower() or req.resource_type == "document":
                logging.info(f"  [REQ] {req.resource_type} {req.method} {req.url[:120]}")
            # Capture any application/pdf responses
            pass

        async def on_response(resp):
            ct = resp.headers.get("content-type", "")
            if "pdf" in ct.lower() or "pdf" in resp.url.lower():
                logging.info(f"  [RESP-PDF] {resp.status} content-type={ct} url={resp.url[:120]}")
                pdf_requests.append(resp.url)

        page = await context.new_page()
        page.on("request", on_request)
        page.on("response", on_response)

        logging.info(f"\n=== {label} ===")
        logging.info(f"Navigating to: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(5000)  # wait for any async PDF loads

        # Check for embed elements
        embed_src = await page.evaluate("""() => {
            const embed = document.querySelector('embed[type="application/pdf"]');
            const iframe = document.querySelector('iframe');
            const object = document.querySelector('object[type="application/pdf"]');
            return {
                embed: embed ? embed.getAttribute('src') : null,
                iframe: iframe ? iframe.getAttribute('src') : null,
                object: object ? object.getAttribute('data') : null,
                bodyText: document.body ? document.body.innerText.substring(0, 200) : '',
                allSrcs: Array.from(document.querySelectorAll('embed,iframe,object')).map(e => ({
                    tag: e.tagName,
                    src: e.getAttribute('src') || e.getAttribute('data'),
                    type: e.getAttribute('type')
                }))
            };
        }""")
        logging.info(f"  embed_src: {embed_src['embed']}")
        logging.info(f"  iframe_src: {embed_src['iframe']}")
        logging.info(f"  object_data: {embed_src['object']}")
        logging.info(f"  all embed/iframe/object: {embed_src['allSrcs']}")
        logging.info(f"  bodyText[:200]: {embed_src['bodyText']}")
        logging.info(f"  PDF responses intercepted: {pdf_requests}")

        # Try page.pdf() to render the page
        pdf_bytes = await page.pdf(format="A4", print_background=True)
        logging.info(f"  page.pdf() size: {len(pdf_bytes)} bytes, starts with: {pdf_bytes[:4]}")

        await browser.close()
        return pdf_requests, embed_src

async def main():
    await debug_detail(DETAIL_URL_1, "Detail 1 - Likvidator")
    await debug_detail(DETAIL_URL_2, "Detail 2 - Zrusenie spolocnosti")

asyncio.run(main())

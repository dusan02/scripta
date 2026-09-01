import asyncio
import os
import time
import logging
from playwright.async_api import Browser

logger = logging.getLogger(__name__)

class BrowserManager:
    def __init__(self):
        self.failures = 0
        self.last_failure_time = 0
        self.failure_threshold = 3
        self.failure_window = 60  # sekúnd
        self.reset_timeout = 300  # 5 minút
        self.state = "CLOSED"  # CLOSED = Browserless OK, OPEN = Lokálny fallback

    async def get_browser(self, playwright) -> Browser:
        current_time = time.time()
        
        # Ak sme v stave OPEN, skontrolujeme či nevypršal reset timeout
        if self.state == "OPEN":
            if current_time - self.last_failure_time > self.reset_timeout:
                logger.info("[BrowserManager] Circuit Breaker reset. Skúšam znovu Browserless.")
                self.state = "HALF_OPEN"
                self.failures = 0
            else:
                logger.warning("[BrowserManager] Circuit Breaker OPEN. Používam lokálny fallback Chromium.")
                return await self._launch_local(playwright)

        try:
            # Skúšame pripojenie na Browserless
            # stealth=1 zapne stealth plugin proti anti-bot detekcii
            # blockAds=false — ad-blocker môže zablokovať funkčné requesty (captcha, API calls)
            # launch= base64-encoded JSON: {"args":["--disable-blink-features=AutomationControlled"]}
            # Required for UVO and other sites that detect headless Chrome via blink features.
            # stealth=1 alone is not sufficient — some sites check navigator.webdriver before
            # our STEALTH_JS can override it; the blink flag prevents Chrome from setting it.
            _launch_b64 = "eyJhcmdzIjpbIi0tZGlzYWJsZS1ibGluay1mZWF0dXJlcz1BdXRvbWF0aW9uQ29udHJvbGxlZCJdfQ=="
            browserless_url = f"ws://browserless:3000?stealth=1&launch={_launch_b64}"
            browser = await playwright.chromium.connect_over_cdp(browserless_url, timeout=15000)
            
            # Pre-flight health check — over že browser je skutočne funkčný
            # (pripojenie môže uspieť aj keď Browserless je nestabilný)
            try:
                test_ctx = await browser.new_context()
                test_page = await test_ctx.new_page()
                await test_page.set_content("<html><body>ok</body></html>")
                await test_ctx.close()
            except Exception as health_err:
                logger.warning(f"[BrowserManager] Health check zlyhal napriek úspešnému pripojeniu: {health_err}")
                try:
                    await browser.close()
                except Exception:
                    pass
                raise RuntimeError(f"Browserless health check failed: {health_err}")
            
            if self.state == "HALF_OPEN":
                logger.info("[BrowserManager] Browserless funguje. Circuit Breaker CLOSED.")
                self.state = "CLOSED"
                self.failures = 0
                
            return browser
        except Exception as e:
            # Browserless zlyhal
            if current_time - self.last_failure_time > self.failure_window:
                self.failures = 1
            else:
                self.failures += 1
                
            self.last_failure_time = current_time
            logger.warning(f"[BrowserManager] Chyba pripojenia na Browserless ({self.failures}/{self.failure_threshold}): {e}")
            
            if self.failures >= self.failure_threshold:
                logger.error("[BrowserManager] Threshold dosiahnutý! Prepínam Circuit Breaker do stavu OPEN.")
                self.state = "OPEN"
                
            logger.warning("[BrowserManager] Fallback na lokálny Chromium.")
            return await self._launch_local(playwright)

    async def _launch_local(self, playwright) -> Browser:
        return await playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-blink-features=AutomationControlled",
            ]
        )

# Globálna inštancia (pre zachovanie stavu v rámci jedného worker procesu)
browser_manager = BrowserManager()

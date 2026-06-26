"""Stealth helpers — User-Agent rotation, proxy rotation, anti-detection JS.

Použitie:
    from .stealth import get_rotating_proxy, get_random_user_agent, STEALTH_JS

    proxy = get_rotating_proxy()  # None ak nie je nastavené
    ua = get_random_user_agent()
    await context.add_init_script(STEALTH_JS)
"""
from __future__ import annotations

import itertools
import logging
import random
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)

# ─── User-Agent pool ──────────────────────────────────────────────────
# Reálne UA stringy z rôznych prehliadačov/OS — rotácia znižuje fingerprint.
_USER_AGENTS = [
    # Chrome / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    # Chrome / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    # Firefox / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    # Firefox / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    # Edge / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
]

# ─── Viewport sizes ───────────────────────────────────────────────────
_VIEWPORTS = [
    {"width": 1920, "height": 1080},
    {"width": 1680, "height": 1050},
    {"width": 1536, "height": 864},
    {"width": 1440, "height": 900},
    {"width": 1366, "height": 768},
]

# ─── Locales ──────────────────────────────────────────────────────────
_LOCALES = ["sk-SK", "cs-CZ", "en-US"]

# ─── Proxy rotation ───────────────────────────────────────────────────
_proxy_cycle: Optional[itertools.cycle] = None
_proxy_initialized = False


def _init_proxies() -> None:
    global _proxy_cycle, _proxy_initialized
    if _proxy_initialized:
        return
    _proxy_initialized = True
    if settings.proxy_list:
        proxies = [p.strip() for p in settings.proxy_list.split(",") if p.strip()]
        if proxies:
            _proxy_cycle = itertools.cycle(proxies)
            logger.info(f"[STEALTH] Proxy rotation aktivovaná: {len(proxies)} proxy")


def get_rotating_proxy() -> Optional[dict]:
    """Vráti dict pre Playwright new_context(proxy=...) alebo None."""
    _init_proxies()
    if _proxy_cycle is None:
        return None
    proxy_url = next(_proxy_cycle)
    # Playwright očakáva formát {"server": "http://host:port", "username": ..., "password": ...}
    # Ak URL obsahuje auth, rozdelíme ho
    if "@" in proxy_url:
        # http://user:pass@host:port
        scheme_part, rest = proxy_url.split("://", 1)
        auth, host_port = rest.split("@", 1)
        username, password = auth.split(":", 1)
        return {
            "server": f"{scheme_part}://{host_port}",
            "username": username,
            "password": password,
        }
    return {"server": proxy_url}


# ─── UA / viewport / locale rotation ──────────────────────────────────

def get_random_user_agent() -> str:
    return random.choice(_USER_AGENTS)


def get_random_viewport() -> dict:
    return random.choice(_VIEWPORTS)


def get_random_locale() -> str:
    return random.choice(_LOCALES)


# ─── Stealth JS — injektuje sa do každého contextu ────────────────────
# Skrýva automatizáciu, fakeuje plugins, languages, platform, WebGL vendor.
STEALTH_JS = """
// Skryť navigator.webdriver
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
});

// Fake plugins
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ],
});

// Fake languages
Object.defineProperty(navigator, 'languages', {
    get: () => ['sk-SK', 'sk', 'cs', 'en-US', 'en'],
});

// Fake platform — závisí od UA, ale 'Win32' je najbežnejšia
Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
});

// Skryť Playwright / automation signs v permissions
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

// WebGL vendor spoofing
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function (parameter) {
    if (parameter === 37445) return 'Intel Inc.';           // UNMASKED_VENDOR_WEBGL
    if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
    return getParameter.call(this, parameter);
};

// Skryť CDP (Chrome DevTools Protocol) detekciu
window.cdc_adoQpoasnfa76pfcZLmcfl_Array = undefined;
window.cdc_adoQpoasnfa76pfcZLmcfl_Promise = undefined;
window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol = undefined;

// chrome runtime fake
window.chrome = window.chrome || { runtime: {} };

// Skryť automation v toString
const originalToString = Function.prototype.toString;
Function.prototype.toString = function () {
    if (this === window.navigator.permissions.query) {
        return 'function query() { [native code] }';
    }
    return originalToString.call(this);
};
"""

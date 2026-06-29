import asyncio
import logging

logger = logging.getLogger(__name__)

# ── Hybrid Model Routing ────────────────────────────────────────────────────
# IFRS tabuľky: gemini-2.5-flash — spoľahlivý OCR/extraktor, ~20× lacnejší ako 3.5
# Naratívna analýza (VS): gemini-3.5-flash — potrebuje hlbšie pochopenie nuancií
# Vestník udalosti: gemini-2.5-flash — štruktúrovaná extrakcia textu
_MODEL_IFRS = "gemini-2.5-flash"
_MODEL_NARRATIVE = "gemini-3.5-flash"
_MODEL_VESTNIK = "gemini-2.5-flash"

# ── Exponential Backoff + Fallback Model ──────────────────────────────────
_BACKOFF_SECONDS = [15, 45, 120, 300]
_FALLBACK_MODEL = "gemini-3.5-flash"

async def safe_llm_call(func, *args, label: str = "llm_call", **kwargs):
    """
    Bezpečne zavolá LLM funkciu s exponential backoff a fallback modelom.

    - 4 pokusy s backoff [15s, 45s, 120s, 300s] pre 429 (Resource Exhausted) a 503 (Unavailable).
    - Po vyčerpaní pokusov skúsi fallback model (napr. ak je to dočasný výpadok).
    - Ak fallback tiež zlyhá, vyhodí výnimku.
    """
    model = kwargs.get("model", "unknown")
    for attempt, wait in enumerate(_BACKOFF_SECONDS):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            error_str = str(e).lower()
            if "503" not in error_str and "429" not in error_str and "resource_exhausted" not in error_str:
                raise
            
            error_reason = "429 (Quota/Credits)" if "429" in error_str or "resource_exhausted" in error_str else "503 (Unavailable)"
            logger.warning(
                f"API {error_reason} pre {label} (model={model}), čakám {wait}s "
                f"(pokus {attempt + 1}/{len(_BACKOFF_SECONDS)})"
            )
            await asyncio.sleep(wait)

    # Fallback na iný model (iný Google pool / priorita)
    if model != _FALLBACK_MODEL:
        logger.warning(f"Limity vyčerpané pre {label} (model={model}), skúšam fallback: {_FALLBACK_MODEL}")
        kwargs["model"] = _FALLBACK_MODEL
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Fallback {_FALLBACK_MODEL} tiež zlyhal pre {label}: {e}")
            raise

    raise Exception(f"Max retries reached for {label} (model={model})")

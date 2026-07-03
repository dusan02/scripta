import asyncio
import logging
import time

from src.config import settings
from src.log_helpers import log_llm_retry, get_correlation_id

logger = logging.getLogger(__name__)

# ── Hybrid Model Routing (centralized in config.py) ─────────────────────────
_MODEL_IFRS = settings.model_ifrs
_MODEL_NARRATIVE = settings.model_narrative
_MODEL_NOTES = settings.model_notes
_MODEL_VESTNIK = settings.model_vestnik

# ── Exponential Backoff + Fallback Model ──────────────────────────────────
_BACKOFF_SECONDS = settings.llm_backoff_list
_FALLBACK_MODEL = settings.model_fallback

async def safe_llm_call(func, *args, label: str = "llm_call", **kwargs):
    """
    Bezpečne zavolá LLM funkciu s exponential backoff a fallback modelom.

    - 4 pokusy s backoff [15s, 45s, 120s, 300s] pre 429 (Resource Exhausted) a 503 (Unavailable).
    - Po vyčerpaní pokusov skúsi fallback model (napr. ak je to dočasný výpadok).
    - Ak fallback tiež zlyhá, vyhodí výnimku.
    """
    model = kwargs.get("model", "unknown")
    _t0 = time.perf_counter()
    for attempt, wait in enumerate(_BACKOFF_SECONDS):
        try:
            result = await asyncio.wait_for(func(*args, **kwargs), timeout=120)
            elapsed = time.perf_counter() - _t0
            logger.info(f"[{get_correlation_id() or '-'}] LLM OK: {label} model={model} ({elapsed:.1f}s)")
            return result
        except asyncio.TimeoutError:
            log_llm_retry(label, model, attempt + 1, len(_BACKOFF_SECONDS), "Timeout 120s", wait)
            if attempt < len(_BACKOFF_SECONDS) - 1:
                await asyncio.sleep(wait)
                continue
            raise
        except Exception as e:
            error_str = str(e).lower()
            if "503" not in error_str and "429" not in error_str and "resource_exhausted" not in error_str:
                elapsed = time.perf_counter() - _t0
                logger.error(f"[{get_correlation_id() or '-'}] LLM FAIL: {label} model={model} ({elapsed:.1f}s) — {e}")
                raise
            
            error_reason = "429 (Quota/Credits)" if "429" in error_str or "resource_exhausted" in error_str else "503 (Unavailable)"
            log_llm_retry(label, model, attempt + 1, len(_BACKOFF_SECONDS), error_reason, wait)
            await asyncio.sleep(wait)

    # Fallback na iný model (iný Google pool / priorita)
    if model != _FALLBACK_MODEL:
        logger.warning(f"[{get_correlation_id() or '-'}] LLM FALLBACK: {label} model={model} → {_FALLBACK_MODEL}")
        kwargs["model"] = _FALLBACK_MODEL
        try:
            result = await asyncio.wait_for(func(*args, **kwargs), timeout=120)
            elapsed = time.perf_counter() - _t0
            logger.info(f"[{get_correlation_id() or '-'}] LLM FALLBACK OK: {label} model={_FALLBACK_MODEL} ({elapsed:.1f}s)")
            return result
        except Exception as e:
            logger.error(f"[{get_correlation_id() or '-'}] LLM FALLBACK FAIL: {label} model={_FALLBACK_MODEL}: {e}")
            raise

    raise Exception(f"Max retries reached for {label} (model={model})")

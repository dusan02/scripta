import asyncio
import logging

from src.config import settings

logger = logging.getLogger(__name__)

# ── Hybrid Model Routing (centralized in config.py) ─────────────────────────
_MODEL_IFRS = settings.model_ifrs
_MODEL_NARRATIVE = settings.model_narrative
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

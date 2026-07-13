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
_FALLBACK_MODEL_2 = settings.model_fallback_2


def _log_failed_call_cost(model: str, label: str, reason: str) -> None:
    """Zaloguje odhadovaný náklad za neúspešné LLM volanie.
    Google účtuje input tokens aj pri 503/429 chybách (response sa nevygeneruje, ale input sa spracuje).
    Nemáme presné usage metadata, tak použijeme odhad z logu label-u."""
    from src.agents.shared import _token_stats
    from src.log_helpers import get_correlation_id
    cid = get_correlation_id() or "-"
    price_in, _ = settings.llm_pricing.get(model, (0.0, 0.0))
    # Odhad: 503/490 zvyčajne znamená že input bol spracovaný ale output nepršiel.
    # Nemáme presný token count, len zalogujeme varovanie.
    logger.warning(f"[{cid}] LLM FAILED COST: {label} model={model} reason={reason} — Google môže účtovať input tokens")

async def safe_llm_call(func, *args, label: str = "llm_call", **kwargs):
    """
    Bezpečne zavolá LLM funkciu s exponential backoff a fallback modelom.

    - 404 NOT_FOUND → okamžitý fallback na iný model (model vypnutý/deprecated)
    - 429/503 → exponential backoff [5s, 15s, 30s], potom fallback model
    - Ak fallback tiež zlyhá, skúsi sekundárny fallback model
    - Ak všetko zlyhá, vyhodí výnimku
    """
    model = kwargs.get("model", "unknown")
    _t0 = time.perf_counter()
    _timeout = 300 if any(k in label for k in ("Chief", "Cross-Analysis")) else 120

    # 404 sa neretryuje — model je vypnutý, treba fallback
    for attempt, wait in enumerate(_BACKOFF_SECONDS):
        try:
            result = await asyncio.wait_for(func(*args, **kwargs), timeout=_timeout)
            elapsed = time.perf_counter() - _t0
            logger.info(f"[{get_correlation_id() or '-'}] LLM OK: {label} model={model} ({elapsed:.1f}s)")
            return result
        except asyncio.TimeoutError:
            log_llm_retry(label, model, attempt + 1, len(_BACKOFF_SECONDS), f"Timeout {_timeout}s", wait)
            _log_failed_call_cost(model, label, "timeout")
            if attempt < len(_BACKOFF_SECONDS) - 1:
                await asyncio.sleep(wait)
                continue
        except Exception as e:
            error_str = str(e).lower()
            elapsed = time.perf_counter() - _t0

            # 404 — model vypnutý, okamžitý fallback (bez retry)
            if "404" in error_str or "not_found" in error_str:
                logger.warning(f"[{get_correlation_id() or '-'}] LLM 404: {label} model={model} ({elapsed:.1f}s) — model nedostupný, skúšam fallback")
                _log_failed_call_cost(model, label, "404")
                break

            # 429/503 — retry s backoff
            if "503" in error_str or "429" in error_str or "resource_exhausted" in error_str:
                error_reason = "429 (Quota/Credits)" if "429" in error_str or "resource_exhausted" in error_str else "503 (Unavailable)"
                log_llm_retry(label, model, attempt + 1, len(_BACKOFF_SECONDS), error_reason, wait)
                _log_failed_call_cost(model, label, error_reason)
                if attempt < len(_BACKOFF_SECONDS) - 1:
                    await asyncio.sleep(wait)
                    continue
                break

            # Iná chyba — neopakovať
            logger.error(f"[{get_correlation_id() or '-'}] LLM FAIL: {label} model={model} ({elapsed:.1f}s) — {e}")
            _log_failed_call_cost(model, label, "error")
            raise

    # Fallback 1: model_fallback (flash-lite)
    for fb_model in (_FALLBACK_MODEL, _FALLBACK_MODEL_2):
        if model == fb_model:
            continue
        logger.warning(f"[{get_correlation_id() or '-'}] LLM FALLBACK: {label} model={model} → {fb_model}")
        kwargs["model"] = fb_model
        try:
            result = await asyncio.wait_for(func(*args, **kwargs), timeout=_timeout)
            elapsed = time.perf_counter() - _t0
            logger.info(f"[{get_correlation_id() or '-'}] LLM FALLBACK OK: {label} model={fb_model} ({elapsed:.1f}s)")
            return result
        except Exception as e:
            error_str = str(e).lower()
            logger.error(f"[{get_correlation_id() or '-'}] LLM FALLBACK FAIL: {label} model={fb_model}: {e}")
            _log_failed_call_cost(fb_model, label, "fallback_error")
            if "404" not in error_str and "not_found" not in error_str:
                # Pre 429/503 skúsiť ďalší fallback; pre iné chyby re-raise
                if "503" not in error_str and "429" not in error_str and "resource_exhausted" not in error_str:
                    raise
            model = fb_model
            continue

    raise Exception(f"Max retries reached for {label} (all models failed)")

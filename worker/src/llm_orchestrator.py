import asyncio
import logging
import time
import os

from src.config import settings
from src.log_helpers import log_llm_retry, get_correlation_id
from src.agents.shared import _mark_gemini_key_failed, _mark_last_key_failed, record_fallback

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

# ── Pro model availability cache ──────────────────────────────────────────
# Pre-flight check výsledok sa cachuje na 60s — viaceré agenty v jednom reporte
# zdieľajú rovnaký výsledok (3.1 Pro sa nemení z minúty na minútu)
_pro_available_cache: dict[str, tuple[bool, float]] = {}
_PRO_CACHE_TTL = 60  # sekundy


async def check_pro_model_available(model: str = "gemini-3.1-pro-preview", timeout: float = 8.0) -> bool:
    """
    Pre-flight check: otestuje či Pro model odpovedá v rámci timeoutu.
    Výsledok sa cachuje na 60s aby sa zbytočne netestoval pri každom agentovi.
    """
    now = time.time()
    cached = _pro_available_cache.get(model)
    if cached and (now - cached[1]) < _PRO_CACHE_TTL:
        return cached[0]

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        _pro_available_cache[model] = (False, now)
        return False

    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                json={"contents": [{"parts": [{"text": "OK"}]}], "generationConfig": {"maxOutputTokens": 1}},
            )
            available = r.status_code == 200
            _pro_available_cache[model] = (available, now)
            logger.info(f"[{get_correlation_id() or '-'}] PRE-FLIGHT {model}: {'AVAILABLE' if available else f'UNAVAILABLE ({r.status_code})'}")
            return available
    except Exception as e:
        _pro_available_cache[model] = (False, now)
        logger.info(f"[{get_correlation_id() or '-'}] PRE-FLIGHT {model}: UNAVAILABLE ({type(e).__name__})")
        return False


def get_chief_auditor_model() -> str:
    """
    Vráti model pre Chief Auditora na základe pre-flight checku.
    Ak je expert_mode a 3.1 Pro je dostupný → 3.1 Pro.
    Ak 3.1 Pro nedostupný → 2.5 Pro (stabilný fallback, nie flash).
    V non-expert móde → flash (štandard).
    """
    if not settings.expert_mode:
        return "gemini-3.5-flash"
    # Pre-flight check — ak 3.1 Pro nefunguje, použijeme 2.5 Pro
    cached = _pro_available_cache.get("gemini-3.1-pro-preview")
    if cached and not cached[0]:
        logger.info(f"[{get_correlation_id() or '-'}] CHIEF AUDITOR: Using gemini-2.5-pro (3.1 Pro unavailable)")
        return "gemini-2.5-pro"
    return "gemini-3.1-pro-preview"


def _log_failed_call_cost(model: str, label: str, reason: str, prompt_text: str = "") -> None:
    """Zaloguje odhadovaný náklad za neúspešné LLM volanie.
    Google účtuje input tokens aj pri 503/429 chybách (response sa nevygeneruje, ale input sa spracuje).
    Pokúsi sa odhadnúť input tokeny z veľkosti prompt textu."""
    from src.agents.shared import _token_stats
    from src.log_helpers import get_correlation_id
    cid = get_correlation_id() or "-"
    price_in, _ = settings.llm_pricing.get(model, (0.0, 0.0))
    # Odhad input tokenov: ~4 znaky na token (približný odhad pre text + PDF metadata)
    est_input_tokens = 0
    if prompt_text:
        est_input_tokens = len(prompt_text) // 4
    elif label:
        # Ak nemáme prompt text, odhadneme z labelu — pre PDF analýzu je typicky 50k-200k tokenov
        if any(k in label for k in ("IFRS", "VS_", "Annual Report", "Financial Statements", "Footnotes")):
            est_input_tokens = 100_000  # PDF súbory sú veľké
        elif any(k in label for k in ("Chief", "Cross-Analysis", "Report QA")):
            est_input_tokens = 50_000  # Zhrnutia a analýzy
        else:
            est_input_tokens = 10_000  # Menšie cally
    est_cost = (est_input_tokens * price_in) / 1_000_000
    logger.warning(
        f"[{cid}] LLM FAILED COST: {label} model={model} reason={reason} "
        f"est_input~{est_input_tokens:,} tok est_cost~${est_cost:.5f} — Google môže účtovať input tokens"
    )
    # Accumulate failed costs
    if model not in _token_stats:
        _token_stats[model] = {"calls": 0, "input": 0, "output": 0, "cost": 0.0, "failed_calls": 0, "failed_cost": 0.0}
    if "failed_calls" not in _token_stats[model]:
        _token_stats[model]["failed_calls"] = 0
        _token_stats[model]["failed_cost"] = 0.0
    _token_stats[model]["failed_calls"] += 1
    _token_stats[model]["failed_cost"] += est_cost

async def safe_llm_call(func, *args, label: str = "llm_call", **kwargs):
    """
    Bezpečne zavolá LLM funkciu s exponential backoff a fallback modelom.

    - 404 NOT_FOUND → okamžitý fallback na iný model (model vypnutý/deprecated)
    - 429/503 → max 1 retry, potom fallback (503 = služba dole, retry je zbytočný)
    - Timeout → max 1 retry, potom fallback
    - Ak fallback tiež zlyhá, skúsi sekundárny fallback model
    - Ak všetko zlyhá, vyhodí výnimku
    """
    model = kwargs.get("model", "unknown")
    _t0 = time.perf_counter()
    _timeout = 180 if any(k in label for k in ("Chief", "Cross-Analysis")) else 120
    _max_retries = 2  # max 1 retry (2 pokusy total) — znížené z 3

    # 404 sa neretryuje — model je vypnutý, treba fallback
    for attempt, wait in enumerate(_BACKOFF_SECONDS[:_max_retries]):
        try:
            result = await asyncio.wait_for(func(*args, **kwargs), timeout=_timeout)
            elapsed = time.perf_counter() - _t0
            logger.info(f"[{get_correlation_id() or '-'}] LLM OK: {label} model={model} ({elapsed:.1f}s)")
            return result
        except asyncio.TimeoutError:
            log_llm_retry(label, model, attempt + 1, _max_retries, f"Timeout {_timeout}s", wait)
            _log_failed_call_cost(model, label, "timeout")
            if attempt < _max_retries - 1:
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

            # 429/503 — retry s backoff (max 1 retry)
            if "503" in error_str or "429" in error_str or "resource_exhausted" in error_str:
                error_reason = "429 (Quota/Credits)" if "429" in error_str or "resource_exhausted" in error_str else "503 (Unavailable)"
                log_llm_retry(label, model, attempt + 1, _max_retries, error_reason, wait)
                _log_failed_call_cost(model, label, error_reason)
                _mark_last_key_failed()
                if attempt < _max_retries - 1:
                    await asyncio.sleep(wait)
                    continue
                break

            # Iná chyba — neopakovať
            logger.error(f"[{get_correlation_id() or '-'}] LLM FAIL: {label} model={model} ({elapsed:.1f}s) — {e}")
            _log_failed_call_cost(model, label, "error")
            raise

    # Fallback: iba Chief Auditor → 2.5 Pro (nehalucinuje).
    # Cross-Analysis, QA a extractori → flash tier (flash-lite → flash).
    _original_model = model
    _is_chief = "Chief" in label
    if _is_chief:
        # Chief Auditor: fallback len na 2.5 Pro (stabilný, nehalucinuje)
        _fallback_chain = ("gemini-2.5-pro",)
    else:
        # Cross-Analysis, QA, extractori: flash-lite → flash
        _fallback_chain = (_FALLBACK_MODEL, _FALLBACK_MODEL_2)
    for fb_model in _fallback_chain:
        if model == fb_model or _original_model == fb_model:
            continue
        logger.warning(f"[{get_correlation_id() or '-'}] LLM FALLBACK: {label} model={model} → {fb_model}")
        record_fallback(label, _original_model, fb_model, "503/timeout")
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
                if "503" in error_str or "429" in error_str or "resource_exhausted" in error_str:
                    _mark_last_key_failed()
                else:
                    raise
            model = fb_model
            continue

    raise Exception(f"Max retries reached for {label} (all models failed)")

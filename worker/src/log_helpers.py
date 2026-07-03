"""Logging helpers: correlation ID, phase timing, structured pipeline logs."""
import logging
import time
from contextvars import ContextVar
from typing import Optional

# ContextVar pre correlation ID (report_id) — bezpečné pre async/parallel
_correlation_id: ContextVar[Optional[str]] = ContextVar("_correlation_id", default=None)

logger = logging.getLogger("pipeline")


def set_correlation_id(report_id: str) -> None:
    """Nastaví correlation ID pre aktuálny async context."""
    _correlation_id.set(report_id)


def get_correlation_id() -> Optional[str]:
    """Vráti aktuálne correlation ID."""
    return _correlation_id.get()


def _prefix() -> str:
    """Vráti '[report_id] ' prefix alebo prázdny string."""
    cid = _correlation_id.get()
    return f"[{cid}] " if cid else ""


class PhaseTimer:
    """Kontextový manažér pre meranie trvania fázy pipeline."""

    def __init__(self, phase_name: str, level: int = logging.INFO):
        self.phase_name = phase_name
        self.level = level
        self._t0 = 0.0

    def __enter__(self):
        self._t0 = time.perf_counter()
        logger.log(self.level, f"{_prefix()}PHASE START: {self.phase_name}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        elapsed = time.perf_counter() - self._t0
        if exc_type:
            logger.error(f"{_prefix()}PHASE FAIL: {self.phase_name} ({elapsed:.1f}s) — {exc_val}")
        else:
            logger.log(self.level, f"{_prefix()}PHASE DONE: {self.phase_name} ({elapsed:.1f}s)")
        return False


def log_pipeline_start(ico: str, report_id: str) -> None:
    set_correlation_id(report_id)
    logger.info(f"{_prefix()}PIPELINE START: IČO={ico}")


def log_pipeline_end(ico: str, status: str, total_seconds: float) -> None:
    logger.info(f"{_prefix()}PIPELINE END: IČO={ico} status={status} ({total_seconds:.1f}s)")
    _correlation_id.set(None)


def log_scraper_result(source_type: str, status: str, findings: str = "", duration: float = 0.0) -> None:
    findings_short = (findings or "")[:120].replace("\n", " ")
    dur = f" ({duration:.1f}s)" if duration > 0 else ""
    logger.info(f"{_prefix()}SCRAPER: {source_type} → {status}{dur} | {findings_short}")


def log_llm_call(label: str, model: str, duration: float, tokens: int = 0, status: str = "OK") -> None:
    tok = f" tokens={tokens}" if tokens > 0 else ""
    logger.info(f"{_prefix()}LLM: {label} model={model} {status} ({duration:.1f}s){tok}")


def log_llm_retry(label: str, model: str, attempt: int, max_attempts: int, reason: str, wait_s: float) -> None:
    logger.warning(f"{_prefix()}LLM RETRY: {label} model={model} attempt={attempt}/{max_attempts} reason={reason} wait={wait_s}s")


def log_pdf_compile(report_id: str, total_pages: int, skipped_clean: int, duration: float) -> None:
    logger.info(f"{_prefix()}PDF COMPILE: {total_pages} pages, skipped {skipped_clean} clean sources ({duration:.1f}s)")

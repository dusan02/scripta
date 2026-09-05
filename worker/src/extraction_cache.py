"""
LLM Extraction Cache — ensures deterministic financial data extraction.

When the same PDF is processed multiple times (e.g. report regeneration),
the cache returns the previously extracted structured data instead of
calling the LLM again. This eliminates LLM variability for IFRS firms
where RÚZ API provides no structured JSON tables (templates 709/703).

Cache key: (pdfHash, extractor, model, promptVersion, schemaVersion)
Invalidation: bump PROMPT_VERSION or SCHEMA_VERSION when prompt/schema changes.
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

from prisma import Json

from .agents.shared import CompanyFinancialExtraction

logger = logging.getLogger(__name__)

# ── Version constants ────────────────────────────────────────────────────────
# Bump these when SYSTEM_PROMPT or FinancialMetrics schema changes.
# This invalidates all cached extractions — next run will re-extract via LLM
# and store a new cache entry with the new version.
PROMPT_VERSION = "v4"
SCHEMA_VERSION = "v2"  # v2: balance sheet integrity check added — re-extract all IFRS PDFs

# Extractor identifiers (stored in ExtractionCache.extractor column)
EXTRACTOR_FINANCIAL_ANALYST = "GEMINI_FINANCIAL_ANALYST"
EXTRACTOR_FINANCIAL_VERIFY = "GEMINI_FINANCIAL_VERIFY"
EXTRACTOR_NOTES_FORENSIC = "GEMINI_NOTES_FORENSIC"
EXTRACTOR_NARRATIVE_RISK = "GEMINI_NARRATIVE_RISK"


def compute_pdf_hash(file_path: str) -> str:
    """Compute SHA-256 hash of a file (PDF or TXT)."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


async def cache_lookup(
    file_path: str,
    extractor: str,
    model: str,
    hash_override: Optional[str] = None,
) -> Optional[CompanyFinancialExtraction]:
    """Check if we have a cached extraction for this PDF + model + prompt version.

    Returns:
        CompanyFinancialExtraction if cache HIT, None if MISS.
    """
    from .db_repository import get_db

    try:
        pdf_hash = hash_override or compute_pdf_hash(file_path)
    except Exception as e:
        logger.warning(f"[CACHE] Cannot hash {file_path}: {e} — treating as MISS")
        return None

    file_name = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    try:
        db = get_db()
        row = await db.extractioncache.find_unique(
            where={
                "pdfHash_extractor_model_promptVersion_schemaVersion": {
                    "pdfHash": pdf_hash,
                    "extractor": extractor,
                    "model": model,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": SCHEMA_VERSION,
                }
            }
        )
        if row is None:
            logger.info(f"[CACHE MISS] {file_name} hash={pdf_hash[:12]} extractor={extractor} model={model}")
            return None

        # Check expiry
        if row.expiresAt is not None:
            if row.expiresAt.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
                logger.info(f"[CACHE EXPIRED] {file_name} hash={pdf_hash[:12]} — expired at {row.expiresAt}")
                return None

        # Reconstruct CompanyFinancialExtraction from cached raw response
        raw = row.rawResponse
        if isinstance(raw, str):
            import json
            raw = json.loads(raw)

        data = CompanyFinancialExtraction.model_validate(raw)

        warnings_str = ", ".join(row.warnings) if row.warnings else "none"
        logger.info(
            f"[CACHE HIT] {file_name} hash={pdf_hash[:12]} extractor={extractor} "
            f"model={model} confidence={row.confidence} warnings=[{warnings_str}] "
            f"age={row.createdAt.isoformat() if row.createdAt else '?'}"
        )
        return data

    except Exception as e:
        logger.warning(f"[CACHE LOOKUP ERROR] {file_name}: {e} — treating as MISS")
        return None


async def cache_store(
    file_path: str,
    company_ico: str,
    extractor: str,
    model: str,
    data: CompanyFinancialExtraction,
    confidence: str = "UNKNOWN",
    warnings: Optional[list[str]] = None,
    missing_fields: Optional[list[str]] = None,
    hash_override: Optional[str] = None,
) -> None:
    """Store an LLM extraction result in the cache.

    Called after a successful LLM extraction so future runs can reuse it.
    """
    from .db_repository import get_db

    try:
        pdf_hash = hash_override or compute_pdf_hash(file_path)
    except Exception as e:
        logger.warning(f"[CACHE STORE] Cannot hash {file_path}: {e} — skipping cache store")
        return

    file_name = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    file_ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    source_type = "PDF" if file_ext == "pdf" else "TXT"

    # Serialize extraction to JSON
    raw_json = data.model_dump_json()
    import json
    raw_dict = json.loads(raw_json)

    # Build normalized data (just the FinancialMetrics fields)
    normalized = data.metriky.model_dump(mode="json")

    # Wrap with Json() for Prisma JSONB fields
    raw_json_prisma = Json(raw_dict)
    normalized_prisma = Json(normalized)

    # Auto-detect missing fields
    if missing_fields is None:
        missing_fields = []
        for field_name in [
            "celkove_aktiva", "trzby_z_hlavnej_cinnosti", "zisk_alebo_strata_po_zdaneni",
            "vlastne_imanie_celkom", "ciste_penazne_toky_z_prevadzkovej_cinnosti",
            "osobne_naklady", "uroky", "odpisy", "pocet_zamestnancov",
        ]:
            val = getattr(data.metriky, field_name, None)
            if val is None:
                missing_fields.append(field_name)

    if warnings is None:
        warnings = []

    try:
        db = get_db()
        await db.extractioncache.upsert(
            where={
                "pdfHash_extractor_model_promptVersion_schemaVersion": {
                    "pdfHash": pdf_hash,
                    "extractor": extractor,
                    "model": model,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": SCHEMA_VERSION,
                }
            },
            data={
                "create": {
                    "pdfHash": pdf_hash,
                    "companyIco": company_ico,
                    "fileName": file_name,
                    "extractor": extractor,
                    "model": model,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": SCHEMA_VERSION,
                    "temperature": 0.0,
                    "rawResponse": raw_json_prisma,
                    "normalizedData": normalized_prisma,
                    "confidence": confidence,
                    "warnings": warnings,
                    "missingFields": missing_fields,
                    "sourceSize": file_size,
                    "sourceType": source_type,
                },
                "update": {
                    "companyIco": company_ico,
                    "fileName": file_name,
                    "rawResponse": raw_json_prisma,
                    "normalizedData": normalized_prisma,
                    "confidence": confidence,
                    "warnings": warnings,
                    "missingFields": missing_fields,
                    "sourceSize": file_size,
                },
            },
        )
        logger.info(
            f"[CACHE STORE] {file_name} hash={pdf_hash[:12]} extractor={extractor} "
            f"model={model} confidence={confidence} missing={len(missing_fields)} warnings={len(warnings)}"
        )
    except Exception as e:
        logger.warning(f"[CACHE STORE ERROR] {file_name}: {e} — cache not stored, LLM will be used next time")


async def get_cache_stats() -> dict:
    """Return cache statistics for monitoring."""
    from .db_repository import get_db

    try:
        db = get_db()
        total = await db.extractioncache.count()
        by_extractor: dict[str, int] = {}
        by_model: dict[str, int] = {}

        rows = await db.extractioncache.group_by(
            by=["extractor"],
            count=True,
        )
        for r in rows:
            by_extractor[r["extractor"]] = r["_count"]

        rows = await db.extractioncache.group_by(
            by=["model"],
            count=True,
        )
        for r in rows:
            by_model[r["model"]] = r["_count"]

        return {
            "total": total,
            "by_extractor": by_extractor,
            "by_model": by_model,
            "prompt_version": PROMPT_VERSION,
            "schema_version": SCHEMA_VERSION,
        }
    except Exception as e:
        logger.warning(f"[CACHE STATS ERROR] {e}")
        return {"error": str(e)}


# ── Generic cache for non-FinancialExtraction LLM results (e.g. Notes Forensic) ──

async def cache_lookup_generic(
    file_path: str,
    extractor: str,
    model: str,
    hash_override: Optional[str] = None,
) -> Optional[dict]:
    """Generic cache lookup — returns raw dict, not CompanyFinancialExtraction."""
    from .db_repository import get_db

    try:
        pdf_hash = hash_override or compute_pdf_hash(file_path)
    except Exception as e:
        logger.warning(f"[CACHE] Cannot hash {file_path}: {e} — treating as MISS")
        return None

    file_name = os.path.basename(file_path)

    try:
        db = get_db()
        row = await db.extractioncache.find_unique(
            where={
                "pdfHash_extractor_model_promptVersion_schemaVersion": {
                    "pdfHash": pdf_hash,
                    "extractor": extractor,
                    "model": model,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": SCHEMA_VERSION,
                }
            }
        )
        if row is None:
            logger.info(f"[CACHE MISS] {file_name} extractor={extractor} model={model}")
            return None

        if row.expiresAt is not None:
            if row.expiresAt.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
                logger.info(f"[CACHE EXPIRED] {file_name} extractor={extractor}")
                return None

        raw = row.rawResponse
        if isinstance(raw, str):
            import json
            raw = json.loads(raw)

        logger.info(f"[CACHE HIT] {file_name} extractor={extractor} model={model}")
        return raw
    except Exception as e:
        logger.warning(f"[CACHE LOOKUP ERROR] {file_name}: {e} — treating as MISS")
        return None


async def cache_store_generic(
    file_path: str,
    company_ico: str,
    extractor: str,
    model: str,
    data: Any,
    hash_override: Optional[str] = None,
) -> None:
    """Generic cache store — accepts any Pydantic model or dict."""
    from .db_repository import get_db

    try:
        pdf_hash = hash_override or compute_pdf_hash(file_path)
    except Exception as e:
        logger.warning(f"[CACHE STORE] Cannot hash {file_path}: {e} — skipping")
        return

    file_name = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    file_ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    source_type = "PDF" if file_ext == "pdf" else "TXT"

    if hasattr(data, "model_dump_json"):
        raw_dict = json.loads(data.model_dump_json())
    elif isinstance(data, dict):
        raw_dict = data
    else:
        raw_dict = json.loads(json.dumps(data, default=str))

    raw_json_prisma = Json(raw_dict)
    normalized_prisma = Json({})

    try:
        db = get_db()
        await db.extractioncache.upsert(
            where={
                "pdfHash_extractor_model_promptVersion_schemaVersion": {
                    "pdfHash": pdf_hash,
                    "extractor": extractor,
                    "model": model,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": SCHEMA_VERSION,
                }
            },
            data={
                "create": {
                    "pdfHash": pdf_hash,
                    "companyIco": company_ico,
                    "fileName": file_name,
                    "extractor": extractor,
                    "model": model,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": SCHEMA_VERSION,
                    "temperature": 0.0,
                    "rawResponse": raw_json_prisma,
                    "normalizedData": normalized_prisma,
                    "confidence": "UNKNOWN",
                    "warnings": [],
                    "missingFields": [],
                    "sourceSize": file_size,
                    "sourceType": source_type,
                },
                "update": {
                    "companyIco": company_ico,
                    "fileName": file_name,
                    "rawResponse": raw_json_prisma,
                    "normalizedData": normalized_prisma,
                    "confidence": "UNKNOWN",
                    "warnings": [],
                    "missingFields": [],
                    "sourceSize": file_size,
                },
            },
        )
        logger.info(f"[CACHE STORE] {file_name} extractor={extractor} model={model}")
    except Exception as e:
        logger.warning(f"[CACHE STORE ERROR] {file_name}: {e} — cache not stored")

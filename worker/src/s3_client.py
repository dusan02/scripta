"""S3-compatible storage client for uploading generated report files.

Supports AWS S3, Cloudflare R2, MinIO, Supabase Storage, and any other
S3-compatible provider via the S3_ENDPOINT override.

Env vars:
  S3_BUCKET          — bucket name (required for S3 mode)
  S3_REGION          — region (default: "auto" for R2, "eu-central-1" for AWS)
  S3_ENDPOINT        — custom endpoint URL (for R2/MinIO/Supabase)
  AWS_ACCESS_KEY_ID  — access key
  AWS_SECRET_ACCESS_KEY — secret key

If S3_BUCKET is not set, the module falls back to local filesystem mode
(useful for local development without cloud storage).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy-init singleton
_s3_client = None
_s3_bucket: Optional[str] = None
_s3_enabled: bool = False


def _init_s3() -> None:
    """Initialize the boto3 S3 client from env vars. Called once on first use."""
    global _s3_client, _s3_bucket, _s3_enabled

    _s3_bucket = os.environ.get("S3_BUCKET", "").strip()
    if not _s3_bucket:
        _s3_enabled = False
        logger.info("[s3] S3_BUCKET not set — local filesystem mode active")
        return

    import boto3
    from botocore.config import Config

    region = os.environ.get("S3_REGION", "auto")
    endpoint = os.environ.get("S3_ENDPOINT") or None

    _s3_client = boto3.client(
        "s3",
        region_name=region,
        endpoint_url=endpoint,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )
    _s3_enabled = True
    logger.info(f"[s3] S3 mode enabled — bucket: {_s3_bucket}, endpoint: {endpoint or 'default AWS'}")


def is_s3_enabled() -> bool:
    """Check if S3 cloud storage is configured."""
    if not _s3_enabled and _s3_client is None:
        _init_s3()
    return _s3_enabled


def upload_report_file(
    local_path: Path,
    report_request_id: str,
    ico: Optional[str] = None,
) -> str:
    """Upload a generated report file to S3.

    The S3 object key follows the format: reports/{reportRequestId}/{filename}
    This avoids collisions between reports and provides a clean structure
    for lifecycle policies and presigned URL generation.

    Args:
        local_path: Path to the local file to upload.
        report_request_id: The ReportRequest ID (used as a directory prefix).
        ico: Optional IČO — currently unused in the key but available
             for future naming schemes.

    Returns:
        The S3 object key if S3 is enabled, or the local path as a string
        if running in local filesystem mode (prefixed with "local://").
    """
    if not is_s3_enabled():
        # Local filesystem fallback — caller stores the path as-is.
        return f"local://{local_path}"

    assert _s3_client is not None
    assert _s3_bucket is not None

    filename = local_path.name
    key = f"reports/{report_request_id}/{filename}"

    content_type = "application/pdf" if filename.endswith(".pdf") else "application/octet-stream"

    logger.info(f"[s3] Uploading {local_path} → s3://{_s3_bucket}/{key}")
    _s3_client.upload_file(
        str(local_path),
        _s3_bucket,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    logger.info(f"[s3] Upload complete: {key}")
    return key


def delete_report_file(s3_key: str) -> None:
    """Delete a file from S3. Used by cleanup cron.

    If the key starts with "local://", this is a no-op (local files are
    cleaned by the filesystem cleanup routine).
    """
    if s3_key.startswith("local://"):
        return

    if not is_s3_enabled():
        return

    assert _s3_client is not None
    assert _s3_bucket is not None

    try:
        _s3_client.delete_object(Bucket=_s3_bucket, Key=s3_key)
        logger.info(f"[s3] Deleted: {s3_key}")
    except Exception as e:
        logger.warning(f"[s3] Delete failed for {s3_key}: {e}")

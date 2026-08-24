"""Singleton Prisma client — shared connection across all worker modules.

The Prisma client is instantiated once and connected on worker startup.
All modules import `get_db()` to access the shared instance, eliminating
per-function connect/disconnect TCP overhead.
"""
import logging
from typing import Optional
from prisma import Prisma
from prisma.errors import PrismaError

logger = logging.getLogger(__name__)

_db: Optional[Prisma] = None


async def connect_db() -> None:
    """Initialize and connect the shared Prisma client. Call once on startup."""
    global _db
    if _db is not None:
        logger.warning("DB client already connected — skipping")
        return
    _db = Prisma()
    await _db.connect()
    logger.info("Shared Prisma client connected")


async def disconnect_db() -> None:
    """Gracefully disconnect the shared Prisma client. Call on shutdown."""
    global _db
    if _db is None:
        return
    try:
        await _db.disconnect()
        logger.info("Shared Prisma client disconnected")
    except Exception as e:
        logger.warning(f"Error disconnecting Prisma client: {e}")
    finally:
        _db = None


async def reconnect_db() -> None:
    """Force reconnect the Prisma client after connection timeout.

    The Prisma query engine communicates via HTTP on localhost.
    After long-running tasks (15+ min LLM pipelines), the HTTP connection
    can idle-timeout with httpcore.ConnectTimeout. This function tears down
    the stale client and creates a fresh connection.
    """
    global _db
    logger.warning("Reconnecting Prisma client (stale connection recovery)")
    try:
        if _db is not None:
            await _db.disconnect()
    except Exception as e:
        logger.warning(f"Error during stale disconnect: {e}")
    _db = Prisma()
    await _db.connect()
    logger.info("Prisma client reconnected successfully")


def get_db() -> Prisma:
    """Return the shared Prisma client instance.

    Raises RuntimeError if called before connect_db().
    """
    if _db is None:
        raise RuntimeError("Prisma client not initialized — call connect_db() on startup")
    return _db

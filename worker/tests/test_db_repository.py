"""
Unit testy pre databázové operácie v db_repository.py a obchodny_vestnik.py.

Testuje:
- save_company_persons: transaction wrapping, exception propagation
- upsert_report_sources: transaction wrapping
- upsert_company_name: race condition fix (upsert instead of read-then-write)
- save_vestnik_events_to_db: transaction wrapping, dedup via upsert
- Schema constraints: unique indexes for CompanyEvent and VestnikEvent
"""

import asyncio
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch, call
from datetime import datetime
import pytest


# ── Path helpers (worker/tests/ → frontend/prisma/) ────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_SCHEMA_PATH = _PROJECT_ROOT / "frontend" / "prisma" / "schema.prisma"
_MIGRATION_PATH = (
    _PROJECT_ROOT / "frontend" / "prisma" / "migrations"
    / "20260801600000_add_dedup_constraints" / "migration.sql"
)

# Skip schema/migration tests if frontend dir not available (e.g. in worker container)
_SKIP_SCHEMA = not _SCHEMA_PATH.exists()
skip_if_no_schema = pytest.mark.skipif(_SKIP_SCHEMA, reason="frontend/prisma/schema.prisma not accessible from this environment")

def _schema_path():
    return str(_SCHEMA_PATH)

def _migration_path():
    return str(_MIGRATION_PATH)


# ── Prisma mock (z conftest.py) ─────────────────────────────────────────────
if "prisma" not in sys.modules:
    _prisma_mock = types.ModuleType("prisma")
    _prisma_mock.Prisma = type("Prisma", (), {})
    sys.modules["prisma"] = _prisma_mock

if "prisma.errors" not in sys.modules:
    _prisma_errors_mock = types.ModuleType("prisma.errors")
    _prisma_errors_mock.PrismaError = type("PrismaError", (Exception,), {})
    sys.modules["prisma.errors"] = _prisma_errors_mock
    _prisma_mock.errors = _prisma_errors_mock


# ═══════════════════════════════════════════════════════════════════════════
# save_company_persons — transaction wrapping + exception propagation
# ═══════════════════════════════════════════════════════════════════════════

class TestSaveCompanyPersons:
    """save_company_persons by mala:
    1. Wrap delete+create v transaction
    2. Re-raise exception (nie silent swallow)
    """

    def _make_persons(self, count=3):
        persons = []
        for i in range(count):
            p = SimpleNamespace(
                raw_name=f"Ján Testový {i}",
                clean_name=f"Jan Testovy {i}",
                role="statutar" if i == 0 else "spolocnik",
                city="Bratislava",
                zip_code="811 02",
            )
            persons.append(p)
        return persons

    @pytest.mark.asyncio
    async def test_uses_transaction(self):
        """save_company_persons by mala použiť db.tx() transaction."""
        from src.db_repository import save_company_persons

        tx_mock = AsyncMock()
        tx_mock.company.upsert = AsyncMock()
        tx_mock.companyperson.delete_many = AsyncMock()
        tx_mock.companyperson.create = AsyncMock()

        db_mock = MagicMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        with patch("src.db_repository.get_db", return_value=db_mock):
            await save_company_persons("12345678", self._make_persons(3))

        # Transaction should be used
        db_mock.tx.assert_called_once()
        # All operations should go through transaction, not db directly
        tx_mock.company.upsert.assert_called_once()
        tx_mock.companyperson.delete_many.assert_called_once()
        assert tx_mock.companyperson.create.call_count == 3

    @pytest.mark.asyncio
    async def test_exception_propagates(self):
        """Ak create zlyhá, výnimka by mala propagovať (nie silent swallow)."""
        from src.db_repository import save_company_persons

        tx_mock = AsyncMock()
        tx_mock.company.upsert = AsyncMock()
        tx_mock.companyperson.delete_many = AsyncMock()
        tx_mock.companyperson.create = AsyncMock(side_effect=Exception("DB connection lost"))

        db_mock = MagicMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        with patch("src.db_repository.get_db", return_value=db_mock):
            with pytest.raises(Exception, match="DB connection lost"):
                await save_company_persons("12345678", self._make_persons(1))

    @pytest.mark.asyncio
    async def test_delete_and_create_atomic(self):
        """Ak create zlyhá po delete, transaction by mala rollbackovať delete."""
        from src.db_repository import save_company_persons

        tx_mock = AsyncMock()
        tx_mock.company.upsert = AsyncMock()
        tx_mock.companyperson.delete_many = AsyncMock()
        # Second create fails
        tx_mock.companyperson.create = AsyncMock(
            side_effect=[None, Exception("Unique constraint violation"), None]
        )

        db_mock = MagicMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        with patch("src.db_repository.get_db", return_value=db_mock):
            with pytest.raises(Exception, match="Unique constraint violation"):
                await save_company_persons("12345678", self._make_persons(3))

        # Delete was called, but transaction will rollback
        tx_mock.companyperson.delete_many.assert_called_once()
        # Only 2 creates attempted (second failed)
        assert tx_mock.companyperson.create.call_count == 2


# ═══════════════════════════════════════════════════════════════════════════
# upsert_report_sources — transaction wrapping
# ═══════════════════════════════════════════════════════════════════════════

class TestUpsertReportSources:
    """upsert_report_sources by mala wrap upserts v transaction."""

    def _make_sources(self, count=3):
        sources = []
        for i in range(count):
            s = SimpleNamespace(
                source_type=f"ORSR_{i}",
                status="SUCCESS",
                status_message="OK",
                file_path=f"/tmp/file_{i}.pdf",
                page_count=10 + i,
                findings="Findings text",
            )
            sources.append(s)
        return sources

    @pytest.mark.asyncio
    async def test_uses_transaction(self):
        """upsert_report_sources by mala použiť db.tx() transaction."""
        from src.db_repository import upsert_report_sources

        tx_mock = AsyncMock()
        tx_mock.reportsource.upsert = AsyncMock()

        db_mock = MagicMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        with patch("src.db_repository.get_db", return_value=db_mock):
            await upsert_report_sources("report_123", self._make_sources(3))

        db_mock.tx.assert_called_once()
        assert tx_mock.reportsource.upsert.call_count == 3

    @pytest.mark.asyncio
    async def test_exception_propagates(self):
        """Ak upsert zlyhá, výnimka by mala propagovať."""
        from src.db_repository import upsert_report_sources

        tx_mock = AsyncMock()
        tx_mock.reportsource.upsert = AsyncMock(side_effect=Exception("DB error"))

        db_mock = MagicMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        with patch("src.db_repository.get_db", return_value=db_mock):
            with pytest.raises(Exception, match="DB error"):
                await upsert_report_sources("report_123", self._make_sources(1))


# ═══════════════════════════════════════════════════════════════════════════
# upsert_company_name — race condition fix
# ═══════════════════════════════════════════════════════════════════════════

class TestUpsertCompanyName:
    """upsert_company_name by mala použiť upsert (nie read-then-write)."""

    @pytest.mark.asyncio
    async def test_creates_new_company_with_upsert(self):
        """Ak firma neexistuje, použije upsert (nie create)."""
        from src.db_repository import upsert_company_name

        db_mock = AsyncMock()
        # find_unique returns None (company doesn't exist)
        db_mock.company.find_unique = AsyncMock(return_value=None)
        db_mock.company.upsert = AsyncMock()

        with patch("src.db_repository.get_db", return_value=db_mock):
            await upsert_company_name("12345678", "Test Company s.r.o.")

        # Should use upsert, not create
        db_mock.company.upsert.assert_called_once()
        call_args = db_mock.company.upsert.call_args
        assert call_args.kwargs["where"] == {"ico": "12345678"}
        assert call_args.kwargs["data"]["create"]["ico"] == "12345678"
        assert call_args.kwargs["data"]["create"]["name"] == "Test Company s.r.o."

    @pytest.mark.asyncio
    async def test_updates_existing_with_valid_name(self):
        """Ak firma existuje s invalid názov, update s platným názvom."""
        from src.db_repository import upsert_company_name

        existing = SimpleNamespace(name="")
        db_mock = AsyncMock()
        db_mock.company.find_unique = AsyncMock(return_value=existing)
        db_mock.company.update = AsyncMock()

        with patch("src.db_repository.get_db", return_value=db_mock):
            await upsert_company_name("12345678", "Better Name s.r.o.")

        db_mock.company.update.assert_called_once_with(
            where={"ico": "12345678"}, data={"name": "Better Name s.r.o."}
        )

    @pytest.mark.asyncio
    async def test_does_not_update_with_valid_existing_name(self):
        """Ak firma má už platný názov, neprepíše ho."""
        from src.db_repository import upsert_company_name

        existing = SimpleNamespace(name="Existing Valid Name s.r.o.")
        db_mock = AsyncMock()
        db_mock.company.find_unique = AsyncMock(return_value=existing)
        db_mock.company.update = AsyncMock()

        with patch("src.db_repository.get_db", return_value=db_mock):
            await upsert_company_name("12345678", "Different Name s.r.o.")

        # Should NOT update — existing name is valid
        db_mock.company.update.assert_not_called()

    @pytest.mark.asyncio
    async def test_invalid_name_not_saved(self):
        """Invalid names (n/a, null, -) by sa nemali uložiť."""
        from src.db_repository import upsert_company_name

        db_mock = AsyncMock()
        db_mock.company.find_unique = AsyncMock(return_value=None)
        db_mock.company.upsert = AsyncMock()

        with patch("src.db_repository.get_db", return_value=db_mock):
            await upsert_company_name("12345678", "n/a")

        # upsert should be called with name=None
        call_args = db_mock.company.upsert.call_args
        assert call_args.kwargs["data"]["create"]["name"] is None


# ═══════════════════════════════════════════════════════════════════════════
# save_vestnik_events_to_db — transaction + dedup
# ═══════════════════════════════════════════════════════════════════════════

class TestSaveVestnikEvents:
    """save_vestnik_events_to_db by mala:
    1. Wrap creates v transaction
    2. Používať upsert pre dedup (ak sourceId existuje)
    """

    def _make_events(self, count=2, with_source_id=True):
        events = []
        for i in range(count):
            analysis = SimpleNamespace(
                typ_udalosti="Konkurz",
                rizikovost="CRITICAL",
                zhrnutie="Konkurzné konanie",
                red_flags=["Insolvencia", "Likvidácia"],
            )
            events.append({
                "analysis": analysis,
                "publishedAt": "2024-01-15T00:00:00Z",
                "sourceId": f"VESTNIK_{i}" if with_source_id else None,
            })
        return events

    @pytest.mark.asyncio
    async def test_uses_transaction(self):
        """save_vestnik_events_to_db by mala použiť db.tx() transaction."""
        from src.scrapers.obchodny_vestnik import save_vestnik_events_to_db

        tx_mock = AsyncMock()
        tx_mock.vestnikevent.upsert = AsyncMock()

        db_mock = AsyncMock()
        db_mock.company.upsert = AsyncMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        with patch("src.scrapers.obchodny_vestnik.get_db", return_value=db_mock):
            await save_vestnik_events_to_db("12345678", self._make_events(2))

        db_mock.tx.assert_called_once()
        assert tx_mock.vestnikevent.upsert.call_count == 2

    @pytest.mark.asyncio
    async def test_uses_upsert_when_source_id_exists(self):
        """Ak sourceId existuje, použije upsert pre dedup."""
        from src.scrapers.obchodny_vestnik import save_vestnik_events_to_db

        tx_mock = AsyncMock()
        tx_mock.vestnikevent.upsert = AsyncMock()

        db_mock = AsyncMock()
        db_mock.company.upsert = AsyncMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        events = self._make_events(1, with_source_id=True)
        with patch("src.scrapers.obchodny_vestnik.get_db", return_value=db_mock):
            await save_vestnik_events_to_db("12345678", events)

        # Should use upsert with companyIco_sourceId composite key
        assert tx_mock.vestnikevent.upsert.called
        call_args = tx_mock.vestnikevent.upsert.call_args
        assert "companyIco_sourceId" in call_args.kwargs["where"]

    @pytest.mark.asyncio
    async def test_uses_create_when_no_source_id(self):
        """Ak sourceId je None, použije create (no dedup possible)."""
        from src.scrapers.obchodny_vestnik import save_vestnik_events_to_db

        tx_mock = AsyncMock()
        tx_mock.vestnikevent.create = AsyncMock()

        db_mock = AsyncMock()
        db_mock.company.upsert = AsyncMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        events = self._make_events(1, with_source_id=False)
        with patch("src.scrapers.obchodny_vestnik.get_db", return_value=db_mock):
            await save_vestnik_events_to_db("12345678", events)

        # Should use create, not upsert
        tx_mock.vestnikevent.create.assert_called_once()
        tx_mock.vestnikevent.upsert.assert_not_called()

    @pytest.mark.asyncio
    async def test_exception_in_transaction_propagates(self):
        """Ak upsert zlyhá, výnimka by mala propagovať."""
        from src.scrapers.obchodny_vestnik import save_vestnik_events_to_db

        tx_mock = AsyncMock()
        tx_mock.vestnikevent.upsert = AsyncMock(side_effect=Exception("DB error"))

        db_mock = AsyncMock()
        db_mock.company.upsert = AsyncMock()
        db_mock.tx = MagicMock(return_value=_async_ctx_mgr(tx_mock))

        events = self._make_events(1, with_source_id=True)
        with patch("src.scrapers.obchodny_vestnik.get_db", return_value=db_mock):
            with pytest.raises(Exception, match="DB error"):
                await save_vestnik_events_to_db("12345678", events)


# ═══════════════════════════════════════════════════════════════════════════
# Schema constraints — verify unique indexes exist
# ═══════════════════════════════════════════════════════════════════════════

class TestSchemaConstraints:
    """Verifikuje že schema.prisma má unikátne obmedzenia pre dedup."""

    @skip_if_no_schema
    def test_company_event_has_unique_constraint(self):
        """CompanyEvent by mal mať @@unique([companyIco, source, eventType, eventDate, amount])."""
        schema_path = _schema_path()
        with open(schema_path, "r") as f:
            content = f.read()
        # Find CompanyEvent model
        import re
        match = re.search(r'model CompanyEvent \{.*?\}', content, re.DOTALL)
        assert match, "CompanyEvent model not found"
        model_text = match.group()
        assert "@@unique" in model_text, "CompanyEvent missing @@unique constraint"
        assert "companyIco" in model_text
        assert "source" in model_text
        assert "eventType" in model_text

    @skip_if_no_schema
    def test_vestnik_event_has_unique_constraint(self):
        """VestnikEvent by mal mať @@unique([companyIco, sourceId])."""
        schema_path = _schema_path()
        with open(schema_path, "r") as f:
            content = f.read()
        import re
        match = re.search(r'model VestnikEvent \{.*?\}', content, re.DOTALL)
        assert match, "VestnikEvent model not found"
        model_text = match.group()
        assert "@@unique" in model_text, "VestnikEvent missing @@unique constraint"
        assert "companyIco" in model_text
        assert "sourceId" in model_text

    @skip_if_no_schema
    def test_report_request_has_deletedAt_index(self):
        """ReportRequest by mať @@index([deletedAt])."""
        schema_path = _schema_path()
        with open(schema_path, "r") as f:
            content = f.read()
        import re
        match = re.search(r'model ReportRequest \{.*?\}', content, re.DOTALL)
        assert match, "ReportRequest model not found"
        model_text = match.group()
        assert "deletedAt" in model_text
        assert "@@index([deletedAt])" in model_text

    @skip_if_no_schema
    def test_migration_file_exists(self):
        """Migrácia pre dedup constraints by mala existovať."""
        import os
        migration_path = _migration_path()
        assert os.path.exists(migration_path), f"Migration file not found: {migration_path}"

    @skip_if_no_schema
    def test_migration_has_dedup_cleanup(self):
        """Migrácia by mala obsahovať DELETE pre dedup existujúcich duplikátov."""
        migration_path = _migration_path()
        with open(migration_path, "r") as f:
            content = f.read()
        assert "DELETE FROM" in content, "Migration missing dedup DELETE"
        assert "CompanyEvent" in content
        assert "VestnikEvent" in content
        assert "CREATE UNIQUE INDEX" in content

    @skip_if_no_schema
    def test_migration_has_deletedAt_index(self):
        """Migrácia by mala vytvoriť index pre deletedAt."""
        migration_path = _migration_path()
        with open(migration_path, "r") as f:
            content = f.read()
        assert "ReportRequest_deletedAt_idx" in content
        assert "deletedAt" in content


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

class _async_ctx_mgr:
    """Mock async context manager pre db.tx()."""
    def __init__(self, tx_mock):
        self.tx_mock = tx_mock

    async def __aenter__(self):
        return self.tx_mock

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False  # Don't suppress exceptions

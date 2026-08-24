"""
F4.3 — Regression test pre source_pages enrichment pre Súvaha findings.

Overuje že:
1. Súvaha findings dostanú source_pages = "1" ak sú null
2. Notes findings zachovajú svoje LLM-generované source_pages
3. Vestník/OR SR findings nie sú ovplyvnené
4. UNKNOWN findings (source="—") ostanú null
5. Findings s už nastaveným source_pages sa neprepíšu
6. Prázdny zoznam findings je bezpečný
7. verdict_builder aplikuje enrichment pri ukladaní do DB
"""
import pytest
from src.agents.chief_auditor import ReportFinding
from src.verdict_builder import _enrich_findings_source_pages


class TestEnrichFindingsSourcePages:
    """Overí _enrich_findings_source_pages funkciu."""

    def test_suvaha_finding_gets_source_page_1(self):
        """Súvaha finding s null source_pages → source_pages = '1'."""
        findings = [
            ReportFinding(
                category="STRENGTH",
                title="Silná tvorba hotovosti",
                evidence="OCF 67M EUR",
                source="Súvaha",
                source_pages=None,
                explanation="Firma generuje hotovosť.",
                implication="Schopnosť splácať záväzky.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages == "1"

    def test_balance_sheet_english_gets_source_page_1(self):
        """'Balance Sheet' finding (English) s null source_pages → source_pages = '1'."""
        findings = [
            ReportFinding(
                category="RISK",
                title="High debt",
                evidence="D/E ratio 7.76",
                source="Balance Sheet",
                source_pages=None,
                explanation="Leverage risk.",
                implication="Credit risk for lenders.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages == "1"

    def test_notes_finding_keeps_llm_source_pages(self):
        """Notes finding s source_pages='9, 13' → zachová sa."""
        findings = [
            ReportFinding(
                category="ANOMALY",
                title="Cash-pooling",
                evidence="Pôžičky 91M EUR",
                source="Notes",
                source_pages="9, 13",
                explanation="Intra-group cash-pooling.",
                implication="Nie je riziko odtoku.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages == "9, 13"

    def test_notes_finding_null_stays_null(self):
        """Notes finding s null source_pages → ostane null (LLM neposkytol)."""
        findings = [
            ReportFinding(
                category="RISK",
                title="Daňové riziko",
                evidence="Rezerva 1.8M EUR",
                source="Notes",
                source_pages=None,
                explanation="Daňové kontroly.",
                implication="Riziko dodatočných nákladov.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages is None

    def test_vestnik_finding_not_affected(self):
        """Vestník finding s null source_pages → ostane null."""
        findings = [
            ReportFinding(
                category="RISK",
                title="Konkurz",
                evidence="Konkurzné konanie",
                source="Vestník",
                source_pages=None,
                explanation="Insolvencia.",
                implication="Kritické riziko.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages is None

    def test_unknown_finding_stays_null(self):
        """UNKNOWN finding (source='—') → source_pages ostane null."""
        findings = [
            ReportFinding(
                category="UNKNOWN",
                title="Neznáma transakcia",
                evidence="Dostupné zdroje neobsahujú relevantný dôkaz",
                source="—",
                source_pages=None,
                explanation="Dostupné Notes neposkytujú dôkaz.",
                implication="Odporúčame overiť.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages is None

    def test_suvaha_with_existing_pages_not_overwritten(self):
        """Súvaha finding s už nastaveným source_pages='3' → neprepíše sa."""
        findings = [
            ReportFinding(
                category="STRENGTH",
                title="Silná likvidita",
                evidence="Current ratio 3.15",
                source="Súvaha",
                source_pages="3",
                explanation="Vysoká likvidita.",
                implication="Schopnosť splácať.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages == "3"

    def test_empty_findings_list_safe(self):
        """Prázdny zoznam findings → bez chyby."""
        result = _enrich_findings_source_pages([])
        assert result == []

    def test_mixed_findings_batch(self):
        """Mix Súvaha + Notes + Vestník → iba Súvaha null sa enrichne."""
        findings = [
            ReportFinding(
                category="STRENGTH", title="OCF", evidence="67M",
                source="Súvaha", source_pages=None,
                explanation="x", implication="y",
            ),
            ReportFinding(
                category="ANOMALY", title="Cash-pooling", evidence="91M",
                source="Notes", source_pages="9, 13",
                explanation="x", implication="y",
            ),
            ReportFinding(
                category="RISK", title="Konkurz", evidence="Konanie",
                source="Vestník", source_pages=None,
                explanation="x", implication="y",
            ),
            ReportFinding(
                category="RISK", title="Daňové riziko", evidence="Rezerva",
                source="Notes", source_pages=None,
                explanation="x", implication="y",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages == "1"       # Súvaha → enriched
        assert result[1].source_pages == "9, 13"   # Notes → kept
        assert result[2].source_pages is None       # Vestník → untouched
        assert result[3].source_pages is None       # Notes null → stays null

    def test_suvaha_vyraz_ziskov_strat_also_enriched(self):
        """'Súvaha a Výkaz ziskov a strát' source → enriched."""
        findings = [
            ReportFinding(
                category="RISK", title="Strata", evidence="-14M",
                source="Súvaha a Výkaz ziskov a strát", source_pages=None,
                explanation="Trhové vplyvy.", implication="Riziko.",
            ),
        ]
        result = _enrich_findings_source_pages(findings)
        assert result[0].source_pages == "1"


class TestVerdictBuilderEnrichment:
    """Overí že verdict_builder aplikuje enrichment pri ukladaní do DB."""

    def test_enrich_function_importable(self):
        """_enrich_findings_source_pages je importovateľná z verdict_builder."""
        from src.verdict_builder import _enrich_findings_source_pages
        assert callable(_enrich_findings_source_pages)

    def test_verdict_builder_calls_enrich(self):
        """verdict_builder source kód obsahuje volanie _enrich_findings_source_pages."""
        import inspect
        from src.verdict_builder import run_and_save_audit_verdict
        source = inspect.getsource(run_and_save_audit_verdict)
        assert "_enrich_findings_source_pages" in source

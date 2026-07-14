"""
Backward-compatibility facade — all agents have been refactored into src/agents/.
This module re-exports everything so existing imports continue to work.
"""
from src.agents.shared import (
    _get_gemini_client,
    _gemini_uploaded_file,
    _log_tokens,
    reset_token_stats,
    log_token_summary,
    AuditorReportData,
    FinancialMetrics,
    CompanyFinancialExtraction,
    VerificationExtraction,
)
from src.agents.financial_analyst import extract_financial_data, verify_critical_numbers_blind
from src.agents.staff_costs import extract_staff_costs_focused, StaffCostsResult
from src.agents.vestnik import extract_vestnik_event, extract_vestnik_events_batch, VestnikExtraction, VestnikBatchResult
from src.agents.narrative import extract_narrative_risk, NarrativeRiskAnalysis
from src.agents.notes_forensic import extract_notes_risks, NotesRiskAnalysis
from src.agents.chief_auditor import evaluate_audit_verdict, AuditVerdict, EvidenceItem
from src.agents.cross_analysis import generate_cross_analysis, CrossAnalysisResult
from src.agents.report_qa import verify_report_quality, QAResult
from src.agents.orsr_forensic import analyze_orsr_history

__all__ = [
    # Shared
    "_get_gemini_client",
    "_gemini_uploaded_file",
    "_log_tokens",
    "reset_token_stats",
    "log_token_summary",
    "AuditorReportData",
    "FinancialMetrics",
    "CompanyFinancialExtraction",
    "VerificationExtraction",
    # Agents
    "extract_financial_data",
    "verify_critical_numbers_blind",
    "extract_staff_costs_focused",
    "StaffCostsResult",
    "extract_vestnik_event",
    "extract_vestnik_events_batch",
    "VestnikExtraction",
    "VestnikBatchResult",
    "extract_narrative_risk",
    "NarrativeRiskAnalysis",
    "extract_notes_risks",
    "NotesRiskAnalysis",
    "evaluate_audit_verdict",
    "AuditVerdict",
    "EvidenceItem",
    "generate_cross_analysis",
    "CrossAnalysisResult",
    "verify_report_quality",
    "QAResult",
    "analyze_orsr_history",
]

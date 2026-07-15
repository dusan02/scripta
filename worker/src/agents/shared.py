import os
import logging
from contextlib import contextmanager
from pydantic import BaseModel, Field
from typing import Optional
from google import genai

from src.config import settings

logger = logging.getLogger(__name__)


def _get_gemini_client() -> genai.Client:
    """Vráti Gemini API klienta s API kľúčom z environment variables."""
    return genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


@contextmanager
def _gemini_uploaded_file(client: genai.Client, file_path: str):
    """Context manager: uploadne PDF do Gemini File API a automaticky ho vymaže po použití."""
    uploaded = client.files.upload(file=file_path)
    try:
        yield uploaded
    finally:
        try:
            if uploaded.name:
                client.files.delete(name=uploaded.name)
        except Exception as e:
            logger.warning(f"Nepodarilo sa vymazať súbor z Gemini: {e}")


# ── Token cost accumulator ────────────────────────────────────────────
_token_stats: dict[str, dict] = {}

def reset_token_stats() -> None:
    """Reset accumulator na začiatku nového reportu."""
    _token_stats.clear()

def _log_tokens(model: str, usage, label: str) -> None:
    """Zaloguje spotrebu tokenov a odhadnuté náklady pre jedno LLM volanie."""
    if not usage:
        return
    from src.log_helpers import get_correlation_id
    inp = getattr(usage, "prompt_token_count", 0) or 0
    out = getattr(usage, "candidates_token_count", 0) or 0
    price_in, price_out = settings.llm_pricing.get(model, (0.0, 0.0))
    cost_usd = (inp * price_in + out * price_out) / 1_000_000
    cid = get_correlation_id() or "-"
    logger.info(
        f"[{cid}] LLM TOKENS: {label} | model={model} "
        f"in={inp:,} out={out:,} tok "
        f"cost=${cost_usd:.5f}"
    )
    # Accumulate
    if model not in _token_stats:
        _token_stats[model] = {"calls": 0, "input": 0, "output": 0, "cost": 0.0}
    _token_stats[model]["calls"] += 1
    _token_stats[model]["input"] += inp
    _token_stats[model]["output"] += out
    _token_stats[model]["cost"] += cost_usd

def log_token_summary() -> None:
    """Zaloguje súhrn token cost za celý report."""
    if not _token_stats:
        return
    from src.log_helpers import get_correlation_id
    cid = get_correlation_id() or "-"
    total_cost = 0.0
    total_in = 0
    total_out = 0
    parts = []
    for model, stats in _token_stats.items():
        total_cost += stats["cost"]
        total_in += stats["input"]
        total_out += stats["output"]
        parts.append(f"{model}: {stats['calls']} calls, {stats['input']:,}+{stats['output']:,} tok, ${stats['cost']:.4f}")
    logger.info(
        f"[{cid}] LLM SUMMARY: {len(_token_stats)} models, "
        f"{total_in:,}+{total_out:,} tok, ${total_cost:.4f} | "
        f"{' | '.join(parts)}"
    )


# ── Shared Pydantic Models ────────────────────────────────────────────

class AuditorReportData(BaseModel):
    nazor_auditora: str = Field(..., description="Typ názoru: 'Bez výhrad', 'S výhradou', 'Záporný', 'Odmietnutie vyjadriť názor'.")
    going_concern_riziko: bool = Field(..., description="True, ak audítor spomína významnú neistotu týkajúcu sa going concern. Inak False.")
    auditor_vyhrady_text: Optional[str] = Field(..., description="Zhrnutie výhrad audítora, ak existujú.")

class FinancialMetrics(BaseModel):
    rok_zavierky: int = Field(...)
    celkove_aktiva: Optional[float] = Field(..., description="Celkové aktíva (Total assets). Ak údaj chýba v závierke, vráť null.")
    obezny_majetok: Optional[float] = Field(..., description="Obežný majetok (current assets) — zásoby, pohľadávky, krátkodobý finančný majetok. Ak chýba, vráť null.")
    vlastne_imanie_celkom: Optional[float] = Field(..., description="Vlastné imanie celkom (Total equity). Ak chýba, vráť null.")
    kratkodobe_zavazky: Optional[float] = Field(..., description="Krátkodobé záväzky (Short-term liabilities). Ak chýba, vráť null.")
    dlhodobe_zavazky: Optional[float] = Field(..., description="Dlhodobé záväzky (long-term liabilities) — bankové úvery, dlhopisy, lízingové záväzky > 1 rok. Ak chýba, vráť null.")
    trzby_z_hlavnej_cinnosti: Optional[float] = Field(..., description="Tržby z hlavnej činnosti (Revenue/Turnover). Ak chýba, vráť null.")
    hruba_marza: Optional[float] = Field(..., description="Hrubý zisk (Gross Profit). V SK GAAP hľadaj riadok 'Hrubý zisk' / 'Gross profit'; ak nie je uvedený, použi 'Pridanú hodnotu' (Value added) ako približný proxy, alebo vypočítaj (Tržby - Náklady na predaný tovar - Výrobná spotreba). V IFRS = Revenue - Cost of sales. Ak chýba, vráť null.")
    zisk_alebo_strata_po_zdaneni: Optional[float] = Field(..., description="Čistý zisk alebo strata (Net profit/loss). Ak chýba, vráť null.")
    peniaze_a_penazne_ekvivalenty_k_31_12: Optional[float] = Field(..., description="Peniaze a peňažné ekvivalenty (Cash and equivalents). Ak chýba, vráť null.")
    ciste_penazne_toky_z_prevadzkovej_cinnosti: Optional[float] = Field(..., description="Čisté peňažné toky z prevádzkovej činnosti (Operating cash flow). Ak chýba, vráť null.")
    osobne_naklady: Optional[float] = Field(..., description="Personálne/osobné náklady (Staff costs). Ak chýba, vráť null.")
    pohladavky_z_obchodneho_styku: Optional[float] = Field(..., description="Pohľadávky z obchodného styku (Trade receivables). Ak chýba, vráť null.")
    zavazky_z_obchodneho_styku: Optional[float] = Field(..., description="Záväzky z obchodného styku (Trade payables). Ak chýba, vráť null.")
    zasoby: Optional[float] = Field(..., description="Zásoby (Inventory/Stocks). Hľadaj 'Zásoby', 'Inventories', 'Stocks'. Ak chýba, vráť null.")
    odpisy: Optional[float] = Field(..., description="Odpisy dlhodobého nehmotného a hmotného majetku (Depreciation/Amortization). Hľadaj 'Odpisy', 'Depreciation', 'Amortization'. Ak chýba, vráť null.")
    investicny_cash_flow: Optional[float] = Field(..., description="Čisté peňažné toky z investičnej činnosti (Investing cash flow). Hľadaj 'Investičná činnosť', 'Investing activities'. Ak chýba, vráť null.")
    financny_cash_flow: Optional[float] = Field(..., description="Čisté peňažné toky z finančnej činnosti (Financing cash flow). Hľadaj 'Finančná činnosť', 'Financing activities'. Ak chýba, vráť null.")
    uroky: Optional[float] = Field(..., description="Náklady na úroky (Interest expense). Hľadaj 'Úroky', 'Interest expense', 'Finance costs'. Ak chýba, vráť null.")
    pocet_zamestnancov: Optional[int] = Field(..., description="Počet zamestnancov (ak je uvedený v závierke alebo poznámkach). Hľadaj 'Priemerný počet zamestnancov', 'Number of employees'. Ak chýba, vráť null.")
    mena: str = Field(..., description="Mena výkazu: 'EUR', 'CZK', 'USD'. Ak výkaz uvádza 'v tisícoch EUR', mena je stále EUR.")
    typ_zavierky: str = Field(..., description="Typ závierky: 'IFRS' ak dokument explicitne uvádza IFRS, 'MICRO' pre Úč MUJ mikro jednotky, inak 'SK_GAAP'.")
    pocet_mesiacov_obdobia: Optional[int] = Field(..., description="Zisti počet mesiacov (od - do) na prvej strane dokumentu. Dôkladne zisti, či výkaz pokrýva 12 mesiacov alebo kratšie/dlhšie obdobie. Ak to nie je možné určiť, vráť null.")
    is_consolidated: bool = Field(..., description="Dôkladne prever prvú stranu. True ak ide o konsolidovanú závierku (hľadaj slová 'konsolidovaná', 'consolidated'). Zbystri pozornosť ak názov firmy obsahuje 'Holding' alebo 'Group'. Ak je to individuálna (samostatná) závierka, vráť False.")

class CompanyFinancialExtraction(BaseModel):
    ico: str = Field(...)
    nazov_spolocnosti: str = Field(..., description="Oficiálny názov spoločnosti.")
    audit: AuditorReportData
    metriky: FinancialMetrics
    verification_confidence: dict[str, str] = Field(default_factory=dict, description="Mapovanie pola na confidence level: HIGH, MEDIUM, LOW")

class VerificationExtraction(BaseModel):
    celkove_aktiva: Optional[float] = Field(None, description="Celkové aktíva (Total assets). Ak nenájdeš s istotou, vráť null.")
    trzby_z_hlavnej_cinnosti: Optional[float] = Field(None, description="Tržby z hlavnej činnosti (Revenue). Ak nenájdeš s istotou, vráť null.")
    zisk_alebo_strata_po_zdaneni: Optional[float] = Field(None, description="Čistý zisk alebo strata (Net profit/loss). Ak nenájdeš s istotou, vráť null.")
    vlastne_imanie_celkom: Optional[float] = Field(None, description="Vlastné imanie celkom (Total equity). Ak nenájdeš s istotou, vráť null.")
    ciste_penazne_toky_z_prevadzkovej_cinnosti: Optional[float] = Field(None, description="Prevádzkový cash flow. Ak nenájdeš s istotou, vráť null.")

from .prompt_common import COMMON_BUT_PATTERNS, COMMON_FORENSIC_RULES, COMMON_TEXT_QUALITY_RULES

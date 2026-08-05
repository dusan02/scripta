import os
import logging
import itertools
import threading
from contextlib import contextmanager
from pydantic import BaseModel, Field
from typing import Optional
from google import genai

from src.config import settings

logger = logging.getLogger(__name__)

# ── Gemini API key pool ──────────────────────────────────────────────────────
# Supports multiple keys via GEMINI_API_KEYS (comma-separated) for round-robin
# rotation. Falls back to single GEMINI_API_KEY / GOOGLE_API_KEY env var.
# This prevents all LLM calls from failing when a single key hits quota limits.

def _load_gemini_keys() -> list[str]:
    """Load API keys from environment, supporting both multi-key and single-key configs."""
    keys: list[str] = []
    multi = os.environ.get("GEMINI_API_KEYS", "").strip()
    if multi:
        keys = [k.strip() for k in multi.split(",") if k.strip()]
    if not keys:
        single = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
        if single:
            keys = [single]
    return keys

_gemini_keys = _load_gemini_keys()
_key_cycle = itertools.cycle(_gemini_keys) if _gemini_keys else None
_key_lock = threading.Lock()

# Track failed keys to skip them on subsequent calls
_failed_keys: set[str] = set()

if _gemini_keys:
    logger.info(f"[Gemini] Loaded {len(_gemini_keys)} API key(s) for round-robin rotation")
else:
    logger.warning("[Gemini] No API keys configured — LLM calls will fail")


def _get_gemini_client() -> genai.Client:
    """Vráti Gemini API klienta s API kľúčom z environment variables.

    Pri viacerých kľúčoch (GEMINI_API_KEYS) strieda kľúče round-robin,
    preskakuje kľúče ktoré už raz zlyhali (napr. quota exceeded).
    """
    if not _key_cycle:
        raise RuntimeError("No Gemini API keys configured")

    with _key_lock:
        # Try to find a non-failed key
        for _ in range(len(_gemini_keys)):
            key = next(_key_cycle)
            if key not in _failed_keys:
                _last_issued_key.set(key)
                return genai.Client(api_key=key)

        # All keys failed — reset and try the first one (maybe quota reset)
        logger.warning("[Gemini] All keys have failed — resetting failed set and retrying")
        _failed_keys.clear()
        key = next(_key_cycle)
        _last_issued_key.set(key)
        return genai.Client(api_key=key)


# Context variable tracking the last-issued API key, so safe_llm_call
# can mark it as failed on 429/503 without needing access to the client.
import contextvars
_last_issued_key: contextvars.ContextVar[str] = contextvars.ContextVar("_last_issued_key", default="")


def _mark_gemini_key_failed(api_key: str) -> None:
    """Mark a Gemini API key as failed (e.g. quota exceeded). It will be skipped on subsequent calls."""
    with _key_lock:
        _failed_keys.add(api_key)
        remaining = len(_gemini_keys) - len(_failed_keys)
        logger.warning(f"[Gemini] Key marked as failed. {remaining} key(s) remaining active")


def _mark_last_key_failed() -> None:
    """Mark the last-issued API key as failed. Called by safe_llm_call on 429/503."""
    key = _last_issued_key.get()
    if key:
        _mark_gemini_key_failed(key)


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
    """Zaloguje súhrn token cost za celý report — vrátane odhadu za failed cally."""
    if not _token_stats:
        return
    from src.log_helpers import get_correlation_id
    cid = get_correlation_id() or "-"
    total_cost = 0.0
    total_in = 0
    total_out = 0
    total_failed_cost = 0.0
    total_failed_calls = 0
    parts = []
    for model, stats in _token_stats.items():
        total_cost += stats["cost"]
        total_in += stats["input"]
        total_out += stats["output"]
        failed_calls = stats.get("failed_calls", 0)
        failed_cost = stats.get("failed_cost", 0.0)
        total_failed_cost += failed_cost
        total_failed_calls += failed_calls
        part = f"{model}: {stats['calls']} ok calls, {stats['input']:,}+{stats['output']:,} tok, ${stats['cost']:.4f}"
        if failed_calls:
            part += f" | {failed_calls} failed, ~${failed_cost:.4f}"
        parts.append(part)
    grand_total = total_cost + total_failed_cost
    logger.info(
        f"[{cid}] LLM SUMMARY: {len(_token_stats)} models, "
        f"{total_in:,}+{total_out:,} tok, ${total_cost:.4f} ok"
        + (f" + ~${total_failed_cost:.4f} failed ({total_failed_calls} calls)" if total_failed_calls else "")
        + f" = ~${grand_total:.4f} total | "
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
    dan_z_prijmu: Optional[float] = Field(None, description="Daň z príjmov (Income tax). Hľadaj 'Daň z príjmov', 'Income tax', 'Daň z príjmov z bežnej činnosti'. Extrahuj ako kladné číslo. Ak chýba, vráť null.")
    pocet_zamestnancov: Optional[int] = Field(..., description="Počet zamestnancov (ak je uvedený v závierke alebo poznámkach). Hľadaj 'Priemerný počet zamestnancov', 'Number of employees', 'PRIEMERNÝ POČET ZAMESTNANCOV'. Ak chýba, vráť null.")
    zavazky_sp: Optional[float] = Field(None, description="Záväzky zo sociálneho poistenia (Social insurance liabilities). Hľadaj 'Záväzky zo sociálneho poistenia', '336A', sekciu 'ZÁVÄZKY VOČI ŠTÁTU A SP'. Ak chýba, vráť null.")
    danove_zavazky: Optional[float] = Field(None, description="Daňové záväzky a dotácie (Tax liabilities). Hľadaj 'Daňové záväzky', '341', '342', '343', '34X', sekciu 'ZÁVÄZKY VOČI ŠTÁTU A SP'. Ak chýba, vráť null.")
    zavazky_zamestnanci: Optional[float] = Field(None, description="Záväzky voči zamestnancom (Employee liabilities). Hľadaj 'Záväzky voči zamestnancom', '331', '333', '33X', sekciu 'ZÁVÄZKY VOČI ŠTÁTU A SP'. Ak chýba, vráť null.")
    mena: str = Field(..., description="Mena výkazu: 'EUR', 'CZK', 'USD'. Ak výkaz uvádza 'v tisícoch EUR', mena je stále EUR.")
    typ_zavierky: str = Field(..., description="Typ závierky: 'IFRS' ak dokument explicitne uvádza IFRS, 'MICRO' pre Úč MUJ mikro jednotky, inak 'SK_GAAP'.")
    pocet_mesiacov_obdobia: Optional[int] = Field(..., description="Zisti počet mesiacov (od - do) na prvej strane dokumentu. Dôkladne zisti, či výkaz pokrýva 12 mesiacov alebo kratšie/dlhšie obdobie. Ak to nie je možné určiť, vráť null.")
    is_consolidated: bool = Field(..., description="Dôkladne prever prvú stranu. True ak ide o konsolidovanú závierku (hľadaj slová 'konsolidovaná', 'consolidated'). Zbystri pozornosť ak názov firmy obsahuje 'Holding' alebo 'Group'. Ak je to individuálna (samostatná) závierka, vráť False.")
    # ── Extended fields (template 699 only — asset/equity composition) ──
    neobezny_majetok: Optional[float] = Field(None, description="Neobežný majetok (non-current assets). Šablóna 699 r.2.")
    dlhodoby_nehmotny_majetok: Optional[float] = Field(None, description="Dlhodobý nehmotný majetok súčet. Šablóna 699 r.3.")
    dlhodoby_hmotny_majetok: Optional[float] = Field(None, description="Dlhodobý hmotný majetok súčet. Šablóna 699 r.11.")
    dlhodoby_financny_majetok: Optional[float] = Field(None, description="Dlhodobý finančný majetok súčet. Šablóna 699 r.21.")
    dlhodobe_pohladavky: Optional[float] = Field(None, description="Dlhodobé pohľadávky súčet. Šablóna 699 r.41.")
    kratkodoby_financny_majetok: Optional[float] = Field(None, description="Krátkodobý finančný majetok súčet. Šablóna 699 r.66.")
    casove_rozlisenie_aktiv: Optional[float] = Field(None, description="Časové rozlíšenie aktív. Šablóna 699 r.74.")
    zakladne_imanie: Optional[float] = Field(None, description="Základné imanie súčet. Šablóna 699 r.81.")
    emisione_azio: Optional[float] = Field(None, description="Emisné ážio. Šablóna 699 r.85.")
    ostatne_kapitalove_fondy: Optional[float] = Field(None, description="Ostatné kapitálové fondy. Šablóna 699 r.86.")
    zakonne_rezervne_fondy: Optional[float] = Field(None, description="Zákonné rezervné fondy. Šablóna 699 r.87.")
    ostatne_fondy_zo_zisku: Optional[float] = Field(None, description="Ostatné fondy zo zisku. Šablóna 699 r.90.")
    vysledok_minuly_rokov: Optional[float] = Field(None, description="Výsledok hospodárenia minulých rokov (súčet). Šablóna 699 r.97.")
    nerozdeleny_zisk: Optional[float] = Field(None, description="Nerozdelený zisk minulých rokov. Šablóna 699 r.98.")
    neuhradena_strata: Optional[float] = Field(None, description="Neuhradená strata minulých rokov. Šablóna 699 r.99.")
    vysledok_beziaceho_roka: Optional[float] = Field(None, description="Výsledok hospodárenia za účtovné obdobie po zdanení (z pasív). Šablóna 699 r.100.")
    dlhodobe_rezervy: Optional[float] = Field(None, description="Dlhodobé rezervy. Šablóna 699 r.118.")
    kratkodobe_rezervy: Optional[float] = Field(None, description="Krátkodobé rezervy. Šablóna 699 r.136.")
    bezne_bankove_uvery: Optional[float] = Field(None, description="Bežné bankové úvery. Šablóna 699 r.139.")
    kratkodobe_financne_vypomoci: Optional[float] = Field(None, description="Krátkodobé finančné výpomoci. Šablóna 699 r.140.")
    naklady_na_hosp_cinnost: Optional[float] = Field(None, description="Náklady na hospodársku činnosť spolu. Šablóna 699 r.10.")
    spotreba_materialu: Optional[float] = Field(None, description="Spotreba materiálu, energie a ostatných neskladovateľných dodávok. Šablóna 699 r.12.")
    sluzby: Optional[float] = Field(None, description="Služby. Šablóna 699 r.14.")
    mzdove_naklady: Optional[float] = Field(None, description="Mzdové náklady (podmnožina osobných nákladov). Šablóna 699 r.16.")
    dane_a_poplatky: Optional[float] = Field(None, description="Dane a poplatky. Šablóna 699 r.20.")
    vysledok_z_fin_cinnosti: Optional[float] = Field(None, description="Výsledok hospodárenia z finančnej činnosti. Šablóna 699 r.55.")
    zisk_pred_zdanenim: Optional[float] = Field(None, description="Výsledok hospodárenia za účtovné obdobie pred zdanením. Šablóna 699 r.56.")
    prevod_podielov_spolocnikom: Optional[float] = Field(None, description="Prevod podielov na výsledku hospodárenia spoločníkom. Šablóna 699 r.60.")
    datum_zostavenia: Optional[str] = Field(None, description="Dátum zostavenia závierky (ISO formát, napr. '2024-05-13'). Forenzný signál — oneskorené závierky indikujú problémy.")
    datum_schvalenia: Optional[str] = Field(None, description="Dátum schválenia závierky (ISO formát).")

class VerificationConfidenceItem(BaseModel):
    field: str = Field(..., description="Názov pola, napr. celkove_aktiva, trzby_z_hlavnej_cinnosti.")
    confidence: str = Field(..., description="Confidence level: HIGH, MEDIUM, LOW")

class CompanyFinancialExtraction(BaseModel):
    ico: str = Field(...)
    nazov_spolocnosti: str = Field(..., description="Oficiálny názov spoločnosti.")
    audit: AuditorReportData
    metriky: FinancialMetrics
    verification_confidence: list[VerificationConfidenceItem] = Field(default_factory=list, description="Zoznam confidence levelov pre polia: HIGH, MEDIUM, LOW")

class VerificationExtraction(BaseModel):
    celkove_aktiva: Optional[float] = Field(None, description="Celkové aktíva (Total assets). Ak nenájdeš s istotou, vráť null.")
    trzby_z_hlavnej_cinnosti: Optional[float] = Field(None, description="Tržby z hlavnej činnosti (Revenue). Ak nenájdeš s istotou, vráť null.")
    zisk_alebo_strata_po_zdaneni: Optional[float] = Field(None, description="Čistý zisk alebo strata (Net profit/loss). Ak nenájdeš s istotou, vráť null.")
    vlastne_imanie_celkom: Optional[float] = Field(None, description="Vlastné imanie celkom (Total equity). Ak nenájdeš s istotou, vráť null.")
    ciste_penazne_toky_z_prevadzkovej_cinnosti: Optional[float] = Field(None, description="Prevádzkový cash flow. Ak nenájdeš s istotou, vráť null.")
    typ_zavierky: Optional[str] = Field(None, description="Typ závierky: 'IFRS', 'MICRO' pre Úč MUJ, inak 'SK_GAAP'. Používa sa na sanity check.")

from .prompt_common import COMMON_BUT_PATTERNS, COMMON_FORENSIC_RULES, COMMON_TEXT_QUALITY_RULES

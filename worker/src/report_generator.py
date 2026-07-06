import os
import re
import io
import json
import time
import math
import base64
import asyncio
import logging
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape as xml_escape

from playwright.async_api import async_playwright
from prisma import Prisma
from jinja2 import Environment, FileSystemLoader
from src.infographics import generate_pl_infographic, generate_balance_sheet_infographic, generate_cashflow_waterfall

import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
from matplotlib.ticker import FuncFormatter
from src.analytics import (
    compute_altman_z_score,
    sanitize_cash_flow_fields,
    estimate_missing_cash_flow,
    compute_financial_ratios,
    compute_financial_trends,
    compute_forensic_scorecard,
    detect_startup_profile,
    compute_piotroski_f_score,
)

logger = logging.getLogger(__name__)

SOURCE_CATEGORIES = [
    ("Základné firemné a právne registre", ["ORSR", "REGISTER_UZ", "OBCHODNY_VESTNIK", "ZRSR", "RPO", "RPVS"]),
    ("Insolvencia, exekúcie a dlhy", ["INSOLVENCY", "POVERENIA", "FINANCNA_SPRAVA", "SP_DLZNICI", "VSZP_DLZNICI", "DOVERA_DLZNICI", "UNION_DLZNICI"]),
    ("Finančná správa a DPH", ["FS_DANOVE_SUBJEKTY", "FS_DPH_REGISTROVANI", "FS_DPH_RUSENIE", "FS_DPH_VYMAZANI", "FS_DPH_NADMERNY_ODPOCET", "FS_DPH_BANKOVE_UCTY", "FS_DAN_Z_PRIJMOV", "FS_DAN_PRIJMOV_REG"]),
    ("Súdy a sankcie", ["CRRS", "DISKVALIFIKACIE"]),
    ("Financie a štátne zákazky", ["CRZ", "UVO"]),
    ("Majetok a práva", ["NCRZP", "NCRD", "OCHRANNE_ZNAMKY"]),
]

SOURCE_LABELS = {
    "ORSR": "ORSR", "ZRSR": "ŽRSR", "RPO": "RPO", "RPVS": "RPVS", "OBCHODNY_VESTNIK": "Obchodný vestník",
    "INSOLVENCY": "Register úpadcov", "POVERENIA": "Poverenia", "FINANCNA_SPRAVA": "Daňoví dlžníci",
    "SP_DLZNICI": "Soc. poisťovňa", "VSZP_DLZNICI": "VšZP", "DOVERA_DLZNICI": "Dôvera", "UNION_DLZNICI": "UNION",
    "FS_DANOVE_SUBJEKTY": "Index daň. spoľahlivosti", "FS_DPH_REGISTROVANI": "Platitelia DPH",
    "FS_DPH_RUSENIE": "Zrušenie DPH", "FS_DPH_VYMAZANI": "Vymazaní z DPH",
    "FS_DPH_NADMERNY_ODPOCET": "Nadmerný odpočet", "FS_DPH_BANKOVE_UCTY": "Bankové účty DPH",
    "FS_DAN_Z_PRIJMOV": "Daň z príjmov PO", "FS_DAN_PRIJMOV_REG": "Reg. k dani z príjmov",
    "CRRS": "Rozhodnutia súdov", "DISKVALIFIKACIE": "Diskvalifikácie",
    "NCRZP": "Záložné práva", "NCRD": "Register dražieb", "OCHRANNE_ZNAMKY": "Ochranné známky",
    "REGISTER_UZ": "Účtovné závierky", "CRZ": "Register zmlúv", "UVO": "Verejné obstarávanie",
}

def format_currency(value: float) -> str:
    """Naformátuje číslo ako menu (napr. 1 234 567 €). Ak je None, vráti '—'."""
    if value is None:
        return "—"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f} mil. €".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.1f} tis. €".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f} €".replace(",", " ")
    except (ValueError, TypeError):
        return "—"

def format_number(value: float) -> str:
    """Vráti číslo bez menovej prípony — pre tabuľky kde je jednotka uvedená v hlavičke."""
    if value is None:
        return "—"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f}".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.0f}".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f}".replace(",", " ")
    except (ValueError, TypeError):
        return "—"

def format_number_millions(value: float, treat_zero_as_none: bool = False) -> str:
    """Vráti číslo v miliónoch s 2 desatinnými miestami — pre tabuľky s mixom veľkých a malých hodnôt.
    Zabraňuje zmiešavaniu miliónov a tisícov v jednej tabuľke.
    Ak treat_zero_as_none=True, nula sa zobrazí ako '—' (pre cash flow polia, kde 0 = chýbajúce dáta)."""
    if value is None:
        return "—"
    if treat_zero_as_none and value == 0:
        return "—"
    try:
        val = float(value)
        return f"{val / 1_000_000:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ")
    except (ValueError, TypeError):
        return "—"

def format_cf_millions(value: float) -> str:
    """Wrapper pre format_number_millions s treat_zero_as_none=True.
    Pre cash flow polia: 0 znamená chýbajúce dáta, nie nulový cash flow."""
    return format_number_millions(value, treat_zero_as_none=True)

def generate_financial_chart(statements) -> str:
    """
    Vygeneruje Matplotlib graf (Tržby vs. Zisk) v Corporate Minimalist štýle
    a vráti base64 string.
    """
    if not statements or len(statements) < 2:
        return ""
        
    # Zoradiť chronologicky (od najstaršieho po najnovší)
    statements = sorted(statements, key=lambda x: x.year)
    
    years = [str(s.year) for s in statements]
    revenues = [s.mainActivityRevenue or 0 for s in statements]
    profits = [s.netProfitLoss or 0 for s in statements]
    
    # Nastavenie Corporate Minimalist štýlu (seaborn)
    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(8, 4), dpi=150)
    
    # Kreslenie čiar
    ax.plot(years, revenues, marker='o', color='#1e293b', linewidth=2.5, markersize=8, label='Tržby')
    ax.plot(years, profits, marker='s', color='#3b82f6', linewidth=2.5, markersize=8, label='Čistý Zisk / Strata')
    
    # Formátovanie osí
    ax.set_ylabel('Suma v EUR', fontsize=10, color='#64748b', fontweight='bold')
    ax.tick_params(axis='x', colors='#64748b')
    ax.tick_params(axis='y', colors='#64748b')
    
    # Odstránenie horného a pravého okraja pre čistejší vzhľad
    sns.despine(left=True, bottom=True)
    
    ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=9, labelcolor='#475569')
    ax.set_title('Vývoj Tržieb a Zisku', fontsize=12, fontweight='bold', color='#0f172a', pad=15)
    
    # Formát y-osi na milióny/tisíce
    def currency_formatter(x, pos):
        if x >= 1e6:
            return f'{x*1e-6:.1f}M'
        elif x >= 1e3:
            return f'{x*1e-3:.0f}k'
        return f'{x:.0f}'
        
    ax.yaxis.set_major_formatter(FuncFormatter(currency_formatter))
    
    plt.tight_layout()
    
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

def generate_balance_sheet_chart(statements) -> str:
    """
    Vygeneruje Matplotlib graf pre štruktúru: Aktíva, Dlh a Vlastné imanie.
    """
    if not statements or len(statements) < 2:
        return ""
        
    # Zoradiť chronologicky
    statements = sorted(statements, key=lambda x: x.year)
    
    years = [str(s.year) for s in statements]
    assets = [s.totalAssets or 0 for s in statements]
    equity = [s.equity or 0 for s in statements]
    debt = [((s.shortTermLiabilities or 0) + (s.longTermLiabilities or 0)) for s in statements]
    
    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(8, 4), dpi=150)
    
    ax.plot(years, assets, marker='D', color='#94a3b8', linewidth=2, markersize=6, label='Celkové Aktíva', linestyle='--')
    ax.plot(years, debt, marker='^', color='#e11d48', linewidth=2.5, markersize=8, label='Celkový Dlh')
    ax.plot(years, equity, marker='s', color='#10b981', linewidth=2.5, markersize=8, label='Vlastné Imanie')
    
    ax.set_ylabel('Suma v EUR', fontsize=10, color='#64748b', fontweight='bold')
    ax.tick_params(axis='x', colors='#64748b')
    ax.tick_params(axis='y', colors='#64748b')
    
    sns.despine(left=True, bottom=True)
    
    ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=9, labelcolor='#475569')
    ax.set_title('Štruktúra majetku a zdrojov', fontsize=12, fontweight='bold', color='#0f172a', pad=15)
    
    def currency_formatter(x, pos):
        if abs(x) >= 1_000_000:
            return f'{x/1_000_000:.1f}M'
        elif abs(x) >= 1_000:
            return f'{x/1_000:.0f}k'
        return str(int(x))
        
    ax.yaxis.set_major_formatter(FuncFormatter(currency_formatter))
    
    plt.tight_layout()
    
    # Uloženie do pamäte ako base64
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')


def generate_pnl_chart(statements) -> str:
    """Vygeneruje stĺpcový graf: Tržby, Hrubá marža, Čistý zisk za roky."""
    if not statements or len(statements) < 2:
        return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    revenues = [s.mainActivityRevenue or 0 for s in statements]
    gross = [s.grossProfit or 0 for s in statements]
    ebitda = [(s.netProfitLoss or 0) + abs(s.interestExpense or 0) + (s.depreciation or 0) for s in statements]
    net = [s.netProfitLoss or 0 for s in statements]

    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(8, 3.5), dpi=150)
    x = np.arange(len(years))
    w = 0.2
    ax.bar(x - 1.5*w, revenues, w, color='#1e293b', label='Tržby')
    ax.bar(x - 0.5*w, gross, w, color='#3b82f6', label='Hrubá marža')
    ax.bar(x + 0.5*w, ebitda, w, color='#f59e0b', label='EBITDA')
    net_colors = ['#10b981' if v >= 0 else '#ef4444' for v in net]
    ax.bar(x + 1.5*w, net, w, color=net_colors)
    ax.set_xticks(x)
    ax.set_xticklabels(years)
    ax.set_ylabel('EUR', fontsize=10, color='#64748b', fontweight='bold')
    ax.tick_params(axis='x', colors='#64748b')
    ax.tick_params(axis='y', colors='#64748b')
    sns.despine(left=True, bottom=True)
    legend_handles = [
        Patch(facecolor='#1e293b', label='Tržby'),
        Patch(facecolor='#3b82f6', label='Hrubá marža'),
        Patch(facecolor='#f59e0b', label='EBITDA'),
        Patch(facecolor='#10b981', label='Čistý zisk'),
        Patch(facecolor='#ef4444', label='Čistá strata'),
    ]
    ax.legend(handles=legend_handles, loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=8, labelcolor='#475569')
    ax.set_title('Výkaz ziskov a strát', fontsize=12, fontweight='bold', color='#0f172a', pad=12)
    def _fmt(x, pos):
        if abs(x) >= 1e6: return f'{x/1e6:.1f}M'
        if abs(x) >= 1e3: return f'{x/1e3:.0f}k'
        return f'{x:.0f}'
    ax.yaxis.set_major_formatter(FuncFormatter(_fmt))
    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def generate_cashflow_chart(statements) -> str:
    """Vygeneruje graf: Prevádzkový cash flow a Cash balance za roky.
    Ak nie sú k dispozícii žiadne CF dáta (všetky 0/None), vráti prázdny string —
    graf sa nezobrazí a v template sa ukáže disclaimer o nedostupnosti dát."""
    if not statements or len(statements) < 2:
        return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    ocf_raw = [s.operatingCashFlow for s in statements]
    # Ak sú všetky CF hodnoty None alebo 0, dáta nie sú k dispozícii
    if all(v is None or v == 0 for v in ocf_raw):
        return ""
    ocf = [v or 0 for v in ocf_raw]
    icf = [s.investingCashFlow or 0 for s in statements]
    fcf = [s.financingCashFlow or 0 for s in statements]
    cash = [s.cashAndEquivalents or 0 for s in statements]

    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(8, 3.5), dpi=150)
    
    pos_bottom = np.zeros(len(years))
    neg_bottom = np.zeros(len(years))
    
    for cf_data, color in [
        (ocf, '#10b981'),
        (icf, '#ef4444'),
        (fcf, '#6366f1')
    ]:
        for i, val in enumerate(cf_data):
            if val >= 0:
                ax.bar(years[i], val, color=color, bottom=pos_bottom[i])
                pos_bottom[i] += val
            else:
                ax.bar(years[i], val, color=color, bottom=neg_bottom[i])
                neg_bottom[i] += val
                
    ax.plot(years, cash, marker='D', color='#1e293b', linewidth=2, markersize=7, label='Cash & ekvivalenty', linestyle='--')
    
    ax.set_ylabel('EUR', fontsize=10, color='#64748b', fontweight='bold')
    ax.tick_params(axis='x', colors='#64748b')
    ax.tick_params(axis='y', colors='#64748b')
    sns.despine(left=True, bottom=True)
    
    legend_handles = [
        Patch(facecolor='#10b981', label='Prevádzkový CF'),
        Patch(facecolor='#ef4444', label='Investičný CF'),
        Patch(facecolor='#6366f1', label='Finančný CF'),
        Line2D([0], [0], color='#1e293b', linestyle='--', marker='D', markersize=7, label='Cash & ekvivalenty', linewidth=2),
    ]
    ax.legend(handles=legend_handles, loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=8, labelcolor='#475569')
    ax.set_title('Peňažné toky a likvidita', fontsize=12, fontweight='bold', color='#0f172a', pad=12)
    def _fmt(x, pos):
        if abs(x) >= 1e6: return f'{x/1e6:.1f}M'
        if abs(x) >= 1e3: return f'{x/1e3:.0f}k'
        return f'{x:.0f}'
    ax.yaxis.set_major_formatter(FuncFormatter(_fmt))
    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

def generate_liquidity_chart(statements) -> str:
    """Vygeneruje graf likvidity: Pracovný kapitál (stĺpce) a Ratios (čiary)."""
    if not statements or len(statements) < 2:
        return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    
    wc = [(s.currentAssets or 0) - (s.shortTermLiabilities or 0) for s in statements]
    cr = [(s.currentAssets or 0) / (s.shortTermLiabilities or 1) for s in statements]
    qr = [((s.currentAssets or 0) - (s.inventory or 0)) / (s.shortTermLiabilities or 1) for s in statements]

    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax1 = plt.subplots(figsize=(6, 3), dpi=150)
    
    ax1.bar(years, wc, color='#94a3b8', alpha=0.6, label='Pracovný kapitál')
    ax1.set_ylabel('Pracovný kap. (EUR)', fontsize=9, color='#64748b', fontweight='bold')
    
    ax2 = ax1.twinx()
    ax2.plot(years, cr, marker='o', color='#3b82f6', linewidth=2.0, markersize=6, label='Current Ratio')
    ax2.plot(years, qr, marker='D', color='#10b981', linewidth=2.0, markersize=6, label='Quick Ratio')
    ax2.axhline(1.0, color='#ef4444', linestyle='--', linewidth=1, alpha=0.5)
    ax2.set_ylabel('Ratio', fontsize=9, color='#64748b', fontweight='bold')
    
    ax1.tick_params(axis='x', colors='#64748b', labelsize=8)
    ax1.tick_params(axis='y', colors='#64748b', labelsize=8)
    ax2.tick_params(axis='y', colors='#64748b', labelsize=8)
    sns.despine(left=False, right=False, bottom=True)
    
    legend_handles = [
        Patch(facecolor='#94a3b8', alpha=0.6, label='Pracovný kapitál'),
        Line2D([0], [0], color='#3b82f6', marker='o', markersize=6, label='Current Ratio', linewidth=2.0),
        Line2D([0], [0], color='#10b981', marker='D', markersize=6, label='Quick Ratio', linewidth=2.0),
    ]
    ax1.legend(handles=legend_handles, loc='upper left', bbox_to_anchor=(1.10, 1), frameon=False, fontsize=8, labelcolor='#475569')
    ax1.set_title('Likvidita a Pracovný kapitál', fontsize=10, fontweight='bold', color='#0f172a', pad=12)
    
    def _fmt(x, pos):
        if abs(x) >= 1e6: return f'{x/1e6:.1f}M'
        if abs(x) >= 1e3: return f'{x/1e3:.0f}k'
        return f'{x:.0f}'
    ax1.yaxis.set_major_formatter(FuncFormatter(_fmt))
    
    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

def generate_altman_chart(altman_scores) -> str:
    """Vygeneruje čiarový graf vývoja Altman Z″-Score s farebnými zónami."""
    if not altman_scores or len(altman_scores) < 2:
        return ""
    valid = [z for z in altman_scores if z.get("z_score") is not None]
    if len(valid) < 2:
        return ""
    valid = sorted(valid, key=lambda z: z["year"])
    years = [str(z["year"]) for z in valid]
    scores = [z["z_score"] for z in valid]

    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(6, 3), dpi=150)

    # Farebné zóny
    ax.axhspan(2.6, ax.get_ylim()[1] if ax.get_ylim()[1] > 2.6 else max(scores) * 1.2, color="#10b981", alpha=0.08, zorder=0)
    ax.axhspan(1.1, 2.6, color="#f59e0b", alpha=0.08, zorder=0)
    ax.axhspan(0, 1.1, color="#ef4444", alpha=0.08, zorder=0)

    # Čiara skóre
    ax.plot(range(len(years)), scores, marker='o', color='#1e293b', linewidth=2.0, markersize=6, zorder=3)
    for i, (yr, sc) in enumerate(zip(years, scores)):
        color = '#10b981' if sc > 2.6 else '#f59e0b' if sc >= 1.1 else '#ef4444'
        ax.scatter(i, sc, color=color, s=50, zorder=4)
        ax.annotate(f"{sc:.2f}", (i, sc), textcoords="offset points", xytext=(0, 8), ha='center', fontsize=8, fontweight='bold', color=color)

    y_min, y_max = ax.get_ylim()
    ax.set_ylim(y_min, y_max + (y_max - y_min) * 0.1)

    ax.set_xticks(range(len(years)))
    ax.set_xticklabels(years, fontsize=8, color='#64748b')

    ax.axhline(y=2.6, color='#10b981', linestyle='--', linewidth=0.8, alpha=0.5)
    ax.axhline(y=1.1, color='#ef4444', linestyle='--', linewidth=0.8, alpha=0.5)

    ax.set_ylabel("Z″-Score", fontsize=9, color='#64748b', fontweight='bold')
    ax.tick_params(axis='x', colors='#64748b', labelsize=8)
    ax.tick_params(axis='y', colors='#64748b', labelsize=8)
    sns.despine(left=True, bottom=True)
    ax.set_title("Altman Z″-Score trend", fontsize=10, fontweight='bold', color='#0f172a', pad=12)
    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

def sanitize_llm_text(text: str) -> str:
    """Sanitizuje LLM generovaný text pre PDF rendering.
    - Odstráni LaTeX $...$ syntax a nahradí ju plain textom
    - Opraví časté preklepy slovenských slov
    - Konvertuje Unicode znaky, ktoré by sa mohli skomiť
    """
    if not text:
        return text
    # LaTeX $...$ → plain text (zachová vnútro)
    text = re.sub(r'\$([^$]+)\$', r'\1', text)
    # LaTeX ^{...} a _{...} → plain text
    text = re.sub(r'\^[\{]([^}]+)[\}]', r'\1', text)
    text = re.sub(r'\^\{([^}]+)\}', r'\1', text)
    text = re.sub(r'\\prime\\prime', "''", text)
    text = re.sub(r"\\prime", "'", text)
    text = re.sub(r"\\pm", "+/-", text)
    text = re.sub(r"\\times", "x", text)
    text = re.sub(r"\\leq", "<=", text)
    text = re.sub(r"\\geq", ">=", text)
    text = re.sub(r"\\neq", "!=", text)
    text = re.sub(r"\\approx", "~", text)
    # Bežné preklepy z LLM
    text = text.replace("dižnik", "dlžník").replace("dižníkov", "dlžníkov")
    text = text.replace("bezúhonnost", "bezúhonnosť")
    text = text.replace("Interpretica", "Interpretácia")
    text = text.replace("Rezpečná", "Bezpečná")
    return text

def format_findings(source) -> str:
    raw = source.findings or source.message or "Bez záznamu."
    raw = sanitize_llm_text(raw)
    max_chars = 350
    if len(raw) > max_chars:
        truncated = raw[:max_chars]
        last_nl = truncated.rfind("\n")
        if last_nl > 100:
            truncated = truncated[:last_nl]
        raw = truncated + "\n… (ďalšie záznamy v PDF výpise)"
        
    findings = xml_escape(raw)
    findings = findings.replace("\n", "<br/>")
    
    findings = re.sub(
        r'(https?://[^\s&lt;&gt;]+)',
        r'<a href="\1" class="text-blue-600 hover:underline">[Zobraziť detail]</a>',
        findings,
    )
    
    _KEY_PATTERN = re.compile(
        r'(?m)^(Oprávnený|Povinný|Sídlo|IČO|DIČ|Predmet|Dátum|Stav|'
        r'Typ|Spoločnosť|Meno|Priezvisko|Dátum narodenia|'
        r'Vyrubená daň|Daňová strata|Spoľahlivosť|'
        r'Exekútor|Spôsob|Predmet exekúcie|'
        r'Záložný veriteľ|Záložný dlžník|Predmet záložného práva|'
        r'Dražobník|Dražba|Najvyššie prihodenie|'
        r'Prihlasovateľ|Značka|Registračné číslo|'
        r'Účastník konania|Dôvod diskvalifikácie|'
        r'Rozhodnutie|Súd|Spisová značka|Dátum právoplatnosti'
        r')\s*:',
    )
    findings = _KEY_PATTERN.sub(r'<b>\1:</b>', findings)
    
    is_info_source = source.source_type in {"CRZ", "RPVS", "UVO", "REGISTER_UZ"}
    if "POZOR" in findings:
        if is_info_source:
            findings = findings.replace("POZOR!", '<span class="text-blue-600 font-bold">INFO:</span>')
            findings = findings.replace("POZOR:", '<span class="text-blue-600 font-bold">INFO:</span>')
            findings = findings.replace("POZOR", '<span class="text-blue-600 font-bold">INFO</span>')
        else:
            findings = findings.replace("POZOR!", '<span class="text-rose-600 font-bold">POZOR!</span>')
            findings = findings.replace("POZOR:", '<span class="text-rose-600 font-bold">POZOR:</span>')
            findings = findings.replace("POZOR", '<span class="text-rose-600 font-bold">POZOR</span>')
            
    findings = re.sub(r'vysoko spoľahlivý', r'<span class="text-emerald-600 font-bold">\g<0></span>', findings)
    findings = re.sub(r'menej spoľahlivý', r'<span class="text-rose-600 font-bold">\g<0></span>', findings)
    findings = re.sub(r'(?<!vysoko )(?<!menej )spoľahlivý', r'<span class="text-amber-500 font-bold">\g<0></span>', findings)
    findings = re.sub(r'Vyrubená daň:\s*(?!0[.,]00)([\d.,]+\s*EUR)', r'<span class="text-emerald-600 font-bold">Vyrubená daň: \1</span>', findings)
    findings = re.sub(r'Daňová strata:\s*(?!0[.,]00)([\d.,]+\s*EUR)', r'<span class="text-rose-600 font-bold">Daňová strata: \1</span>', findings)
    
    return findings


def generate_ratios_trend_chart(trend_ratios: list) -> str:
    """Vygeneruje trend graf pre ROA, ROE a čistú maržu cez roky."""
    if not trend_ratios or len(trend_ratios) < 2:
        return ""

    years = [t["year"] for t in trend_ratios]
    roa = [t.get("roa_pct") for t in trend_ratios]
    roe = [t.get("roe_pct") for t in trend_ratios]
    margin = [t.get("net_profit_margin_pct") for t in trend_ratios]

    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(6, 3), dpi=150)

    style_cfg = {'marker': 'o', 'markersize': 6, 'linewidth': 2.0}
    ax.plot(years, roa, color='#10b981', label='ROA', **style_cfg)
    ax.plot(years, roe, color='#3b82f6', label='ROE', **style_cfg)
    ax.plot(years, margin, color='#f59e0b', label='Čistá marža', **style_cfg)

    ax.set_xticks(years)
    ax.set_xticklabels([str(y) for y in years], fontsize=8, color='#64748b')
    ax.set_xlabel('')
    ax.set_ylabel('Percentá (%)', fontsize=9, color='#64748b', fontweight='bold')
    ax.tick_params(axis='both', labelsize=8, colors='#64748b')
    sns.despine(left=True, bottom=True)
    ax.axhline(y=0, color='#cbd5e1', linewidth=0.8, linestyle='--')
    
    legend_handles = [
        Line2D([0], [0], color='#10b981', marker='o', markersize=6, label='ROA', linewidth=2.0),
        Line2D([0], [0], color='#3b82f6', marker='o', markersize=6, label='ROE', linewidth=2.0),
        Line2D([0], [0], color='#f59e0b', marker='o', markersize=6, label='Čistá marža', linewidth=2.0),
    ]
    ax.legend(handles=legend_handles, fontsize=8, loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, labelcolor='#475569')
    ax.set_title('Trend rentability', fontsize=10, fontweight='bold', color='#0f172a', pad=12)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def generate_radar_chart(pillars: list) -> str:
    """Vygeneruje radar/spider chart pre 5 pilierov Verifa Score."""
    if not pillars or len(pillars) < 3:
        return ""

    labels = [p["name"].split("—")[0].strip()[:18] for p in pillars]
    scores = [p["score"] for p in pillars]
    max_scores = [p["max_score"] if p["max_score"] > 0 else 1 for p in pillars]
    pcts = [s / m * 100 for s, m in zip(scores, max_scores)]

    n = len(labels)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
    pcts_closed = pcts + [pcts[0]]
    angles_closed = angles + [angles[0]]

    fig, ax = plt.subplots(figsize=(5, 5), subplot_kw=dict(polar=True))
    fig.patch.set_facecolor('white')
    fig.patch.set_alpha(0)

    ax.fill(angles_closed, pcts_closed, color='#10b981', alpha=0.15)
    ax.plot(angles_closed, pcts_closed, color='#10b981', linewidth=2)
    ax.scatter(angles, pcts, color='#10b981', s=30, zorder=5)

    ax.set_xticks(angles)
    ax.set_xticklabels(labels, fontsize=12, color='#475569', fontweight='bold')
    ax.set_ylim(0, 100)
    ax.set_yticks([20, 40, 60, 80, 100])
    ax.set_yticklabels(['20', '40', '60', '80', '100'], fontsize=10, color='#94a3b8')
    ax.tick_params(pad=12)
    ax.spines['polar'].set_color('#e2e8f0')
    ax.grid(color='#e2e8f0', linewidth=0.5)

    plt.tight_layout(pad=0.5)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def generate_debt_donut(stmt) -> str:
    """Vygeneruje donut graf kapitálovej štruktúry."""
    if not stmt:
        return ""

    equity = getattr(stmt, 'equity', None) or 0
    short_liab = getattr(stmt, 'shortTermLiabilities', None) or 0
    long_liab = getattr(stmt, 'longTermLiabilities', None) or 0

    if equity == 0 and short_liab == 0 and long_liab == 0:
        return ""

    labels = ['Vlastné imanie', 'Krátkodobé záväzky', 'Dlhodobé záväzky']
    values = [equity, short_liab, long_liab]
    colors = ['#10b981', '#f59e0b', '#ef4444']

    filtered = [(l, v, c) for l, v, c in zip(labels, values, colors) if v > 0]
    if len(filtered) < 2:
        return ""

    labels, values, colors = zip(*filtered)

    fig, ax = plt.subplots(figsize=(6, 5.5))
    fig.patch.set_facecolor('white')

    wedges, texts, autotexts = ax.pie(
        values, labels=None, colors=colors, autopct='%1.0f%%',
        startangle=90, pctdistance=0.75,
        wedgeprops=dict(width=0.45, edgecolor='white', linewidth=2)
    )
    
    import matplotlib.patheffects as path_effects
    for t in autotexts:
        t.set_fontsize(22)
        t.set_color('white')
        t.set_fontweight('bold')
        t.set_path_effects([path_effects.withStroke(linewidth=2, foreground='#0f172a')])

    ax.legend(wedges, labels, fontsize=20, loc='upper center', frameon=False,
              bbox_to_anchor=(0.5, -0.05), ncol=1, labelspacing=1.2, handletextpad=0.8)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def prepare_report_context(company, sources, start_pages_map, total_pages, generated_at):
    verdict = company.auditVerdict
    if company.financialStatements:
        company.financialStatements = sorted(company.financialStatements, key=lambda s: s.year, reverse=True)[:5]
    stmts = company.financialStatements
    # Sanitizácia: 0 pre cash flow polia = chýbajúce dáta (artefakt starého LLM promptu)
    for stmt in (stmts or []):
        sanitize_cash_flow_fields(stmt)
    # Fallback: ak grossProfit chýba (extrakcia zlyhala), vypočítaj ako prevádzkový zisk
    # Používa sa pre IFRS/SK GAAP by-function výkazy kde gross profit nie je explicitne uvedený
    # Výpočet: revenue - (staffCosts + depreciation + interestExpense) ≈ approx operating profit
    # Vyžaduje všetky 3 nákladové položky — ak niektorá chýba, fallback sa nevykoná
    gross_profit_estimated = False
    estimated_gp_years = set()
    for stmt in (stmts or []):
        if getattr(stmt, 'grossProfit', None) is None:
            revenue = getattr(stmt, 'mainActivityRevenue', None)
            staff = getattr(stmt, 'staffCosts', None)
            depreciation = getattr(stmt, 'depreciation', None)
            interest = getattr(stmt, 'interestExpense', None)
            if revenue and revenue > 0 and staff is not None and depreciation is not None and interest is not None:
                estimated = revenue - staff - depreciation - interest
                # Sanity check: fallback nesmie byť záporný ani > 100% tržieb
                if 0 < estimated <= revenue:
                    stmt.grossProfit = estimated
                    estimated_gp_years.add(stmt.year)
                    gross_profit_estimated = True
    # Ak sú VŠETKY hodnoty grossProfit odhadnuté (žiadny rok nemá reálnu hrubú maržu),
    # môžeme premenovať celý riadok. Inak ostáva "Hrubá marža" a odhadnuté bunky sa označia.
    _gp_years = [s for s in (stmts or []) if getattr(s, 'grossProfit', None) is not None]
    gross_profit_all_estimated = bool(_gp_years) and all(s.year in estimated_gp_years for s in _gp_years)

    # Fallback: ak operatingCashFlow chýba (zjednodušený výkaz bez CF), vypočítaj nepriamou metódou
    # Operating CF ≈ Net Profit + Depreciation - ΔInventory - ΔTrade Receivables + ΔTrade Payables
    cashflow_estimated = estimate_missing_cash_flow(stmts or [])
    latest_stmt = max(stmts, key=lambda s: s.year) if stmts else None
    vestnik_events = company.vestnikEvents or []
    
    # Zoradené výkazy pre tabuľky (od najstaršieho)
    stmts_sorted = sorted(stmts, key=lambda s: s.year) if stmts else []
    
    # Najnovšie finančné pomery pre karty v reporte
    latest_ratios = {}
    if latest_stmt:
        latest_ratios = compute_financial_ratios(latest_stmt)
    
    # NACE info
    nace_code = getattr(company, 'naceCode', None)
    nace_text = getattr(company, 'naceText', None)
    
    # Počet zamestnancov z najnovšieho výkazu (alebo odhad z staffCosts)
    employee_count = getattr(latest_stmt, 'employeeCount', None) if latest_stmt else None
    if not employee_count and latest_stmt:
        staff_costs = getattr(latest_stmt, 'staffCosts', 0) or 0
        if staff_costs > 0:
            employee_count = max(1, round(staff_costs / 12000))  # odhad: priemerná ročná mzda ~12k €
    
    # Tržby na zamestnanca
    revenue_per_employee = None
    if latest_stmt and employee_count and employee_count > 0:
        rev = getattr(latest_stmt, 'mainActivityRevenue', None)
        if rev and rev > 0:
            revenue_per_employee = round(rev / employee_count)

    # Vygenerovanie grafov
    chart_base64 = ""
    balance_chart_base64 = ""
    has_mixed_consolidation = False
    has_non_standard_months = False
    
    if stmts:
        is_cons_set = set(getattr(s, 'isConsolidated', False) for s in stmts)
        if len(is_cons_set) > 1:
            has_mixed_consolidation = True
            
        for s in stmts:
            months = getattr(s, 'monthsInPeriod', 12)
            if months is not None and months != 12:
                has_non_standard_months = True
                break

    has_short_history = bool(stmts) and len(stmts) < 2

    if stmts and len(stmts) >= 2:
        chart_base64 = generate_financial_chart(stmts)
        balance_chart_base64 = generate_balance_sheet_chart(stmts)
        pnl_chart_base64 = generate_pnl_chart(stmts)
        cashflow_chart_base64 = generate_cashflow_chart(stmts)
    else:
        pnl_chart_base64 = ""
        cashflow_chart_base64 = ""
    
    # Načítanie Verifa loga
    current_dir = Path(__file__).parent
    logo_path = current_dir.parent.parent / "frontend" / "public" / "logo-verifa.png"
    logo_base64 = ""
    if logo_path.exists():
        with open(logo_path, "rb") as lf:
            logo_base64 = base64.b64encode(lf.read()).decode('utf-8')
            
    counts = {"SUCCESS": 0, "WARNING": 0, "INFO": 0, "FAILED": 0, "UNAVAILABLE": 0}
    if sources:
        for s in sources:
            findings = (s.findings or s.message or "").upper()
            if "POZOR" in findings:
                if s.source_type in {"CRZ", "RPVS", "UVO", "REGISTER_UZ"}:
                    counts["INFO"] += 1
                else:
                    counts["WARNING"] += 1
            elif s.status == "SUCCESS":
                counts["SUCCESS"] += 1
            elif s.status in counts:
                counts[s.status] += 1
            else:
                counts["FAILED"] += 1
                
    source_map = {s.source_type: s for s in sources} if sources else {}
    
    # Sídlo (mesto) a rok vzniku z RPO findings
    company_city = None
    company_founded_year = None
    if "RPO" in source_map:
        rpo_findings = source_map["RPO"].findings or ""
        addr_match = re.search(r'Adresa sídla:\s*(.+)', rpo_findings)
        if addr_match:
            addr = addr_match.group(1).strip()
            parts = addr.split(',')
            if parts:
                last_part = parts[-1].strip()
                city = re.sub(r'^\d{3}\s?\d{2}\s*', '', last_part).strip()
                if city:
                    company_city = city
        vznik_match = re.search(r'Dátum vzniku:\s*(\d{1,2}\.\d{1,2}\.(\d{4})|\d{4})', rpo_findings)
        if vznik_match:
            year_str = vznik_match.group(2) if vznik_match.group(2) else vznik_match.group(1)
            try:
                company_founded_year = int(year_str)
            except ValueError:
                pass
    # Fallback 1: Sídlo z ORSR
    if not company_city and "ORSR" in source_map:
        orsr_findings = source_map["ORSR"].findings or ""
        addr_match = re.search(r'Sídlo:\s*([^\r\n]*)\r?\n\s*([^\r\n]+)', orsr_findings)
        if addr_match:
            line2 = addr_match.group(2).strip()
            city_part = line2.split('-')[0].split(',')[0].strip()
            city = re.sub(r'^\d{3}\s?\d{2}\s*', '', city_part)
            city = re.sub(r'\s*\d{3}\s?\d{2}\s*$', '', city).strip()
            if city:
                company_city = city

    # Fallback 2: mesto z company.name (formát "Firma s.r.o. (Bratislava)")
    if not company_city and company.name:
        name_city_match = re.search(r'\(([^)]+)\)', company.name)
        if name_city_match:
            company_city = name_city_match.group(1).strip()

    grouped_sources = []
    rendered_types = set()
    for cat_name, types in SOURCE_CATEGORIES:
        cat_sources = [source_map[t] for t in types if t in source_map]
        if cat_sources:
            grouped_sources.append((cat_name, cat_sources))
            rendered_types.update(types)
            
    other_sources = [s for s in (sources or []) if s.source_type not in rendered_types]
    if other_sources:
        grouped_sources.append(("Ostatné", other_sources))
        
    evidence_list = []
    try:
        if verdict and verdict.justification:
            raw_list = json.loads(verdict.justification)
            for item in raw_list:
                # Premapuj anglické kľúče z DB na slovenské, ktoré šablóny očakávajú
                if "claim" in item and "tvrdenie" not in item:
                    item["tvrdenie"] = item["claim"]
                if "evidence" in item and "dokaz" not in item:
                    item["dokaz"] = item["evidence"]
                if "source" in item and "zdroj" not in item:
                    item["zdroj"] = item["source"]
                z = item.get("zdroj", "")
                if "profit_trend" in z: z = "Finančná analýza (Trend zisku)"
                elif "ratios_by_year" in z: z = "Finančná analýza (Ukazovatele)"
                elif "altman_z_scores" in z: z = "Finančná analýza (Altman Z″)"
                elif "financialStatements" in z: z = "Účtovná závierka (RÚZ)"
                elif "sp_dlznici" in z: z = "Sociálna poisťovňa (dlhy)"
                elif "vszp_dlznici" in z or "union_dlznici" in z: z = "Zdravotné poisťovne (dlhy)"
                elif "fs_danove" in z: z = "Finančná správa"
                elif "insolvency" in z: z = "Register úpadcov"
                elif "orsr" in z: z = "Obchodný register (ORSR)"
                item["zdroj"] = z
            evidence_list = raw_list
    except Exception as e:
        logger.warning(f"Nepodarilo sa naparsovať evidence z verdict.justification: {e}")

    scorecard_breakdown = []
    algorithmic_total = 0
    # Uprednostni uložený scorecardBreakdown z verdiktu — bol počítaný z raw dát
    # a zodpovedá uloženému verifaScore. Prepočet len ako fallback keď chýba.
    stored_breakdown = getattr(verdict, "scorecardBreakdown", None) if verdict else None
    if stored_breakdown:
        scorecard_breakdown = stored_breakdown
        algorithmic_total = sum(p.get("score", 0) for p in stored_breakdown)
    elif stmts:
        company_dict_for_scoring = {
            "vestnikEvents": [
                {"eventType": e.eventType, "severityLevel": getattr(e, "severityLevel", None)}
                for e in vestnik_events
            ],
            "financialStatements": stmts,
        }
        trends_for_scoring = compute_financial_trends(stmts)
        sc_result = compute_forensic_scorecard(company_dict_for_scoring, trends_for_scoring)
        algorithmic_total = sc_result.total_score
        scorecard_breakdown = [
            {"name": p.name, "score": p.score, "max_score": p.max_score, "detail": p.detail, "flags": p.flags}
            for p in sc_result.pillars
        ]

    # Vypnutie Altman Z-Score pre finančné inštitúcie (NACE 64, 65, 66) alebo "banka"/"poisťovňa" v názve
    is_financial_institution = False
    if company.naceCode and company.naceCode.startswith(("64", "65", "66")):
        is_financial_institution = True
    elif company.name and re.search(r'\bbanka\b|\bpoisťovňa\b', company.name.lower()):
        is_financial_institution = True

    # Startup detekcia — pre pre-revenue firmy s veľkým imaním
    sorted_stmts_for_startup = sorted(stmts or [], key=lambda s: s.year)
    startup_info = detect_startup_profile(sorted_stmts_for_startup)
    is_startup = startup_info.get("is_startup", False)

    if is_financial_institution:
        altman_scores = []
    elif is_startup:
        altman_scores = []
    else:
        altman_scores = sorted(
            [{"year": s.year, **compute_altman_z_score(s)} for s in (stmts or []) if s.year and s.year > 2000],
            key=lambda z: z["year"]
        )

    # Piotroski F-score
    sorted_stmts_raw = sorted(stmts or [], key=lambda s: s.year)
    piotroski_result = compute_piotroski_f_score(sorted_stmts_raw)

    # YoY rast tržieb a zisku
    yoy_revenue_growth = None
    yoy_profit_growth = None
    if len(sorted_stmts_raw) >= 2:
        curr = sorted_stmts_raw[-1]
        prev = sorted_stmts_raw[-2]
        curr_rev = getattr(curr, 'mainActivityRevenue', 0) or 0
        prev_rev = getattr(prev, 'mainActivityRevenue', 0) or 0
        curr_profit = getattr(curr, 'netProfitLoss', 0) or 0
        prev_profit = getattr(prev, 'netProfitLoss', 0) or 0
        if prev_rev > 0:
            yoy_revenue_growth = round(((curr_rev - prev_rev) / prev_rev) * 100, 1)
        if prev_profit != 0:
            yoy_profit_growth = round(((curr_profit - prev_profit) / abs(prev_profit)) * 100, 1)

    # Trend ratios pre všetky roky (pre trend graf)
    trend_ratios = []
    for s in sorted_stmts_raw:
        r = compute_financial_ratios(s)
        trend_ratios.append({
            "year": s.year,
            "roa_pct": r.get("roa_pct"),
            "roe_pct": r.get("roe_pct"),
            "net_profit_margin_pct": r.get("net_profit_margin_pct"),
            "current_ratio": r.get("current_ratio"),
            "debt_to_equity": r.get("debt_to_equity"),
        })

    # Trend graf pre ROA/ROE/maržu
    ratios_chart_base64 = ""
    if len(trend_ratios) >= 2:
        ratios_chart_base64 = generate_ratios_trend_chart(trend_ratios)

    # Radar chart pre 5 pilierov
    radar_chart_base64 = ""
    if scorecard_breakdown and len(scorecard_breakdown) >= 3:
        radar_chart_base64 = generate_radar_chart(scorecard_breakdown)

    # Auditor opinion info
    auditor_opinion = None
    if latest_stmt and getattr(latest_stmt, 'auditorOpinions', None):
        for ao in latest_stmt.auditorOpinions:
            auditor_opinion = {
                "opinion_type": getattr(ao, 'opinionType', None),
                "going_concern_risk": getattr(ao, 'goingConcernRisk', None),
                "reservation_text": getattr(ao, 'reservationText', None),
                "auditor_name": getattr(ao, 'auditorName', None),
            }
            break

    # Gauge arc endpoint for cover page score gauge
    score_val = verdict.verifaScore if verdict else 0
    arc_angle = (score_val / 100.0) * 180
    rad = (180 - arc_angle) * math.pi / 180.0
    gx, gy, gr = 100, 100, 80
    gauge_end_x = round(gx + gr * math.cos(rad), 2)
    gauge_end_y = round(gy - gr * math.sin(rad), 2)
    gauge_large_arc = 1 if arc_angle > 180 else 0

    # Cash flow waterfall + debt donut + balance sheet infographic
    cf_waterfall_base64 = generate_cashflow_waterfall(latest_stmt) if latest_stmt else ""
    debt_donut_base64 = generate_debt_donut(latest_stmt) if latest_stmt else ""
    bs_infographic_base64 = generate_balance_sheet_infographic(latest_stmt) if latest_stmt else ""
    pl_infographic_base64 = generate_pl_infographic(latest_stmt) if latest_stmt else ""
    liquidity_chart_base64 = generate_liquidity_chart(stmts_sorted) if stmts_sorted else ""

    # QR code for cover page
    qr_base64 = ""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=4, border=1)
        qr.add_data(f"https://verifa.sk/reports/{company.ico}")
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color='#1e293b', back_color='white')
        qr_buf = io.BytesIO()
        qr_img.save(qr_buf, format='PNG')
        qr_base64 = base64.b64encode(qr_buf.getvalue()).decode('utf-8')
    except Exception:
        pass

    # ── Confidence score (Spoľahlivosť analýzy) ──
    confidence_factors = []
    confidence_score = 100

    # 1. Audit (±15 bodov)
    has_audit = bool(auditor_opinion)
    if has_audit:
        confidence_factors.append({"label": "Auditovaná závierka", "ok": True, "weight": 15})
    else:
        confidence_factors.append({"label": "Chýba audit", "ok": False, "weight": 15})
        confidence_score -= 15

    # 2. Úplnosť finančných výkazov (±20 bodov)
    has_full_statements = bool(stmts) and len(stmts) >= 1
    if has_full_statements:
        confidence_factors.append({"label": "Účtovná závierka dostupná", "ok": True, "weight": 20})
    else:
        confidence_factors.append({"label": "Chýbajú účtovné výkazy", "ok": False, "weight": 20})
        confidence_score -= 20

    # 3. Dĺžka histórie (±20 bodov)
    stmt_count = len(stmts) if stmts else 0
    if stmt_count >= 5:
        confidence_factors.append({"label": f"Dlhá história ({stmt_count} rokov dát)", "ok": True, "weight": 20})
    elif stmt_count >= 2:
        confidence_factors.append({"label": f"Stredná história ({stmt_count} roky dát)", "ok": True, "weight": 10})
        confidence_score -= 10
    elif stmt_count == 1:
        confidence_factors.append({"label": "Krátká história (1 rok dát)", "ok": False, "weight": 20})
        confidence_score -= 20
    else:
        confidence_factors.append({"label": "Žiadne finančné dáta", "ok": False, "weight": 20})
        confidence_score -= 20

    # 4. Pokrytie registrov (±25 bodov)
    total_sources = sum(counts.values()) if counts else 0
    failed_sources = counts.get("FAILED", 0) + counts.get("UNAVAILABLE", 0)
    if total_sources > 0:
        success_ratio = (total_sources - failed_sources) / total_sources
        if success_ratio >= 0.9:
            confidence_factors.append({"label": "Všetky registre dostupné", "ok": True, "weight": 25})
        elif success_ratio >= 0.6:
            confidence_factors.append({"label": f"Čiastočne dostupné registre ({int(success_ratio*100)}%)", "ok": True, "weight": 15})
            confidence_score -= 10
        else:
            confidence_factors.append({"label": f"Obmedzené registre ({int(success_ratio*100)}%)", "ok": False, "weight": 25})
            confidence_score -= 25
    else:
        confidence_factors.append({"label": "Žiadne zdroje dát", "ok": False, "weight": 25})
        confidence_score -= 25

    # 5. LLM analýza (±20 bodov)
    llm_status = getattr(verdict, 'llmAnalysisStatus', None) if verdict else None
    if llm_status and llm_status != 'FALLBACK_ALGORITHMIC':
        confidence_factors.append({"label": "Systémová analýza dokončená", "ok": True, "weight": 20})
    else:
        confidence_factors.append({"label": "Systémová analýza nedostupná (fallback)", "ok": False, "weight": 20})
        confidence_score -= 20

    confidence_score = max(0, min(100, confidence_score))

    # Valid until date (90 days from generation)
    from datetime import datetime, timedelta
    valid_until = (datetime.now() + timedelta(days=90)).strftime('%d.%m.%Y')

    return {
        "company": company,
        "verdict": verdict,
        "evidence_list": evidence_list,
        "latest_stmt": latest_stmt,
        "stmts_sorted": stmts_sorted,
        "latest_ratios": latest_ratios,
        "gross_profit_estimated": gross_profit_estimated,
        "gross_profit_all_estimated": gross_profit_all_estimated,
        "estimated_gp_years": estimated_gp_years,
        "cashflow_estimated": cashflow_estimated,
        "nace_code": nace_code,
        "nace_text": nace_text,
        "employee_count": employee_count,
        "vestnik_events": vestnik_events,
        "chart_image_base64": chart_base64,
        "balance_chart_base64": balance_chart_base64,
        "pnl_chart_base64": pnl_chart_base64,
        "cashflow_chart_base64": cashflow_chart_base64,
        "altman_chart_base64": generate_altman_chart(altman_scores) if altman_scores else "",
        "logo_base64": logo_base64,
        "start_pages_map": start_pages_map or {},
        "total_pages": total_pages,
        "generated_at": generated_at,
        "counts": counts,
        "grouped_sources": grouped_sources,
        "labels": SOURCE_LABELS,
        "scorecard_breakdown": scorecard_breakdown,
        "algorithmic_total": algorithmic_total,
        "altman_scores": altman_scores,
        "is_financial_institution": is_financial_institution,
        "is_startup": is_startup,
        "startup_info": startup_info,
        "has_mixed_consolidation": has_mixed_consolidation,
        "has_non_standard_months": has_non_standard_months,
        "has_short_history": has_short_history,
        "piotroski_score": piotroski_result.get("score"),
        "piotroski_flags": piotroski_result.get("flags", []),
        "yoy_revenue_growth": yoy_revenue_growth,
        "yoy_profit_growth": yoy_profit_growth,
        "trend_ratios": trend_ratios,
        "ratios_chart_base64": ratios_chart_base64,
        "radar_chart_base64": radar_chart_base64,
        "auditor_opinion": auditor_opinion,
        "gauge_end_x": gauge_end_x,
        "gauge_end_y": gauge_end_y,
        "gauge_large_arc": gauge_large_arc,
        "cf_waterfall_base64": cf_waterfall_base64,
        "debt_donut_base64": debt_donut_base64,
        "bs_infographic_base64": bs_infographic_base64,
        "pl_infographic_base64": pl_infographic_base64,
        "liquidity_chart_base64": liquidity_chart_base64,
        "qr_base64": qr_base64,
        "valid_until": valid_until,
        "confidence_score": confidence_score,
        "confidence_factors": confidence_factors,
        "company_city": company_city,
        "company_founded_year": company_founded_year,
        "revenue_per_employee": revenue_per_employee,
    }

def render_html_report(context: dict) -> str:
    current_dir = Path(__file__).parent
    templates_dir = current_dir / "templates"
    font_dir = current_dir / "pdf" / "fonts"
    context['font_dir'] = str(font_dir.absolute())
    context['tailwind_dir'] = str(templates_dir.absolute())
    env = Environment(loader=FileSystemLoader(templates_dir))
    env.filters['format_currency'] = format_currency
    env.filters['format_number'] = format_number
    env.filters['format_number_millions'] = format_number_millions
    env.filters['format_cf_millions'] = format_cf_millions
    env.filters['format_findings'] = format_findings
    env.filters['sanitize_llm'] = sanitize_llm_text
    
    template = env.get_template("report_template.html")
    return template.render(**context)

async def render_pdf_via_playwright(html_content: str, pdf_path: str, ico: str):
    logger.info(f"Spúšťam Playwright pre konverziu do PDF ({pdf_path})...")
    dir_name = os.path.dirname(pdf_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
    # Unikátny názov .html — zabraňuje kolízii pri súbežných reportoch rovnakého IČO
    _base = pdf_path[:-4] if pdf_path.endswith('.pdf') else pdf_path
    html_path = os.path.abspath(f"{_base}.{os.getpid()}.{int(time.time() * 1000)}.html")
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            "--disable-gpu", "--no-sandbox",
            "--font-render-hinting=none",
        ])
        page = await browser.new_page()
        await page.goto(f"file://{html_path}", wait_until="networkidle", timeout=30000)
        try:
            await page.wait_for_function(
                "() => { const styles = document.querySelectorAll('style'); for (const s of styles) { if (s.textContent.includes('--tw') || s.textContent.includes('.container')) return true; } return false; }",
                timeout=10000
            )
        except Exception:
            logger.warning("Tailwind JIT styles neboli detekované včas — pokračujem bez čakania")
        try:
            await page.evaluate("async () => { await document.fonts.ready; }")
        except Exception:
            pass
        try:
            await page.wait_for_function(
                "() => document.fonts.check('10px Inter') && document.fonts.check('bold 10px Inter') && document.fonts.check('10px \"DejaVu Sans\"')",
                timeout=10000
            )
        except Exception:
            pass
        await page.emulate_media(media="print")
        await page.pdf(
            path=pdf_path, 
            format="A4", 
            margin={"top": "12mm", "bottom": "18mm", "left": "0mm", "right": "0mm"}, 
            print_background=True,
            display_header_footer=False,
            prefer_css_page_size=True,
        )
        await browser.close()
    try:
        os.remove(html_path)
    except Exception:
        pass
    logger.info(f"PDF úspešne vygenerované: {pdf_path}")
    return pdf_path

async def generate_forensic_pdf_report(
    ico: str, 
    sources: Optional[list] = None,
    start_pages_map: Optional[dict] = None,
    total_pages: int = 0,
    generated_at: str = "",
    target_path: str = ""
):
    logger.info(f"Generujem HTML/PDF report pre IČO: {ico}")
    db = Prisma()
    await db.connect()
    
    try:
        company = await db.company.find_unique(
            where={'ico': ico},
            include={
                'auditVerdict': True,
                'financialStatements': {'orderBy': {'year': 'asc'}, 'include': {'auditorOpinion': True, 'narrativeRisk': True, 'notesRisk': True}},
                'vestnikEvents': {'orderBy': {'publishedAt': 'desc'}}
            }
        )
        
        if not company or not company.auditVerdict:
            logger.error(f"Nedostatok dát pre generovanie PDF (IČO: {ico})")
            return None

        context = prepare_report_context(company, sources, start_pages_map, total_pages, generated_at)
        html_content = render_html_report(context)

        pdf_path = target_path or f"assets/{ico}/Verifa_Forensic_Report_{ico}.pdf"
        await render_pdf_via_playwright(html_content, pdf_path, ico)

        return pdf_path

    finally:
        await db.disconnect()


async def generate_financial_summary_pdf(ico: str, target_path: str) -> Optional[str]:
    """Vygeneruje 1-2 strany s finančným prehľadom z DB dát (FinancialStatement).
    Používa sa pre IFRS firmy, kde registeruz.sk nezobrazuje štruktúrované HTML."""
    db = Prisma()
    await db.connect()
    try:
        company = await db.company.find_unique(
            where={'ico': ico},
            include={
                'financialStatements': {
                    'orderBy': {'year': 'asc'},
                    'include': {'auditorOpinion': True},
                },
            },
        )
        if not company or not company.financialStatements:
            logger.warning(f"[FIN_SUMMARY] Žiadne finančné výkazy pre IČO {ico}")
            return None

        stmts = sorted(company.financialStatements, key=lambda s: s.year, reverse=True)[:5]
        stmts.sort(key=lambda s: s.year)
        latest = stmts[-1]
        years = [s.year for s in stmts]

        def _fmt(val) -> str:
            if val is None:
                return "—"
            return f"{float(val) / 1_000_000:,.2f} M €".replace(",", "X").replace(".", ",").replace("X", " ")

        rows_balance = [
            ("Celkové aktíva", [s.totalAssets for s in stmts]),
            ("Obežný majetok", [s.currentAssets for s in stmts]),
            ("Vlastné imanie", [s.equity for s in stmts]),
            ("Krátkodobé záväzky", [s.shortTermLiabilities for s in stmts]),
            ("Dlhodobé záväzky", [s.longTermLiabilities for s in stmts]),
            ("Pohľadávky z obch. styku", [s.tradeReceivables for s in stmts]),
            ("Záväzky z obch. styku", [s.tradePayables for s in stmts]),
        ]

        rows_pnl = [
            ("Tržby z hlavnej činnosti", [s.mainActivityRevenue for s in stmts]),
            ("Hrubá marža", [s.grossProfit for s in stmts]),
            ("Čistý zisk/strata", [s.netProfitLoss for s in stmts]),
            ("Osobné náklady", [s.staffCosts for s in stmts]),
            ("Peniaze a peňažné ekvivalenty", [s.cashAndEquivalents for s in stmts]),
            ("Prevádzkové cash flow", [s.operatingCashFlow for s in stmts]),
        ]

        def _table_rows(rows):
            html = ""
            for label, vals in rows:
                cells = "".join(f"<td style='text-align:right;padding:6px 10px;border-bottom:1px solid #e2e8f0;'>{_fmt(v)}</td>" for v in vals)
                html += f"<tr><td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#334155;'>{label}</td>{cells}</tr>"
            return html

        year_headers = "".join(f"<th style='text-align:right;padding:6px 10px;color:#64748b;font-size:11px;'>{y}</th>" for y in years)

        audit_text = ""
        if latest.auditorOpinion:
            ao = latest.auditorOpinion
            audit_text = f"<p style='font-size:11px;color:#64748b;margin-top:8px;'>Názor audítora ({latest.year}): <strong>{ao.opinionType}</strong>"
            if ao.goingConcernRisk:
                audit_text += f" — {ao.goingConcernRisk}"
            if ao.reservationText:
                audit_text += f" — {ao.reservationText}"
            audit_text += "</p>"

        stmt_type = latest.statementType or "IFRS"
        consolidated = "Konsolidovaná" if latest.isConsolidated else "Individuálna"

        font_dir = str((Path(__file__).parent / "pdf" / "fonts").absolute())
        html_content = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@font-face {{
    font-family: 'Inter';
    src: url('file://{font_dir}/Inter-Regular.ttf') format('truetype');
    font-weight: 400;
    font-display: swap;
}}
@font-face {{
    font-family: 'Inter';
    src: url('file://{font_dir}/Inter-Bold.ttf') format('truetype');
    font-weight: 700;
    font-display: swap;
}}
@font-face {{
    font-family: 'DejaVu Sans';
    src: url('file://{font_dir}/DejaVuSans.ttf') format('truetype');
    font-weight: 400;
    font-display: swap;
}}
body {{ font-family: 'Inter', 'DejaVu Sans', 'Segoe UI', system-ui, sans-serif; color: #1e293b; margin: 0; padding: 20px 30px; }}
h1 {{ font-size: 18px; color: #0f172a; margin: 0 0 4px 0; }}
h2 {{ font-size: 13px; color: #475569; margin: 20px 0 8px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }}
.meta {{ font-size: 11px; color: #94a3b8; margin-bottom: 16px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
th {{ text-align: left; padding: 6px 10px; color: #64748b; font-size: 11px; }}
.note {{ font-size: 10px; color: #94a3b8; margin-top: 12px; }}
</style></head>
<body>
<h1>Finančný prehľad — {company.name or f'Spoločnosť s IČO {ico}'}</h1>
<div class="meta">IČO: {ico} &nbsp;|&nbsp; Typ: {stmt_type} ({consolidated}) &nbsp;|&nbsp; Obdobie: {years[0]}–{years[-1]}</div>

<h2>Súvaha</h2>
<table>
<thead><tr><th style='text-align:left;padding:6px 10px;color:#64748b;font-size:11px;'>Položka (v EUR)</th>{year_headers}</tr></thead>
<tbody>{_table_rows(rows_balance)}</tbody>
</table>

<h2>Výkaz ziskov a strát</h2>
<table>
<thead><tr><th style='text-align:left;padding:6px 10px;color:#64748b;font-size:11px;'>Položka (v EUR)</th>{year_headers}</tr></thead>
<tbody>{_table_rows(rows_pnl)}</tbody>
</table>

{audit_text}
<p class="note">Zdroj: Register účtovných závierok (registeruz.sk) — údaje extrahované z IFRS PDF závierky pomocou automatizovanej analýzy textu. Štruktúrované HTML tabuľky nie sú dostupné pre IFRS účtovné jednotky.</p>
<p class="note">EBITDA = Čistý zisk + Náklady na úroky + Odpisy. Zaokrúhlenie na celé tisíce môže spôsobiť drobné odchýlky vo výpočte.</p>
</body></html>"""

        await render_pdf_via_playwright(html_content, target_path, ico)
        logger.info(f"[FIN_SUMMARY] Vygenerovaný finančný prehľad pre IČO {ico} → {target_path}")
        return target_path

    except Exception as e:
        logger.error(f"[FIN_SUMMARY] Chyba pre IČO {ico}: {e}", exc_info=True)
        return None
    finally:
        await db.disconnect()

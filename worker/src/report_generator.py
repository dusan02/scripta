import os
import asyncio
import logging
import base64
import io
from pathlib import Path

from playwright.async_api import async_playwright
from prisma import Prisma
from jinja2 import Environment, FileSystemLoader

import matplotlib.pyplot as plt
import seaborn as sns
from src.analytics import compute_altman_z_score

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
    """Naformátuje číslo ako menu (napr. 1 234 567 €). Ak je None, vráti '-'."""
    if value is None:
        return "-"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f} mil. €".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.1f} tis. €".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f} €".replace(",", " ")
    except (ValueError, TypeError):
        return "-"

def format_number(value: float) -> str:
    """Vráti číslo bez menovej prípony — pre tabuľky kde je jednotka uvedená v hlavičke."""
    if value is None:
        return "—"
    abs_val = abs(value)
    if abs_val >= 1_000_000:
        return f"{value / 1_000_000:,.1f}".replace(",", "X").replace(".", ",").replace("X", " ")
    elif abs_val >= 1_000:
        return f"{value / 1_000:,.0f}".replace(",", "X").replace(".", ",").replace("X", " ")
    return f"{value:,.0f}".replace(",", " ")

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
    revenues = [s.mainActivityRevenue for s in statements]
    profits = [s.netProfitLoss for s in statements]
    
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
    
    ax.legend(loc='upper left', frameon=False, fontsize=10, labelcolor='#475569')
    ax.set_title('Vývoj Tržieb a Zisku', fontsize=12, fontweight='bold', color='#0f172a', pad=15)
    
    # Formát y-osi na milióny/tisíce
    def currency_formatter(x, pos):
        if x >= 1e6:
            return f'{x*1e-6:.1f}M'
        elif x >= 1e3:
            return f'{x*1e-3:.0f}k'
        return f'{x:.0f}'
        
    ax.yaxis.set_major_formatter(plt.FuncFormatter(currency_formatter))
    
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
    assets = [s.totalAssets for s in statements]
    equity = [s.equity for s in statements]
    debt = [(s.shortTermLiabilities + s.longTermLiabilities) for s in statements]
    
    sns.set_theme(style="whitegrid", rc={"axes.facecolor": "#f8fafc", "figure.facecolor": "#ffffff"})
    fig, ax = plt.subplots(figsize=(8, 4), dpi=150)
    
    ax.plot(years, assets, marker='D', color='#94a3b8', linewidth=2, markersize=6, label='Celkové Aktíva', linestyle='--')
    ax.plot(years, debt, marker='^', color='#e11d48', linewidth=2.5, markersize=8, label='Celkový Dlh')
    ax.plot(years, equity, marker='s', color='#10b981', linewidth=2.5, markersize=8, label='Vlastné Imanie')
    
    ax.set_ylabel('Suma v EUR', fontsize=10, color='#64748b', fontweight='bold')
    ax.tick_params(axis='x', colors='#64748b')
    ax.tick_params(axis='y', colors='#64748b')
    
    sns.despine(left=True, bottom=True)
    
    ax.legend(loc='upper left', frameon=False, fontsize=10, labelcolor='#475569')
    ax.set_title('Štruktúra majetku a zdrojov', fontsize=12, fontweight='bold', color='#0f172a', pad=15)
    
    def currency_formatter(x, pos):
        if abs(x) >= 1_000_000:
            return f'{x/1_000_000:.1f}M'
        elif abs(x) >= 1_000:
            return f'{x/1_000:.0f}k'
        return str(int(x))
        
    ax.yaxis.set_major_formatter(plt.FuncFormatter(currency_formatter))
    
    plt.tight_layout()
    
    # Uloženie do pamäte ako base64
    buf = io.BytesIO()
    plt.savefig(buf, format='png', transparent=False)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')


import re
from xml.sax.saxutils import escape as xml_escape

def format_findings(source) -> str:
    raw = source.findings or source.message or "Bez záznamu."
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


def prepare_report_context(company, sources, start_pages_map, total_pages, generated_at):
    verdict = company.auditVerdict
    stmts = company.financialStatements
    latest_stmt = max(stmts, key=lambda s: s.year) if stmts else None
    vestnik_events = company.vestnikEvents or []
    
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

    if stmts and len(stmts) >= 2:
        chart_base64 = generate_financial_chart(stmts)
        balance_chart_base64 = generate_balance_sheet_chart(stmts)
    
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
        
    import json
    evidence_list = []
    try:
        if verdict and verdict.justification:
            raw_list = json.loads(verdict.justification)
            for item in raw_list:
                z = item.get("zdroj", "")
                if "profit_trend" in z: z = "Finančná analýza (Trend zisku)"
                elif "ratios_by_year" in z: z = "Finančná analýza (Ukazovatele)"
                elif "altman_z_scores" in z: z = "Finančná analýza (Altman Z'')"
                elif "financialStatements" in z: z = "Účtovná závierka (RÚZ)"
                elif "sp_dlznici" in z: z = "Sociálna poisťovňa (dlhy)"
                elif "vszp_dlznici" in z or "union_dlznici" in z: z = "Zdravotné poisťovne (dlhy)"
                elif "fs_danove" in z: z = "Finančná správa"
                elif "insolvency" in z: z = "Register úpadcov"
                elif "orsr" in z: z = "Obchodný register (ORSR)"
                item["zdroj"] = z
            evidence_list = raw_list
    except Exception:
        pass
        
    from src.analytics import compute_financial_trends, compute_forensic_scorecard
    scorecard_breakdown = []
    algorithmic_total = 0
    if stmts:
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
    import re
    if company.naceCode and company.naceCode.startswith(("64", "65", "66")):
        is_financial_institution = True
    elif company.name and re.search(r'\bbanka\b|\bpoisťovňa\b', company.name.lower()):
        is_financial_institution = True

    # Startup detekcia — pre pre-revenue firmy s veľkým imaním
    from src.analytics import detect_startup_profile
    sorted_stmts_for_startup = sorted(stmts or [], key=lambda s: s.year)
    startup_info = detect_startup_profile(sorted_stmts_for_startup)
    is_startup = startup_info.get("is_startup", False)

    if is_financial_institution:
        altman_scores = []
    elif is_startup:
        altman_scores = []  # Altman sa nezobrazí pre startupy — nahradené infoboxom
    else:
        altman_scores = sorted(
            [{"year": s.year, **compute_altman_z_score(s)} for s in (stmts or []) if s.year and s.year > 2000],
            key=lambda z: z["year"]
        )

    return {
        "company": company,
        "verdict": verdict,
        "evidence_list": evidence_list,
        "latest_stmt": latest_stmt,
        "vestnik_events": vestnik_events,
        "chart_image_base64": chart_base64,
        "balance_chart_base64": balance_chart_base64,
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
        "has_non_standard_months": has_non_standard_months
    }

def render_html_report(context: dict) -> str:
    current_dir = Path(__file__).parent
    templates_dir = current_dir / "templates"
    env = Environment(loader=FileSystemLoader(templates_dir))
    env.filters['format_currency'] = format_currency
    env.filters['format_number'] = format_number
    env.filters['format_findings'] = format_findings
    
    template = env.get_template("report_template.html")
    return template.render(**context)

async def render_pdf_via_playwright(html_content: str, pdf_path: str, ico: str):
    logger.info(f"Spúšťam Playwright pre konverziu do PDF ({pdf_path})...")
    dir_name = os.path.dirname(pdf_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        page = await browser.new_page()
        # domcontentloaded je rýchlejšie ako networkidle — nepotrebujeme network pre inline HTML
        await page.set_content(html_content, wait_until="domcontentloaded")
        # Aktivujeme print media — Chrome optimalizuje rendering pre tlač
        await page.emulate_media(media="print")
        header_tpl = '<div></div>'
        footer_tpl = f'<div style="font-size: 9px; color: #94a3b8; text-align: center; width: 100%; font-family: sans-serif; padding-bottom: 5px;">IČO: {ico} &nbsp;|&nbsp; Due Diligence Report &nbsp;|&nbsp; Strana <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        
        await page.pdf(
            path=pdf_path, 
            format="A4", 
            margin={"top": "0mm", "bottom": "15mm", "left": "0mm", "right": "0mm"}, 
            print_background=True,
            display_header_footer=True,
            header_template=header_tpl,
            footer_template=footer_tpl,
            prefer_css_page_size=True,
        )
        await browser.close()
    logger.info(f"PDF úspešne vygenerované: {pdf_path}")
    return pdf_path

async def generate_forensic_pdf_report(
    ico: str, 
    sources: list = None,
    start_pages_map: dict = None,
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

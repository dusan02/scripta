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
    if value is None:
        return "N/A"
    return f"{value:,.0f} €".replace(",", " ")

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
                'financialStatements': {
                    'orderBy': {'year': 'desc'},
                    'include': {
                        'auditorOpinion': True,
                        'narrativeRisk': True
                    }
                },
                'vestnikEvents': {
                    'orderBy': {'publishedAt': 'desc'}
                }
            }
        )
        
        if not company or not company.auditVerdict:
            logger.error(f"Nedostatok dát pre generovanie PDF (IČO: {ico})")
            return None
            
        verdict = company.auditVerdict
        stmts = company.financialStatements
        latest_stmt = stmts[0] if stmts else None
        vestnik_events = company.vestnikEvents or []
        
        chart_base64 = generate_financial_chart(stmts)
        
        # Načítanie Verifa loga z frontend/public
        current_dir = Path(__file__).parent
        logo_path = current_dir.parent.parent / "frontend" / "public" / "logo-verifa.png"
        logo_base64 = ""
        if logo_path.exists():
            with open(logo_path, "rb") as lf:
                logo_base64 = base64.b64encode(lf.read()).decode('utf-8')
        
        # Nastavenie Jinja2 prostredia
        templates_dir = current_dir / "templates"
        env = Environment(loader=FileSystemLoader(templates_dir))
        env.filters['format_currency'] = format_currency
        env.filters['format_findings'] = format_findings
        
        # Spočítať summary "pills" pre semafor
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
                    
        # Zoskupíme zdroje pre ľahší render v Jinja2
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
            
        template = env.get_template("report_template.html")
        
        html_content = template.render(
            company=company,
            verdict=verdict,
            latest_stmt=latest_stmt,
            vestnik_events=vestnik_events,
            chart_image_base64=chart_base64,
            logo_base64=logo_base64,
            start_pages_map=start_pages_map or {},
            total_pages=total_pages,
            generated_at=generated_at,
            counts=counts,
            grouped_sources=grouped_sources,
            labels=SOURCE_LABELS,
            altman_scores=[
                {"year": s.year, **compute_altman_z_score(s)}
                for s in (stmts or [])
                if s.year and s.year > 2000
            ],
        )

        pdf_path = target_path or f"assets/{ico}/Verifa_Forensic_Report_{ico}.pdf"
        os.makedirs(os.path.dirname(pdf_path), exist_ok=True)
        
        logger.info(f"Spúšťam Playwright pre konverziu do PDF ({pdf_path})...")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.set_content(html_content, wait_until="networkidle")
            await page.pdf(
                path=pdf_path, 
                format="A4", 
                margin={"top": "0mm", "bottom": "0mm", "left": "0mm", "right": "0mm"}, 
                print_background=True
            )
            await browser.close()
            
        logger.info(f"PDF úspešne vygenerované: {pdf_path}")
        return pdf_path
        
    finally:
        await db.disconnect()

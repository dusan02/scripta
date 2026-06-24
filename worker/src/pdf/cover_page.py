from __future__ import annotations
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.graphics.shapes import Drawing, Circle, Rect, String

from ..models import ScrapedSource


# Vizuálne ikony zdrojov — farebné badge so skratkou
_SOURCE_ICONS = {
    "ORSR": ("OR", "#2563eb"),
    "ZRSR": ("ZR", "#7c3aed"),
    "INSOLVENCY": ("RU", "#dc2626"),
    "RPVS": ("RP", "#0d9488"),
    "FINANCNA_SPRAVA": ("DD", "#ea580c"),
    "FS_DPH_RUSENIE": ("DR", "#f59e0b"),
    "FS_DPH_VYMAZANI": ("DV", "#f59e0b"),
    "FS_DANOVE_SUBJEKTY": ("DS", "#ea580c"),
    "FS_DAN_Z_PRIJMOV": ("DP", "#ea580c"),
    "FS_DPH_NADMERNY_ODPOCET": ("DN", "#f59e0b"),
    "FS_DPH_REGISTROVANI": ("DG", "#f59e0b"),
    "FS_DAN_PRIJMOV_REG": ("DPR", "#ea580c"),
    "SP_DLZNICI": ("SP", "#db2777"),
    "VSZP_DLZNICI": ("VšZP", "#2563eb"),
    "DOVERA_DLZNICI": ("Dôv", "#7c3aed"),
    "UNION_DLZNICI": ("UNI", "#0891b2"),
}

# Friendly názvy zdrojov pre cover page (raw enum je príliš dlhý pre tabuľku)
_SOURCE_LABELS = {
    "ORSR": "ORSR",
    "ZRSR": "ŽRSR",
    "INSOLVENCY": "Register úpadcov",
    "RPVS": "RPVS",
    "FINANCNA_SPRAVA": "Daň. dlžníci",
    "FS_DPH_RUSENIE": "DPH rušenie",
    "FS_DPH_VYMAZANI": "DPH vymazaní",
    "FS_DANOVE_SUBJEKTY": "Daň. spoľahlivosť",
    "FS_DAN_Z_PRIJMOV": "Daň z príjmov",
    "FS_DPH_NADMERNY_ODPOCET": "DPH nadmerný odpočet",
    "FS_DPH_REGISTROVANI": "DPH registrovaní",
    "FS_DAN_PRIJMOV_REG": "Daň z príjmov (reg.)",
    "SP_DLZNICI": "Soc. poisťovňa",
    "VSZP_DLZNICI": "VšZP",
    "DOVERA_DLZNICI": "Dôvera",
    "UNION_DLZNICI": "UNION",
}

# Zoskupenie zdrojov do kategórií pre prehľadnejšie zobrazenie
_SOURCE_CATEGORIES = [
    ("Základné firemné a podnikateľské registre", ["ORSR", "ZRSR", "RPVS"]),
    ("Insolvenčný a majetkový register", ["INSOLVENCY"]),
    ("Finančná správa SR — DPH", ["FS_DPH_RUSENIE", "FS_DPH_VYMAZANI", "FS_DPH_NADMERNY_ODPOCET", "FS_DPH_REGISTROVANI"]),
    ("Finančná správa SR — Daň z príjmov", ["FS_DAN_Z_PRIJMOV", "FS_DAN_PRIJMOV_REG"]),
    ("Finančná správa SR — Ostatné", ["FINANCNA_SPRAVA", "FS_DANOVE_SUBJEKTY"]),
    ("Poisťovne a inštitúcie", ["SP_DLZNICI", "VSZP_DLZNICI", "DOVERA_DLZNICI", "UNION_DLZNICI"]),
]

# Mapa source_type -> category label pre rýchle hľadanie
_SOURCE_TO_CATEGORY: dict[str, str] = {}
for _cat_label, _source_ids in _SOURCE_CATEGORIES:
    for _sid in _source_ids:
        _SOURCE_TO_CATEGORY[_sid] = _cat_label


class CoverPageGenerator:
    """Generuje titulnú stranu Evidence Binder so semaformi a obsahom."""

    def generate(
        self,
        output_path: Path,
        *,
        target_type: str,
        identifier: str,  # IČO alebo "Meno Priezvisko, DD.MM.RRRR"
        sources: List[ScrapedSource],
        generated_at: datetime,
        company_name: Optional[str] = None,
    ) -> None:
        fonts_dir = Path(__file__).parent / "fonts"
        pdfmetrics.registerFont(TTFont("DejaVuSans", str(fonts_dir / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", str(fonts_dir / "DejaVuSans-Bold.ttf")))
        pdfmetrics.registerFont(TTFont("Inter", str(fonts_dir / "Inter-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Inter-Bold", str(fonts_dir / "Inter-Bold.ttf")))

        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=A4,
            rightMargin=2 * cm,
            leftMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
        )
        styles = getSampleStyleSheet()

        # Override default fonts for basic styles used in table
        styles["Normal"].fontName = "Inter"
        styles["Normal"].fontSize = 9
        styles["Normal"].leading = 13
        styles["Heading2"].fontName = "Inter-Bold"

        # ── Font system ──────────────────────────────────────────────
        # Brand: 18pt bold (fits on one line with suffix)
        brand_style = ParagraphStyle(
            "Brand",
            parent=styles["Normal"],
            fontName="Inter-Bold",
            fontSize=18,
            leading=22,
            spaceAfter=0,
        )
        # Subtitle: 10pt muted, for subject info and summary
        subtitle_style = ParagraphStyle(
            "Subtitle",
            parent=styles["Normal"],
            fontName="Inter",
            fontSize=10,
            leading=14,
            spaceAfter=0.25 * cm,
            textColor=colors.HexColor("#71717a"),
        )
        # Section heading: 13pt bold
        section_style = ParagraphStyle(
            "Section",
            parent=styles["Normal"],
            fontName="Inter-Bold",
            fontSize=13,
            leading=17,
            spaceAfter=0,
            textColor=colors.HexColor("#18181b"),
        )
        # Table body: 9pt
        table_style = ParagraphStyle(
            "TableCell",
            parent=styles["Normal"],
            fontName="Inter",
            fontSize=9,
            leading=12.5,
        )

        story: list = []
        
        # Vykreslenie loga (moderné grid logo)
        from reportlab.graphics.shapes import Rect
        color_main = colors.HexColor("#10b981")
        color_light = colors.HexColor("#86efac")

        # Drawing 24x20 — vizuálny stred štvorčekov sa zarovná s cap-height stredom 24pt textu
        logo_drawing = Drawing(24, 20)
        sq = 8  # veľkosť štvorčeka
        gap = 2  # medzera medzi štvorčekami
        logo_drawing.add(Rect(0, 0, sq, sq, rx=1.5, ry=1.5, fillColor=color_light, strokeColor=None))
        logo_drawing.add(Rect(sq + gap, 0, sq, sq, rx=1.5, ry=1.5, fillColor=color_main, strokeColor=None))
        logo_drawing.add(Rect(0, sq + gap, sq, sq, rx=1.5, ry=1.5, fillColor=color_main, strokeColor=None))
        logo_drawing.add(Rect(sq + gap, sq + gap, sq, sq, rx=1.5, ry=1.5, fillColor=color_light, strokeColor=None))

        # Naformátovaný text: Registro.sk — Due Diligence Report
        # Brand 18pt bold + suffix 11pt regular muted = jeden riadok
        logo_text = Paragraph(
            '<font color="#111827">Registro</font><font color="#10b981">.sk</font>'
            '<font color="#71717a" size="11"> — Due Diligence Report</font>',
            brand_style
        )

        # Prvý stĺpec 1.2cm + LEFTPADDING 6pt na druhom stĺpci = medzera medzi logom a textom
        header_table = Table([[logo_drawing, logo_text]], colWidths=[1.2 * cm, 14.8 * cm])
        header_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
            ('RIGHTPADDING', (0, 0), (0, 0), 0),
            ('LEFTPADDING', (1, 0), (1, 0), 6),
            ('RIGHTPADDING', (1, 0), (1, 0), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
        ]))
        
        story.append(header_table)
        story.append(Spacer(1, 0.6 * cm))

        # ── Subject info ────────────────────────────────────────────
        subject_label = "Subjekt" if target_type == "COMPANY" else "Fyzická osoba"
        story.append(Paragraph(f"<b>{subject_label}:</b> {identifier}", subtitle_style))
        if target_type == "COMPANY" and company_name:
            story.append(Paragraph(f"<b>Obchodné meno:</b> {company_name}", subtitle_style))
        story.append(Paragraph(f"<b>Vygenerované:</b> {generated_at.strftime('%d.%m.%Y %H:%M:%S')}", subtitle_style))
        total_pages = sum(s.page_count or 0 for s in sources if s.status == "SUCCESS")
        story.append(Paragraph(f"<b>Počet strán:</b> {total_pages}", subtitle_style))
        story.append(Spacer(1, 0.6 * cm))

        # ── Section heading ────────────────────────────────────────
        story.append(Paragraph("Prehľad zdrojov", section_style))
        story.append(Spacer(1, 0.35 * cm))

        from xml.sax.saxutils import escape as xml_escape

        # Stĺpce: Icon (1.0cm) | Zdroj (3.3cm) | Strana (1.5cm) | Stav (2.5cm) | Nálezy (7.8cm)
        col_widths = [1.0 * cm, 3.3 * cm, 1.5 * cm, 2.5 * cm, 7.8 * cm]

        # Status farby
        _STATUS_COLORS = {
            "SUCCESS":     "#10b981",
            "UNAVAILABLE": "#f59e0b",
            "FAILED":      "#ef4444",
        }

        def _effective_status(source) -> str:
            """Vráti efektívny status — ak findings obsahujú POZOR, ide o varovanie."""
            findings = (source.findings or source.message or "").upper()
            if "POZOR" in findings:
                return "WARNING"
            return source.status

        def _build_source_icon(source_type: str) -> Drawing:
            """Farebný badge so skratkou zdroja."""
            abbr, color_hex = _SOURCE_ICONS.get(source_type, ("?", "#71717a"))
            fill = colors.HexColor(color_hex)
            w, h = 22, 14
            d = Drawing(w, h)
            d.add(Rect(0, 0, w, h, rx=3, ry=3, fillColor=fill, strokeColor=None))
            d.add(String(w / 2, 4, abbr, textAnchor="middle",
                         fontName="Inter-Bold", fontSize=7, fillColor=colors.white))
            return d

        def _build_status_pill(status: str) -> Table:
            """Pill-shaped status badge s ikonou a textom."""
            if status == "WARNING":
                color, icon, label = "#ef4444", "⚠", "Upozornenie"
            elif status == "SUCCESS":
                color, icon, label = "#10b981", "✓", "V poriadku"
            elif status == "UNAVAILABLE":
                color, icon, label = "#f59e0b", "⚠", "Nedostupné"
            else:
                color, icon, label = "#ef4444", "✗", "Zlyhal"
            text = Paragraph(
                f'<font color="white" size="8"><b>{icon} {label}</b></font>',
                table_style,
            )
            pill = Table([[text]], colWidths=[2.3 * cm])
            pill.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(color)),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]))
            return pill

        def _build_findings(source) -> Paragraph:
            findings = source.findings or source.message or "Bez záznamu."
            findings = xml_escape(findings)
            # Konverzia nových riadkov na <br/> — ReportLab Paragraph ignoruje \n
            findings = findings.replace("\n", "<br/>")

            if "POZOR" in findings:
                findings = findings.replace("POZOR!", '<font color="#ef4444"><b>POZOR!</b></font>')
                findings = findings.replace("POZOR:", '<font color="#ef4444"><b>POZOR:</b></font>')
                findings = findings.replace("POZOR", '<font color="#ef4444"><b>POZOR</b></font>')

            findings = re.sub(r'vysoko spoľahlivý', r'<font color="#10b981"><b>\g<0></b></font>', findings)
            findings = re.sub(r'menej spoľahlivý', r'<font color="#ef4444"><b>\g<0></b></font>', findings)
            findings = re.sub(r'(?<!vysoko )(?<!menej )spoľahlivý', r'<font color="#f59e0b"><b>\g<0></b></font>', findings)
            findings = re.sub(r'Vyrubená daň:\s*(?!0[.,]00)([\d.,]+\s*EUR)', r'<font color="#10b981"><b>Vyrubená daň: \1</b></font>', findings)
            findings = re.sub(r'Daňová strata:\s*(?!0[.,]00)([\d.,]+\s*EUR)', r'<font color="#ef4444"><b>Daňová strata: \1</b></font>', findings)

            return Paragraph(findings, table_style)

        # ── Helper: build a source row ─────────────────────────────
        def _build_source_label(source) -> Paragraph:
            """Názov zdroja — klikateľný odkaz na jeho stranu v dokumente (ak má PDF sekciu)."""
            label = _SOURCE_LABELS.get(source.source_type, source.source_type)
            start_page = getattr(source, "start_page", None)
            if start_page:
                # compiler.py prevedie 'http://PAGE_N' na interný GoTo odkaz.
                # Modrý text bez podčiarknutia + ↗ symbol pre indikáciu odkazu.
                return Paragraph(
                    f'<a href="http://PAGE_{start_page}" color="#2563eb">{label}</a>'
                    f' <font size="8" color="#2563eb">↗</font>',
                    table_style,
                )
            return Paragraph(label, table_style)

        def _build_source_row(source) -> list:
            start_page = getattr(source, "start_page", None)
            page_text = str(start_page) if start_page else "—"
            eff_status = _effective_status(source)
            return [
                _build_source_icon(source.source_type),
                _build_source_label(source),
                Paragraph(page_text, ParagraphStyle("PageNum", parent=table_style, alignment=1)),
                _build_status_pill(eff_status),
                _build_findings(source),
            ]

        # ── Shared table style base ─────────────────────────────────
        _base_table_style = [
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),  # Icon column centered
            ("ALIGN", (2, 0), (2, -1), "CENTER"),  # Strana column centered
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("FONTNAME", (0, 0), (-1, -1), "Inter"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("LEADING", (0, 0), (-1, -1), 12.5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]

        # ── Column header table (Zdroj | Strana | Stav | Nálezy) ───
        header_row = [
            Paragraph("", table_style),
            Paragraph("<b>Zdroj</b>", table_style),
            Paragraph("<b>Strana</b>", table_style),
            Paragraph("<b>Stav</b>", table_style),
            Paragraph("<b>Súhrnný nález</b>", table_style),
        ]
        header_table = Table([header_row], colWidths=col_widths)
        header_table.setStyle(TableStyle(_base_table_style + [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f5")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#18181b")),
            ("FONTNAME", (0, 0), (-1, 0), "Inter-Bold"),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#e4e4e7")),
        ]))
        story.append(header_table)

        # ── Helper: build a category mini-table wrapped in KeepTogether ─
        cat_header_style = ParagraphStyle(
            "CatHeader", parent=table_style, fontName="Inter-Bold",
            fontSize=10, leading=13,
            textColor=colors.HexColor("#18181b"),
        )

        def _build_category_block(cat_label: str, cat_sources_list: list) -> KeepTogether:
            rows = []
            styles = list(_base_table_style)  # copy base

            # Category header row
            rows.append([
                Paragraph(f'<b>{cat_label}</b>', cat_header_style),
                "", "", "", "",
            ])
            styles.append(("SPAN", (0, 0), (-1, 0)))
            styles.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e4e4e7")))
            styles.append(("TOPPADDING", (0, 0), (-1, 0), 8))
            styles.append(("BOTTOMPADDING", (0, 0), (-1, 0), 8))
            styles.append(("LEFTPADDING", (0, 0), (-1, 0), 12))
            styles.append(("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#d4d4d8")))

            # Source rows
            for i, source in enumerate(cat_sources_list, start=1):
                rows.append(_build_source_row(source))
                styles.append(("LINEBELOW", (0, i), (-1, i), 0.5, colors.HexColor("#f0f0f0")))

            mini_table = Table(rows, colWidths=col_widths)
            mini_table.setStyle(TableStyle(styles))
            return KeepTogether(mini_table)

        # ── Build per-category blocks ──────────────────────────────
        source_map = {s.source_type: s for s in sources}
        rendered_sources = set()

        for cat_label, cat_source_ids in _SOURCE_CATEGORIES:
            cat_sources = [source_map[sid] for sid in cat_source_ids if sid in source_map]
            if not cat_sources:
                continue
            for s in cat_sources:
                rendered_sources.add(s.source_type)
            story.append(_build_category_block(cat_label, cat_sources))

        # Zdroje, ktoré nepatria do žiadnej kategórie
        remaining = [s for s in sources if s.source_type not in rendered_sources]
        if remaining:
            story.append(_build_category_block("Ostatné", remaining))

        story.append(Spacer(1, 0.4 * cm))

        # ── Summary with status counts ─────────────────────────────
        total = len(sources)
        warnings = sum(1 for s in sources if _effective_status(s) == "WARNING")
        successful = sum(1 for s in sources if s.status == "SUCCESS" and _effective_status(s) != "WARNING")
        unavailable = sum(1 for s in sources if s.status == "UNAVAILABLE")
        failed = total - successful - unavailable - warnings

        summary_parts = []
        if successful:
            summary_parts.append(f'<font color="#10b981"><b>✓ {successful}</b></font> V poriadku')
        if warnings:
            summary_parts.append(f'<font color="#ef4444"><b>⚠ {warnings}</b></font> Upozornenie')
        if unavailable:
            summary_parts.append(f'<font color="#f59e0b"><b>⚠ {unavailable}</b></font> Nedostupné')
        if failed:
            summary_parts.append(f'<font color="#ef4444"><b>✗ {failed}</b></font> Zlyhal')
        summary_text = "  •  ".join(summary_parts) if summary_parts else "Žiadne zdroje."

        summary_style = ParagraphStyle(
            "SummaryStyle", parent=subtitle_style,
            fontSize=10, leading=14, textColor=colors.HexColor("#18181b"),
        )
        story.append(Paragraph(f"<b>Zhrnutie:</b> {summary_text}", summary_style))

        doc.build(story)

    @staticmethod
    def _status_color(status: str) -> str:
        if status == "SUCCESS":
            return "#16a34a"  # zelená
        if status == "UNAVAILABLE":
            return "#ea580c"  # oranžová
        return "#dc2626"  # červená (FAILED / PENDING)

    @staticmethod
    def _build_summary(sources: List[ScrapedSource]) -> str:
        total = len(sources)
        successful = sum(1 for s in sources if s.status == "SUCCESS")
        unavailable = sum(1 for s in sources if s.status == "UNAVAILABLE")
        failed = total - successful - unavailable

        parts = [f"{successful}/{total} zdrojov úspešne stiahnutých."]
        if unavailable:
            parts.append(f"{unavailable} nedostupných." )
        if failed:
            parts.append(f"{failed} zlyhalo.")
        return " ".join(parts)

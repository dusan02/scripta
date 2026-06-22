from __future__ import annotations
from datetime import datetime
from pathlib import Path
from typing import List

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.graphics.shapes import Drawing, Path as RLPath

from ..models import ScrapedSource


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
        styles["Heading2"].fontName = "Inter-Bold"
        
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Heading1"],
            fontName="Inter-Bold",
            fontSize=24,
            spaceAfter=0, # Space is handled by Spacer after table
        )
        subtitle_style = ParagraphStyle(
            "Subtitle",
            parent=styles["Normal"],
            fontName="Inter",
            fontSize=11,
            spaceAfter=0.3 * cm,
            textColor=colors.HexColor("#52525b"), # Muted text
        )

        story: list = []
        
        # Vykreslenie loga (zelená "fajka") presne podľa webu (väčšie a zarovnané)
        logo_drawing = Drawing(30, 26)
        p = RLPath(strokeColor=colors.HexColor("#10b981"), strokeWidth=4.5, strokeLineCap=1, strokeLineJoin=1, fillColor=None)
        # Scaled by ~1.25, Y os otočená. Posunuté nižšie (o 4 body) aby V nebolo "ustrelené" dohora
        p.moveTo(6.25, 14)
        p.lineTo(13.75, 1.5)
        p.lineTo(26.25, 19)
        logo_drawing.add(p)

        # Naformátovaný text: eriso.sk (zelené sk) a potom šedý suffix
        logo_text = Paragraph(
            '<font color="#111827">eriso</font><font color="#10b981">.sk</font><font color="#000000"> — Due Diligence Report</font>',
            title_style
        )

        # Šírka prvého stĺpca 0.85cm naschvál vytvorí mierny prekryv (-8px margin ako na webe)
        header_table = Table([[logo_drawing, logo_text]], colWidths=[0.85 * cm, 15 * cm])
        header_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
        ]))
        
        story.append(header_table)
        story.append(Spacer(1, 0.8 * cm))

        subject_label = "Subjekt" if target_type == "COMPANY" else "Fyzická osoba"
        story.append(Paragraph(f"<b>{subject_label}:</b> {identifier}", subtitle_style))
        if target_type == "COMPANY" and company_name:
            story.append(Paragraph(f"<b>Obchodné meno:</b> {company_name}", subtitle_style))
        story.append(Paragraph(f"<b>Vygenerované:</b> {generated_at.strftime('%d.%m.%Y %H:%M:%S')}", subtitle_style))
        story.append(Spacer(1, 1.2 * cm))

        story.append(Paragraph("<b>Prehľad zdrojov</b>", styles["Heading2"]))
        story.append(Spacer(1, 0.4 * cm))

        table_data = [
            ["Zdroj", "Status", "Strana", "Nálezy"]
        ]

        for source in sources:
            if source.status == "SUCCESS":
                status_p = Paragraph('<font color="#10b981">SUCCESS</font>', styles["Normal"])
            elif source.status == "UNAVAILABLE":
                status_p = Paragraph('<font color="#f59e0b">UNAVAILABLE</font>', styles["Normal"])
            else:
                status_p = Paragraph('<font color="#ef4444">FAILED</font>', styles["Normal"])

            findings = source.findings or source.message or "Bez záznamu."
            
            # Zvýrazníme slovo POZOR na červeno a tučne pre lepšiu viditeľnosť nálezov
            if "POZOR" in findings:
                findings = findings.replace("POZOR!", '<font color="#ef4444"><b>POZOR!</b></font>')
                findings = findings.replace("POZOR:", '<font color="#ef4444"><b>POZOR:</b></font>')
                findings = findings.replace("POZOR", '<font color="#ef4444"><b>POZOR</b></font>')
            
            if source.start_page is not None:
                page_link = Paragraph(f'<a href="http://PAGE_{source.start_page}" color="#2563eb"><u>{source.start_page}</u></a>', styles["Normal"])
            else:
                page_link = Paragraph("-", styles["Normal"])

            table_data.append(
                [
                    Paragraph(source.source_type, styles["Normal"]),
                    status_p,
                    page_link,
                    Paragraph(findings, styles["Normal"]),
                ]
            )

        table = Table(table_data, colWidths=[3.5 * cm, 3 * cm, 2 * cm, 7.5 * cm])
        table.setStyle(
            TableStyle(
                [
                    # Header
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f5")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#18181b")),
                    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("FONTNAME", (0, 0), (-1, 0), "Inter-Bold"),
                    ("FONTNAME", (0, 1), (-1, -1), "Inter"),
                    ("FONTSIZE", (0, 0), (-1, 0), 10),
                    ("FONTSIZE", (0, 1), (-1, -1), 9),
                    # Padding
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    # Grid
                    ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 0.8 * cm))

        summary = self._build_summary(sources)
        story.append(Paragraph(f"<b>Zhrnutie:</b> {summary}", subtitle_style))

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

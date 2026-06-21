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
    ) -> None:
        fonts_dir = Path(__file__).parent / "fonts"
        pdfmetrics.registerFont(TTFont("DejaVuSans", str(fonts_dir / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", str(fonts_dir / "DejaVuSans-Bold.ttf")))

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
        styles["Normal"].fontName = "DejaVuSans"
        styles["Heading2"].fontName = "DejaVuSans-Bold"
        
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Heading1"],
            fontName="DejaVuSans-Bold",
            fontSize=22,
            spaceAfter=0.6 * cm,
            textColor=colors.HexColor("#1f2937"),
        )
        subtitle_style = ParagraphStyle(
            "Subtitle",
            parent=styles["Normal"],
            fontName="DejaVuSans",
            fontSize=12,
            spaceAfter=0.4 * cm,
            textColor=colors.HexColor("#4b5563"),
        )

        story: list = []
        story.append(Paragraph("Scripta.sk — Evidence Binder", title_style))
        story.append(Spacer(1, 0.5 * cm))

        subject_label = "Spoločnosť" if target_type == "COMPANY" else "Fyzická osoba"
        story.append(Paragraph(f"<b>{subject_label}:</b> {identifier}", subtitle_style))
        story.append(Paragraph(f"<b>Vygenerované:</b> {generated_at.strftime('%d.%m.%Y %H:%M:%S')}", subtitle_style))
        story.append(Spacer(1, 1 * cm))

        story.append(Paragraph("<b>Prehľad zdrojov</b>", styles["Heading2"]))
        story.append(Spacer(1, 0.3 * cm))

        table_data = [["Zdroj", "Status", "Strany", "Nálezy"]]
        for source in sources:
            status_color = self._status_color(source.status)
            table_data.append([
                source.source_type,
                Paragraph(f'<font color="{status_color}">{source.status}</font>', styles["Normal"]),
                str(source.page_count or "—"),
                source.findings or source.message or "—",
            ])

        table = Table(table_data, colWidths=[3 * cm, 3 * cm, 2 * cm, 8 * cm])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("FONTNAME", (0, 0), (-1, 0), "DejaVuSans-Bold"),
                    ("FONTNAME", (0, 1), (-1, -1), "DejaVuSans"),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 0.6 * cm))

        summary = self._build_summary(sources)
        story.append(Paragraph(f"<b>Zhrnutie:</b> {summary}", styles["Normal"]))

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

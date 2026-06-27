from __future__ import annotations
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from xml.sax.saxutils import escape as xml_escape

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
from reportlab.graphics.shapes import Drawing, Rect, String

from ..models import ScrapedSource

# ── Constants ──────────────────────────────────────────────────────────

_LEGAL_STATUSES = ["v likvidácii", "vymazaná", "v konkurze", "v reštrukturalizácii"]

_STATUS_PILL_CONFIG = {
    "WARNING": ("#ef4444", "⚠", "Upozornenie"),
    "SUCCESS": ("#10b981", "✓", "V poriadku"),
    "UNAVAILABLE": ("#f59e0b", "⚠", "Nedostupné"),
    "FAILED": ("#ef4444", "✗", "Zlyhal"),
}

_COL_WIDTHS = [1.0 * cm, 3.3 * cm, 1.5 * cm, 2.5 * cm, 7.8 * cm]

_BASE_TABLE_STYLE = [
    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
    ("ALIGN", (0, 0), (0, -1), "CENTER"),
    ("ALIGN", (2, 0), (2, -1), "CENTER"),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("FONTNAME", (0, 0), (-1, -1), "Inter"),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
    ("LEADING", (0, 0), (-1, -1), 12.5),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
]


# Vizuálne ikony zdrojov — farebné badge so skratkou (zodpovedá frontend sources.ts)
_SOURCE_ICONS = {
    # basic
    "ORSR": ("ORSR", "#2563eb"),
    "ZRSR": ("ŽRSR", "#7c3aed"),
    "RPO": ("RPO", "#0d9488"),
    "RPVS": ("RPVS", "#0d9488"),
    "OBCHODNY_VESTNIK": ("OV", "#2563eb"),
    # risk
    "INSOLVENCY": ("INS", "#dc2626"),
    "POVERENIA": ("POV", "#db2777"),
    "FINANCNA_SPRAVA": ("FS", "#ea580c"),
    "SP_DLZNICI": ("SP", "#db2777"),
    "VSZP_DLZNICI": ("VšZP", "#2563eb"),
    "DOVERA_DLZNICI": ("Dôvera", "#7c3aed"),
    "UNION_DLZNICI": ("UNION", "#0891b2"),
    # fs
    "FS_DANOVE_SUBJEKTY": ("IDS", "#ea580c"),
    "FS_DPH_REGISTROVANI": ("REG", "#f59e0b"),
    "FS_DPH_RUSENIE": ("DPH", "#f59e0b"),
    "FS_DPH_VYMAZANI": ("VYM", "#f59e0b"),
    "FS_DPH_NADMERNY_ODPOCET": ("NOP", "#f59e0b"),
    "FS_DPH_BANKOVE_UCTY": ("BA", "#f59e0b"),
    "FS_DAN_Z_PRIJMOV": ("DAP", "#ea580c"),
    "FS_DAN_PRIJMOV_REG": ("DPR", "#ea580c"),
    # court
    "CRRS": ("CRRS", "#9333ea"),
    "DISKVALIFIKACIE": ("DIS", "#9333ea"),
    # asset
    "NCRZP": ("NCRZP", "#6366f1"),
    "NCRD": ("NCRD", "#9333ea"),
    "OCHRANNE_ZNAMKY": ("OZ", "#6366f1"),
    # fin
    "REGISTER_UZ": ("RUZ", "#059669"),
    "CRZ": ("CRZ", "#0891b2"),
    "UVO": ("UVO", "#059669"),
}

# Friendly názvy zdrojov pre cover page (zodpovedá frontend sources.ts)
_SOURCE_LABELS = {
    # basic
    "ORSR": "ORSR",
    "ZRSR": "ŽRSR",
    "RPO": "RPO",
    "RPVS": "RPVS",
    "OBCHODNY_VESTNIK": "Obchodný vestník",
    # risk
    "INSOLVENCY": "Register úpadcov",
    "POVERENIA": "Poverenia",
    "FINANCNA_SPRAVA": "Daňoví dlžníci",
    "SP_DLZNICI": "Soc. poisťovňa",
    "VSZP_DLZNICI": "VšZP",
    "DOVERA_DLZNICI": "Dôvera",
    "UNION_DLZNICI": "UNION",
    # fs
    "FS_DANOVE_SUBJEKTY": "Index daň. spoľahlivosti",
    "FS_DPH_REGISTROVANI": "Platitelia DPH",
    "FS_DPH_RUSENIE": "Zrušenie DPH",
    "FS_DPH_VYMAZANI": "Vymazaní z DPH",
    "FS_DPH_NADMERNY_ODPOCET": "Nadmerný odpočet",
    "FS_DPH_BANKOVE_UCTY": "Bankové účty DPH",
    "FS_DAN_Z_PRIJMOV": "Daň z príjmov PO",
    "FS_DAN_PRIJMOV_REG": "Reg. k dani z príjmov",
    # court
    "CRRS": "Rozhodnutia súdov",
    "DISKVALIFIKACIE": "Diskvalifikácie",
    # asset
    "NCRZP": "Záložné práva",
    "NCRD": "Register dražieb",
    "OCHRANNE_ZNAMKY": "Ochranné známky",
    # fin
    "REGISTER_UZ": "Účtovné závierky",
    "CRZ": "Register zmlúv",
    "UVO": "Verejné obstarávanie",
}

# Zoskupenie zdrojov do kategórií (zodpovedá frontend SOURCE_CATEGORIES v sources.ts)
_SOURCE_CATEGORIES = [
    ("Základné firemné a právne registre", ["ORSR", "ZRSR", "RPO", "RPVS", "OBCHODNY_VESTNIK"]),
    ("Insolvencia, exekúcie a dlhy", ["INSOLVENCY", "POVERENIA", "FINANCNA_SPRAVA", "SP_DLZNICI", "VSZP_DLZNICI", "DOVERA_DLZNICI", "UNION_DLZNICI"]),
    ("Finančná správa a DPH", ["FS_DANOVE_SUBJEKTY", "FS_DPH_REGISTROVANI", "FS_DPH_RUSENIE", "FS_DPH_VYMAZANI", "FS_DPH_NADMERNY_ODPOCET", "FS_DPH_BANKOVE_UCTY", "FS_DAN_Z_PRIJMOV", "FS_DAN_PRIJMOV_REG"]),
    ("Súdy a sankcie", ["CRRS", "DISKVALIFIKACIE"]),
    ("Financie a štátne zákazky", ["REGISTER_UZ", "CRZ", "UVO"]),
    ("Majetok a práva", ["NCRZP", "NCRD", "OCHRANNE_ZNAMKY"]),
]


class CoverPageGenerator:
    """Generuje titulnú stranu Evidence Binder so semaformi a obsahom."""

    def generate(
        self,
        output_path: Path,
        *,
        target_type: str,
        identifier: str,
        sources: List[ScrapedSource],
        generated_at: datetime,
        company_name: Optional[str] = None,
    ) -> None:
        self._register_fonts()
        self._styles = getSampleStyleSheet()
        self._styles["Normal"].fontName = "Inter"
        self._styles["Normal"].fontSize = 9
        self._styles["Normal"].leading = 13
        self._styles["Heading2"].fontName = "Inter-Bold"

        doc = SimpleDocTemplate(
            str(output_path), pagesize=A4,
            rightMargin=2 * cm, leftMargin=2 * cm,
            topMargin=2 * cm, bottomMargin=2 * cm,
        )

        story: list = []
        story.extend(self._build_logo())
        story.extend(self._build_company_header(target_type, identifier, company_name))
        story.extend(self._build_metadata_grid(target_type, identifier, sources, generated_at))
        story.extend(self._build_metric_cards(sources))
        story.extend(self._build_divider())
        story.extend(self._build_source_table(sources))

        doc.build(story)

    # ── Setup ──────────────────────────────────────────────────────

    def _register_fonts(self) -> None:
        fonts_dir = Path(__file__).parent / "fonts"
        for name, file in [
            ("DejaVuSans", "DejaVuSans.ttf"),
            ("DejaVuSans-Bold", "DejaVuSans-Bold.ttf"),
            ("Inter", "Inter-Regular.ttf"),
            ("Inter-Bold", "Inter-Bold.ttf"),
        ]:
            pdfmetrics.registerFont(TTFont(name, str(fonts_dir / file)))

    def _style(self, name: str, **kwargs) -> ParagraphStyle:
        return ParagraphStyle(name, parent=self._styles["Normal"], **kwargs)

    @staticmethod
    def _darken_hex(hex_color: str, factor: float = 0.12) -> str:
        """Darken a hex color by a given factor (0-1). Returns hex string."""
        h = hex_color.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        r = max(0, int(r * (1 - factor)))
        g = max(0, int(g * (1 - factor)))
        b = max(0, int(b * (1 - factor)))
        return f"#{r:02x}{g:02x}{b:02x}"

    # ── Logo ───────────────────────────────────────────────────────

    def _build_logo(self) -> list:
        color_main = colors.HexColor("#10b981")
        color_light = colors.HexColor("#86efac")
        sq, gap = 8, 2

        logo_drawing = Drawing(24, 20)
        for x, y, c in [(0, 0, color_light), (sq + gap, 0, color_main), (0, sq + gap, color_main), (sq + gap, sq + gap, color_light)]:
            logo_drawing.add(Rect(x, y, sq, sq, rx=1.5, ry=1.5, fillColor=c, strokeColor=None))

        logo_text = Paragraph(
            '<font color="#111827">Registro</font><font color="#10b981">.sk</font>'
            '<font color="#71717a" size="11"> — Due Diligence Report</font>',
            self._style("Brand", fontName="Inter-Bold", fontSize=18, leading=22),
        )

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
        return [header_table, Spacer(1, 0.6 * cm)]

    # ── Company Header (H1 + Legal Status Badge) ───────────────────

    def _build_company_header(self, target_type: str, identifier: str, company_name: Optional[str]) -> list:
        display_name = company_name or ""
        legal_badge = None

        if target_type == "COMPANY" and company_name:
            for status in _LEGAL_STATUSES:
                idx = company_name.lower().find(status.lower())
                if idx >= 0:
                    legal_badge = company_name[idx:idx + len(status)]
                    remainder = company_name[idx + len(status):].strip()
                    if remainder.startswith("("):
                        paren_end = remainder.find(")")
                        if paren_end >= 0:
                            legal_badge += f" {remainder[:paren_end + 1]}"
                    display_name = company_name[:idx].strip().rstrip(",").strip()
                    break

        h1_style = self._style("CompanyH1", fontName="Inter-Bold", fontSize=24, leading=28,
                               textColor=colors.HexColor("#0f172a"))

        if target_type == "COMPANY" and display_name:
            if legal_badge:
                # Pill-shaped badge with rounded corners, vertically centered via a Table
                badge_style = self._style("LegalBadge", fontName="Inter-Bold", fontSize=9, leading=12,
                                         textColor=colors.white, alignment=1)
                badge_cell = Table([[Paragraph(xml_escape(legal_badge), badge_style)]], colWidths=[3.2 * cm])
                badge_cell.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#dc2626")),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING", (0, 0), (-1, -1), 12),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                    ("ROUNDEDCORNERS", [6, 6, 6, 6]),
                ]))
                # Flex-like layout: name + badge in a row, vertically centered
                name_para = Paragraph(xml_escape(display_name), h1_style)
                header_table = Table([[name_para, badge_cell]], colWidths=[None, 3.6 * cm])
                header_table.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (0, 0), 12),
                    ("RIGHTPADDING", (1, 0), (1, 0), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]))
                return [header_table, Spacer(1, 0.3 * cm)]
            else:
                html = xml_escape(display_name)
        else:
            html = xml_escape(identifier)

        return [Paragraph(html, h1_style), Spacer(1, 0.3 * cm)]

    # ── Metadata Grid ──────────────────────────────────────────────

    def _build_metadata_grid(self, target_type: str, identifier: str, sources: List[ScrapedSource], generated_at: datetime) -> list:
        total_pages = sum(s.page_count or 0 for s in sources if s.status == "SUCCESS")

        meta_items = []
        if target_type == "COMPANY":
            # Strip "IČO " prefix from identifier to avoid duplication with the label
            ico_value = identifier.replace("IČO ", "").strip()
            meta_items.append(("IČO", ico_value))
        meta_items.append(("Vygenerované", generated_at.strftime("%d.%m.%Y %H:%M:%S")))
        meta_items.append(("Počet strán", str(total_pages)))

        col_w = 16.0 * cm / len(meta_items)
        row = []
        for label, value in meta_items:
            row.append(Paragraph(
                f'<font color="#64748b" size="8">{label.upper()}</font><br/>'
                f'<font color="#1e293b" size="11"><b>{xml_escape(value)}</b></font>',
                self._style("MetaCell", fontName="Inter", fontSize=8, leading=14),
            ))

        meta_table = Table([row], colWidths=[col_w] * len(meta_items))
        meta_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [meta_table, Spacer(1, 0.5 * cm)]

    # ── Metric Cards ───────────────────────────────────────────────

    @staticmethod
    def _effective_status(source: ScrapedSource) -> str:
        findings = (source.findings or source.message or "").upper()
        if "POZOR" in findings:
            return "WARNING"
        return source.status

    def _build_metric_card(self, count: int, label: str, icon: str, bg_hex: str, text_hex: str) -> Table:
        text_color = colors.HexColor(text_hex)
        card_style = self._style("MetricCard", fontName="Inter", fontSize=9, leading=13, textColor=text_color, alignment=1)
        count_style = self._style("MetricCount", fontName="Inter-Bold", fontSize=22, leading=26, textColor=text_color, alignment=1)
        label_style = self._style("MetricLabel", fontName="Inter", fontSize=8, leading=11, textColor=text_color, alignment=1)

        inner = Table([
            [Paragraph(f'<font size="11"><b>{icon}</b></font>', card_style)],
            [Paragraph(str(count), count_style)],
            [Paragraph(label, label_style)],
        ], colWidths=[4.8 * cm])
        # Derive a slightly darker border color from the background
        border_hex = self._darken_hex(bg_hex, 0.12)
        inner.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_hex)),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor(border_hex)),
            ("ROUNDEDCORNERS", [8, 8, 8, 8]),
        ]))
        return inner

    def _build_metric_cards(self, sources: List[ScrapedSource]) -> list:
        total = len(sources)
        warnings = sum(1 for s in sources if self._effective_status(s) == "WARNING")
        successful = sum(1 for s in sources if s.status == "SUCCESS" and self._effective_status(s) != "WARNING")
        unavailable = sum(1 for s in sources if s.status == "UNAVAILABLE")
        failed = total - successful - unavailable - warnings

        cards = [
            self._build_metric_card(successful, "V poriadku", "✓", "#dcfce7", "#166534"),
            self._build_metric_card(warnings, "Upozornení", "⚠", "#fee2e2", "#991b1b"),
            self._build_metric_card(unavailable, "Nedostupné", "⚠", "#fef9c3", "#854d0e"),
        ]
        if failed > 0:
            cards.append(self._build_metric_card(failed, "Zlyhal", "✗", "#fee2e2", "#991b1b"))

        if not cards:
            return []

        metrics_table = Table([cards], colWidths=[5.2 * cm] * len(cards))
        metrics_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        return [metrics_table, Spacer(1, 0.5 * cm)]

    # ── Divider ────────────────────────────────────────────────────

    def _build_divider(self) -> list:
        section_style = self._style("Section", fontName="Inter-Bold", fontSize=13, leading=17,
                                    textColor=colors.HexColor("#18181b"))
        divider = Table([[""]], colWidths=[16.0 * cm])
        divider.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [divider, Spacer(1, 0.35 * cm), Paragraph("Prehľad zdrojov", section_style), Spacer(1, 0.35 * cm)]

    # ── Source Table ───────────────────────────────────────────────

    def _build_source_icon(self, source_type: str) -> Drawing:
        abbr, color_hex = _SOURCE_ICONS.get(source_type, ("?", "#71717a"))
        w, h = 22, 14
        d = Drawing(w, h)
        d.add(Rect(0, 0, w, h, rx=3, ry=3, fillColor=colors.HexColor(color_hex), strokeColor=None))
        d.add(String(w / 2, 4, abbr, textAnchor="middle", fontName="Inter-Bold", fontSize=7, fillColor=colors.white))
        return d

    def _build_status_pill(self, status: str) -> Table:
        color_hex, icon, label = _STATUS_PILL_CONFIG.get(status, _STATUS_PILL_CONFIG["FAILED"])
        text = Paragraph(f'<font color="white" size="8"><b>{icon} {label}</b></font>',
                         self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5))
        pill = Table([[text]], colWidths=[2.3 * cm])
        pill.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(color_hex)),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ]))
        return pill

    def _build_findings(self, source: ScrapedSource) -> Paragraph:
        raw = source.findings or source.message or "Bez záznamu."
        table_style = self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5,
                                 wordWrap="CJK")  # CJK wordWrap breaks long URLs

        max_chars = 350
        if len(raw) > max_chars:
            truncated = raw[:max_chars]
            last_nl = truncated.rfind("\n")
            if last_nl > 100:
                truncated = truncated[:last_nl]
            raw = truncated + "\n… (ďalšie záznamy v PDF výpise)"

        # 1. Escape raw text first (before any HTML tag insertion)
        findings = xml_escape(raw)

        # 2. Replace newlines with <br/>
        findings = findings.replace("\n", "<br/>")

        # 3. Replace raw escaped URLs with clean clickable links
        #    URLs were escaped by xml_escape: & -> &amp; but URL chars are mostly safe
        findings = re.sub(
            r'(https?://[^\s&lt;&gt;]+)',
            r'<a href="\1" color="#2563eb">[Zobraziť detail]</a>',
            findings,
        )

        # 4. Bold key-value pairs: "Key: value" → "<b>Key:</b> value"
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

        # 5. Highlight POZOR warnings
        if "POZOR" in findings:
            findings = findings.replace("POZOR!", '<font color="#ef4444"><b>POZOR!</b></font>')
            findings = findings.replace("POZOR:", '<font color="#ef4444"><b>POZOR:</b></font>')
            findings = findings.replace("POZOR", '<font color="#ef4444"><b>POZOR</b></font>')

        # 6. Highlight reliability/d tax keywords
        findings = re.sub(r'vysoko spoľahlivý', r'<font color="#10b981"><b>\g<0></b></font>', findings)
        findings = re.sub(r'menej spoľahlivý', r'<font color="#ef4444"><b>\g<0></b></font>', findings)
        findings = re.sub(r'(?<!vysoko )(?<!menej )spoľahlivý', r'<font color="#f59e0b"><b>\g<0></b></font>', findings)
        findings = re.sub(r'Vyrubená daň:\s*(?!0[.,]00)([\d.,]+\s*EUR)', r'<font color="#10b981"><b>Vyrubená daň: \1</b></font>', findings)
        findings = re.sub(r'Daňová strata:\s*(?!0[.,]00)([\d.,]+\s*EUR)', r'<font color="#ef4444"><b>Daňová strata: \1</b></font>', findings)

        return Paragraph(findings, table_style)

    def _build_source_label(self, source: ScrapedSource) -> Paragraph:
        label = _SOURCE_LABELS.get(source.source_type, source.source_type)
        table_style = self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5)
        start_page = getattr(source, "start_page", None)
        if start_page:
            return Paragraph(
                f'<a href="http://PAGE_{start_page}" color="#2563eb">{label}</a>'
                f' <font size="8" color="#2563eb">↗</font>',
                table_style,
            )
        return Paragraph(label, table_style)

    def _build_source_row(self, source: ScrapedSource) -> list:
        start_page = getattr(source, "start_page", None)
        page_text = str(start_page) if start_page else "—"
        table_style = self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5)
        return [
            self._build_source_icon(source.source_type),
            self._build_source_label(source),
            Paragraph(page_text, ParagraphStyle("PageNum", parent=table_style, alignment=1)),
            self._build_status_pill(self._effective_status(source)),
            self._build_findings(source),
        ]

    def _build_category_block(self, cat_label: str, cat_sources: list) -> KeepTogether:
        rows = []
        styles_list = list(_BASE_TABLE_STYLE)

        cat_header_style = self._style("CatHeader", fontName="Inter-Bold", fontSize=10, leading=13,
                                       textColor=colors.HexColor("#18181b"))
        rows.append([Paragraph(f'<b>{cat_label}</b>', cat_header_style), "", "", "", ""])
        styles_list.extend([
            ("SPAN", (0, 0), (-1, 0)),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e4e4e7")),
            ("TOPPADDING", (0, 0), (-1, 0), 8),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
            ("LEFTPADDING", (0, 0), (-1, 0), 12),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#d4d4d8")),
        ])

        for i, source in enumerate(cat_sources, start=1):
            rows.append(self._build_source_row(source))
            styles_list.append(("LINEBELOW", (0, i), (-1, i), 0.5, colors.HexColor("#f0f0f0")))

        mini_table = Table(rows, colWidths=_COL_WIDTHS, splitByRow=1)
        mini_table.setStyle(TableStyle(styles_list))
        return KeepTogether(mini_table)

    def _build_source_table(self, sources: List[ScrapedSource]) -> list:
        table_style = self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5)

        # Column header
        header_row = [
            Paragraph("", table_style),
            Paragraph("<b>Zdroj</b>", table_style),
            Paragraph("<b>Strana</b>", table_style),
            Paragraph("<b>Stav</b>", table_style),
            Paragraph("<b>Súhrnný nález</b>", table_style),
        ]
        header_table = Table([header_row], colWidths=_COL_WIDTHS)
        header_table.setStyle(TableStyle(_BASE_TABLE_STYLE + [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f5")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#18181b")),
            ("FONTNAME", (0, 0), (-1, 0), "Inter-Bold"),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#e4e4e7")),
        ]))

        story = [header_table]

        # Per-category blocks
        source_map = {s.source_type: s for s in sources}
        rendered = set()

        for cat_label, cat_source_ids in _SOURCE_CATEGORIES:
            cat_sources = [source_map[sid] for sid in cat_source_ids if sid in source_map]
            if not cat_sources:
                continue
            for s in cat_sources:
                rendered.add(s.source_type)
            story.append(self._build_category_block(cat_label, cat_sources))

        # Uncategorised sources
        remaining = [s for s in sources if s.source_type not in rendered]
        if remaining:
            story.append(self._build_category_block("Ostatné", remaining))

        story.append(Spacer(1, 0.4 * cm))
        return story

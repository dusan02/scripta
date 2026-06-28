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
    Image,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.graphics.shapes import Drawing, Circle, Rect, String

from ..models import ScrapedSource

# ── Constants ──────────────────────────────────────────────────────────

_LEGAL_STATUSES = ["v likvidácii", "vymazaná", "v konkurze", "v reštrukturalizácii"]

# Šírka obsahu = A4 (21cm) − ľavá marža (2cm) − pravá marža (2cm) = 17cm.
# Všetky bloky (header, info, divider, source table) používajú túto šírku,
# aby boli zarovnané a centrované rovnako.
_CONTENT_WIDTH = 17.0 * cm

_STATUS_PILL_CONFIG = {
    "WARNING": ("#ef4444", "⚠", "Upozornenie"),
    "INFO": ("#2563eb", "ⓘ", "Informácia"),
    "SUCCESS": ("#10b981", "✓", "V poriadku"),
    "UNAVAILABLE": ("#f59e0b", "?", "Nedostupné"),
    "FAILED": ("#ef4444", "✗", "Zlyhal"),
}

# Informačné registre — prítomnosť záznamu NIE je nevyhnutne negatívna.
# Napr. veľké firmy bežne majú zmluvy so štátom (CRZ), sú partnermi verejného
# sektora (RPVS), zúčastňujú sa verejného obstarávania (UVO) atď.
# Tieto zdroje označíme modrým INFO labelom namiesto červeného upozornenia.
#
# POZNÁMKA: OBCHODNY_VESTNIK tu zámerne NIE JE — môže obsahovať negatívne
# záznamy (likvidácie, konkurzy, exekúcie, rozsudky, dražby), preto zostáva
# červený (WARNING) keď obsahuje záznam.
_INFO_SOURCE_TYPES = {
    "CRZ",               # Centrálny register zmlúv
    "RPVS",              # Register partnerov verejného sektora
    "UVO",               # Úrad pre verejné obstarávanie
    "REGISTER_UZ",       # Register účtovných závierok
}

# Stĺpce: [Zdroj & Stav] [Súhrnný nález] [Str.] — suma = 17cm
_COL_WIDTHS = [4.4 * cm, 10.4 * cm, 2.2 * cm]

# Akcentová farba (brand zelená) pre moderné kategórie a hlavičku
_ACCENT = "#10b981"

_BASE_TABLE_STYLE = [
    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
    ("ALIGN", (2, 0), (2, -1), "CENTER"),  # stĺpec Str. (posledný) centrovaný
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("FONTNAME", (0, 0), (-1, -1), "Inter"),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
    ("LEADING", (0, 0), (-1, -1), 12.5),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
]


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
        legal_badge = self._extract_legal_badge(target_type, company_name)
        story.extend(self._build_header(target_type, identifier, company_name, legal_badge))
        story.extend(self._build_info_section(target_type, identifier, sources, generated_at, legal_badge))
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

    # ── Header (centered logo + title + subject name) ─────────────

    @staticmethod
    def _extract_legal_badge(target_type: str, company_name: Optional[str]) -> Optional[str]:
        if not (target_type == "COMPANY" and company_name):
            return None
        for status in _LEGAL_STATUSES:
            idx = company_name.lower().find(status.lower())
            if idx >= 0:
                badge = company_name[idx:idx + len(status)]
                remainder = company_name[idx + len(status):].strip()
                if remainder.startswith("("):
                    paren_end = remainder.find(")")
                    if paren_end >= 0:
                        badge += f" {remainder[:paren_end + 1]}"
                return badge
        return None

    def _build_header(self, target_type: str, identifier: str, company_name: Optional[str], legal_badge: Optional[str] = None) -> list:
        logo_path = Path(__file__).resolve().parent.parent.parent / "assets" / "logo-verifa.png"
        logo_img = Image(str(logo_path), width=4.5 * cm, height=1.53 * cm)

        logo_text = Paragraph(
            '<font color="#71717a" size="13">Due Diligence Report</font>',
            self._style("Brand", fontName="Inter-Bold", fontSize=13, leading=18, alignment=1),
        )

        # ── Determine display name ──
        display_name = company_name or ""
        if legal_badge and company_name:
            # Strip the legal badge portion from display_name
            idx = company_name.lower().find(legal_badge.split(" ")[0].lower())
            if idx >= 0:
                display_name = company_name[:idx].strip().rstrip(",").strip()
        else:
            display_name = identifier if not (target_type == "COMPANY" and company_name) else company_name

        # Split name at first "(" — put parenthesized part on second line
        name_html = xml_escape(display_name)
        paren_idx = display_name.find("(")
        if paren_idx > 0:
            before = xml_escape(display_name[:paren_idx].strip())
            after = xml_escape(display_name[paren_idx:].strip())
            name_html = f'{before}<br/><font size="11">{after}</font>'

        name_style = self._style("SubjectName", fontName="Inter-Bold", fontSize=14, leading=18,
                                 textColor=colors.HexColor("#0f172a"), alignment=1)
        name_para = Paragraph(name_html, name_style)

        # Build header rows: logo, title, subject name
        header_rows = [[logo_img], [logo_text], [name_para]]

        header_block = Table(header_rows, colWidths=[_CONTENT_WIDTH], hAlign="CENTER")
        header_block.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (0, 0), 6),
            ('BOTTOMPADDING', (1, 0), (1, 0), 8),
            ('BOTTOMPADDING', (2, 0), (2, 0), 0),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        return [header_block, Spacer(1, 0.6 * cm)]

    # ── Info Section (two-column: left=subject, right=metrics) ────

    @staticmethod
    def _effective_status(source: ScrapedSource) -> str:
        findings = (source.findings or source.message or "").upper()
        has_content = "POZOR" in findings
        if has_content:
            # Informačné registre (zmluvy, partnerstvá, obstarávania) nie sú negatívne
            if source.source_type in _INFO_SOURCE_TYPES:
                return "INFO"
            return "WARNING"
        return source.status

    def _build_info_section(
        self, target_type: str, identifier: str,
        sources: List[ScrapedSource],
        generated_at: datetime,
        legal_badge: Optional[str] = None,
    ) -> list:
        # ── Left column: metadata (compact) ──
        left_cells = []

        total_pages = sum(s.page_count or 0 for s in sources if s.status == "SUCCESS")
        meta_items = []
        if target_type == "COMPANY":
            ico_value = identifier.replace("IČO ", "").strip()
            meta_items.append(("IČO", ico_value))
        meta_items.append(("Vygenerované", generated_at.strftime("%d.%m.%Y %H:%M:%S")))
        meta_items.append(("Počet strán", str(total_pages)))

        meta_style = self._style("MetaLine", fontName="Inter", fontSize=10, leading=13,
                                 textColor=colors.HexColor("#1e293b"))
        for label, value in meta_items:
            left_cells.append(Paragraph(
                f'<font color="#64748b" size="9">{label}</font>  '
                f'<font color="#1e293b" size="10"><b>{xml_escape(value)}</b></font>',
                meta_style,
            ))

        # ── Right column: metric cards (compact, stacked) ──
        total = len(sources)
        warnings = sum(1 for s in sources if self._effective_status(s) == "WARNING")
        info = sum(1 for s in sources if self._effective_status(s) == "INFO")
        successful = sum(1 for s in sources if s.status == "SUCCESS" and self._effective_status(s) not in ("WARNING", "INFO"))
        unavailable = sum(1 for s in sources if s.status == "UNAVAILABLE")
        failed = total - successful - unavailable - warnings - info

        right_cells = []
        metric_specs = [
            (successful, "V poriadku", "✓", "#dcfce7", "#166534"),
            (warnings, "Upozornení", "⚠", "#fee2e2", "#991b1b"),
        ]
        if info > 0:
            metric_specs.append((info, "Informácia", "ⓘ", "#dbeafe", "#1e40af"))
        if unavailable > 0:
            metric_specs.append((unavailable, "Nedostupné", "?", "#fef9c3", "#854d0e"))
        if failed > 0:
            metric_specs.append((failed, "Zlyhal", "✗", "#fee2e2", "#991b1b"))

        for count, label, icon, bg_hex, text_hex in metric_specs:
            right_cells.append(self._build_metric_pill(count, label, icon, bg_hex, text_hex))

        # Legal status badge below metrics
        if legal_badge:
            badge_style = self._style("LegalBadge", fontName="Inter-Bold", fontSize=8, leading=11,
                                     textColor=colors.white, alignment=1)
            badge_cell = Table([[Paragraph(xml_escape(legal_badge), badge_style)]], colWidths=[6.5 * cm])
            badge_cell.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#dc2626")),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("ROUNDEDCORNERS", [6, 6, 6, 6]),
            ]))
            right_cells.append(Spacer(1, 0.15 * cm))
            right_cells.append(badge_cell)

        # ── Two-column table (single row, each column is a nested table) ──
        left_inner = Table([[c] for c in left_cells], colWidths=[9.0 * cm])
        left_inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))

        right_inner = Table([[c] for c in right_cells], colWidths=[8.0 * cm])
        right_inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))

        info_table = Table([[left_inner, right_inner]], colWidths=[9.0 * cm, 8.0 * cm], hAlign="CENTER")
        info_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, -1), 12),
            ("LEFTPADDING", (1, 0), (1, -1), 4),
            ("RIGHTPADDING", (1, 0), (1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [info_table, Spacer(1, 0.4 * cm)]

    def _icon_flowable(self, char: str, size: float, fg: str, *,
                       shape: Optional[str] = None, fill: Optional[str] = None) -> Drawing:
        """Malá ikona: voliteľne v krúžku (circle) alebo štvorci (square)."""
        d = Drawing(size, size)
        cx = size / 2
        if shape == "circle":
            d.add(Circle(cx, cx, size / 2, fillColor=colors.HexColor(fill), strokeColor=None))
            fs = size * 0.72
        elif shape == "square":
            d.add(Rect(0, 0, size, size, rx=size * 0.22, ry=size * 0.22,
                       fillColor=colors.HexColor(fill), strokeColor=None))
            fs = size * 0.72
        else:
            fs = size
        d.add(String(cx, cx - fs * 0.34, char, fontName="Inter-Bold", fontSize=fs,
                     fillColor=colors.HexColor(fg), textAnchor="middle"))
        return d

    def _build_metric_pill(self, count: int, label: str, icon: str, bg_hex: str, text_hex: str) -> Table:
        text_color = colors.HexColor(text_hex)
        pill_style = self._style("MetricPill", fontName="Inter", fontSize=9, leading=12, textColor=text_color)

        text = Paragraph(
            f'<font size="11"><b>{count}</b></font>  '
            f'<font size="9">{label}</font>',
            pill_style,
        )

        # Ikona: info = "i" v krúžku, nedostupné = "?" v štvorci, inak plain glyf
        if icon == "ⓘ":
            icon_fl = self._icon_flowable("i", 12, fg="#ffffff", shape="circle", fill=text_hex)
        elif icon == "?":
            icon_fl = self._icon_flowable("?", 12, fg="#ffffff", shape="square", fill=text_hex)
        else:
            icon_fl = self._icon_flowable(icon, 11, fg=text_hex)

        pill = Table([[icon_fl, text]], colWidths=[0.75 * cm, 5.75 * cm])
        border_hex = self._darken_hex(bg_hex, 0.10)
        pill.setStyle(TableStyle([
            ("ALIGN", (0, 0), (0, 0), "CENTER"),
            ("ALIGN", (1, 0), (1, 0), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (0, 0), 12),
            ("RIGHTPADDING", (0, 0), (0, 0), 8),
            ("LEFTPADDING", (1, 0), (1, 0), 8),
            ("RIGHTPADDING", (1, 0), (1, 0), 8),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_hex)),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_hex)),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ]))
        return pill

    # ── Divider ────────────────────────────────────────────────────

    def _build_divider(self) -> list:
        section_style = self._style("Section", fontName="Inter-Bold", fontSize=13, leading=17,
                                    textColor=colors.HexColor("#18181b"))
        divider = Table([[""]], colWidths=[_CONTENT_WIDTH], hAlign="CENTER")
        divider.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [divider, Spacer(1, 0.35 * cm), Paragraph("Prehľad zdrojov", section_style), Spacer(1, 0.35 * cm)]

    # ── Source Table ───────────────────────────────────────────────

    def _build_status_pill(self, status: str) -> Table:
        color_hex, icon, label = _STATUS_PILL_CONFIG.get(status, _STATUS_PILL_CONFIG["FAILED"])
        text = Paragraph(f'<font color="white" size="8"><b>{label}</b></font>',
                         self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5))

        # Ikona: info = "i" v bielom krúžku, nedostupné = "?" v bielom štvorci, inak biely glyf
        if status == "INFO":
            icon_fl = self._icon_flowable("i", 9, fg=color_hex, shape="circle", fill="#ffffff")
        elif status == "UNAVAILABLE":
            icon_fl = self._icon_flowable("?", 9, fg=color_hex, shape="square", fill="#ffffff")
        else:
            icon_fl = self._icon_flowable(icon, 9, fg="#ffffff")

        pill = Table([[icon_fl, text]], colWidths=[0.42 * cm, 2.5 * cm])
        pill.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(color_hex)),
            ("ALIGN", (0, 0), (0, 0), "CENTER"),
            ("ALIGN", (1, 0), (1, 0), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (0, 0), 6),
            ("RIGHTPADDING", (0, 0), (0, 0), 2),
            ("LEFTPADDING", (1, 0), (1, 0), 2),
            ("RIGHTPADDING", (1, 0), (1, 0), 6),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ]))
        return pill

    def _build_findings(self, source: ScrapedSource, status: str = "SUCCESS") -> Paragraph:
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

        # 5. Highlight POZOR — pre informačné zdroje modrá INFO, inak červené upozornenie
        if "POZOR" in findings:
            if status == "INFO":
                findings = findings.replace("POZOR!", '<font color="#2563eb"><b>INFO:</b></font>')
                findings = findings.replace("POZOR:", '<font color="#2563eb"><b>INFO:</b></font>')
                findings = findings.replace("POZOR", '<font color="#2563eb"><b>INFO</b></font>')
            else:
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

    def _build_source_label(self, source: ScrapedSource, status: str = "SUCCESS") -> Paragraph:
        label = _SOURCE_LABELS.get(source.source_type, source.source_type)
        status_color = _STATUS_PILL_CONFIG.get(status, _STATUS_PILL_CONFIG["FAILED"])[0]
        table_style = self._style("TableCell", fontName="Inter-Bold", fontSize=9, leading=12.5,
                                 textColor=colors.HexColor(status_color))
        start_page = getattr(source, "start_page", None)
        if start_page:
            return Paragraph(
                f'<a href="http://PAGE_{start_page}" color="{status_color}">{label}</a>'
                f' <font size="8" color="{status_color}">↗</font>',
                table_style,
            )
        return Paragraph(label, table_style)

    def _build_source_status_cell(self, source: ScrapedSource, status: str) -> Table:
        """Kombinovaná bunka: názov zdroja (s ↗ odkazom) navrchu + status pill pod ním."""
        label_para = self._build_source_label(source, status)
        pill = self._build_status_pill(status)
        cell = Table([[label_para], [pill]], colWidths=[3.7 * cm])
        cell.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (0, 0), 0),
            ("BOTTOMPADDING", (0, 0), (0, 0), 4),
            ("TOPPADDING", (0, 1), (0, 1), 0),
            ("BOTTOMPADDING", (0, 1), (0, 1), 0),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return cell

    def _build_source_row(self, source: ScrapedSource) -> list:
        start_page = getattr(source, "start_page", None)
        page_text = str(start_page) if start_page else "—"
        table_style = self._style("TableCell", fontName="Inter", fontSize=9, leading=12.5)
        effective_status = self._effective_status(source)
        return [
            self._build_source_status_cell(source, effective_status),
            self._build_findings(source, effective_status),
            Paragraph(page_text, ParagraphStyle("PageNum", parent=table_style, alignment=1)),
        ]

    def _build_source_table(self, sources: List[ScrapedSource]) -> list:
        # Moderná hlavička: uppercase, tlmené, menšie písmo + akcentová línia pod ňou
        hdr_style = self._style("ColHdr", fontName="Inter-Bold", fontSize=8, leading=11,
                                textColor=colors.HexColor("#64748b"))
        hdr_center = ParagraphStyle("ColHdrC", parent=hdr_style, alignment=1)

        header_row = [
            Paragraph("ZDROJ &amp; STAV", hdr_style),
            Paragraph("SÚHRNNÝ NÁLEZ", hdr_style),
            Paragraph("STR.", hdr_center),
        ]

        rows = [header_row]
        styles_list = list(_BASE_TABLE_STYLE)

        styles_list.extend([
            ("BACKGROUND", (0, 0), (-1, 0), colors.white),
            ("TOPPADDING", (0, 0), (-1, 0), 2),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("LINEBELOW", (0, 0), (-1, 0), 1.5, colors.HexColor(_ACCENT)),
        ])

        source_map = {s.source_type: s for s in sources}
        rendered = set()

        cat_header_style = self._style("CatHeader", fontName="Inter-Bold", fontSize=10.5, leading=14,
                                       textColor=colors.HexColor("#0f172a"))

        row_idx = 1  # Pretože riadok 0 je header

        def add_category(label: str, cat_sources: list):
            nonlocal row_idx
            rows.append([Paragraph(f'<b>{label}</b>', cat_header_style), "", ""])

            styles_list.extend([
                ("SPAN", (0, row_idx), (-1, row_idx)),
                ("BACKGROUND", (0, row_idx), (-1, row_idx), colors.HexColor("#f8fafc")),
                ("LINEBEFORE", (0, row_idx), (0, row_idx), 3, colors.HexColor(_ACCENT)),
                ("TOPPADDING", (0, row_idx), (-1, row_idx), 9),
                ("BOTTOMPADDING", (0, row_idx), (-1, row_idx), 9),
                ("LEFTPADDING", (0, row_idx), (-1, row_idx), 12),
                ("LINEBELOW", (0, row_idx), (-1, row_idx), 0.5, colors.HexColor("#e2e8f0")),
            ])
            row_idx += 1

            for source in cat_sources:
                rows.append(self._build_source_row(source))
                styles_list.append(("LINEBELOW", (0, row_idx), (-1, row_idx), 0.5, colors.HexColor("#f0f0f0")))
                row_idx += 1

        for cat_label, cat_source_ids in _SOURCE_CATEGORIES:
            cat_sources = [source_map[sid] for sid in cat_source_ids if sid in source_map]
            if not cat_sources:
                continue
            for s in cat_sources:
                rendered.add(s.source_type)
            add_category(cat_label, cat_sources)

        # Uncategorised sources
        remaining = [s for s in sources if s.source_type not in rendered]
        if remaining:
            add_category("Ostatné", remaining)

        master_table = Table(rows, colWidths=_COL_WIDTHS, repeatRows=1, hAlign="CENTER")
        master_table.setStyle(TableStyle(styles_list))

        return [master_table, Spacer(1, 0.4 * cm)]

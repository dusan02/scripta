from __future__ import annotations
import io
import os
import tempfile
import logging
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import List, Optional

from PyPDF2 import PdfWriter, PdfReader
from PyPDF2.generic import ArrayObject, NumberObject, NameObject

from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors

from ..report_generator import SOURCE_CATEGORY_DEFS as _SOURCE_CATEGORIES, SOURCE_LABEL_I18N_KEYS as _SOURCE_LABEL_KEYS
from ..models import ScrapedSource
from ..i18n import get_i18n_strings

logger = logging.getLogger(__name__)

_FONTS_REGISTERED = False
_FONT_LOCK = Lock()

# Zdroje, ktoré už majú vlastný nadpis vložený scraperom (_generate_clean_pdf / _generate_no_results_pdf).
# Pre tieto zdroje compiler nepridáva ďalší overlay nadpis, aby sa neduplikoval.
_SOURCES_WITH_EMBEDDED_TITLE = frozenset({
    "ORSR",
    "OBCHODNY_VESTNIK",
    "SP_DLZNICI",
    "VSZP_DLZNICI",
    "UNION_DLZNICI",
    "DOVERA_DLZNICI",
    "CRZ",
    "UVO",
    "NCRZP",
    "NCRD",
    "REGISTER_UZ",
    "RPO",
    "DISKVALIFIKACIE",
    "FINANCNA_SPRAVA",
})

# Canonical order of sources for PDF compilation (matches cover page categories)
_SOURCE_ORDER = {sid: idx for idx, sid in enumerate(sid for _, ids in _SOURCE_CATEGORIES for sid in ids)}

# Markers indicating "no record found" — source has no data to show in PDF appendix.
# Ak findings/status_message obsahuje niektorý z týchto textov, PDF sa nezahrnie do príloh.
# Platlí univerzálne pre všetky registre.
_NO_RECORD_MARKERS = (
    "nie je evidovaný",
    "žiadny záznam",
    "nenašli sa žiadne",
    "neobsahuje žiadne",
    "nie je v zozname",
    "žiadne nedoplatky",
    "žiadne výsledky",
    "bez výsledkov",
    "neboli nájdené žiadne",
    "0 záznamov",
    "žiadne záznamy",
    "bez nálezu",
    "nemá negatívne záznamy",
)


def _has_no_record(source: ScrapedSource) -> bool:
    """True ak zdroj nenašiel žiadny záznam — PDF sa nezahrnie do príloh.
    Univerzálne pravidlo: záznam existuje → prilož PDF, záznam neexistuje → vynechaj PDF."""
    if source.status != "SUCCESS":
        return True
    if not source.file_path:
        return True
    findings = (source.findings or source.status_message or "").lower()
    return any(marker in findings for marker in _NO_RECORD_MARKERS)


class PdfCompiler:
    """
    Zlúči HTML Cover Page (s AI posudkom a prehľadom zdrojov) + všetky stiahnuté PDF do jedného Evidence Binder.
    Pridáva časovú pečiatku do metadata (placeholder pre digitálny podpis).
    """

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir
        self.results_dir.mkdir(parents=True, exist_ok=True)

    async def compile(
        self,
        *,
        report_request_id: str,
        target_type: str,
        identifier: str,
        sources: List[ScrapedSource],
        company_name: Optional[str] = None,
        report_language: str = "sk",
    ) -> Path:
        output_dir = self.results_dir / report_request_id
        output_dir.mkdir(parents=True, exist_ok=True)
        self._report_language = report_language
        i18n_strings = get_i18n_strings(report_language)

        generated_at = datetime.now(ZoneInfo("Europe/Bratislava"))
        generated_at_str = generated_at.strftime("%d.%m.%Y %H:%M:%S")

        # 0. Zotriedime zdroje podľa kategorického poradia (rovnaké ako na cover page).
        sources = sorted(sources, key=lambda s: _SOURCE_ORDER.get(s.source_type, 999))

        # 1. Spočítame skutočný počet strán pre všetky zdroje.
        # Cover page môže mať 1+ strán — nepoznáme ich ešte, tak predpokladáme 1 a opravíme neskôr.
        for source in sources:
            if source.status == "SUCCESS" and source.file_path and Path(source.file_path).exists():
                try:
                    if os.path.getsize(source.file_path) == 0:
                        source.page_count = 0
                        logger.warning(f"[PdfCompiler] Zdroj {source.source_type} vygeneroval prázdny súbor (0 bytes).")
                    else:
                        source.page_count = len(PdfReader(source.file_path).pages)
                except Exception as e:
                    logger.warning(f"[PdfCompiler] Zdroj {source.source_type} vygeneroval neplatné PDF: {e}")
                    source.page_count = 0
            else:
                source.page_count = 0

        start_pages_map = {}

        # 2. Pomocná funkcia na priradenie start_page s predpokladaným počtom strán cover page.
        # +1 za divider page (PRÍLOHY - ZDROJOVÉ DÁTA) medzi Part A a Part B.
        def _assign_start_pages(cover_pages: int):
            start_pages_map['SCORING_BREAKDOWN'] = cover_pages - 5
            start_pages_map['FORENZNY_POSUDOK'] = cover_pages - 4
            start_pages_map['SUVAHA'] = cover_pages - 3
            start_pages_map['VYKAZ_ZISKOV'] = cover_pages - 2
            start_pages_map['CASH_FLOW'] = cover_pages - 1
            start_pages_map['FINANCNY_POSUDOK'] = cover_pages
            
            current = cover_pages + 2  # +1 za divider page, +1 za prvú stránu zdrojov
            for source in sources:
                # Univerzálne pravidlo: záznam neexistuje → vynechaj PDF
                if _has_no_record(source):
                    source.start_page = None
                    source.page_count = 0
                    continue
                if source.status == "SUCCESS" and source.file_path and source.page_count is not None and source.page_count > 0:
                    source.start_page = current
                    start_pages_map[source.source_type] = current
                    current += source.page_count
                else:
                    source.start_page = None

        from src.report_generator import generate_forensic_pdf_report
        ico = identifier.replace("IČO ", "").strip()

        # 3. Odhadneme počet strán cover page podľa počtu zdrojov (vyhneme sa dvojitej generácii).
        success_sources = [s for s in sources if s.status == "SUCCESS"]
        estimated_cover_pages = 7 if len(success_sources) <= 18 else 8
        cover_path = output_dir / "cover_page.pdf"
        _assign_start_pages(estimated_cover_pages)

        # Calculate total pages = cover_pages + divider(1) + sum of included source pages
        total_sources_pages = sum(s.page_count for s in sources if s.page_count)

        await generate_forensic_pdf_report(
            ico=ico,
            sources=sources,
            start_pages_map=start_pages_map,
            total_pages=estimated_cover_pages + 1 + total_sources_pages,
            generated_at=generated_at_str,
            target_path=str(cover_path),
            report_language=report_language,
        )
        actual_cover_pages = len(PdfReader(str(cover_path)).pages)

        # 4. Ak sa odhad mýli, regenerujeme s opravenými start_page.
        if actual_cover_pages != estimated_cover_pages:
            _assign_start_pages(actual_cover_pages)
            await generate_forensic_pdf_report(
                ico=ico,
                sources=sources,
                start_pages_map=start_pages_map,
                total_pages=actual_cover_pages + 1 + total_sources_pages,
                generated_at=generated_at_str,
                target_path=str(cover_path),
                report_language=report_language,
            )

        # 5. Zlúčime cover page + divider + PDF zdrojov pomocou PdfWriter.
        writer = PdfWriter()
        writer.append(cover_path)

        # Divider page: "PRÍLOHY - ZDROJOVÉ DÁTA" medzi Part A a Part B
        divider_path = self._generate_divider_page(output_dir, report_language=report_language)
        writer.append(divider_path)

        # Paralelizácia overlay nadpisov — každý overlay je nezávislý (vlastný súbor).
        sources_needing_overlay = [
            s for s in sources
            if s.start_page is not None and s.file_path
            and s.source_type not in _SOURCES_WITH_EMBEDDED_TITLE
        ]
        if sources_needing_overlay:
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(self._overlay_title_on_source, sources_needing_overlay))

        skipped_no_record = []
        bookmarks = []
        bookmarks.append((i18n_strings.get("divider_title", "PRÍLOHY") + " — " + i18n_strings.get("divider_subtitle", "ZDROJOVÉ DÁTA"), actual_cover_pages))
        
        for source in sources:
            if source.start_page is not None and source.file_path:
                writer.append(source.file_path)
                label = i18n_strings.get(_SOURCE_LABEL_KEYS.get(source.source_type, source.source_type), source.source_type)
                bookmarks.append((label, source.start_page - 1))
            elif _has_no_record(source) and source.status == "SUCCESS":
                skipped_no_record.append(source.source_type)

        if skipped_no_record:
            logger.info(f"[PdfCompiler] Preskočených {len(skipped_no_record)} zdrojov bez záznamu: {skipped_no_record}")

        # 6. Pridanie čísel strán do pätičky (okrem cover page a divider page)
        # PyPDF2 3.0.1 má bug, kedy merge_page na writeri vymaže obsah.
        # Preto to spravíme bezpečne prečítaním dočastného buffra.
        writer = self._add_page_numbers(writer, skip_pages=actual_cover_pages + 1, bookmarks=bookmarks)

        # 4. Nahradenie falošných URL odkazov z Cover Page za vnútorné prelinkovania na stránky (GoTo Action)
        # Spracováme PO _add_page_numbers, aby anotácie fungovali na stránkach nového writera.
        for cover_idx in range(actual_cover_pages):
            cover_page_obj = writer.pages[cover_idx]
            if "/Annots" in cover_page_obj:
                annots = cover_page_obj["/Annots"]
                if hasattr(annots, "get_object"):
                    annots = annots.get_object()
                if not annots or not hasattr(annots, "__iter__"):
                    continue
                for annot in annots:
                    annot_obj = annot.get_object()
                    a_obj = None
                    if "/A" in annot_obj:
                        a_val = annot_obj["/A"]
                        a_obj = a_val.get_object() if hasattr(a_val, "get_object") else a_val
                    if a_obj and a_obj.get("/S") == "/URI":
                        uri = a_obj.get("/URI")
                        if isinstance(uri, str) and "http://page_" in uri.lower():
                            import re
                            match = re.search(r'page_(\d+)', uri, re.IGNORECASE)
                            if match:
                                target_page_idx = int(match.group(1)) - 1
                                if 0 <= target_page_idx < len(writer.pages):
                                    target_page = writer.pages[target_page_idx]
                                    if "/A" in annot_obj:
                                        del annot_obj["/A"]
                                    annot_obj[NameObject("/Dest")] = ArrayObject([
                                        target_page.indirect_reference, 
                                        NameObject("/XYZ"), 
                                        NumberObject(0), 
                                        target_page.mediabox.top, 
                                        NumberObject(0)
                                    ])

        # 5. Opečiatkujeme metadata časovou pečiatkou (po _add_page_numbers, lebo vytvára nový writer).
        writer.add_metadata(
            {
                "/Title": f"Verifa.sk — Due Diligence Report — {identifier}",
                "/Author": "Verifa.sk",
                "/Subject": "Due Diligence Report — automatizovaný výpis zo štátnych registrov SR",
                "/Keywords": "due diligence, verifa, report, ORSR, ZRSR, insolvencia, exekúcie, RPVS",
                "/Producer": "Verifa.sk PDF Worker",
                "/Creator": "Verifa.sk (https://verifa.sk)",
                "/CreationDate": generated_at.strftime("D:%Y%m%d%H%M%S+00'00'"),
                "/VerifaGeneratedAt": generated_at.isoformat(),
                "/VerifaReportId": report_request_id,
            }
        )

        # Nastavíme page mode na zobrazenie panelu záložiek (obsahu) pri otvorení PDF.
        writer.page_mode = "/UseOutlines"

        final_path = output_dir / "evidence_binder.pdf"
        with open(final_path, "wb") as f:
            writer.write(f)
        writer.close()

        return final_path

    def _add_page_numbers(self, writer: PdfWriter, skip_pages: int, bookmarks: List[tuple]) -> PdfWriter:
        """Pridá číslo strany do pravého dolného rohu na každú stranu okrem prvých skip_pages
        (cover page + divider page). Y = total - skip_pages = počet obsahových strán."""
        global _FONTS_REGISTERED
        if not _FONTS_REGISTERED:
            with _FONT_LOCK:
                if not _FONTS_REGISTERED:
                    fonts_dir = Path(__file__).parent / "fonts"
                    pdfmetrics.registerFont(TTFont("Inter", str(fonts_dir / "Inter-Regular.ttf")))
                    pdfmetrics.registerFont(TTFont("Inter-Bold", str(fonts_dir / "Inter-Bold.ttf")))
                    _FONTS_REGISTERED = True

        _i18n = get_i18n_strings(getattr(self, '_report_language', 'sk'))

        # Bezpečný prístup: Zapíšeme doterajší stav do buffra a znova načítame.
        # Tým sa vyhneme PyPDF2 bugu s merge_page na modifikovaných stránkach.
        temp_buf = io.BytesIO()
        writer.write(temp_buf)
        temp_buf.seek(0)
        
        safe_reader = PdfReader(temp_buf)
        new_writer = PdfWriter()
        new_writer.append_pages_from_reader(safe_reader) # Skopíruje aj metadáta a outline, ale pages si vypýtame priamo
        
        # Očistíme new_writer pages a nahráme ich ručne, aby sme aplikovali merge
        new_writer = PdfWriter()

        total = len(safe_reader.pages)
        content_total = total - skip_pages
        
        for i in range(total):
            page = safe_reader.pages[i]
            if i < skip_pages:
                new_writer.add_page(page)
                continue
                
            page_w = float(page.mediabox.width)
            page_h = float(page.mediabox.height)

            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
            c.setFont("Inter", 9)
            c.setFillColor(colors.HexColor("#94a3b8"))
            c.drawRightString(page_w - 35, 20, _i18n.get("page_number_format", "Strana {current} z {total}").format(current=i - skip_pages + 1, total=content_total))
            c.showPage()
            c.save()
            buf.seek(0)

            overlay_reader = PdfReader(buf)
            page.merge_page(overlay_reader.pages[0])
            new_writer.add_page(page)
            
        # Obnova outline a metadát
        for label, page_idx in bookmarks:
            new_writer.add_outline_item(label, page_idx)
            
        return new_writer

    def _generate_divider_page(self, output_dir: Path, report_language: str = "sk") -> Path:
        """Vygeneruje stránku 'PRÍLOHY - ZDROJOVÉ DÁTA' ako prechod medzi Part A a Part B."""
        global _FONTS_REGISTERED
        if not _FONTS_REGISTERED:
            with _FONT_LOCK:
                if not _FONTS_REGISTERED:
                    fonts_dir = Path(__file__).parent / "fonts"
                    pdfmetrics.registerFont(TTFont("Inter", str(fonts_dir / "Inter-Regular.ttf")))
                    pdfmetrics.registerFont(TTFont("Inter-Bold", str(fonts_dir / "Inter-Bold.ttf")))
                    _FONTS_REGISTERED = True

        i18n_strings = get_i18n_strings(report_language)

        divider_path = output_dir / "_divider.pdf"
        buf = io.BytesIO()
        c = rl_canvas.Canvas(buf, pagesize=(595, 842))  # A4

        # Plná biela stránka s veľkým nadpisom
        c.setFillColor(colors.white)
        c.rect(0, 0, 595, 842, fill=1, stroke=0)

        # Horizontálna čiara hore
        c.setStrokeColor(colors.HexColor("#10b981"))
        c.setLineWidth(3)
        c.line(80, 500, 515, 500)

        # Nadpis
        c.setFont("Inter-Bold", 28)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.drawString(80, 460, i18n_strings.get("divider_title", "PRÍLOHY"))

        c.setFont("Inter-Bold", 16)
        c.setFillColor(colors.HexColor("#64748b"))
        c.drawString(80, 435, i18n_strings.get("divider_subtitle", "ZDROJOVÉ DÁTA — AUDIT TRAIL"))

        # Podnadpis
        c.setFont("Inter", 11)
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.drawString(80, 400, i18n_strings.get("divider_desc_1", "Nasledujúce stránky obsahujú originálne výpisy zo štátnych registrov."))
        c.drawString(80, 385, i18n_strings.get("divider_desc_2", "Prílohy sú chronologicky zoradené podľa zdroja v Obsahu reportu."))

        # Dolná akcentná čiara
        c.setStrokeColor(colors.HexColor("#10b981"))
        c.setLineWidth(1.5)
        c.line(80, 360, 200, 360)

        # Brand v päte
        c.setFont("Inter", 9)
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.drawString(80, 60, i18n_strings.get("divider_footer", "Verifa.sk — Due Diligence reporty zo štátnych registrov SR"))
        c.drawRightString(515, 60, "www.verifa.sk")

        c.showPage()
        c.save()
        buf.seek(0)

        with open(divider_path, "wb") as f:
            f.write(buf.getvalue())
        return divider_path

    def _overlay_title_on_source(self, source: ScrapedSource) -> None:
        """Pridá nadpis (názov zdroja) na prvú stránku zdrojového PDF pred zlúčením."""
        if not source.file_path or not Path(source.file_path).exists():
            return

        global _FONTS_REGISTERED
        if not _FONTS_REGISTERED:
            with _FONT_LOCK:
                if not _FONTS_REGISTERED:
                    fonts_dir = Path(__file__).parent / "fonts"
                    pdfmetrics.registerFont(TTFont("Inter", str(fonts_dir / "Inter-Regular.ttf")))
                    pdfmetrics.registerFont(TTFont("Inter-Bold", str(fonts_dir / "Inter-Bold.ttf")))
                    _FONTS_REGISTERED = True

        _i18n = get_i18n_strings(getattr(self, '_report_language', 'sk'))
        label = _i18n.get(_SOURCE_LABEL_KEYS.get(source.source_type, source.source_type), source.source_type)
        label = label.upper()
        try:
            reader = PdfReader(source.file_path)
            first_page = reader.pages[0]
            page_w = float(first_page.mediabox.width)
            page_h = float(first_page.mediabox.height)

            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
            
            # Posunúť obsah PDF o 60 bodov nižšie aby ho neprekryl nadpis (najmä pre Finančnú správu)
            if source.source_type.startswith("FS_"):
                try:
                    from PyPDF2 import Transformation
                    first_page.add_transformation(Transformation().translate(0, -60))
                except Exception as trans_err:
                    logger.debug(f"[PdfCompiler] Nepodarilo sa posunúť obsah PDF: {trans_err}")

            # Biely background pre nadpis — aby neprekryval obsah PDF
            c.setFillColor(colors.white)
            c.rect(0, page_h - 56, page_w, 56, fill=1, stroke=0)
            
            # section-title štýl (text-sm, uppercase, text-slate-500)
            c.setFont("Inter-Bold", 10)
            c.setFillColor(colors.HexColor("#475569"))
            
            x_margin = 35
            y_pos = page_h - 28
            c.drawString(x_margin, y_pos, label)
            
            # Brand na pravej strane
            c.setFont("Inter", 8)
            c.setFillColor(colors.HexColor("#94a3b8"))
            c.drawRightString(page_w - x_margin, y_pos, "Verifa.sk")
            
            # Akcentná čiara pod nadpisom (emerald, hrubšia)
            c.setStrokeColor(colors.HexColor("#10b981"))
            c.setLineWidth(1.5)
            c.line(x_margin, y_pos - 10, page_w - x_margin, y_pos - 10)
            
            c.showPage()
            c.save()
            buf.seek(0)

            overlay_reader = PdfReader(buf)
            first_page.merge_page(overlay_reader.pages[0])

            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
                
            fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(source.file_path), suffix=".pdf")
            with os.fdopen(fd, "wb") as f:
                writer.write(f)
            writer.close()
            os.replace(tmp_path, source.file_path)
            logger.info(f"[PdfCompiler] Nadpis '{label}' pridaný do {source.file_path}")
        except Exception as e:
            logger.warning(f"[PdfCompiler] Pridanie nadpisu pre {source.source_type} zlyhalo: {e}")

    @staticmethod
    def read_page_count(file_path: Path) -> Optional[int]:
        try:
            return len(PdfReader(str(file_path)).pages)
        except Exception:
            return None

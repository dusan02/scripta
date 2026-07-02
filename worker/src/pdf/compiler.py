from __future__ import annotations
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from PyPDF2 import PdfWriter, PdfReader
from PyPDF2.generic import ArrayObject, NumberObject, NameObject

from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors

from ..report_generator import SOURCE_CATEGORIES as _SOURCE_CATEGORIES, SOURCE_LABELS as _SOURCE_LABELS
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_FONTS_REGISTERED = False

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
    ) -> Path:
        output_dir = self.results_dir / report_request_id
        output_dir.mkdir(parents=True, exist_ok=True)

        generated_at = datetime.now(timezone.utc)
        generated_at_str = generated_at.strftime("%d.%m.%Y %H:%M:%S")

        # 0. Zotriedime zdroje podľa kategorického poradia (rovnaké ako na cover page).
        sources = sorted(sources, key=lambda s: _SOURCE_ORDER.get(s.source_type, 999))

        # 1. Spočítame skutočný počet strán pre všetky zdroje.
        # Cover page môže mať 1+ strán — nepoznáme ich ešte, tak predpokladáme 1 a opravíme neskôr.
        for source in sources:
            if source.status == "SUCCESS" and source.file_path and Path(source.file_path).exists():
                try:
                    source.page_count = len(PdfReader(source.file_path).pages)
                except Exception:
                    source.page_count = source.page_count or 1
            else:
                source.page_count = 0

        start_pages_map = {}

        # 2. Pomocná funkcia na priradenie start_page s predpokladaným počtom strán cover page.
        def _assign_start_pages(cover_pages: int):
            start_pages_map['FORENZNY_POSUDOK'] = cover_pages - 5
            start_pages_map['SCORING_BREAKDOWN'] = cover_pages - 4
            start_pages_map['SUVAHA'] = cover_pages - 3
            start_pages_map['VYKAZ_ZISKOV'] = cover_pages - 2
            start_pages_map['CASH_FLOW'] = cover_pages - 1
            start_pages_map['FINANCNY_POSUDOK'] = cover_pages
            
            current = cover_pages + 1
            for source in sources:
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

        # Calculate total pages = cover_pages + sum of all source pages
        total_sources_pages = sum(s.page_count for s in sources if s.page_count)

        await generate_forensic_pdf_report(
            ico=ico,
            sources=sources,
            start_pages_map=start_pages_map,
            total_pages=estimated_cover_pages + total_sources_pages,
            generated_at=generated_at_str,
            target_path=str(cover_path)
        )
        actual_cover_pages = len(PdfReader(str(cover_path)).pages)

        # 4. Ak sa odhad mýli, regenerujeme s opravenými start_page.
        if actual_cover_pages != estimated_cover_pages:
            _assign_start_pages(actual_cover_pages)
            await generate_forensic_pdf_report(
                ico=ico,
                sources=sources,
                start_pages_map=start_pages_map,
                total_pages=actual_cover_pages + total_sources_pages,
                generated_at=generated_at_str,
                target_path=str(cover_path)
            )

        # 5. Zlúčime cover page + PDF zdrojov pomocou PdfWriter.
        writer = PdfWriter()
        writer.append(cover_path)

        # Paralelizácia overlay nadpisov — každý overlay je nezávislý (vlastný súbor).
        sources_needing_overlay = [
            s for s in sources
            if s.start_page is not None and s.file_path
            and s.source_type not in _SOURCES_WITH_EMBEDDED_TITLE
        ]
        if sources_needing_overlay:
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(self._overlay_title_on_source, sources_needing_overlay))

        for source in sources:
            if source.start_page is not None and source.file_path:
                writer.append(source.file_path)
                label = _SOURCE_LABELS.get(source.source_type, source.source_type)
                writer.add_outline_item(label, source.start_page - 1)

        # 4. Nahradenie falošných URL odkazov z Cover Page za vnútorné prelinkovania na stránky (GoTo Action)
        # Cover page môže mať viac stránok — spracujeme anotácie na každej z nich.
        cover_page_count = len(PdfReader(str(cover_path)).pages)
        for cover_idx in range(cover_page_count):
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

        # 5. Opečiatkujeme metadata časovou pečiatkou.
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

    def _overlay_title_on_source(self, source: ScrapedSource) -> None:
        """Pridá nadpis (názov zdroja) na prvú stránku zdrojového PDF pred zlúčením."""
        if not source.file_path or not Path(source.file_path).exists():
            return

        global _FONTS_REGISTERED
        if not _FONTS_REGISTERED:
            fonts_dir = Path(__file__).parent / "fonts"
            pdfmetrics.registerFont(TTFont("Inter", str(fonts_dir / "Inter-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("Inter-Bold", str(fonts_dir / "Inter-Bold.ttf")))
            _FONTS_REGISTERED = True

        label = _SOURCE_LABELS.get(source.source_type, source.source_type)
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
            c.rect(0, page_h - 50, page_w, 50, fill=1, stroke=0)
            
            # section-title štýl (text-sm, uppercase, text-slate-500)
            c.setFont("Inter-Bold", 10)
            c.setFillColor(colors.HexColor("#64748b"))
            
            x_margin = 35
            y_pos = page_h - 30
            c.drawString(x_margin, y_pos, label)
            
            # border-b (border-slate-200)
            c.setStrokeColor(colors.HexColor("#e2e8f0"))
            c.setLineWidth(1)
            c.line(x_margin, y_pos - 8, page_w - x_margin, y_pos - 8)
            
            c.showPage()
            c.save()
            buf.seek(0)

            overlay_reader = PdfReader(buf)
            first_page.merge_page(overlay_reader.pages[0])

            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            with open(source.file_path, "wb") as f:
                writer.write(f)
            writer.close()
            logger.info(f"[PdfCompiler] Nadpis '{label}' pridaný do {source.file_path}")
        except Exception as e:
            logger.warning(f"[PdfCompiler] Pridanie nadpisu pre {source.source_type} zlyhalo: {e}")

    @staticmethod
    def read_page_count(file_path: Path) -> Optional[int]:
        try:
            return len(PdfReader(str(file_path)).pages)
        except Exception:
            return None

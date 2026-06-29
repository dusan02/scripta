from __future__ import annotations
import io
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from PyPDF2 import PdfWriter, PdfReader
from PyPDF2.generic import ArrayObject, NumberObject, NameObject

from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

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
            current = cover_pages + 1
            for source in sources:
                if source.status == "SUCCESS" and source.file_path and source.page_count > 0:
                    source.start_page = current
                    start_pages_map[source.source_type] = current
                    current += source.page_count
                else:
                    source.start_page = None

        from src.report_generator import generate_forensic_pdf_report
        ico = identifier.replace("IČO ", "").strip()

        # 3. Odhadneme počet strán cover page podľa počtu zdrojov (vyhneme sa dvojitej generácii).
        success_sources = [s for s in sources if s.status == "SUCCESS"]
        estimated_cover_pages = 1 if len(success_sources) <= 18 else 2
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

        for source in sources:
            if source.start_page is not None and source.file_path:
                # Pridáme nadpis na prvú stránku zdrojového PDF pred zlúčením.
                # Preskakujeme zdroje, ktoré už majú vlastný nadpis od scrapera.
                if source.source_type not in _SOURCES_WITH_EMBEDDED_TITLE:
                    self._overlay_title_on_source(source)
                writer.append(source.file_path)
                label = _SOURCE_LABELS.get(source.source_type, source.source_type)
                writer.add_outline_item(label, source.start_page - 1)

        # 4. Nahradenie falošných URL odkazov z Cover Page za vnútorné prelinkovania na stránky (GoTo Action)
        # Cover page môže mať viac stránok — spracujeme anotácie na každej z nich.
        cover_page_count = len(PdfReader(str(cover_path)).pages)
        for cover_idx in range(cover_page_count):
            cover_page_obj = writer.pages[cover_idx]
            if "/Annots" in cover_page_obj:
                for annot in cover_page_obj["/Annots"]:
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
        try:
            reader = PdfReader(source.file_path)
            first_page = reader.pages[0]
            page_w = float(first_page.mediabox.width)
            page_h = float(first_page.mediabox.height)

            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
            c.setFont("Inter-Bold", 13)
            c.drawCentredString(page_w / 2, page_h - 25, label)
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

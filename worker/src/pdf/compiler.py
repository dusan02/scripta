from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from PyPDF2 import PdfWriter, PdfReader
from PyPDF2.generic import ArrayObject, NumberObject, NameObject

from .cover_page import CoverPageGenerator
from ..models import ScrapedSource


class PdfCompiler:
    """
    Zlúči Cover Page + všetky stiahnuté PDF do jedného Evidence Binder.
    Pridáva časovú pečiatku do metadata (placeholder pre digitálny podpis).
    """

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.cover_generator = CoverPageGenerator()

    def compile(
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

        # 2. Pomocná funkcia na priradenie start_page s predpokladaným počtom strán cover page.
        def _assign_start_pages(cover_pages: int):
            current = cover_pages + 1
            for source in sources:
                if source.status == "SUCCESS" and source.file_path and source.page_count > 0:
                    source.start_page = current
                    current += source.page_count
                else:
                    source.start_page = None

        # 3. Prvý pokus: predpokladáme 1-stranový cover, vygenerujeme a zistíme reálny počet.
        cover_path = output_dir / "cover_page.pdf"
        _assign_start_pages(1)
        self.cover_generator.generate(
            output_path=cover_path,
            target_type=target_type,
            identifier=identifier,
            sources=sources,
            generated_at=generated_at,
            company_name=company_name,
        )
        actual_cover_pages = len(PdfReader(str(cover_path)).pages)

        # 4. Ak má cover page viac strán, opravíme start_page a regenerujeme.
        if actual_cover_pages != 1:
            _assign_start_pages(actual_cover_pages)
            self.cover_generator.generate(
                output_path=cover_path,
                target_type=target_type,
                identifier=identifier,
                sources=sources,
                generated_at=generated_at,
                company_name=company_name,
            )

        # 5. Zlúčime cover page + PDF zdrojov pomocou PdfWriter.
        writer = PdfWriter()
        writer.append(cover_path)

        for source in sources:
            if source.start_page is not None and source.file_path:
                writer.append(source.file_path)
                writer.add_outline_item(source.source_type, source.start_page - 1)

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
                        if isinstance(uri, str) and uri.startswith("http://PAGE_"):
                            target_page_idx = int(uri.replace("http://PAGE_", "")) - 1
                            if 0 <= target_page_idx < len(writer.pages):
                                target_page = writer.pages[target_page_idx]
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
                "/Title": f"Registro.sk — Due Diligence Report — {identifier}",
                "/Author": "Registro.sk",
                "/Producer": "Registro.sk PDF Worker",
                "/CreationDate": generated_at.strftime("D:%Y%m%d%H%M%S+00'00'"),
                "/RegistroGeneratedAt": generated_at.isoformat(),
                "/RegistroReportId": report_request_id,
            }
        )

        final_path = output_dir / "evidence_binder.pdf"
        with open(final_path, "wb") as f:
            writer.write(f)
        writer.close()

        return final_path

    @staticmethod
    def read_page_count(file_path: Path) -> Optional[int]:
        try:
            return len(PdfReader(str(file_path)).pages)
        except Exception:
            return None

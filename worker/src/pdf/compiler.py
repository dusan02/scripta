from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from PyPDF2 import PdfMerger, PdfReader

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
    ) -> Path:
        output_dir = self.results_dir / report_request_id
        output_dir.mkdir(parents=True, exist_ok=True)

        generated_at = datetime.now(timezone.utc)

        # 1. Generujeme titulnú stranu.
        cover_path = output_dir / "cover_page.pdf"
        self.cover_generator.generate(
            output_path=cover_path,
            target_type=target_type,
            identifier=identifier,
            sources=sources,
            generated_at=generated_at,
        )

        # 2. Zlúčime cover page + PDF zdrojov, ktoré majú file_path.
        merger = PdfMerger()
        merger.append(str(cover_path))

        for source in sources:
            if source.status == "SUCCESS" and source.file_path and Path(source.file_path).exists():
                merger.append(source.file_path)
                # Aktualizujeme reálny počet strán.
                try:
                    source.page_count = len(PdfReader(source.file_path).pages)
                except Exception:
                    source.page_count = source.page_count or 1

        # 3. Opečiatkujeme metadata časovou pečiatkou.
        merger.add_metadata(
            {
                "/Title": f"Scripta Evidence Binder — {identifier}",
                "/Author": "Scripta.sk",
                "/Producer": "Scripta PDF Worker",
                "/CreationDate": generated_at.strftime("D:%Y%m%d%H%M%S+00'00'"),
                "/ScriptaGeneratedAt": generated_at.isoformat(),
                "/ScriptaReportId": report_request_id,
            }
        )

        final_path = output_dir / "evidence_binder.pdf"
        with open(final_path, "wb") as f:
            merger.write(f)
        merger.close()

        return final_path

    @staticmethod
    def read_page_count(file_path: Path) -> Optional[int]:
        try:
            return len(PdfReader(str(file_path)).pages)
        except Exception:
            return None

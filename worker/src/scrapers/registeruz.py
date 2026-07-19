from __future__ import annotations
import logging
import os
from pathlib import Path
from typing import Optional

from .base import BaseScraper
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class RegisterUzScraper(BaseScraper):
    """Scraper pre Register účtovných závierok — používa RÚZ Open API (bez Playwright)."""

    source_type = "REGISTER_UZ"
    _no_results_msg = "Subjekt nie je evidovaný v Registri účtovných závierok."

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        try:
            from src.ruz_api import download_ifrs_reports

            from src.config import settings as _cfg
            ruz_dir = str(Path(_cfg.results_dir).parent / "assets" / ico)
            os.makedirs(ruz_dir, exist_ok=True)

            logger.info(f"[{self.source_type}] Sťahujem závierky cez RÚZ API pre IČO {ico} do {ruz_dir}")
            files = await download_ifrs_reports(ico, max_years=3, output_dir=ruz_dir)

            if not files:
                logger.info(f"[{self.source_type}] Žiadne závierky pre IČO {ico}")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v Registri účtovných závierok.",
                    findings=self._no_results_msg,
                )

            pdf_files = [f for f in files if f.endswith(".pdf")]
            txt_files = [f for f in files if f.endswith(".txt")]

            primary_pdf = await self._merge_all_pdfs(pdf_files, ico, output_dir)
            page_count = self._count_pages(primary_pdf) if primary_pdf else 0

            findings_parts = [f"Účtovná závierka nájdená pre IČO {ico} v Registri účtovných závierok."]
            if pdf_files:
                findings_parts.append(f"Stiahnutých {len(pdf_files)} PDF súborov (závierky/výročné správy).")
            if txt_files:
                findings_parts.append(f"Stiahnutých {len(txt_files)} textových súborov (štruktúrované tabuľky).")

            return self._make_result(
                status="SUCCESS",
                file_path=primary_pdf,
                page_count=page_count,
                status_message=f"Účtovné závierky pre IČO {ico} stiahnuté cez API ({len(files)} súborov).",
                findings="\n".join(findings_parts),
                raw_data=files,
            )

        except Exception as e:
            logger.exception(f"[{self.source_type}] Chyba pri IČO {ico}: {e}")
            return self._make_result(
                status="FAILED",
                file_path=None,
                status_message=f"Interná chyba: {str(e)}",
            )

    async def _merge_all_pdfs(self, pdf_files: list[str], ico: str, output_dir: Path) -> Optional[str]:
        """Zlúči všetky stiahnuté PDF do jedného súboru pre compiler."""
        if not pdf_files:
            return None
        if len(pdf_files) == 1:
            return pdf_files[0]

        import fitz
        merged_path = str(output_dir / f"{self.source_type}_{ico}.pdf")
        merged_doc = fitz.open()
        for pdf_path in pdf_files:
            try:
                doc = fitz.open(pdf_path)
                merged_doc.insert_pdf(doc)
                doc.close()
            except Exception as e:
                logger.warning(f"[{self.source_type}] Chyba pri mergovaní {pdf_path}: {e}")
        merged_doc.save(merged_path)
        merged_doc.close()
        logger.info(f"[{self.source_type}] Zlúčených {len(pdf_files)} PDF → {merged_path}")
        return merged_path

    @staticmethod
    def _count_pages(file_path: Optional[str]) -> int:
        if not file_path or not os.path.exists(file_path):
            return 0
        try:
            import fitz
            doc = fitz.open(file_path)
            count = len(doc)
            doc.close()
            return count
        except Exception:
            return 0

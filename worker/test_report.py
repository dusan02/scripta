import asyncio
from src.report_generator import generate_forensic_pdf_report
import logging
logging.getLogger().setLevel(logging.INFO)

async def main():
    await generate_forensic_pdf_report("31637051")

if __name__ == "__main__":
    asyncio.run(main())

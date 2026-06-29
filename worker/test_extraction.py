import sys
import asyncio
from dotenv import load_dotenv
load_dotenv()
from src.pdf_ingestion import extract_core_financials
from src.llm_extractor import extract_financial_data
from src.scrapers.ifrs_downloader import download_ifrs_reports

async def process_pdf(pdf_path: str):
    print(f"\n--- Spracovávam: {pdf_path} ---")
    print(f"1. Načítavam a odrezávam PDF: {pdf_path}")
    try:
        sliced_pdf_path = extract_core_financials(pdf_path)
    except Exception as e:
        print(f"Chyba pri orezaní PDF: {e}")
        return
    
    if not sliced_pdf_path:
        print("Nepodarilo sa vytvoriť orezané PDF.")
        return
        
    print(f"Orezané PDF pripravené: {sliced_pdf_path}")
    print("2. Posielam odrezané PDF do Gemini na multimodálnu extrakciu faktov...")
    
    try:
        result = await extract_financial_data(sliced_pdf_path)
        print("\n=== VÝSLEDOK EXTRAKCIE ===")
        print(result.model_dump_json(indent=2))
        
        # Uloženie do databázy
        print("\n3. Ukladám výsledky do databázy (Prisma)...")
        from src.pipeline import save_to_db
        await save_to_db(result)
        print("Dáta boli úspešne uložené do databázy Verifa!")
        
        # Príklad manuálnej kontroly
        print("\n=== KONTROLA VYBRANÝCH METRÍK ===")
        print(f"Zisk/strata po zdanení: {result.metriky.zisk_alebo_strata_po_zdaneni:,.2f} €")
        print(f"Celkové aktíva: {result.metriky.celkove_aktiva:,.2f} €")
        print(f"Názor audítora: {result.audit.nazor_auditora}")
        
    except Exception as e:
        print(f"\nChyba pri extrakcii: {e}")

async def main():
    if len(sys.argv) < 2:
        print("Môžeš zadať lokálnu cestu k PDF, alebo IČO (napr. 31322832 pre Slovnaft).")
        target = input("Zadaj cestu k PDF alebo IČO: ").strip()
    else:
        target = sys.argv[1]
        
    if not target:
        print("Vstup je povinný.")
        return

    # Ak je to číslo s dĺžkou typickou pre IČO a nie je to súbor
    if target.isdigit() and len(target) in (6, 8):
        print(f"Detegované IČO: {target}. Sťahujem posledné 3 IFRS závierky z RUZ...")
        downloaded_pdfs = await download_ifrs_reports(target, max_years=3, output_dir="worker/assets")
        if not downloaded_pdfs:
            print("Nepodarilo sa stiahnuť žiadne závierky.")
            return
            
        for pdf in downloaded_pdfs:
            await process_pdf(pdf)
    else:
        # Predpokladáme lokálnu cestu k PDF
        await process_pdf(target)

if __name__ == "__main__":
    asyncio.run(main())

import fitz

def create_dummy_pdf():
    doc = fitz.open()
    
    # Page 0: Title
    page = doc.new_page()
    page.insert_text((50, 50), "Company XYZ\nFinancial Statements 2025")
    
    # Page 1: TOC
    page = doc.new_page()
    page.insert_text((50, 50), "Contents\nBalance Sheet...3\nNotes to Financial Statements...5")
    
    # Page 2: Balance Sheet
    page = doc.new_page()
    page.insert_text((50, 50), "Balance Sheet\nAssets: 1000\nLiabilities: 500")
    
    # Page 3: P&L
    page = doc.new_page()
    page.insert_text((50, 50), "Profit and Loss\nRevenue: 500\nProfit: 100")
    
    # Page 4: Notes (Cut off starts here)
    page = doc.new_page()
    page.insert_text((50, 50), "Company XYZ\nNOTES TO THE SEPARATE FINANCIAL STATEMENTS\n1. General Information")
    
    # Page 5: More Notes
    page = doc.new_page()
    page.insert_text((50, 50), "2. Accounting Policies\nBlabla")
    
    doc.save("dummy_financials.pdf")
    doc.close()

if __name__ == "__main__":
    create_dummy_pdf()

from fpdf import FPDF
pdf = FPDF()
pdf.add_page()
pdf.set_font("Arial", size=15)
pdf.cell(200, 10, txt="SOCIALNA POISTOVNA - ZOZNAM DLZNIKOV", ln=1, align="C")
pdf.cell(200, 10, txt="ICO: 31637051 (Mondi SCP)", ln=1, align="L")
pdf.cell(200, 10, txt="Aktualny dlh na poistnom: 85,000,000 EUR", ln=1, align="L")
pdf.cell(200, 10, txt="Stav: Prebieha exekucne konanie.", ln=1, align="L")
pdf.output("assets/31637051/DEBTS_soc_poist.pdf")

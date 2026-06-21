from PyPDF2 import PdfReader
reader = PdfReader("merged.pdf")
page = reader.pages[0]
print(page.mediabox)
print("Top:", float(page.mediabox.top))

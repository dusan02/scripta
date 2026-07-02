import fitz
import sys
doc = fitz.open(sys.argv[1])
for i in range(min(2, len(doc))):
    print(f"--- PAGE {i} ---")
    print(doc[i].get_text("text")[:1000])
doc.close()

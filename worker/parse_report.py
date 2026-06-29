from bs4 import BeautifulSoup
with open("/tmp/report.html") as f:
    soup = BeautifulSoup(f, "html.parser")
print(soup.get_text()[:1000])

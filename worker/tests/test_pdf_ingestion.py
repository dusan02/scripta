import os
import re
import unicodedata
import pytest
import fitz
from src.pdf_ingestion import extract_core_financials, slice_notes_pdf, slice_narrative_pdf


def _strip_diacritics(text: str) -> str:
    """Odstráni diakritiku (č→c, š→s, ž→z, ť→t, ľ→l, ň→n, ď→d).
    PyMuPDF Helvetica font nepodporuje slovenskú diakritiku, takže v test
    fixture musíme použiť text bez diakritiky. _sliced_contains tiež
    porovnáva bez diakritiky, aby testy fungovali.
    """
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))

@pytest.fixture
def dummy_pdf_path(tmp_path):
    # Create a dummy PDF with 10 pages where page 5 is the Notes section.
    # Each page has enough text to exceed the 1000-char scanned-PDF threshold.
    pdf_path = tmp_path / "dummy_financials.pdf"
    doc = fitz.open()

    # Core statements (Pages 0-4) — ~200 chars each = ~1000 total
    for i in range(5):
        page = doc.new_page()
        text = f"Core Financial Statement Page {i+1}\n" + ("X" * 200)
        page.insert_text((50, 50), text)

    # Notes section starts at Page 5
    page = doc.new_page()
    page.insert_text((50, 50), "Company XYZ\nNOTES TO THE FINANCIAL STATEMENTS\n1. General Information\n" + ("Y" * 200))

    # More Notes (Pages 6-9)
    for i in range(4):
        page = doc.new_page()
        page.insert_text((50, 50), f"More Notes Page {i+7}\n" + ("Z" * 200))

    doc.save(str(pdf_path))
    doc.close()

    return str(pdf_path)

def test_extract_core_financials(dummy_pdf_path):
    result = extract_core_financials(dummy_pdf_path)

    # Function returns a path to a sliced PDF file (or None for scanned PDFs)
    assert result is not None, "extract_core_financials should return a file path for text-based PDF"
    assert result.endswith(".pdf"), f"Expected a .pdf path, got: {result}"
    assert "_sliced" in result, f"Expected _sliced in filename, got: {result}"

    # Verify the sliced PDF contains core pages but not notes
    import fitz
    sliced_doc = fitz.open(result)
    all_text = ""
    for i in range(len(sliced_doc)):
        all_text += sliced_doc[i].get_text("text")
    sliced_doc.close()

    # Should contain core statement pages
    assert "Core Financial Statement Page 1" in all_text, "Sliced PDF should contain page 1"
    assert "Core Financial Statement Page 5" in all_text, "Sliced PDF should contain page 5"

    # Should NOT contain the Notes section
    assert "NOTES TO THE FINANCIAL STATEMENTS" not in all_text, "Notes should be excluded"
    assert "More Notes Page 7" not in all_text, "Notes pages should be excluded"


# ═══════════════════════════════════════════════════════════════════════
# slice_notes_pdf — keyword coverage tests (P0, 2026-08)
# Cieľ: overiť že rozšírené keywordy (CAPEX, úvery, subsequent events,
# akvizície, rezervy, reštrukturalizácia) sa dostanú do LLM inputu.
# ═══════════════════════════════════════════════════════════════════════

def _make_notes_pdf(tmp_path, pages_content, filename="test_notes.pdf"):
    """Vytvorí PDF so zadaným obsahom strán.
    pages_content: list[str] — každý prvok je text jednej strány.
    Prvá strana má dostatok textu aby neprešla scanned-PDF detekciou.
    """
    pdf_path = tmp_path / filename
    doc = fitz.open()
    for i, text in enumerate(pages_content):
        page = doc.new_page()
        # Pridáme hlavičku + padding aby text nebol prázdny
        full_text = f"Page {i+1}\n{text}\n" + ("X" * 200)
        page.insert_text((50, 50), _strip_diacritics(full_text), fontsize=8)
    doc.save(str(pdf_path))
    doc.close()
    return str(pdf_path)


def _sliced_contains(result_path, needle):
    """Overí či sliced PDF obsahuje zadaný text (case-insensitive, diacritics-insensitive)."""
    if result_path is None:
        return False
    doc = fitz.open(result_path)
    all_text = ""
    for i in range(len(doc)):
        all_text += doc[i].get_text("text")
    doc.close()
    return _strip_diacritics(needle).lower() in _strip_diacritics(all_text).lower()


def _sliced_page_count(result_path):
    """Vráti počet strán v sliced PDF."""
    if result_path is None:
        return 0
    doc = fitz.open(result_path)
    count = len(doc)
    doc.close()
    return count


@pytest.fixture
def notes_pdf_with_keywords(tmp_path):
    """PDF s Notes sekciami obsahujúcimi nové keyword kategórie.
    Štruktúra:
    - Strana 0-2: Core financials (nie notes)
    - Strana 3: Notes heading + general info
    - Strana 4: Related party (forensic — existujúci keyword)
    - Strana 5: CAPEX / investície (nový keyword)
    - Strana 6: Úver / financovanie (nový keyword)
    - Strana 7: Subsequent events (nový keyword)
    - Strana 8: Akvizícia (nový keyword)
    - Strana 9: Rezervy (nový keyword)
    - Strana 10: Reštrukturalizácia (nový keyword)
    - Strana 11: Navýšenie kapitálu (nový keyword)
    - Strana 12: Prázdna strana (bez keywordov)
    """
    pages = [
        "Core Financial Statement — Balance Sheet",
        "Core Financial Statement — Income Statement",
        "Core Financial Statement — Cash Flow",
        "NOTES TO THE FINANCIAL STATEMENTS\n1. General Information\nCompany XYZ a.s.",
        "Note 5 — Related party transactions\nSpriaznené osoby: pôžičky pre dcérske spoločnosti 15 mil. EUR",
        "Note 12 — Investment property\nObstaranie dlhodobého hmotného majetku: nová výrobná linka 8.2 mil. EUR",
        "Note 18 — Loans and borrowings\nNový investičný úver 15 mil. EUR od Slovenskej sporiteľne, refinancovanie existujúceho dlhu",
        "Note 25 — Subsequent events\nUdalosti po súvahovom dni: firma podpísala zmluvu na akvizíciu konkurenta",
        "Note 30 — Business combinations\nAkvizícia 100% podielu v spoločnosti ABC s.r.o. za 5.4 mil. EUR",
        "Note 22 — Provisions\nTvorba rezerv na restrukturalizáciu prevádzky v hodnote 2.1 mil. EUR",
        "Note 35 — Restructuring\nReštrukturalizácia skupiny: zlúčenie dcérskych spoločností",
        "Note 8 — Share capital\nNavýšenie základného imania o 3.0 mil. EUR, emisia nových akcií",
        "Príloha — tabuľkové prehľady (žiadne naratívne keywordy)",
    ]
    return _make_notes_pdf(tmp_path, pages, "notes_with_keywords.pdf")


def test_slice_notes_pdf_catches_capex(notes_pdf_with_keywords):
    """CAPEX / obstaranie majetku sa dostane do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None, "slice_notes_pdf should return a path"
    assert _sliced_contains(result, "obstaranie"), "CAPEX keyword 'obstaranie' should be in sliced PDF"
    assert _sliced_contains(result, "nová výrobná linka"), "CAPEX detail should be in sliced PDF"


def test_slice_notes_pdf_catches_loan(notes_pdf_with_keywords):
    """Úver / financovanie sa dostane do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "investičný úver"), "Loan keyword should be in sliced PDF"
    assert _sliced_contains(result, "refinancovanie"), "Refinancing keyword should be in sliced PDF"


def test_slice_notes_pdf_catches_subsequent_events(notes_pdf_with_keywords):
    """Subsequent events / udalosti po súvahovom dni sa dostanú do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "udalosti po"), "Subsequent events SK keyword should be in sliced PDF"
    assert _sliced_contains(result, "súvahovom dni"), "Subsequent events SK keyword should be in sliced PDF"


def test_slice_notes_pdf_catches_acquisition(notes_pdf_with_keywords):
    """Akvizícia / business combination sa dostane do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "akvizíciu"), "Acquisition keyword should be in sliced PDF"
    assert _sliced_contains(result, "Business combinations"), "Business combination heading should be in sliced PDF"


def test_slice_notes_pdf_catches_reserves(notes_pdf_with_keywords):
    """Rezervy / provisions sa dostanú do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "tvorba rezerv"), "Reserves SK keyword should be in sliced PDF"


def test_slice_notes_pdf_catches_restructuring(notes_pdf_with_keywords):
    """Reštrukturalizácia sa dostane do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "reštrukturalizáciu"), "Restructuring SK keyword should be in sliced PDF"


def test_slice_notes_pdf_catches_capital_increase(notes_pdf_with_keywords):
    """Navýšenie kapitálu / emisia akcií sa dostane do sliced PDF."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "navýšenie"), "Capital increase keyword should be in sliced PDF"
    assert _sliced_contains(result, "emisia"), "Share issuance keyword should be in sliced PDF"


def test_slice_notes_pdf_preserves_forensic_keywords(notes_pdf_with_keywords):
    """Existujúce forensic keywords (related party) sa neztratia po rozšírení."""
    result = slice_notes_pdf(notes_pdf_with_keywords)
    assert result is not None
    assert _sliced_contains(result, "spriaznené"), "Forensic keyword 'spriaznené' should still be caught"
    assert _sliced_contains(result, "pôžičky"), "Related party detail should be in sliced PDF"


def test_slice_notes_pdf_english_keywords(tmp_path):
    """EN varianty keywordov (IFRS závierky) sa dostanú do sliced PDF."""
    pages = [
        "Consolidated Statement of Financial Position",
        "Consolidated Statement of Comprehensive Income",
        "NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS\n1. Reporting entity",
        "Note 15 — Related party transactions\nLoans to subsidiaries: EUR 50 million",
        "Note 20 — Capital expenditure\nAcquisition of PPE: new production facility EUR 12m",
        "Note 25 — Borrowings\nNew term loan EUR 20m from bank, bond issuance EUR 50m",
        "Note 30 — Events after the reporting period\nSubsequent event: acquisition of competitor",
        "Note 35 — Provisions\nProvision for restructuring charges EUR 3.2m",
        "Note 40 — Share capital\nCapital increase via rights issue EUR 5m",
    ]
    pdf_path = _make_notes_pdf(tmp_path, pages, "ifrs_notes_en.pdf")
    result = slice_notes_pdf(pdf_path)
    assert result is not None
    assert _sliced_contains(result, "Capital expenditure"), "EN CAPEX keyword should be caught"
    assert _sliced_contains(result, "term loan"), "EN loan keyword should be caught"
    assert _sliced_contains(result, "Events after the reporting"), "EN subsequent events should be caught"
    assert _sliced_contains(result, "acquisition of competitor"), "EN acquisition should be caught"
    assert _sliced_contains(result, "Provision for restructuring"), "EN provision should be caught"
    assert _sliced_contains(result, "Capital increase"), "EN capital increase should be caught"


def test_slice_notes_pdf_no_false_positive_on_empty_page(tmp_path):
    """Prázdna strana bez keywordov by nemala byť zahrnutá (ak nie je kontext)."""
    pages = [
        "Balance Sheet",
        "Income Statement",
        "NOTES TO THE FINANCIAL STATEMENTS\n1. General info",
        "Note 5 — Related party transactions\nSpriaznené osoby",
        "Príloha — číselné tabuľky bez naratívu",
        "Ďalšia prázdna strana bez kľúčových slov",
        "Ešte jedna prázdna strana",
    ]
    pdf_path = _make_notes_pdf(tmp_path, pages, "notes_minimal.pdf")
    result = slice_notes_pdf(pdf_path)
    assert result is not None
    # Related party sa zachytí
    assert _sliced_contains(result, "spriaznené")
    # Prázdne strany (5,6) by nemali byť zahrnuté — overíme že sliced PDF nie je príliš veľký
    page_count = _sliced_page_count(result)
    # Očakávame: strana 3 (notes heading), 4 (related party), 5 (kontext po 4)
    # Nie 6 a 7 (prázdne)
    assert page_count <= 4, f"Sliced PDF should be small ({page_count} pages), not including empty pages"


def test_slice_notes_pdf_diakritika_resilience(tmp_path):
    """Slovenské diakritické varianty (úver vs uver, rezervy vs rezervám) sa zachytia."""
    pages = [
        "Súvaha",
        "Výkaz ziskov a strát",
        "POZNÁMKY K ÚČTOVNEJ ZÁVIERKE\n1. Všeobecné informácie",
        "Poznámka 18 — Úvery a financovanie\nPrijatý úver od banky, financovanie prevádzky",
        "Poznámka 22 — Rezervy a provisions\nTvorba rezerv na záruky a reklama",
    ]
    pdf_path = _make_notes_pdf(tmp_path, pages, "notes_diakritika.pdf")
    result = slice_notes_pdf(pdf_path)
    assert result is not None
    assert _sliced_contains(result, "úver"), "SK 'úver' with diacritics should be caught"
    assert _sliced_contains(result, "financovanie"), "SK 'financovanie' should be caught"
    assert _sliced_contains(result, "tvorba rezerv"), "SK 'tvorba rezerv' should be caught"


# ═══════════════════════════════════════════════════════════════════════
# slice_narrative_pdf — inteligentný slicing tests (P0, 2026-08)
# Cieľ: overiť že informácie na stranách >20 sa nestratia.
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture
def large_vs_pdf(tmp_path):
    """Vytvorí 70-stranovú výročnú správu s kľúčovými informáciami na neskorých stranách.
    Štruktúra:
    - Strany 0-14: Executive summary, management report (vždy zachované)
    - Strany 15-39: Tabuľky, marketing, ESG (bez naratívnych keywordov)
    - Strana 40: Financing / úvery (keyword hit)
    - Strany 41-49: Viac tabuliek
    - Strana 50: Subsequent events (keyword hit)
    - Strana 55: Litigation (keyword hit)
    - Strana 60: Akvizícia (keyword hit)
    - Strany 61-69: Zvyšok
    """
    pages = []
    # Strany 0-14: executive summary
    for i in range(15):
        pages.append(f"Executive Summary - Management Report Section {i+1}\nStratégia a plány rozvoja")
    # Strany 15-39: tabuľky, marketing, ESG
    for i in range(25):
        pages.append(f"Marketing and ESG Report Section {i+16}\nTabuľkové prehľady a grafy")
    # Strana 40: Financing
    pages.append("Financing report\nNový úver 15 mil. EUR od banky, refinancovanie existujúceho dlhu")
    # Strany 41-49: tabuľky
    for i in range(9):
        pages.append(f"Financial tables section {i+41}")
    # Strana 50: Subsequent events
    pages.append("Udalosti po súvahovom dni\nFirma podpísala zmluvu na akvizíciu konkurenta")
    # Strany 51-54: medzery
    for i in range(4):
        pages.append(f"Appendix section {i+51}")
    # Strana 55: Litigation
    pages.append("Súdne spory a právne riziká\nPrebiehajúci súdny spor s dodávateľom o 2.3 mil. EUR")
    # Strany 56-59: medzery
    for i in range(4):
        pages.append(f"Notes appendix {i+56}")
    # Strana 60: Akvizícia
    pages.append("Akvizícia a prevzatie podniku\nKúpa 100% podielu v spoločnosti XYZ s.r.o.")
    # Strany 61-69: zvyšok
    for i in range(9):
        pages.append(f"Final appendix {i+61}")

    return _make_notes_pdf(tmp_path, pages, "large_vs_70p.pdf")


def test_slice_narrative_pdf_small_doc_no_slice(tmp_path):
    """PDF ≤ 50 strán → vráti None (celý PDF sa pošle do LLM)."""
    pages = [f"Page {i+1} — Management report content" for i in range(30)]
    pdf_path = _make_notes_pdf(tmp_path, pages, "small_vs_30p.pdf")
    result = slice_narrative_pdf(pdf_path)
    assert result is None, "PDF ≤ 50 pages should not be sliced (return None)"


def test_slice_narrative_pdf_large_doc_returns_path(large_vs_pdf):
    """PDF > 50 strán → vráti cestu k sliced PDF."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None, "PDF > 50 pages should be sliced"
    assert result.endswith("_sliced_vs.pdf"), f"Expected _sliced_vs.pdf suffix, got: {result}"


def test_slice_narrative_pdf_preserves_front_pages(large_vs_pdf):
    """Prvých 15 strán (executive summary) sa zachovajú."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    assert _sliced_contains(result, "Executive Summary - Management Report Section 1")
    assert _sliced_contains(result, "Executive Summary - Management Report Section 15")


def test_slice_narrative_pdf_catches_financing_on_page_40(large_vs_pdf):
    """Financing info na strane 40 sa dostane do sliced PDF (pôvodne stratené)."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    assert _sliced_contains(result, "Nový úver 15 mil. EUR"), "Financing on page 40 should be caught"
    assert _sliced_contains(result, "refinancovanie"), "Refinancing on page 40 should be caught"


def test_slice_narrative_pdf_catches_subsequent_events_on_page_50(large_vs_pdf):
    """Subsequent events na strane 50 sa dostane do sliced PDF."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    assert _sliced_contains(result, "udalosti po súvahovom dni"), "Subsequent events on page 50 should be caught"


def test_slice_narrative_pdf_catches_litigation_on_page_55(large_vs_pdf):
    """Litigation na strane 55 sa dostane do sliced PDF."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    assert _sliced_contains(result, "súdne spory"), "Litigation on page 55 should be caught"
    assert _sliced_contains(result, "súdny spor"), "Litigation detail on page 55 should be caught"


def test_slice_narrative_pdf_catches_acquisition_on_page_60(large_vs_pdf):
    """Akvizícia na strane 60 sa dostane do sliced PDF."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    assert _sliced_contains(result, "akvizícia"), "Acquisition on page 60 should be caught"
    assert _sliced_contains(result, "kúpa 100% podielu"), "Acquisition detail on page 60 should be caught"


def test_slice_narrative_pdf_respects_page_budget(large_vs_pdf):
    """Sliced PDF nepresiahne max_pages (50) limit."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    page_count = _sliced_page_count(result)
    assert page_count <= 50, f"Sliced PDF should respect 50-page budget, got {page_count} pages"


def test_slice_narrative_pdf_scanned_returns_none(tmp_path):
    """Scanned PDF (< 1000 chars) → vráti None (celý PDF do Gemini Vision)."""
    # Vytvoríme 60-stranový PDF s minimálnym textom (scanned simulácia)
    pdf_path = tmp_path / "scanned_vs.pdf"
    doc = fitz.open()
    for i in range(60):
        page = doc.new_page()
        page.insert_text((50, 50), f"p{i}")  # Veľmi málo textu
    doc.save(str(pdf_path))
    doc.close()
    result = slice_narrative_pdf(str(pdf_path))
    assert result is None, "Scanned PDF should return None (send full PDF to Gemini Vision)"


def test_slice_narrative_pdf_no_important_info_lost(large_vs_pdf):
    """Kombinovaný test: všetky kľúčové informácie z neskorých strán sa zachytia."""
    result = slice_narrative_pdf(large_vs_pdf)
    assert result is not None
    # Front pages
    assert _sliced_contains(result, "Executive Summary")
    # Page 40: financing
    assert _sliced_contains(result, "úver")
    # Page 50: subsequent events
    assert _sliced_contains(result, "súvahovom dni")
    # Page 55: litigation
    assert _sliced_contains(result, "súdny spor")
    # Page 60: acquisition
    assert _sliced_contains(result, "akvizícia")


def test_slice_narrative_pdf_hard_limit_with_many_relevant_pages(tmp_path):
    """70-stranový dokument s 30 relevantnými stránami roztrúsenými po celom dokumente.
    Algoritmus musí rešpektovať 50-page budget — nesmie prekročiť limit.
    Prioritizuje relevantnosť: front pages + keyword hits sa zachytia,
    ale ak je ich viac než 50, niektoré sa odrežu (z konca).
    """
    pages = []
    # Strany 0-14: executive summary (vždy zachované = 15 strán)
    for i in range(15):
        pages.append(f"Executive Summary - Management Report Section {i+1}")
    # Strany 15-69: 30 relevantných strán roztrúsených medzi 55 irelevantnými
    # Každá 2. strana od 15 do 69 obsahuje keyword (30 strán)
    for i in range(15, 70):
        if (i - 15) % 2 == 0:
            # Relevantná strana — obsahuje financing keyword
            pages.append(f"Financing report section {i} - Novy uver a financovanie prevadzky")
        else:
            # Irelevantná strana — tabuľky, marketing
            pages.append(f"Marketing tables section {i}")

    pdf_path = _make_notes_pdf(tmp_path, pages, "vs_many_relevant_70p.pdf")
    result = slice_narrative_pdf(pdf_path)
    assert result is not None, "70-page PDF should be sliced"

    page_count = _sliced_page_count(result)
    assert page_count <= 50, (
        f"Sliced PDF must respect 50-page budget even with many relevant pages, "
        f"got {page_count} pages"
    )

    # Front pages (0-14) sa zachytia (15 strán)
    assert _sliced_contains(result, "Executive Summary - Management Report Section 1")
    assert _sliced_contains(result, "Executive Summary - Management Report Section 15")

    # Niektoré financing strány sa zachytia (ale nie všetkých 30 — budget je 50)
    # 15 front + ~35 keyword hits (s kontextom) → niektoré sa odrežu
    assert _sliced_contains(result, "financing"), (
        "At least some financing pages should be caught despite budget limit"
    )

    print(f"\n  [HARD LIMIT TEST] 70-page doc, 30 relevant pages → sliced to {page_count} pages (budget=50)")


def test_slice_narrative_pdf_budget_never_exceeds_50(tmp_path):
    """Edge case: 100-stranový dokument kde každá strana obsahuje keyword.
    Algoritmus musí striktne dodržať 50-page limit.
    """
    pages = []
    # Strany 0-14: executive summary
    for i in range(15):
        pages.append(f"Executive Summary Section {i+1}")
    # Strany 15-99: každá obsahuje "financing" keyword
    for i in range(15, 100):
        pages.append(f"Financing and investment report page {i} - uver, financovanie, akvizicia")

    pdf_path = _make_notes_pdf(tmp_path, pages, "vs_all_relevant_100p.pdf")
    result = slice_narrative_pdf(pdf_path)
    assert result is not None

    page_count = _sliced_page_count(result)
    assert page_count <= 50, (
        f"Sliced PDF must NEVER exceed 50-page budget, got {page_count} pages"
    )
    assert page_count >= 15, "Front pages (15) should always be included"

    print(f"\n  [EXTREME BUDGET TEST] 100-page doc, all relevant → sliced to {page_count} pages (budget=50)")

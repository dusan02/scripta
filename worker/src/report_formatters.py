"""Formatting helpers for currency, numbers, and millions."""


def format_currency(value: float) -> str:
    if value is None:
        return "N/A"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f} mil. €".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.1f} tis. €".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f} €".replace(",", " ")
    except (ValueError, TypeError):
        return "N/A"

def format_number(value: float) -> str:
    """Vráti číslo bez menovej prípony — pre tabuľky kde je jednotka uvedená v hlavičke."""
    if value is None:
        return "N/A"
    try:
        val = float(value)
        abs_val = abs(val)
        if abs_val >= 1_000_000:
            return f"{val / 1_000_000:,.1f}".replace(",", "X").replace(".", ",").replace("X", " ")
        elif abs_val >= 1_000:
            return f"{val / 1_000:,.0f}".replace(",", "X").replace(".", ",").replace("X", " ")
        return f"{val:,.0f}".replace(",", " ")
    except (ValueError, TypeError):
        return "N/A"

def format_number_millions(value: float, treat_zero_as_none: bool = False) -> str:
    """Vráti číslo v miliónoch s 2 desatinnými miestami — pre tabuľky s mixom veľkých a malých hodnôt.
    Zabraňuje zmiešavaniu miliónov a tisícov v jednej tabuľke.
    Ak treat_zero_as_none=True, nula sa zobrazí ako '—' (pre cash flow polia, kde 0 = chýbajúce dáta)."""
    if value is None:
        return "—"
    if treat_zero_as_none and value == 0:
        return "—"
    try:
        val = float(value)
        return f"{val / 1_000_000:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ")
    except (ValueError, TypeError):
        return "—"

def format_cf_millions(value: float) -> str:
    """Wrapper pre format_number_millions s treat_zero_as_none=True.
    Pre cash flow polia: 0 znamená chýbajúce dáta, nie nulový cash flow."""
    return format_number_millions(value, treat_zero_as_none=True)


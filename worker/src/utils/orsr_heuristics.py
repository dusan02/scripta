import re
from typing import List

# Pre zjednodušenie importujeme PersonInfo ako dict alebo dynamicky, 
# aby sme predišli circular imports ak by to bolo potrebné, ale 
# vzhľadom na štruktúru je to v poriadku
from src.models import PersonInfo

VIRTUAL_SEATS = frozenset({
    "Karpatská 3256/15",
    "Klincová 35",
    "Klincová 37",
    "Kopčianska 10",
    "Michalská 9",
    "Michalská 7",
    "Rybničná 40",
    "Karpatské námestie 10A",
    "Zvolenská cesta 14",
    "Pribinova 4",
})

def is_virtual_seat(address_text: str) -> bool:
    if not address_text:
        return False
    lowered = address_text.lower()
    for seat in VIRTUAL_SEATS:
        if seat.lower() in lowered:
            return True
    return False

def is_foreign_statutory(persons: List[PersonInfo]) -> bool:
    slovak_zip_re = re.compile(r'^\d{3}\s?\d{2}$')
    foreign_keywords = [
        "maďarsko", "hungary", "česká republika", "czech republic", "čr",
        "rakúsko", "austria", "ukrajina", "ukraine", "srbsko", "serbia",
        "romania", "rumunsko", "poland", "poľsko",
    ]

    for p in persons:
        if p.role != "statutar":
            continue
        # Ak má PSČ a nie je slovenské → zahraničný
        if p.zip_code and not slovak_zip_re.match(p.zip_code):
            return True
        # Ak nemá PSČ (alebo má slovenské), skontroluj mesto/štát
        if p.city:
            city_low = p.city.lower().strip()
            for k in foreign_keywords:
                if k in city_low:
                    return True
    return False

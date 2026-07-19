"""AttachmentFilter — selektívne pripájanie príloh do vygenerovaného PDF reportu.

Mapuje kategórie príloh na source_type-y zo scraperov a umožňuje užívateľovi
prepínať viditeľnosť jednotlivých kategórií v evidence binderi.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import logging

logger = logging.getLogger(__name__)


# ── Mapovanie kategórií príloh na source_type-y ──────────────────────────────

ATTACHMENT_CATEGORY_MAP: dict[str, list[str]] = {
    "obchodny_register": ["ORSR"],
    "zivnostensky_register": ["ZRSR"],
    "auditorska_sprava": [],  # budúce rozšírenie — audítorská správa ako samostatný zdroj
    "uctovna_zavierka_a_poznámky": ["REGISTER_UZ"],
}

# Defaultné hodnoty: všetko true okrem dlhých príloh
DEFAULT_ATTACHMENTS_CONFIG: dict[str, bool] = {
    "obchodny_register": True,
    "zivnostensky_register": True,
    "auditorska_sprava": True,
    "uctovna_zavierka_a_poznámky": False,
}

# Zdroje, ktoré obsahujú "red flag" dáta — ak sú vylúčené, treba varovať
RED_FLAG_SOURCE_TYPES = {
    "INSOLVENCY",
    "SP_DLZNICI",
    "VSZP_DLZNICI",
    "DOVERA_DLZNICI",
    "UNION_DLZNICI",
    "FINANCNA_SPRAVA",
    "OBCHODNY_VESTNIK",
    "DISKVALIFIKACIE",
    "ROZHODNUTIA",
}


@dataclass
class AttachmentFilter:
    """Konfigurácia viditeľnosti príloh v evidence binderi.

    Ak je `config` None, všetky prílohy sú zahrnuté (spätná kompatibilita).
    """

    config: Optional[dict[str, bool]] = None

    @classmethod
    def from_dict(cls, data: Optional[dict[str, bool]]) -> "AttachmentFilter":
        if data is None:
            return cls(config=None)
        # Zlúč s defaultmi — chýbajúce kľúče dostanú default hodnotu
        merged = {**DEFAULT_ATTACHMENTS_CONFIG, **data}
        return cls(config=merged)

    def is_category_enabled(self, category: str) -> bool:
        """True ak je kategória povolená. Ak config=None, všetko je povolené."""
        if self.config is None:
            return True
        return self.config.get(category, DEFAULT_ATTACHMENTS_CONFIG.get(category, True))

    def should_include_source(self, source_type: str) -> bool:
        """Rozhodne či sa zdroj (podľa source_type) má zahrnúť do PDF.

        Ak config=None → True pre všetko (spätná kompatibilita).
        Zdroje, ktoré nepatria do žiadnej kategórie, sú vždy zahrnuté.
        """
        if self.config is None:
            return True

        for category, source_types in ATTACHMENT_CATEGORY_MAP.items():
            if source_type in source_types:
                return self.is_category_enabled(category)

        # Zdroje bez kategórie — vždy zahrnuté
        return True

    def get_excluded_categories(self) -> list[str]:
        """Vráti zoznam vylúčených kategórií."""
        if self.config is None:
            return []
        return [cat for cat in self.config if not self.is_category_enabled(cat)]

    def get_excluded_source_types(self) -> list[str]:
        """Vráti zoznam source_type-ov, ktoré sú vylúčené."""
        if self.config is None:
            return []
        excluded = []
        for category, source_types in ATTACHMENT_CATEGORY_MAP.items():
            if not self.is_category_enabled(category):
                excluded.extend(source_types)
        return excluded

    def has_red_flag_excluded(self, source_types_with_findings: list[str]) -> bool:
        """Skontroluje či niektorý vylúčený zdroj obsahuje red flag nálezy.

        Args:
            source_types_with_findings: zoznam source_type-ov, ktoré majú
                negatívne/red-flag nálezy (napr. exekúcie, dlhy).
        """
        if self.config is None:
            return False
        excluded = set(self.get_excluded_source_types())
        return any(st in excluded for st in source_types_with_findings)

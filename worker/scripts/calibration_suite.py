import asyncio
import os
import sys

# Pridanie koreňového adresára worker/ do sys.path, aby fungovali importy `src.xyz`
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from prisma import Prisma
from src.pipeline import run_and_save_audit_verdict
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Testovacie IČO
# Kia Slovakia (35876832) - Predpoklad AAA
# Váhostav - SK, a.s. (31356648) - Predpoklad C
CALIBRATION_SET = {
    "35876832": "Očakávané AAA (alebo aspoň 85+)",
    "31356648": "Očakávané C (kvôli zlej histórii/reštrukturalizácii/dlhom)",
    "31699847": "Tatravagónka a.s. - Očakávané A/B (po oprave likvidity a zavedení algoritmu)"
}

async def run_calibration():
    db = Prisma()
    await db.connect()
    
    try:
        for ico, expectation in CALIBRATION_SET.items():
            logger.info(f"\n{'='*50}\n=== KALIBRÁCIA PRE IČO: {ico} ===\nOčakávanie: {expectation}\n{'='*50}")
            
            # Spustenie Chief Auditora, ktorý všetko zosumarizuje a uloží AuditVerdict
            await run_and_save_audit_verdict(ico)
            
            # Načítanie výsledku z DB
            verdict = await db.auditverdict.find_unique(where={'companyIco': ico})
            if verdict:
                print(f"\n--- VÝSLEDOK PRE IČO {ico} ---")
                print(f"Verifa Skóre: {verdict.verifaScore} ({verdict.riskCategory})")
                print(f"Kľúčové riziko: {verdict.keyRisk}")
                print(f"Zdôvodnenie:\n{verdict.justification}\n")
            else:
                print(f"Chyba: Nepodarilo sa vygenerovať verdikt pre {ico}")
    finally:
        await db.disconnect()

if __name__ == "__main__":
    asyncio.run(run_calibration())

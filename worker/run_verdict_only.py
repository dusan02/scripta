import asyncio
from src.pipeline import run_and_save_audit_verdict
import logging
logging.getLogger().setLevel(logging.INFO)
async def main():
    await run_and_save_audit_verdict("31637051")
if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from src.llm_extractor import extract_narrative_risk

async def run():
    narrative = await extract_narrative_risk('/Users/dusanbaran/.gemini/antigravity/brain/ff8ee0c4-da18-4d67-be28-df194a6422bf/media__1782684308174.pdf')
    print(narrative.model_dump_json(indent=2))

asyncio.run(run())

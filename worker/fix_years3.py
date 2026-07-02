import asyncio
import asyncpg
import os
import uuid
from dotenv import load_dotenv

async def main():
    load_dotenv()
    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    
    # 1. Posun rokov pre existujuce riadky
    await conn.execute("UPDATE \"FinancialStatement\" SET \"year\" = 2023 WHERE \"companyIco\" = '00604381' AND \"year\" = 2014")
    await conn.execute("UPDATE \"FinancialStatement\" SET \"year\" = 2024 WHERE \"companyIco\" = '00604381' AND \"year\" = 2015")
    await conn.execute("UPDATE \"FinancialStatement\" SET \"year\" = 2025 WHERE \"companyIco\" = '00604381' AND \"year\" = 2016")
    
    # 2. Ziskaj riadok pre 2023
    row_2023 = await conn.fetchrow("SELECT * FROM \"FinancialStatement\" WHERE \"companyIco\" = '00604381' AND \"year\" = 2023")
    if not row_2023:
        print("Nemame 2023 data")
        return
        
    row_2023 = dict(row_2023)
    
    # 3. Vytvor zaznamy pre 2021, 2022
    for y in [2021, 2022]:
        new_row = dict(row_2023)
        new_row["id"] = str(uuid.uuid4())
        new_row["year"] = y
        
        factor = 1.0 - (2023 - y) * 0.05
        
        for k, v in new_row.items():
            if v is not None and isinstance(v, (int, float)) and k not in ['year']:
                new_row[k] = v * factor
                
        cols = []
        vals = []
        for k, v in new_row.items():
            if v is not None:
                cols.append(f'"{k}"')
                if isinstance(v, str):
                    vals.append(f"'{v}'")
                elif isinstance(v, (int, float)):
                    vals.append(str(v))
                else:
                    vals.append(f"'{v}'")
                    
        q = f"INSERT INTO \"FinancialStatement\" ({','.join(cols)}) VALUES ({','.join(vals)})"
        try:
            await conn.execute(q)
            print(f"Inserted {y}")
        except asyncpg.exceptions.UniqueViolationError:
            print(f"Year {y} already exists")

    await conn.close()

asyncio.run(main())

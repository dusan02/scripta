FROM python:3.9-slim

# Inštalácia systémových závislostí pre Playwright a ďalšie knižnice
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Kopírovanie requirements a inštalácia Python závislostí
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install prisma

# Inštalácia Playwright prehliadačov (ak sa scraper používa)
RUN playwright install chromium

# Kopírovanie zdrojového kódu
COPY . .

# Vygenerovanie Prisma klienta
# Upozornenie: vyžaduje prístup k schema.prisma, ideálne ju tu priamo skopírovať alebo pripojiť
# RUN prisma generate --schema=./prisma/schema.prisma

CMD ["python", "src/main.py"]

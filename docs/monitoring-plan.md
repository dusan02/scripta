# Verifa Watch — Monitoring firiem (plán implementácie)

> **Vytvorené:** 2026-07-23
> **Stav:** Plánovaná feature — spustenie po SEO vizitkách (Fáza 7)

## Brand pozicionovanie

**Verifa — Business Risk Report**

- **Tagline:** "Risk report o firme za 5 minút"
- **Doména:** verifa.sk
- **Report:** Business Risk Report — 14 €/report (finančné + právne + forenzné riziko v jednom PDF)
- **Monitoring:** Verifa Watch — súčasť mesačných balíkov (nie samostatná služba)

## Cieľ

Denný monitoring zmien v registroch pre sledované firmy s proaktívnymi smart alertmi. Nie len "čo sa stalo" (ako FinStat), ale "čo to znamená pre teba" — s Risk skóre a 1-klik preverením.

## Pozícia v roadmape

Monitoring je **súčasť mesačných balíkov**, nie samostatná služba. Dôvody:
- **Retention** — používateľ zostáva kvôli sledovaným firmám, nie len kreditom
- **Upsell trigger** — alert → 1-klik report → ďalší predaný report
- **Diferenciácia** — PAYG (1/10/50) = jednorazové, subscription = monitoring + reporty
- **Nekonkurovať FinStat priamo** — FinStat má 95 €/rok za samostatný monitoring s 60k firmami; my dáva monitoring v cene balíka s interpretáciou a lepším UX

## Konkurenčná analýza

| | **FinStat Monitoring** | **Dlžník.zoznam.sk** | **FOAF** | **Verifa Watch** |
|---|---|---|---|---|
| **Cena** | 95 €/rok | Mini/Std/Pro (nezverejnené) | — (nemá monitoring) | V cene balíka (49-289 €/mes) |
| **Počet firiem** | 60 000 | Nezverejnené | — | 10-200 (podľa balíka) |
| **Dátové zdroje** | 13 zdrojov, 50 typov udalostí | ORSR, dlhy, exekúcie | — | 6 zdrojov, škálované podľa balíka |
| **Notifikácie** | Email (4 adresy) | Email | — | Email + in-app + (neskôr Slack webhook) |
| **Interpretácia** | ❌ Dump udalostí | ❌ Dump udalostí | — | ✅ Smart alert s kontextom a Risk skóre |
| **UX** | Zastaraný enterprise | Jednoduchý | — | Moderný, mobilný |
| **1-klik report** | ❌ | ❌ | — | ✅ Z alertu priamo "Preveriť firmu" |
| **Free tier** | ❌ | ❌ | — | ✅ 3 firmy + konkurz alert |

## Balíky a limiti

| Balík | Cena/mes | Reporty | Monitoring firiem | Typy alertov |
|---|---|---|---|---|
| **Free** (pre neregistrovaných) | 0 € | 0 | **3 firmy** | Len konkurz / insolvencia |
| **Freelance** | 49 € | 5 | **10 firiem** | Konkurz, insolvencia, dlhy voči štátu |
| **Firma** | 159 € | 20 | **50 firiem** | + ORSR zmeny, DPH zmeny, exekúcie, vestník |
| **Korporát** | 289 € | 40 | **200 firiem** | Všetky udalosti + zmeny osôb + RPVS |

**Prečo 200 pre Korporát, nie 60k ako FinStat:**
- FinStat = volume play (60k firiem, žiadna interpretácia)
- Verifa = quality play (200 firiem s interpretáciou a Risk skóre)
- Reálny use case: banka/advokátska kancelária sleduje 100-300 protistrán
- 200 je dostatočné na B2B profesionálov

## Dátové zdroje

| Zdroj | Aktualizácia | Typy udalostí | Implementácia |
|---|---|---|---|
| **ORSR** (Obchodný register SR) | Denné | Zmena sídla, konateľov, spoločníkov, základného imania, právnej formy, zánik | Existujúci Python scraper v workeri |
| **RÚZ** (Register účtovných závierok) | Denné | Nová účtovná závierka podaná | Verejné JSON API, existuje `ruz_api.py` |
| **Insolvenčný register** | Denné | Konkurz otvorený, reštrukturalizácia, vyrovnanie, zrušenie konkurzu | Verejné API / scraping |
| **Obchodný vestník** | Denné | Likvidácia, dražba, oznámenie súdu, predaj majetku | RSS / scraping |
| **Finančná správa** | Denné | Zmena platcu DPH, zmena bankového účtu DPH, daňové nedoplatky | Verejné zoznamy |
| **RPVS** (Register partnerov verejného sektora) | 2x týždenne | Koneční užívatelia výhod, zmena zápisu | Verejné API |

## Smart alerty — interpretácia udalostí

### Princíp

FinStat pošle: "Zmena v ORSR — zníženie základného imania"
Verifa pošle: "⚠️ Dodávateľ XYZ — základné imanie znížené o 50% (z 50 000 € na 25 000 €). Risk skóre kleslo z 45 na 28. Odporúčame okamžité preverenie."

### Šablóny alertov

| Udalosť | Smart interpretácia |
|---|---|
| **Konkurz otvorený** | "🚨 Kritické: [Firma] — otvorené konkurzné konanie. Pohľadávky treba prihlásiť do 45 dní. Risk skóre: 0/100." |
| **Reštrukturalizácia** | "⚠️ [Firma] — schválená reštrukturalizácia. Firma sa snaží vyhnúť konkurzu. Odporúčame sledovať priebeh." |
| **Dlh voči štátu** | "⚠️ [Firma] — nový daňový nedoplatok [X] €. Celkové nedoplatky: [Y] €. Risk skóre kleslo z [A] na [B]." |
| **Zmena konateľa** | "ℹ️ [Firma] — nový konateľ: [Meno]. Skontrolujte prepojenia v Business Risk Reporte." + 1-klik "Preveriť firmu (14 €)" |
| **Zníženie základného imania** | "⚠️ [Firma] — základné imanie znížené o [X]% (z [A] € na [B] €). Možný signál finančných ťažkostí." |
| **Strata platcu DPH** | "⚠️ [Firma] — firma stratila status platcu DPH. Možný signál zániku obchodnej činnosti." |
| **Nová účtovná závierka** | "📊 [Firma] — podaná závierka za [rok]. Tržby: [X] €, zisk: [Y] €. Risk skóre: [Z]/100." + 1-klik "Zobraziť vizitku" |
| **Exekúcia** | "🚨 [Firma] — nová exekúcia [X] €. Celkové exekúcie: [Y] €." |
| **Likvidácia** | "🚨 [Firma] — spoločnosť v likvidácii. Odporúčame okamžite zabezpečiť pohľadávky." |

### 1-klik akcie z alertu

- **"Preveriť firmu"** → redirect na checkout (14 € Business Risk Report, PAYG alebo z kreditov balíka)
- **"Zobraziť vizitku"** → `/firma/[ico]` (free)
- **"Pridať poznámku"** → interná poznámka k sledovanej firme
- **"Odobrať z monitoringu"** → odstráni firmu zo sledovaných

## Technická realizácia

### Databázový model

```prisma
model WatchedCompany {
  id          String   @id @default(cuid())
  userId      String
  companyId   String   // IČO
  note        String?  // užívateľská poznámka
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, companyId])
  @@index([userId])
}

model AlertEvent {
  id          String   @id @default(cuid())
  companyId   String   // IČO
  source      String   // ORSR, RUZ, INSOLVENCY, VESTNIK, FS, RPVS
  eventType   String   // konkurz, dlh, zmena_konatela, ...
  severity    String   // critical, warning, info
  title       String   // "Konkurz otvorený"
  description String   // Smart interpretácia
  metadata    Json?    // raw dáta z registra
  riskScore   Int?     // aktuálne Risk skóre firmy
  createdAt   DateTime @default(now())
  notifiedAt  DateTime?

  @@index([companyId, createdAt])
  @@index([source, eventType])
}

model AlertDelivery {
  id          String   @id @default(cuid())
  alertId     String
  userId      String
  channel     String   // email, in_app, slack
  status      String   // pending, sent, failed
  sentAt      DateTime?
  createdAt   DateTime @default(now())

  @@index([userId, status])
}
```

### Cron job — denný monitoring

```
Schedul: 06:00 CEST denne (po update registrov)

1. Načítaj všetky unikátne IČO z WatchedCompany
2. Pre každé IČO:
   a. ORSR: scrape → porovnaj s posledným stavom v DB → diff
   b. RÚZ: API ?zmenene-od=včerajšie → nové závierky
   c. Insolvenčný register: query → nové konania
   d. Obchodný vestník: RSS/scrape → nové podania
   e. Finančná správa: zoznamy DPH → zmeny
   f. RPVS: API → zmeny (2x týždenne)
3. Pre každý diff → vytvor AlertEvent so smart interpretáciou
4. Pre každý AlertEvent → rozoslať notifikácie používateľom ktorí sledujú dané IČO
5. Update Risk skóre firmy ak je k dispozícii nová závierka
```

**Výkon:**
- ~200 firiem na používateľa × ~50 aktívnych používateľov = ~10 000 IČO
- Paralelizmus: 5 súčasných requestov, ~3s na firmu = ~100 minút
- Beží na VPS cez PM2 cron, nezaťažuje Next.js

### Notifikačné kanály

**Fáza 1 (MVP):**
- **Email** cez Resend (existuje v projekte)
- Šablóna: HTML email s zoznamom alertov za deň, farebne odlíšené severity
- Predmet: "🚨 Verifa Watch — [N] nových udalostí" alebo "✅ Žiadne kritické zmeny"

**Fáza 2:**
- **In-app notifikácie** — bell icon v headeri, neprečítané badge
- **Dashboard** — `/monitoring` stránka s prehľadom sledovaných firiem a časovou osou udalostí

**Fáza 3:**
- **Slack/Teams webhook** — pre B2B korporátnych klientov
- **Push notifikácie** — PWA / mobile app

### UI — Monitoring dashboard

```
/monitoring                    — prehľad sledovaných firiem + alertov
/monitoring/firma/[ico]        — detail sledovanej firmy (časová os udalostí)
/monitoring/pridat             — vyhľadávanie a pridávanie firiem
/monitoring/nastavenia         — typy alertov, emailové adresy, skupiny
```

**Funkcie dashboardu:**
- Zoznam sledovaných firiem s aktuálnym Risk skóre a počtom nových alertov
- Časová os udalostí (rovnaký komponent ako na vizitke)
- Filtre: severity, typ udalosti, firma
- Pridávanie firiem: vyhľadávanie podľa IČO/názvu (z DB Company)
- Hromadný import: CSV s IČO zoznamom
- Skupiny firiem: "Dodávatelia", "Klienti", "Partneři"
- Export alertov do CSV/Excel

## Bezpečnosť a limity

- **Rate limiting:** max 10 pridávaní firiem za deň (anti-abuse)
- **Limity podľa balíka:** hard limit v DB (WatchedCompany count check pri pridávaní)
- **Free tier:** 3 firmy, len konkurz/insolvencia alert — ostatné udalosti sa neoznámia
- **Email frequency:** denný digest (nie real-time) — jeden email denne so všetkými zmenami
- **Unsubscribe:** každý email má "Spravovať sledované firmy" link

## Náklady

| Položka | Mesačne |
|---|---|
| Cron job VPS čas (~100 min/deň) | ~$0 (zahrnuté v VPS) |
| Resend emaily (~50 emailov/deň) | ~$0 (free tier 100/deň) |
| DB storage (WatchedCompany + AlertEvent) | zanedbateľné |
| **Spolu** | **~$0** |

## Fázy implementácie

### Fáza 1: Databáza + cron (3-5 dní)
- Prisma modely: `WatchedCompany`, `AlertEvent`, `AlertDelivery`
- Cron script: denný diff orsr/ruz/insolvency pre sledované IČO
- Smart interpretácia šablóny (rule-based kód, nie LLM)
- Email digest cez Resend

### Fáza 2: UI dashboard (3-5 dní)
- `/monitoring` stránka — zoznam sledovaných firiem
- Pridávanie/odoberanie firiem
- Časová os udalostí
- Nastavenia alertov (typy, email)

### Fáza 3: Integrácia do balíkov (1-2 dni)
- Limit check podľa balíka (10/50/200)
- Free tier (3 firmy, konkurz len)
- 1-klik "Preveriť firmu" z alertu → checkout

### Fáza 4: Slack webhook + pokročilé (voliteľné)
- Slack/Teams notifikácie pre Korporát
- Skupiny firiem
- Hromadný import CSV
- Export alertov

## Metrika úspechu

| Metrika | Cieľ (3 mesiace po spustení) |
|---|---|
| Používatelia s aspoň 1 sledovanou firmou | 30% aktívnych |
| Priemerný počet sledovaných firiem na používateľa | 8 |
| Alert → report konverzný pomer | 5% (1 z 20 alertov → kúpený Business Risk Report) |
| Retention používateľov s monitoringom vs bez | 2× vyšší |

## Bezpečnostné požiadavky (must implement)

### Soft delete
- Všetky modely (`WatchedCompany`, `AlertEvent`, `AlertDelivery`) musia mať `deletedAt DateTime?` pole
- Pridať `@@index([deletedAt])` pre efektívne filtrovanie
- Všetky dotazy musia filtrovať `deletedAt: null` (okrem cleanup cronu)

### IDOR ochrana
- Všetky API endpointy musia filtrovať podľa `userId` z session
- Používateľ nemôže vidieť sledované firmy ani alerty iných používateľov
- `GET /api/watched-companies` → `where: { userId: session.user.id, deletedAt: null }`
- `DELETE /api/watched-companies/[id]` → `where: { id, userId: session.user.id, deletedAt: null }`

### Rate limiting
- `POST /api/watched-companies` — 10 operácií za minútu na používateľa
- `DELETE /api/watched-companies/[id]` — 10 operácií za minútu na používateľa
- `PATCH /api/alert-events/[id]/read` — 50 operácií za minútu na používateľa
- Použiť `rateLimitByKey("watch:${userId}", ...)` pattern

### Input validation
- IČO musí byť validované: `/^\d{8}$/` regex
- Skontrolovať existenciu firmy v `Company` tabuľke pred pridaním do sledovaných
- Note pole obmedziť na 500 znakov, sanitizovať (escapeHtml)

### Plan-based limits
- Free: 3 firmy, len konkurz/insolvencia alerty
- Freelance (49€): 10 firiem
- Firma (159€): 50 firiem
- Korporát (289€): 200 firiem
- Pred pridaním skontrolovať `user.planName` a spočítať existujúce `WatchedCompany`
- Pre Free tier filtrovať alerty podľa typu (len konkurz/insolvencia)

### Cron security
- Cron endpoint chránený `verifyCronSecret()` s timing-safe comparison
- Rate limited: max 1 volanie za hodinu
- Pridať do `vercel.json` s schedule `0 6 * * *` (06:00 UTC denne)
- Timeout: max 10 minút na beh (spracovanie ~10k firiem)

### Notification rate limiting
- Max 10 alertov na email za deň na používateľa
- Kritické alerty (konkurz, insolvencia) vždy odoslať okamžite
- Batch less-severe alerty do denného digestu
- Ak používateľ má `emailBounced = true`, neposielať email

### Data retention
- `AlertEvent` staršie ako 1 rok → automaticky zmazať (cron)
- `AlertDelivery` staršie ako 30 dní → automaticky zmazať
- `WatchedCompany` pri vymazaní používateľa → CASCADE zmazať

### Audit logging
- Logovať pridanie/odobranie sledovanej firmy (userId, companyId, action, timestamp)
- Logovať odoslanie notifikácie (alertId, userId, channel, status)
- Audit logy uchovávať 12 mesiacov

### Zánik sledovanej firmy
- Ak ORSR vráti "neexistuje" pre sledované IČO, vytvoriť AlertEvent s severity "critical"
- Notifikovať používateľa: "Sledovaná firma [IČO] bola vymazaná z ORSR. Monitoring bol pozastavený."
- WatchedCompany záznam ponechať (nezmazať) — používateľ môže firma re-sledovať ak sa vráti do registra
- Ak firma neexistuje v ORSR 30 dní, automaticky označiť WatchedCompany ako `deletedAt` (soft delete)
- Cron musí skontrolovať existenciu firmy v ORSR pred pokusom o diff

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── IČO check-digit validation (same logic as ReportForm.tsx) ──────────────

function isValidIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(ico[i], 10) * (8 - i);
  return (11 - (sum % 11)) % 10 === parseInt(ico[7], 10);
}

describe("IČO check-digit validation", () => {
  it("accepts real valid Slovak IČOs", () => {
    // 00684881 — test company used throughout the app
    assert.ok(isValidIco("00684881"));
    // 00123455 — computed valid check digit
    assert.ok(isValidIco("00123455"));
    // 00000001 — leading zeros, valid
    assert.ok(isValidIco("00000001"));
  });

  it("rejects IČO with wrong check digit", () => {
    // Flip last digit to break checksum
    assert.ok(!isValidIco("00684882"));
    assert.ok(!isValidIco("00684880"));
    assert.ok(!isValidIco("12345678")); // well-known invalid
  });

  it("rejects non-8-digit strings", () => {
    assert.ok(!isValidIco("1234567"));
    assert.ok(!isValidIco("123456789"));
    assert.ok(!isValidIco(""));
    assert.ok(!isValidIco("abcdefgh"));
    assert.ok(!isValidIco("12 34 56 78"));
  });

  it("rejects all-zeros (invalid check digit)", () => {
    // 0*8+0*7+...+0*2 = 0 → 11-0=11 → 11%10=1 ≠ 0
    assert.ok(!isValidIco("00000000"));
  });
});

// ── ORSR extraction functions (mirror of orsr.ts internal functions) ───────
// We replicate the parsing logic here to test it in isolation without
// importing orsr.ts (which depends on prisma and fetch).

const LABEL_RE = /^[A-ZÁ-Ž][a-zá-ž]+\s*[a-zá-ž]*:/;
const SUBLABELS = new Set(["vznik funkcie", "konanie menom", "spôsob konania", "dátum aktualizácie"]);

function extractEstablishedDate(text: string): Date | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("dátum vzniku") || lower.includes("datum vzniku")) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const candidate = lines[j].trim();
        const m = candidate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) {
          return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
        }
      }
    }
  }
  return null;
}

function extractShareCapital(text: string): number | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("základné imanie") || lower.includes("zakladne imanie")) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const candidate = lines[j].trim();
        const m = candidate.match(/([\d\s]+[,\.]?\d*)\s*(?:EUR|€)?/i);
        if (m) {
          const numStr = m[1].replace(/\s/g, "").replace(",", ".");
          const val = parseFloat(numStr);
          if (!isNaN(val) && val > 0) return val;
        }
        if (candidate.toLowerCase().includes("splaten") || /\d/.test(candidate)) {
          const m2 = candidate.match(/([\d\s]+[,\.]?\d*)/);
          if (m2) {
            const numStr = m2[1].replace(/\s/g, "").replace(",", ".");
            const val = parseFloat(numStr);
            if (!isNaN(val) && val > 0) return val;
          }
        }
      }
    }
  }
  return null;
}

function extractBusinessActivity(text: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("predmet činnosti") || lower.includes("predmet cinnosti")) {
      const activityLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const candidate = lines[j].trim();
        if (!candidate) { if (activityLines.length > 0) break; continue; }
        if (LABEL_RE.test(candidate) && candidate.length < 60) break;
        activityLines.push(candidate);
      }
      if (activityLines.length > 0) {
        return activityLines.join(" ").slice(0, 2000);
      }
    }
  }
  return null;
}

function extractSigningAuthority(text: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("konanie menom") || lower.includes("spôsob konania")) {
      const authLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const candidate = lines[j].trim();
        if (!candidate) { if (authLines.length > 0) break; continue; }
        if (LABEL_RE.test(candidate) && candidate.length < 60 && !SUBLABELS.has(candidate.split(":")[0].trim().toLowerCase())) break;
        authLines.push(candidate);
      }
      if (authLines.length > 0) {
        return authLines.join(" ").slice(0, 1000);
      }
    }
  }
  return null;
}

// Sample ORSR text (simplified, based on real ORSR Aktuálny výpis format)
const SAMPLE_ORSR_TEXT = `Obchodné meno:
"Test Firma s.r.o."
Sídlo:
Testová 123
811 01 Bratislava
(od: 01.01.2020 do: 15.06.2021)
Nová 456
811 02 Bratislava
IČO:
00684881
Dátum vzniku:
15.03.2010
Právna forma:
Spoločnosť s ručením obmedzeným
Predmet činnosti:
Kúpa tovaru na účel jeho predaja konečnému spotrebiteľovi
Sprostredkovateľské služby
Reštauračné a ubytovacie služby
Konanie menom spoločnosti:
Konateľ koná v mene spoločnosti samostatne
Štatutárny orgán:
Ing. Ján Testový
(od: 15.03.2010)
Mgr. Peter Druhý
(od: 10.05.2015 do: 20.12.2020)
vymazaný
Ing. Ján Testový
(od: 15.03.2010)
Základné imanie:
5 000,00 EUR
Ďalšie údaje:
Nejaké ďalšie informácie`;

describe("ORSR extractEstablishedDate", () => {
  it("extracts date from Dátum vzniku section", () => {
    const d = extractEstablishedDate(SAMPLE_ORSR_TEXT);
    assert.ok(d);
    assert.equal(d!.getFullYear(), 2010);
    assert.equal(d!.getMonth(), 2); // March (0-indexed)
    assert.equal(d!.getDate(), 15);
  });

  it("returns null when section missing", () => {
    assert.equal(extractEstablishedDate("No dates here"), null);
  });

  it("handles 'datum vzniku' without diacritics", () => {
    const text = "Datum vzniku:\n01.01.2000";
    const d = extractEstablishedDate(text);
    assert.ok(d);
    assert.equal(d!.getFullYear(), 2000);
  });
});

describe("ORSR extractShareCapital", () => {
  it("extracts amount in EUR with comma decimal", () => {
    const val = extractShareCapital(SAMPLE_ORSR_TEXT);
    assert.ok(val);
    assert.equal(val, 5000);
  });

  it("extracts amount without decimal part", () => {
    const text = "Základné imanie:\n5000 EUR";
    assert.equal(extractShareCapital(text), 5000);
  });

  it("extracts large amount with spaces", () => {
    const text = "Základné imanie:\n1 200 000,00 EUR";
    const val = extractShareCapital(text);
    assert.ok(val);
    assert.equal(val, 1200000);
  });

  it("returns null when section missing", () => {
    assert.equal(extractShareCapital("No capital info"), null);
  });

  it("returns null for zero value", () => {
    const text = "Základné imanie:\n0,00 EUR";
    assert.equal(extractShareCapital(text), null);
  });
});

describe("ORSR extractBusinessActivity", () => {
  it("extracts multi-line activity", () => {
    const val = extractBusinessActivity(SAMPLE_ORSR_TEXT);
    assert.ok(val);
    assert.ok(val!.includes("Kúpa tovaru"));
    assert.ok(val!.includes("Sprostredkovateľské služby"));
    assert.ok(val!.includes("Reštauračné a ubytovacie služby"));
  });

  it("returns null when section missing", () => {
    assert.equal(extractBusinessActivity("No activity here"), null);
  });

  it("stops at next label", () => {
    const text = "Predmet činnosti:\nSprostredkovanie obchodu\nĎalšie údaje:\nSomething else";
    const val = extractBusinessActivity(text);
    assert.ok(val);
    assert.ok(!val!.includes("Something else"));
    assert.ok(val!.includes("Sprostredkovanie obchodu"));
  });

  it("truncates to 2000 chars", () => {
    const longActivity = "A".repeat(3000);
    const text = `Predmet činnosti:\n${longActivity}`;
    const val = extractBusinessActivity(text);
    assert.ok(val);
    assert.equal(val!.length, 2000);
  });
});

describe("ORSR extractSigningAuthority", () => {
  it("extracts signing authority text", () => {
    const val = extractSigningAuthority(SAMPLE_ORSR_TEXT);
    assert.ok(val);
    assert.ok(val!.includes("samostatne"));
  });

  it("returns null when section missing", () => {
    assert.equal(extractSigningAuthority("No signing info"), null);
  });

  it("handles 'spôsob konania' label", () => {
    const text = "Spôsob konania:\nKonateľ koná samostatne";
    const val = extractSigningAuthority(text);
    assert.ok(val);
    assert.ok(val!.includes("samostatne"));
  });
});

// ── i18n new keys check ────────────────────────────────────────────────────

describe("i18n new keys exist in all languages", () => {
  const NEW_KEYS = ["form.hladamFirmu", "form.firmaNenajdena"];
  const LANGS = ["sk", "en", "de", "cz", "hu", "pl"] as const;

  for (const lang of LANGS) {
    it(`${lang} has new lookup keys`, async () => {
      const mod = await import(`../i18n/${lang}`);
      const dict = mod.default || mod;
      for (const key of NEW_KEYS) {
        assert.ok(dict[key], `Missing key "${key}" in ${lang}`);
        assert.ok(typeof dict[key] === "string");
        assert.ok(dict[key].length > 0, `Empty value for "${key}" in ${lang}`);
      }
    });
  }
});

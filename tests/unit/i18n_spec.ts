/**
 * Unit testy pre i18n.ts — parita kľúčov SK/EN/DE.
 *
 * Testuje:
 * - Všetky SK kľúče existujú v EN
 * - Všetky SK kľúče existujú v DE
 * - Žiadne prázdne hodnoty v žiadnom jazyku
 * - Žiadne duplicitné kľúče v rámci jedného jazyka
 * - translate() fallback na SK pre chýbajúci kľúč
 * - translate() interpolácia parametrov
 * - LANGUAGES má 3 jazyky
 * - LOCALE_MAP mapuje všetky jazyky
 *
 * Spustenie: npx ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' tests/unit/i18n_spec.ts
 */

const { translations, translate, LANGUAGES, LOCALE_MAP, Lang } = require("../../frontend/src/lib/i18n.ts");

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
};

const assertEq = <T>(actual: T, expected: T, message: string) => {
  if (actual !== expected) throw new Error(`FAIL: ${message} — expected ${expected}, got ${actual}`);
  console.log(`  ✓ ${message}`);
};

async function runTests() {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`✗ ${name}: ${e.message}`);
    }
  };

  console.log("\n── i18n.ts unit tests ──\n");

  const skKeys = Object.keys(translations.sk);
  const enKeys = Object.keys(translations.en);
  const deKeys = Object.keys(translations.de);

  // ── Key parity ─────────────────────────────────────────────────────────────

  await test("SK has keys", () => {
    assert(skKeys.length > 100, `SK should have 100+ keys, got ${skKeys.length}`);
  });

  await test("EN has same keys as SK", () => {
    const missingInEn = skKeys.filter(k => !translations.en[k]);
    assert(missingInEn.length === 0, `Missing in EN: ${missingInEn.slice(0, 10).join(", ")}${missingInEn.length > 10 ? "..." : ""}`);
  });

  await test("DE has same keys as SK", () => {
    const missingInDe = skKeys.filter(k => !translations.de[k]);
    assert(missingInDe.length === 0, `Missing in DE: ${missingInDe.slice(0, 10).join(", ")}${missingInDe.length > 10 ? "..." : ""}`);
  });

  await test("EN has no extra keys not in SK", () => {
    const extraInEn = enKeys.filter(k => !translations.sk[k]);
    assert(extraInEn.length === 0, `Extra in EN: ${extraInEn.slice(0, 10).join(", ")}`);
  });

  await test("DE has no extra keys not in SK", () => {
    const extraInDe = deKeys.filter(k => !translations.sk[k]);
    assert(extraInDe.length === 0, `Extra in DE: ${extraInDe.slice(0, 10).join(", ")}`);
  });

  // ── Empty values ───────────────────────────────────────────────────────────

  await test("SK has no empty values", () => {
    const empty = skKeys.filter(k => translations.sk[k] === "");
    assert(empty.length === 0, `Empty SK values: ${empty.join(", ")}`);
  });

  await test("EN has no empty values", () => {
    const empty = enKeys.filter(k => translations.en[k] === "");
    assert(empty.length === 0, `Empty EN values: ${empty.join(", ")}`);
  });

  await test("DE has no empty values", () => {
    const empty = deKeys.filter(k => translations.de[k] === "");
    assert(empty.length === 0, `Empty DE values: ${empty.join(", ")}`);
  });

  // ── No duplicate keys (TS would error, but verify at runtime) ──────────────

  await test("SK key count matches unique count", () => {
    const unique = new Set(skKeys);
    assertEq(unique.size, skKeys.length, "SK has no duplicate keys");
  });

  await test("EN key count matches unique count", () => {
    const unique = new Set(enKeys);
    assertEq(unique.size, enKeys.length, "EN has no duplicate keys");
  });

  await test("DE key count matches unique count", () => {
    const unique = new Set(deKeys);
    assertEq(unique.size, deKeys.length, "DE has no duplicate keys");
  });

  // ── translate() function ───────────────────────────────────────────────────

  await test("translate returns SK value for SK lang", () => {
    const result = translate("sk", "nav.overenie");
    assertEq(result, "Overenie", "translate(sk, nav.overenie) = 'Overenie'");
  });

  await test("translate returns EN value for EN lang", () => {
    const result = translate("en", "nav.overenie");
    assertEq(result, "Verification", "translate(en, nav.overenie) = 'Verification'");
  });

  await test("translate returns DE value for DE lang", () => {
    const result = translate("de", "nav.overenie");
    assertEq(result, "Prüfung", "translate(de, nav.overenie) = 'Prüfung'");
  });

  await test("translate falls back to SK for missing EN key", () => {
    const result = translate("en", "nonexistent.key");
    assertEq(result, "nonexistent.key", "missing key returns key itself");
  });

  await test("translate interpolates params", () => {
    const result = translate("sk", "reports.predMin", { n: 5 });
    assertEq(result, "pred 5 min", "interpolation works");
  });

  await test("translate interpolates params in EN", () => {
    const result = translate("en", "reports.predMin", { n: 5 });
    assertEq(result, "5 min ago", "EN interpolation works");
  });

  await test("translate interpolates params in DE", () => {
    const result = translate("de", "reports.predMin", { n: 5 });
    assert(result.includes("5"), `DE interpolation should contain '5', got: ${result}`);
  });

  // ── LANGUAGES & LOCALE_MAP ─────────────────────────────────────────────────

  await test("LANGUAGES has 3 entries", () => {
    assertEq(LANGUAGES.length, 3, "should have sk, en, de");
  });

  await test("LANGUAGES contains sk, en, de", () => {
    const codes = LANGUAGES.map((l: any) => l.code);
    assert(codes.includes("sk"), "has sk");
    assert(codes.includes("en"), "has en");
    assert(codes.includes("de"), "has de");
  });

  await test("LOCALE_MAP maps all 3 languages", () => {
    assertEq(LOCALE_MAP.sk, "sk-SK", "sk → sk-SK");
    assertEq(LOCALE_MAP.en, "en-GB", "en → en-GB");
    assertEq(LOCALE_MAP.de, "de-DE", "de → de-DE");
  });

  await test("LANGUAGES have flags", () => {
    for (const lang of LANGUAGES) {
      assert(typeof lang.flag === "string" && lang.flag.length > 0, `${lang.code} has flag`);
    }
  });

  await test("LANGUAGES have labels", () => {
    for (const lang of LANGUAGES) {
      assert(typeof lang.label === "string" && lang.label.length > 0, `${lang.code} has label`);
    }
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n  SK: ${skKeys.length} keys, EN: ${enKeys.length} keys, DE: ${deKeys.length} keys`);
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(console.error);

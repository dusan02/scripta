import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { translations, translate, Lang } from "../i18n";

const LANGS: Lang[] = ["sk", "en", "de", "cz", "hu", "pl"];

describe("i18n key completeness", () => {
  it("all languages have the same set of keys", () => {
    const skKeys = Object.keys(translations.sk).sort();
    for (const lang of LANGS) {
      const langKeys = Object.keys(translations[lang]).sort();
      assert.deepEqual(skKeys, langKeys, `${lang} keys mismatch`);
    }
  });

  it("has a reasonable number of keys (>= 500)", () => {
    for (const lang of LANGS) {
      const count = Object.keys(translations[lang]).length;
      assert.ok(count >= 500, `${lang} has only ${count} keys (expected >= 500)`);
    }
  });

  it("no empty string values in any language", () => {
    for (const lang of LANGS) {
      const entries = Object.entries(translations[lang]);
      for (const [key, val] of entries) {
        if (typeof val === "string" && val.trim() === "") {
          assert.fail(`Empty value for key "${key}" in ${lang}`);
        }
      }
    }
  });
});

describe("a11y keys exist in all languages", () => {
  const A11Y_KEYS = [
    "a11y.icoInput",
    "a11y.clearIco",
    "a11y.retryReport",
    "a11y.deleteReport",
    "a11y.downloadReport",
    "a11y.openReport",
    "a11y.closeModal",
    "a11y.deleteAllReports",
    "a11y.skipToContent",
  ];

  for (const key of A11Y_KEYS) {
    it(`"${key}" exists in all languages`, () => {
      for (const lang of LANGS) {
        assert.ok(
          key in translations[lang],
          `Missing "${key}" in ${lang}`
        );
      }
    });
  }
});

describe("chart keys exist in all languages", () => {
  const CHART_KEYS = [
    "firma.analyzaTrendu",
    "firma.udajeNedostupne",
    "firma.bilancnaSuma",
    "firma.dlhodobyMajetok",
    "firma.zaporneImanie",
    "firma.ostatneAktiva",
    "firma.ostatnePasiva",
  ];

  for (const key of CHART_KEYS) {
    it(`"${key}" exists in all languages`, () => {
      for (const lang of LANGS) {
        assert.ok(key in translations[lang], `Missing "${key}" in ${lang}`);
      }
    });
  }
});

describe("landing keys exist in all languages", () => {
  const LANDING_KEYS = [
    "landing.footerTagline",
    "landing.regGroup1",
    "landing.regGroup2",
    "landing.regGroup3",
    "landing.regGroup4",
    "landing.regGroup5",
    "landing.regGroup6",
  ];

  for (const key of LANDING_KEYS) {
    it(`"${key}" exists in all languages`, () => {
      for (const lang of LANGS) {
        assert.ok(key in translations[lang], `Missing "${key}" in ${lang}`);
      }
    });
  }
});

describe("feedback.nepovinne exists in all languages", () => {
  it(`"feedback.nepovinne" exists in all languages`, () => {
    for (const lang of LANGS) {
      assert.ok("feedback.nepovinne" in translations[lang], `Missing "feedback.nepovinne" in ${lang}`);
    }
  });
});

describe("admin keys exist in all languages", () => {
  const ADMIN_KEYS = [
    "admin.pristupZamietnuty",
    "admin.prehled",
    "admin.pouzivatelia",
    "admin.reportyCelkom",
    "admin.dokoncene",
    "admin.prebiejajuce",
    "admin.zlyhanе",
    "admin.spatnaVazba",
    "admin.spravyPouzivatelov",
    "admin.minuteKredity",
    "admin.posledneReporty",
    "admin.posledniPouzivatelia",
    "admin.firma",
    "admin.ico",
    "admin.pouzivatel",
    "admin.stav",
    "admin.datum",
    "admin.ziadneReporty",
    "admin.ziadniPouzivatelia",
    "admin.email",
    "admin.meno",
    "admin.rola",
    "admin.registracia",
    "admin.nacitanieZlyhalo",
    "admin.walletBalance",
    "admin.nakupeneKredity",
    "admin.minuteKredityUser",
    "admin.vrateneKredity",
    "admin.aktivneBatche",
    "admin.reportyPouzivatela",
    "admin.ziadneTransakcie",
    "admin.ziadneReportyUser",
    "admin.ziadneBatche",
    "admin.kreditoveBatche",
    "admin.admin",
    "admin.pouzivatelRole",
    "admin.feedbackTitulok",
    "admin.vsetky",
    "admin.ziadneFeedbacky",
    "admin.messagesTitulok",
    "admin.novinka",
    "admin.odpoved",
    "admin.system",
    "admin.odPouzivatela",
    "admin.zrusit",
    "admin.novaSprava",
    "admin.novinkaVsetky",
    "admin.odpovedPodnet",
    "admin.systemOznamenie",
    "admin.zanechajtePrazdne",
    "admin.nadpisSpravy",
    "admin.textSpravy",
    "admin.odosielam",
    "admin.odoslat",
    "admin.ziadneSpravy",
    "admin.prijate",
    "admin.poslane",
    "admin.spravaOdoslana",
    "admin.emailNeposlany",
    "admin.pouzivatelNenajdeny",
    "admin.odoslanieZlyhalo",
  ];

  const EMAIL_KEYS = [
    "email.footer",
    "email.dobryDen",
    "email.sPozdravom",
    "email.timVerifa",
    "email.reportDokonceny",
    "email.reportCiastocne",
    "email.reportZlyhany",
    "email.reportNeznamy",
    "email.reportZobrazit",
    "email.reportChyba",
    "email.reportSubject",
    "email.reportBodyText",
    "email.reportBodyHtml",
    "email.reportHeading",
    "email.feedbackChyba",
    "email.feedbackNavrh",
    "email.feedbackOtazka",
    "email.feedbackIne",
    "email.feedbackSpatnaVazba",
    "email.feedbackKategoriaPovinna",
    "email.feedbackTextPovinny",
    "email.inboundPrazdnaOdpoved",
    "email.inboundOdpoved",
    "email.bounceNotificationTitle",
    "email.bounceNotificationBody",
  ];

  for (const key of EMAIL_KEYS) {
    it(`"${key}" exists in all languages`, () => {
      for (const lang of LANGS) {
        assert.ok(key in translations[lang], `Missing "${key}" in ${lang}`);
      }
    });
  }

  for (const key of ADMIN_KEYS) {
    it(`"${key}" exists in all languages`, () => {
      for (const lang of LANGS) {
        assert.ok(key in translations[lang], `Missing "${key}" in ${lang}`);
      }
    });
  }
});

describe("home.welcome keys exist in all languages", () => {
  for (const key of ["home.welcomeTitle", "home.welcomeDesc"]) {
    it(`"${key}" exists in all languages`, () => {
      for (const lang of LANGS) {
        assert.ok(key in translations[lang], `Missing "${key}" in ${lang}`);
      }
    });
  }
});

describe("translate function", () => {
  it("returns Slovak for sk", () => {
    assert.equal(translate("sk", "home.overenieSubjektu"), "Overenie subjektu");
  });

  it("returns English for en", () => {
    assert.equal(translate("en", "home.overenieSubjektu"), "Entity Verification");
  });

  it("falls back to sk for unknown language", () => {
    assert.equal(translate("xx" as Lang, "home.overenieSubjektu"), "Overenie subjektu");
  });

  it("interpolates parameters", () => {
    const result = translate("sk", "grid.zRegistrov", { total: 25 });
    assert.ok(result.includes("25"), `Expected "25" in result: ${result}`);
  });

  it("returns key name for missing key", () => {
    const result = translate("sk", "nonexistent.key.xyz");
    assert.equal(result, "nonexistent.key.xyz");
  });
});

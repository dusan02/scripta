import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ochrana osobných údajov | Verifa.sk",
  description:
    "Zásady ochrany osobných údajov služby Verifa.sk v súlade s GDPR. Informácie o spracúvaní údajov, právach používateľov a technických opatreniach.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://verifa.sk/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "120px 24px 80px" }}>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32 }}>
        Ochrana osobných údajov
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1. Úvod</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk (ďalej len „Prevádzkovateľ“) spracúva osobné údaje v súlade s Nariadením Európskeho parlamentu a Rady (EÚ) 2016/679 (ďalej len „GDPR“) a zákonom č. 18/2018 Z. z. o ochrane osobných údajov. Tieto zásady popisujú, aké údaje spracúvame, na aký účel a aké práva máte ako subjekt údajov.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2. Prevádzkovateľ</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Prevádzkovateľom služby Verifa.sk je:<br />
            <strong>Verifa s.r.o.</strong><br />
            IČO: 12345678<br />
            Slovenská republika<br />
            Kontakt: <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>3. Aké údaje spracúvame</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            <strong>Údaje používateľa (zákazníka):</strong>
          </p>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Meno, priezvisko a e-mailová adresa (pri registrácii)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Fakturačné údaje (názov firmy, IČO, DIČ, adresa — pri platbách)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Technické údaje (IP adresa, typ prehliadača — z technických dôvodov)</li>
          </ul>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
            <strong>Údaje o preverovaných firmách a osobách:</strong>
          </p>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>IČO a názov preverovanej firmy</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Meno a priezvisko štatutárov, spoločníkov a skutočných vlastníkov (z verejných registrov)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Finančné a právne údaje firmy (z ORSR, RÚZ, insolvenčných registrov a ďalších)</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>4. Účel a právny základ spracúvania</h2>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Poskytovanie služby</strong> — Art. 6 ods. 1 písm. b) GDPR (plnenie zmluvy)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Fakturácia a účtovníctvo</strong> — Art. 6 ods. 1 písm. c) GDPR (právna povinnosť)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Ochrana oprávnených záujmov</strong> — Art. 6 ods. 1 písm. f) GDPR (prevencia podvodov, bezpečnosť)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Súhlas používateľa</strong> — Art. 6 ods. 1 písm. a) GDPR (marketingové komunikácie — len na základe dobrovoľného súhlasu)</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>5. Zdroje údajov o firmách</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Údaje o preverovaných firmách sú získavané výhradne z verejne dostupných štátnych registrov Slovenskej republiky (ORSR, ŽRSR, Register úpadcov, RPVS, RÚZ, register DPH a ďalšie). Tieto údaje sú verejné a sprístupnené v zmysle príslušných zákonov SR. Verifa.sk nezbiera osobné údaje z neverejných alebo súkromných zdrojov.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>6. Doba uchovávania údajov</h2>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Účtovné doklady:</strong> 10 rokov (podľa zákona o účtovníctve)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Vygenerované reporty:</strong> po dobu platnosti používateľského účtu</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Prístupové logy:</strong> 12 mesiacov (bezpečnostné dôvody)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Marketingový súhlas:</strong> do odvolania súhlasu</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>7. Práva subjektu údajov</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            V zmysle GDPR máte nasledujúce práva:
          </p>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo na prístup</strong> — môžete si vyžiadať informácie o spracúvaných údajoch</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo na opravu</strong> — môžete požadovať opravu nepresných údajov</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo na vymazanie</strong> — môžete požadovať vymazanie údajov („právo byť zabudnutý“)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo na obmedzenie spracúvania</strong> — môžete požadovať obmedzenie</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo na prenosnosť údajov</strong> — môžete získať údaje v strojovo čitateľnom formáte</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo vzniesť námietku</strong> — môžete namietať proti spracúvaniu</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Právo odvolať súhlas</strong> — kedykoľvek bez vplyvu na zákonnosť predchádzajúceho spracúvania</li>
          </ul>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Uplatnenie práv môžete požadovať e-mailom na <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>8. Technické a organizačné opatrenia</h2>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Šifrovanie prenosu (HTTPS/TLS 1.2+)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Hashovanie hesiel (bcrypt)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Obmedzený prístup k údajom (principle of least privilege)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Pravidelné zálohovanie databázy</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Logovanie prístupov pre audit</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>9. Prenos údajov do tretích krajín</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Údaje sú uložené na serveroch v Európskej únii. Platobné spracúvanie zabezpečuje Stripe, ktoré môže spracúvať údaje mimo EHP v súlade so Standard Contractual Clauses (SCC). Žiadne iné prenosy do tretích krajín neprebiehajú.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>10. Cookies</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk používa len nevyhnutné technické cookies (relácia, jazyk, preferencia tmavého/svetlého režimu). Nepoužívame marketingové ani sledovacie cookies tretích strán. Na používanie nevyhnutných cookies nie je potrebný súhlas.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>11. Kontakt</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pri otázkach týkajúcich sa ochrany osobných údajov nás kontaktujte na <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>. Máte tiež právo podať sťažnosť Úradu na ochranu osobných údajov Slovenskej republiky.
          </p>
        </section>

        <section>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 32 }}>
            Posledná aktualizácia: 14. júla 2026
          </p>
        </section>
      </div>
    </div>
  );
}

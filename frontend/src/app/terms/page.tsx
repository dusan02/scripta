import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Podmienky používania | Verifa.sk",
  description: "Podmienky používania služby Verifa.sk",
  robots: { index: false, follow: false },
  alternates: {
    canonical: "https://verifa.sk/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="content-page" style={{ maxWidth: 800, margin: "0 auto", padding: "80px 24px" }}>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32 }}>
        Podmienky používania
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1. Úvod</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tieto podmienky používania (ďalej len „Podmienky&ldquo;) upravujú prístup a používanie služby Verifa.sk (ďalej len „Služba&ldquo;), ktorú prevádzkuje Verifa.sk. Používaním Služby vyjadrujete súhlas s týmito Podmienkami.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2. Popis služby</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk poskytuje automatizovaný Business Risk Report získavaním údajov z verejne dostupných štátnych registrov Slovenskej republiky. Služba je určená pre profesionálne použitie a slúži ako informačný nástroj, nie ako právne alebo daňové poradenstvo.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>3. Zodpovednosť používateľa</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Používateľ je zodpovedný za všetky údaje, ktoré zadá do systému. Používateľ sa zaväzuje nepoužívať Službu na nelegálne účely, vrátane ale nie obmedzene na: (a) získavanie údajov o osobách bez ich súhlasu, (b) diskrimináciu, (c) porušovanie práv tretích osôb.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>4. Ochrana osobných údajov (GDPR)</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracúvame osobné údaje v súlade s nariadením GDPR. Údaje získavané zo štátnych registrov sú verejne dostupné. Používateľ má právo na prístup k svojim údajom, ich opravu alebo vymazanie. Viac informácií nájdete v našich <a href="/privacy" style={{ color: "var(--accent)", textDecoration: "none" }}>Zásadoch ochrany osobných údajov</a> a v <a href="/dpa" style={{ color: "var(--accent)", textDecoration: "none" }}>Dohode o spracúvaní osobných údajov (DPA)</a>.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>5. Presnosť údajov</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk sa snaží poskytovať presné a aktuálne údaje, ale nezaručuje ich úplnosť alebo presnosť. Údaje sú získavané z verejných zdrojov a môžu byť zastarané alebo nepresné. Používateľ by mal overiť kľúčové informácie priamo v príslušných registroch.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>6. Verifa Score</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa Score je hodnotenie vypočítané na základe vlastných algoritmov aplikácie. Skóre (0–100) a kategória rizika (AAA/A/B/C) sú výhradne informatívne a slúžia ako pomocný nástroj pre používateľa. Verifa Score nezastupuje profesionálne právne, finančné ani daňové posúdenie a nemôže byť použité ako jediný podklad pre rozhodovanie. Verifa.sk nezodpovedá za dôsledky rozhodnutí urobených na základe Verifa Score.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>7. Vylúčenie zodpovednosti</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Služba je poskytovaná „tak, ako je&ldquo;, bez akejkoľvek záruky. Verifa.sk nenahrádza právne, daňové ani iné profesionálne poradenstvo. Verifa.sk nezodpovedá za žiadne škody vyplývajúce z používania alebo nemožnosti použiť Službu.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>8. Kredity a refundácie</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Skúšobný kredit.</strong> Pri registrácii používateľ dostáva 1 skúšobný kredit na overenie firmy. Skúšobný kredit neexpiruje — použite ho kedykoľvek.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Jednorazové balíky.</strong> Služba ponúka jednorazové nákupy kreditov (1×, 10×, 50× Report). Platenie prebieha cez Paddle (Merchant of Record), ktorý zabezpečuje fakturáciu a odvod DPH. Kredity zakúpené jednorazovo <strong>neexpirujú</strong> — použite ich kedykoľvek.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Čerpanie.</strong> Kredity sa čerpajú v poradí FIFO (najstaršie kredity sa minú ako prvé). Jeden kredit = jeden vygenerovaný report.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Refundácia.</strong> Ak sa report nepodarí vygenerovať z dôvodu technického výpadku registrov alebo chyby systému, kredit sa automaticky vráti. Ak report zlyhá kvôli neexistujúcemu IČO alebo chybe používateľa, kredit sa nevracia.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Platobné metódy.</strong> Akceptujeme platby kartou (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal a SEPA bankový prevod prostredníctvom Paddle.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>9. Zmeny podmienok</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk si vyhradzuje právo kedykoľvek zmeniť tieto Podmienky. Zmeny budú zverejnené na tejto stránke. Pokračovanie v používaní Služby po zmenách predstavuje súhlas s novými Podmienkami.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>10. Kontakt</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ak máte otázky týkajúce sa týchto Podmienok, kontaktujte nás na <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>.
          </p>
        </section>

        <section>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 32 }}>
            Posledná aktualizácia: {new Date().toLocaleDateString("sk-SK")}.
          </p>
        </section>
      </div>
    </div>
  );
}

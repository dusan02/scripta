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
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "80px 24px" }}>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32 }}>
        Podmienky používania
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1. Úvod</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tieto podmienky používania (ďalej len „Podmienky“) upravujú prístup a používanie služby Verifa.sk (ďalej len „Služba“), ktorú prevádzkuje Verifa.sk. Používaním Služby vyjadrujete súhlas s týmito Podmienkami.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2. Popis služby</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk poskytuje automatizovaný due diligence report získavaním údajov z verejne dostupných štátnych registrov Slovenskej republiky. Služba je určená pre profesionálne použitie a slúži ako informačný nástroj, nie ako právne alebo daňové poradenstvo.
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
            Spracúvame osobné údaje v súlade s nariadením GDPR. Údaje získavané zo štátnych registrov sú verejne dostupné. Používateľ má právo na prístup k svojim údajom, ich opravu alebo vymazanie. Viac informácií nájdete v našich <a href="/privacy" style={{ color: "var(--accent)", textDecoration: "none" }}>Zásadoch ochrany osobných údajov</a>. Pre firemných zákazníkov je k dispozícii aj <a href="/dpa" style={{ color: "var(--accent)", textDecoration: "none" }}>Spracovateľská zmluva (DPA)</a>.
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
            Verifa Score je subjektívne hodnotenie vypočítané na základe vlastných algoritmov aplikácie. Skóre (0-100) a kategória rizika (AAA/A/B/C) sú výhradne informatívne a slúžia ako pomocný nástroj pre používateľa. Verifa Score nezastupuje profesionálne právne, finančné ani daňové posúdenie a nemôže byť použité ako jediný podklad pre rozhodovanie. Verifa.sk nezodpovedá za dôsledky rozhodnutí urobených na základe Verifa Score.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>7. Vylúčenie zodpovednosti</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Služba je poskytovaná „tak, ako je“, bez akejkoľvek záruky. Verifa.sk nenahrádza právne, daňové ani iné profesionálne poradenstvo. Verifa.sk nezodpovedá za žiadne škody vyplývajúce z používania alebo nemožnosti použiť Službu.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>8. Kredity, predplatné a refundácie</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Skúšobný kredit.</strong> Pri registrácii používateľ dostáva 1 skúšobný kredit na 30 dní. Po uplynutí skúšobného obdobia bez zakúpenia plánu používateľ stratí prístup k vytváraniu reportov.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Predplatné a plány.</strong> Služba ponúka mesačné predplatné (Freelance, Firma, Korporát) a jednorazové nákupy (Štart, dokúpenie kreditov). Platenie prebieha cez Stripe. Predplatné sa obnovuje automaticky každý mesiac, pokiaľ nie je zrušené.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Platnosť kreditov.</strong> Kredity zakúpené alebo získané v rámci predplatného majú platnosť <strong>90 dní</strong> od dátumu ich pripísania. Po uplynutí tejto lehoty sa nevyužité kredity automaticky vymažú. Kredity sa čerpajú v poradí FIFO (najstaršie kredity sa minú ako prvé).
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Zrušenie predplatného.</strong> Používateľ môže zrušiť predplatné kedykoľvek. Po zrušení zostávajú nevyužité kredity dostupné do konca aktuálneho fakturačného obdobia. Po jeho uplynutí sa všetky zostávajúce kredity vynulujú.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Refundácie.</strong> Ak sa nepodarí získať dáta z plateného zdroja, kredity za tento zdroj budú vrátené. Pri zlyhaní spracovania reportu na strane systému sa kredit automaticky vráti.
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
            Posledná aktualizácia: 7. júla 2026
          </p>
        </section>
      </div>
    </div>
  );
}

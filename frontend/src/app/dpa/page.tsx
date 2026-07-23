import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dohoda o spracúvaní osobných údajov (DPA) | Verifa.sk",
  description:
    "Dohoda o spracúvaní osobných údajov (DPA) medzi Verifa.sk a zákazníkom v zmysle čl. 28 GDPR.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://verifa.sk/dpa",
  },
};

export default function DpaPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "120px 24px 80px" }}>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32 }}>
        Dohoda o spracúvaní osobných údajov (DPA)
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            Tento dokument je šablóna. Pred použitím v produkcii ho musí skontrolovať advokát.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1. Zmluvné strany</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            <strong>Sprocesovateľ:</strong><br />
            Verifa s.r.o., IČO: 12345678<br />
            so sídlom v Slovenskej republike<br />
            Kontakt: <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Nariadateľ:</strong><br />
            [Názov zákazníka], IČO: [IČO zákazníka]<br />
            so sídlom [adresa zákazníka]
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Ďalej spoločne ako „strany&ldquo; a jednotlavo ako „strana&ldquo;.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2. Predmet DPA</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Táto Dohoda upravuje podmienky spracúvania osobných údajov sprocesovateľom v mene nariadateľa v súvislosti s používaním služby Verifa.sk. Sprocesovateľ spracúva osobné údaje výlučne na pokyn nariadateľa a v súlade s GDPR a zákonom č. 18/2018 Z. z.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>3. Druh a účel spracúvania</h2>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Druh údajov:</strong> Meno, priezvisko, e-mail, IČO, názov firmy, údaje štatutárov a skutočných vlastníkov z verejných registrov</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Účel:</strong> Generovanie Business Risk Reportov pre nariadateľa</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Doba spracúvania:</strong> Po dobu trvania zmluvného vzťahu + 10 rokov (účtovné doklady)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}><strong>Kategórie subjektov údajov:</strong> Zamestnanci a zástupcovia nariadateľa, štatutári a skutoční vlastníci preverovaných firiem</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>4. Povinnosti sprocesovateľa</h2>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Spracúvať osobné údaje výlučne na pokyn nariadateľa, pokiaľ nie je viazaný právnou povinnosťou.</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Zabezpečiť, že osoby oprávnené spracúvať osobné údaje sú viazané mlčanlivosťou.</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Zaviesť vhodné technické a organizačné opatrenia podľa Art. 32 GDPR.</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Neprenášať spracúvanie na ďalšieho sprocesovateľa bez predchádzajúceho súhlasu nariadateľa.</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Po skončení služby vymazať alebo vrátiť všetky osobné údaje nariadateľovi.</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Poskytnúť nariadateľovi súčinnosť pri plnení jeho povinností podľa GDPR.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>5. Technické a organizačné opatrenia</h2>
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Šifrovanie prenosu a ukladania (HTTPS/TLS, bcrypt pre heslá)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Prístupnosť na základe role (principle of least privilege)</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Pravidelné zálohovanie databázy</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Logovanie prístupov a audit</li>
            <li style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Obmedzenie fyzického prístupu k serverom</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>6. Nahlásenie narušenia bezpečnosti</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Sprocesovateľ nahlási nariadateľovi bez zbytočného odkladu, najneskôr do 48 hodín od zistenia, akékoľvek narušenie bezpečnosti osobných údajov, ktoré môže viesť k riziku pre práva a slobody fyzických osôb. Sprocesovateľ poskytne nariadateľovi všetky dostupné informácie potrebné na splnenie oznamovacej povinnosti podľa Art. 33 GDPR.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>7. Podsprocesovateľ</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Sprocesovateľ využíva nasledujúcich podsprocesovateľov: Stripe (platobné spracúvanie), hosting provider (úložisko dát). Nariadateľ udeľuje vopred súhlas s týmito podsprocesovateľmi. O zmene alebo pridaní nového podsprocesovateľa bude nariadateľ informovaný s možnosťou namietať.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>8. Prenos do tretích krajín</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Osobné údaje sú spracúvané prevažne v Európskej únii. Platobné spracúvanie zabezpečuje Stripe, ktoré môže spracúvať údaje mimo EHP v súlade so Standard Contractual Clauses (SCC).
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>9. Skončenie DPA</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Táto DPA končí spolu so zmluvou o poskytovaní služieb. Po skončení sprocesovateľ vymaže všetky osobné údaje nariadateľa do 30 dní, s výnimkou údajov, ktoré je povinný uchovávať podľa právnych predpisov.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>10. Záverečné ustanovenia</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Táto DPA sa riadi slovenským právom. Zmeny DPA vyžadujú písomnú formu. Ak je niektoré ustanovenie neplatné, ostatné ustanovenia zostávajú v platnosti.
          </p>
        </section>

        <section>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 32 }}>
            Posledná aktualizácia: 14. júla 2026<br />
            <em>Tento dokument je šablóna a musí byť skontrolovaný advokátom pred použitím v produkcii.</em>
          </p>
        </section>
      </div>
    </div>
  );
}

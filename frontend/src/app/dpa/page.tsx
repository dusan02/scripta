import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dohoda o spracúvaní osobných údajov (DPA) | Verifa.sk",
  description: "Dohoda o spracúvaní osobných údajov medzi Verifa.sk a zákazníkom",
  robots: { index: false, follow: false },
  alternates: {
    canonical: "https://verifa.sk/dpa",
  },
};

export default function DpaPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "80px 24px" }}>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32 }}>
        Dohoda o spracúvaní osobných údajov (DPA)
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1. Strany dohody</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Prevádzkovateľ</strong> (zákazník služby Verifa.sk) — fyzická alebo právnická osoba, ktorá využíva službu Verifa.sk na overenie obchodných partnerov a firiem.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Spracovateľ</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Česká republika<br />
            IČ: 06119859<br />
            (nie je platca DPH)<br />
            E-mail: <a href="mailto:dusan_baran@hotmail.com" style={{ color: "var(--accent)", textDecoration: "none" }}>dusan_baran@hotmail.com</a><br />
            Tel: +421 949 718 320
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Prevádzkovateľ a Spracovateľ sa ďalej spoločne označujú ako „Strany&ldquo; a jednotlivo ako „Strana&ldquo;.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2. Predmet a účel spracúvania</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracovateľ spracúva osobné údaje v mene a na účet Prevádzkovateľa výlučne na účel poskytovania služby Verifa.sk — generovania Business Risk Reportov z verejne dostupných štátnych registrov Slovenskej republiky.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Kategórie spracúvaných údajov:</strong>
          </p>
          <ul style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8, paddingLeft: 20 }}>
            <li>Identifikačné údaje firiem (IČO, názov, adresa)</li>
            <li>Mená konateľov a štatutárov (verejne dostupné z ORSR)</li>
            <li>Finančné údaje z účtovných závierok (RÚZ)</li>
            <li>Údaje z insolvenčných, exekučných a daňových registrov</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>3. Povinnosti spracovateľa</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracovateľ sa zaväzuje:
          </p>
          <ul style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8, paddingLeft: 20 }}>
            <li>Spracúvať osobné údaje výlučne na účel poskytovania služby a podľa pokynov Prevádzkovateľa.</li>
            <li>Zabezpečiť, aby osoby poverené spracúvaním boli viazané mlčanlivosťou.</li>
            <li>Implementovať primerané technické a organizačné opatrenia na ochranu údajov.</li>
            <li>Nezveriť spracúvanie údajov tretím stranám bez predchádzajúceho súhlasu Prevádzkovateľa.</li>
            <li>Vymazať všetky osobné údaje po ukončení poskytovania služby, ak to nebráni právnym predpisom.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>4. Povinnosti prevádzkovateľa</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Prevádzkovateľ sa zaväzuje:
          </p>
          <ul style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8, paddingLeft: 20 }}>
            <li>Zabezpečiť, že spracúvanie osobných údajov je oprávnené podľa GDPR (právny základ: oprávnený záujem, plnenie zmluvy alebo právna povinnosť).</li>
            <li>Poskytnúť Spracovateľovi všetky potrebné informácie na splnenie povinností podľa tejto dohody.</li>
            <li>Viesť záznam o spracúvanských činnostiach podľa čl. 30 GDPR.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>5. Bezpečnosť údajov</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracovateľ zabezpečuje ochranu osobných údajov primeranými technickými a organizačnými opatreniami vrátane šifrovania prenosu (TLS), šifrovania úložiska, prístupových práv a pravidelných záloh. V prípade narušenia bezpečnosti údajov Spracovateľ bez zbytočného odkladu informuje Prevádzkovateľa o rozsahu narušenia a prijatých opatreniach.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>6. Subspracovatelia</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracovateľ môže zveriť spracúvanie údajov subspracovateľom (napr. cloudový hosting, e-mailové služby, platobné brány). Spracovateľ zabezpečí, aby subspracovatelia boli viazaní rovnakými záväzkami ochrany údajov ako Spracovateľ. Aktuálny zoznam subspracovateľov je k dispozícii na vyžiadanie.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>7. Trvanie a ukončenie</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Táto dohoda nadobúda účinnosťom momentom registrácie Prevádzkovateľa v službe Verifa.sk a platí po celú dobu využívania služby. Po ukončení zmluvného vzťahu Spracovateľ vymaže všetky osobné údaje Prevádzkovateľa do 30 dní, ak právne predpisy neustanovujú inak.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>8. Kontakt</h2>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pre otázky týkajúce sa spracúvania osobných údajov kontaktujte Spracovateľa:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-mail: <a href="mailto:dusan_baran@hotmail.com" style={{ color: "var(--accent)", textDecoration: "none" }}>dusan_baran@hotmail.com</a><br />
            Tel: +421 949 718 320
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

import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";
import { Lang, LOCALE_MAP } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const meta = generatePageMetadata("dpa", lang);
  return { ...meta, robots: { index: false, follow: false } };
}

const linkStyle = { color: "var(--accent)", textDecoration: "none" } as const;
const liStyle = { fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 } as const;
const ulStyle = { paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 4 } as const;

type Section = { heading: string; body: React.ReactNode };

const CONTENT: Record<Lang, { title: string; sections: Section[]; lastUpdated: string }> = {
  sk: {
    title: "Dohoda o spracúvaní osobných údajov (DPA)",
    lastUpdated: "Posledná aktualizácia",
    sections: [
      { heading: "1. Strany dohody", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Prevádzkovateľ</strong> (zákazník služby Verifa.sk) — fyzická alebo právnická osoba, ktorá využíva službu Verifa.sk na overenie obchodných partnerov a firiem.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Spracovateľ</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />Kubelíkova 1258/43<br />130 00 Praha<br />Česká republika<br />IČ: 06119859<br />(nie je platca DPH)<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Prevádzkovateľ a Spracovateľ sa ďalej spoločne označujú ako „Strany&ldquo; a jednotlivo ako „Strana&ldquo;.
          </p>
        </>
      )},
      { heading: "2. Predmet a účel spracúvania", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracovateľ spracúva osobné údaje v mene a na účet Prevádzkovateľa výlučne na účel poskytovania služby Verifa.sk — generovania Business Risk Reportov z verejne dostupných štátnych registrov Slovenskej republiky.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Kategórie spracúvaných údajov:</strong>
          </p>
          <ul style={ulStyle}>
            <li style={liStyle}>Identifikačné údaje firiem (IČO, názov, adresa)</li>
            <li style={liStyle}>Mená konateľov a štatutárov (verejne dostupné z ORSR)</li>
            <li style={liStyle}>Finančné údaje z účtovných závierok (RÚZ)</li>
            <li style={liStyle}>Údaje z insolvenčných, exekučných a daňových registrov</li>
          </ul>
        </>
      )},
      { heading: "3. Povinnosti spracovateľa", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Spracovateľ sa zaväzuje:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Spracúvať osobné údaje výlučne na účel poskytovania služby a podľa pokynov Prevádzkovateľa.</li>
            <li style={liStyle}>Zabezpečiť, aby osoby poverené spracúvaním boli viazané mlčanlivosťou.</li>
            <li style={liStyle}>Implementovať primerané technické a organizačné opatrenia na ochranu údajov.</li>
            <li style={liStyle}>Nezveriť spracúvanie údajov tretím stranám bez predchádzajúceho súhlasu Prevádzkovateľa.</li>
            <li style={liStyle}>Vymazať všetky osobné údaje po ukončení poskytovania služby, ak to nebráni právnym predpisom.</li>
          </ul>
        </>
      )},
      { heading: "4. Povinnosti prevádzkovateľa", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Prevádzkovateľ sa zaväzuje:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Zabezpečiť, že spracúvanie osobných údajov je oprávnené podľa GDPR (právny základ: oprávnený záujem, plnenie zmluvy alebo právna povinnosť).</li>
            <li style={liStyle}>Poskytnúť Spracovateľovi všetky potrebné informácie na splnenie povinností podľa tejto dohody.</li>
            <li style={liStyle}>Viesť záznam o spracúvanských činnostiach podľa čl. 30 GDPR.</li>
          </ul>
        </>
      )},
      { heading: "5. Bezpečnosť údajov", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Spracovateľ zabezpečuje ochranu osobných údajov primeranými technickými a organizačnými opatreniami vrátane šifrovania prenosu (TLS), šifrovania úložiska, prístupových práv a pravidelných záloh. V prípade narušenia bezpečnosti údajov Spracovateľ bez zbytočného odkladu informuje Prevádzkovateľa o rozsahu narušenia a prijatých opatreniach.
        </p>
      )},
      { heading: "6. Subspracovatelia", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Spracovateľ môže zveriť spracúvanie údajov subspracovateľom (napr. cloudový hosting, e-mailové služby, platobné brány). Spracovateľ zabezpečí, aby subspracovatelia boli viazaní rovnakými záväzkami ochrany údajov ako Spracovateľ. Aktuálny zoznam subspracovateľov je k dispozícii na vyžiadanie.
        </p>
      )},
      { heading: "7. Trvanie a ukončenie", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Táto dohoda nadobúda účinnosťom momentom registrácie Prevádzkovateľa v službe Verifa.sk a platí po celú dobu využívania služby. Po ukončení zmluvného vzťahu Spracovateľ vymaže všetky osobné údaje Prevádzkovateľa do 30 dní, ak právne predpisy neustanovujú inak.
        </p>
      )},
      { heading: "8. Kontakt", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pre otázky týkajúce sa spracúvania osobných údajov kontaktujte Spracovateľa:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        </>
      )},
    ],
  },
  en: {
    title: "Data Processing Agreement (DPA)",
    lastUpdated: "Last updated",
    sections: [
      { heading: "1. Parties to the agreement", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Controller</strong> (customer of Verifa.sk) — a natural or legal person who uses the Verifa.sk service to verify business partners and companies.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Processor</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />Kubelíkova 1258/43<br />130 00 Praha<br />Czech Republic<br />ID: 06119859<br />(not a VAT payer)<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            The Controller and the Processor are hereinafter collectively referred to as the &ldquo;Parties&rdquo; and individually as a &ldquo;Party&rdquo;.
          </p>
        </>
      )},
      { heading: "2. Subject and purpose of processing", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            The Processor processes personal data on behalf of and on behalf of the Controller exclusively for the purpose of providing the Verifa.sk service — generating Business Risk Reports from publicly available state registries of the Slovak Republic.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Categories of processed data:</strong>
          </p>
          <ul style={ulStyle}>
            <li style={liStyle}>Company identification data (IČO, name, address)</li>
            <li style={liStyle}>Names of directors and statutory representatives (publicly available from ORSR)</li>
            <li style={liStyle}>Financial data from financial statements (RÚZ)</li>
            <li style={liStyle}>Data from insolvency, execution and tax registries</li>
          </ul>
        </>
      )},
      { heading: "3. Obligations of the processor", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>The Processor undertakes to:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Process personal data exclusively for the purpose of providing the service and in accordance with the Controller's instructions.</li>
            <li style={liStyle}>Ensure that persons authorized to process data are bound by confidentiality.</li>
            <li style={liStyle}>Implement appropriate technical and organizational measures to protect data.</li>
            <li style={liStyle}>Not entrust data processing to third parties without the prior consent of the Controller.</li>
            <li style={liStyle}>Delete all personal data after termination of the service, unless prohibited by law.</li>
          </ul>
        </>
      )},
      { heading: "4. Obligations of the controller", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>The Controller undertakes to:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Ensure that the processing of personal data is lawful under GDPR (legal basis: legitimate interest, contract performance or legal obligation).</li>
            <li style={liStyle}>Provide the Processor with all necessary information to fulfill obligations under this agreement.</li>
            <li style={liStyle}>Maintain a record of processing activities pursuant to Art. 30 GDPR.</li>
          </ul>
        </>
      )},
      { heading: "5. Data security", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          The Processor ensures the protection of personal data through appropriate technical and organizational measures including transport encryption (TLS), storage encryption, access controls and regular backups. In the event of a data breach, the Processor shall inform the Controller without undue delay of the scope of the breach and the measures taken.
        </p>
      )},
      { heading: "6. Subprocessors", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          The Processor may entrust data processing to subprocessors (e.g. cloud hosting, email services, payment gateways). The Processor shall ensure that subprocessors are bound by the same data protection obligations as the Processor. The current list of subprocessors is available on request.
        </p>
      )},
      { heading: "7. Duration and termination", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          This agreement enters into force upon the Controller's registration with the Verifa.sk service and remains valid for the entire duration of the service. Upon termination of the contractual relationship, the Processor shall delete all of the Controller's personal data within 30 days, unless otherwise required by law.
        </p>
      )},
      { heading: "8. Contact", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            For questions regarding the processing of personal data, please contact the Processor:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        </>
      )},
    ],
  },
  de: {
    title: "Datenverarbeitungsvereinbarung (DPA)",
    lastUpdated: "Zuletzt aktualisiert",
    sections: [
      { heading: "1. Vertragsparteien", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Verantwortlicher</strong> (Kunde von Verifa.sk) — eine natürliche oder juristische Person, die den Dienst Verifa.sk zur Überprüfung von Geschäftspartnern und Unternehmen nutzt.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Auftragsverarbeiter</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />Kubelíkova 1258/43<br />130 00 Praha<br />Tschechische Republik<br />ID: 06119859<br />(kein Umsatzsteuerzahler)<br />
            E-Mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Der Verantwortliche und der Auftragsverarbeiter werden hiernach gemeinsam als &ldquo;Parteien&rdquo; und einzeln als &ldquo;Partei&rdquo; bezeichnet.
          </p>
        </>
      )},
      { heading: "2. Gegenstand und Zweck der Verarbeitung", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Der Auftragsverarbeiter verarbeitet personenbezogene Daten im Namen und für Rechnung des Verantwortlichen ausschließlich zum Zweck der Erbringung des Dienstes Verifa.sk — Erstellung von Business Risk Reports aus öffentlich zugänglichen staatlichen Registern der Slowakischen Republik.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Kategorien verarbeiteter Daten:</strong>
          </p>
          <ul style={ulStyle}>
            <li style={liStyle}>Identifikationsdaten von Unternehmen (IČO, Name, Adresse)</li>
            <li style={liStyle}>Namen von Direktoren und gesetzlichen Vertretern (öffentlich verfügbar aus ORSR)</li>
            <li style={liStyle}>Finanzdaten aus Jahresabschlüssen (RÚZ)</li>
            <li style={liStyle}>Daten aus Insolvenz-, Zwangsvollstreckungs- und Steuerregistern</li>
          </ul>
        </>
      )},
      { heading: "3. Pflichten des Auftragsverarbeiters", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Der Auftragsverarbeiter verpflichtet sich:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Personenbezogene Daten ausschließlich zum Zweck der Dienstleistungserbringung und gemäß den Weisungen des Verantwortlichen zu verarbeiten.</li>
            <li style={liStyle}>Sicherzustellen, dass mit der Verarbeitung betraute Personen zur Verschwiegenheit verpflichtet sind.</li>
            <li style={liStyle}>Angemessene technische und organisatorische Maßnahmen zum Schutz der Daten zu implementieren.</li>
            <li style={liStyle}>Datenverarbeitung nicht ohne vorherige Zustimmung des Verantwortlichen an Dritte weiterzugeben.</li>
            <li style={liStyle}>Alle personenbezogenen Daten nach Beendigung der Dienstleistung zu löschen, soweit gesetzlich nicht anders vorgeschrieben.</li>
          </ul>
        </>
      )},
      { heading: "4. Pflichten des Verantwortlichen", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Der Verantwortliche verpflichtet sich:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Sicherzustellen, dass die Verarbeitung personenbezogener Daten gemäß GDPR rechtmäßig ist (Rechtsgrundlage: berechtigtes Interesse, Vertragserfüllung oder gesetzliche Verpflichtung).</li>
            <li style={liStyle}>Dem Auftragsverarbeiter alle notwendigen Informationen zur Erfüllung der Pflichten aus dieser Vereinbarung zur Verfügung zu stellen.</li>
            <li style={liStyle}>Ein Verzeichnis von Verarbeitungstätigkeiten gemäß Art. 30 GDPR zu führen.</li>
          </ul>
        </>
      )},
      { heading: "5. Datensicherheit", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Der Auftragsverarbeiter gewährleistet den Schutz personenbezogener Daten durch angemessene technische und organisatorische Maßnahmen einschließlich Transportverschlüsselung (TLS), Speicherverschlüsselung, Zugriffskontrollen und regelmäßiger Backups. Im Falle einer Datenverletzung informiert der Auftragsverarbeiter den Verantwortlichen unverzüglich über den Umfang der Verletzung und die ergriffenen Maßnahmen.
        </p>
      )},
      { heading: "6. Unterauftragsverarbeiter", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Der Auftragsverarbeiter kann die Datenverarbeitung an Unterauftragsverarbeiter weitergeben (z.B. Cloud-Hosting, E-Mail-Dienste, Zahlungsgateways). Der Auftragsverarbeiter stellt sicher, dass Unterauftragsverarbeiter zu denselben Datenschutzverpflichtungen gebunden sind wie der Auftragsverarbeiter. Die aktuelle Liste der Unterauftragsverarbeiter ist auf Anfrage verfügbar.
        </p>
      )},
      { heading: "7. Dauer und Beendigung", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Diese Vereinbarung tritt mit der Registrierung des Verantwortlichen beim Dienst Verifa.sk in Kraft und gilt für die gesamte Nutzungsdauer des Dienstes. Nach Beendigung der Vertragsbeziehung löscht der Auftragsverarbeiter alle personenbezogenen Daten des Verantwortlichen innerhalb von 30 Tagen, sofern gesetzlich nicht anders vorgeschrieben.
        </p>
      )},
      { heading: "8. Kontakt", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Bei Fragen zur Verarbeitung personenbezogener Daten wenden Sie sich bitte an den Auftragsverarbeiter:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-Mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        </>
      )},
    ],
  },
  cz: {
    title: "Dohoda o zpracování osobních údajů (DPA)",
    lastUpdated: "Poslední aktualizace",
    sections: [
      { heading: "1. Strany dohody", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Provozovatel</strong> (zákazník služby Verifa.sk) — fyzická nebo právnická osoba, která využívá službu Verifa.sk k ověřování obchodních partnerů a firem.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Zpracovatel</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />Kubelíkova 1258/43<br />130 00 Praha<br />Česká republika<br />IČ: 06119859<br />(není plátce DPH)<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Provozovatel a Zpracovatel se dále společně označují jako „Strany&ldquo; a jednotlivě jako „Strana&ldquo;.
          </p>
        </>
      )},
      { heading: "2. Předmět a účel zpracování", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Zpracovatel zpracovává osobní údaje jménem a na účet Provozovatele výhradně za účelem poskytování služby Verifa.sk — generování Business Risk Reportů z veřejně dostupných státních registrů Slovenské republiky.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Kategorie zpracovávaných údajů:</strong>
          </p>
          <ul style={ulStyle}>
            <li style={liStyle}>Identifikační údaje firem (IČO, název, adresa)</li>
            <li style={liStyle}>Jména jednatelů a statutářů (veřejně dostupné z ORSR)</li>
            <li style={liStyle}>Finanční údaje z účetních závěrek (RÚZ)</li>
            <li style={liStyle}>Údaje z insolvenčních, exekučních a daňových registrů</li>
          </ul>
        </>
      )},
      { heading: "3. Povinnosti zpracovatele", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Zpracovatel se zavazuje:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Zpracovávat osobní údaje výhradně za účelem poskytování služby a podle pokynů Provozovatele.</li>
            <li style={liStyle}>Zajistit, aby osoby pověřené zpracováním byly vázány mlčenlivostí.</li>
            <li style={liStyle}>Implementovat přiměřená technická a organizační opatření k ochraně údajů.</li>
            <li style={liStyle}>Nesvěřit zpracování údajů třetím stranám bez předchozího souhlasu Provozovatele.</li>
            <li style={liStyle}>Vymazat všechny osobní údaje po ukončení poskytování služby, pokud to nebrání právním předpisům.</li>
          </ul>
        </>
      )},
      { heading: "4. Povinnosti provozovatele", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Provozovatel se zavazuje:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Zajistit, že zpracování osobních údajů je oprávněné podle GDPR (právní základ: oprávněný zájem, plnění smlouvy nebo právní povinnost).</li>
            <li style={liStyle}>Poskytnout Zpracovateli všechny potřebné informace ke splnění povinností podle této dohody.</li>
            <li style={liStyle}>Vést záznam o zpracovatelských činnostech podle čl. 30 GDPR.</li>
          </ul>
        </>
      )},
      { heading: "5. Bezpečnost údajů", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Zpracovatel zajišťuje ochranu osobních údajů přiměřenými technickými a organizačními opatřeními včetně šifrování přenosu (TLS), šifrování úložiště, přístupových práv a pravidelných záloh. V případě narušení bezpečnosti údajů Zpracovatel bez zbytečného odkladu informuje Provozovatele o rozsahu narušení a přijatých opatřeních.
        </p>
      )},
      { heading: "6. Podzpracovatelé", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Zpracovatel může svěřit zpracování údajů podzpracovatelům (např. cloudový hosting, e-mailové služby, platební brány). Zpracovatel zajistí, aby podzpracovatelé byli vázáni stejnými závazky ochrany údajů jako Zpracovatel. Aktuální seznam podzpracovatelů je k dispozici na vyžádání.
        </p>
      )},
      { heading: "7. Trvání a ukončení", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Tato dohoda nabývá účinnosti momentem registrace Provozovatele ve službě Verifa.sk a platí po celou dobu využívání služby. Po ukončení smluvního vztahu Zpracovatel vymaže všechny osobní údaje Provozovatele do 30 dnů, pokud právní předpisy nestanoví jinak.
        </p>
      )},
      { heading: "8. Kontakt", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pro otázky týkající se zpracování osobních údajů kontaktujte Zpracovatele:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        </>
      )},
    ],
  },
  hu: {
    title: "Adatkezelési megállapodás (DPA)",
    lastUpdated: "Utolsó frissítés",
    sections: [
      { heading: "1. A megállapodás felei", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Adatkezelő</strong> (a Verifa.sk szolgáltatás ügyfele) — természetes vagy jogi személy, aki a Verifa.sk szolgáltatást üzleti partnerek és cégek ellenőrzésére használja.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Adatfeldolgozó</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />Kubelíkova 1258/43<br />130 00 Praha<br />Cseh Köztársaság<br />ID: 06119859<br />(nem áfás)<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Az Adatkezelő és az Adatfeldolgozó a továbbiakban együttesen &ldquo;Felek&rdquo;, egyenként &ldquo;Fél&rdquo;.
          </p>
        </>
      )},
      { heading: "2. A feldolgozás tárgya és célja", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Az Adatfeldolgozó az Adatkezelő nevében és javára személyes adatokat dolgoz fel kizárólag a Verifa.sk szolgáltatás nyújtása céljából — Business Risk Reportok generálása a Szlovák Köztársaság nyilvánosan hozzáférhető állami nyilvántartásaiból.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Feldolgozott adatkategóriák:</strong>
          </p>
          <ul style={ulStyle}>
            <li style={liStyle}>Cégek azonosító adatai (IČO, név, cím)</li>
            <li style={liStyle}>Igazgatók és statutárius képviselők nevei (nyilvánosan elérhető az ORSR-ből)</li>
            <li style={liStyle}>Pénzügyi kimutatások adatai (RÚZ)</li>
            <li style={liStyle}>Csődeljárási, végrehajtási és adó nyilvántartások adatai</li>
          </ul>
        </>
      )},
      { heading: "3. Az adatfeldolgozó kötelezettségei", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Az Adatfeldolgozó vállalja, hogy:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Személyes adatokat kizárólag a szolgáltatás nyújtása céljából és az Adatkezelő utasításai szerint dolgoz fel.</li>
            <li style={liStyle}>Biztosítja, hogy a feldolgozással megbízott személyek titoktartási kötelezettség alatt állnak.</li>
            <li style={liStyle}>Megfelelő technikai és szervezési intézkedéseket hajt végre az adatok védelme érdekében.</li>
            <li style={liStyle}>Az adatfeldolgozást harmadik feleknek az Adatkezelő előzetes hozzájárulása nélkül nem bízza.</li>
            <li style={liStyle}>A szolgáltatás befejezése után minden személyes adatot töröl, kivéve, ha jogszabály másképp rendelkezik.</li>
          </ul>
        </>
      )},
      { heading: "4. Az adatkezelő kötelezettségei", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Az Adatkezelő vállalja, hogy:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Biztosítja, hogy a személyes adatok feldolgozása a GDPR szerint jogszerű (jogalap: jogos érdek, szerződés teljesítése vagy jogi kötelezettség).</li>
            <li style={liStyle}>Az Adatfeldolgozónak minden szükséges információt megad a megállapozás szerinti kötelezettségek teljesítéséhez.</li>
            <li style={liStyle}>A feldolgozási tevékenységekről nyilvántartást vezet a GDPR 30. cikk szerint.</li>
          </ul>
        </>
      )},
      { heading: "5. Adatbiztonság", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Az Adatfeldolgozó megfelelő technikai és szervezési intézkedésekkel biztosítja a személyes adatok védelmét, beleértve az átviteli titkosítást (TLS), a tárolás titkosítását, a hozzáférés-szabályozást és a rendszeres biztonsági mentéseket. Adatbiztonsági incidens esetén az Adatfeldolgozó haladéktalanul tájékoztatja az Adatkezelőt az incidens hatóköréről és a hozott intézkedésekről.
        </p>
      )},
      { heading: "6. Alfeldolgozók", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Az Adatfeldolgozó az adatfeldolgozást alfeldolgozókra bízhatja (pl. felhő hosting, e-mail szolgáltatások, fizetési átjárók). Az Adatfeldolgozó biztosítja, hogy az alfeldolgozók ugyanazon adatvédelmi kötelezettségek alatt álljanak, mint az Adatfeldolgozó. Az alfeldolgozók aktuális listája igény szerint elérhető.
        </p>
      )},
      { heading: "7. Időtartam és megszüntetés", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Ez a megállapodás az Adatkezelő Verifa.sk szolgáltatásban történő regisztrációjának pillanatában lép hatályba és a szolgáltatás teljes használati ideje alatt érvényes. A szerződéses kapcsolat megszűnése után az Adatfeldolgozó 30 napon belül törli az Adatkezelő összes személyes adatát, kivéve, ha jogszabály másképp rendelkezik.
        </p>
      )},
      { heading: "8. Kapcsolat", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A személyes adatok feldolgozásával kapcsolatos kérdések esetén kérjük, lépjen kapcsolatba az Adatfeldolgozóval:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        </>
      )},
    ],
  },
  pl: {
    title: "Umowa o przetwarzaniu danych (DPA)",
    lastUpdated: "Ostatnia aktualizacja",
    sections: [
      { heading: "1. Strony umowy", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong>Administrator</strong> (klient usługi Verifa.sk) — osoba fizyczna lub prawna, która korzysta z usługi Verifa.sk do weryfikacji partnerów biznesowych i firm.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Przetwórca</strong>:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 4 }}>
            Dušan Baran<br />Kubelíkova 1258/43<br />130 00 Praha<br />Czechy<br />ID: 06119859<br />(nie jest płatnikiem VAT)<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            Administrator i Przetwórca są dalej zbiorczo określani jako &ldquo;Strony&rdquo; a indywidualnie jako &ldquo;Strona&rdquo;.
          </p>
        </>
      )},
      { heading: "2. Przedmiot i cel przetwarzania", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Przetwórca przetwarza dane osobowe w imieniu i na rzecz Administratora wyłącznie w celu świadczenia usługi Verifa.sk — generowania Business Risk Report z publicznie dostępnych rejestrów państwowych Republiki Słowackiej.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
            <strong>Kategorie przetwarzanych danych:</strong>
          </p>
          <ul style={ulStyle}>
            <li style={liStyle}>Dane identyfikacyjne firm (IČO, nazwa, adres)</li>
            <li style={liStyle}>Imiona dyrektorów i reprezentantów statutowych (publicznie dostępne z ORSR)</li>
            <li style={liStyle}>Dane finansowe ze sprawozdań finansowych (RÚZ)</li>
            <li style={liStyle}>Dane z rejestrów upadłościowych, egzekucyjnych i podatkowych</li>
          </ul>
        </>
      )},
      { heading: "3. Obowiązki przetwórcy", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Przetwórca zobowiązuje się do:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Przetwarzania danych osobowych wyłącznie w celu świadczenia usługi i zgodnie z instrukcjami Administratora.</li>
            <li style={liStyle}>Zapewnienia, że osoby upoważnione do przetwarzania są zobowiązane do zachowania poufności.</li>
            <li style={liStyle}>Wdrożenia odpowiednich technicznych i organizacyjnych środków ochrony danych.</li>
            <li style={liStyle}>Niepowierzania przetwarzania danych stronom trzecim bez uprzedniej zgody Administratora.</li>
            <li style={liStyle}>Usunięcia wszystkich danych osobowych po zakończeniu świadczenia usługi, chyba że prawo stanowi inaczej.</li>
          </ul>
        </>
      )},
      { heading: "4. Obowiązki administratora", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>Administrator zobowiązuje się do:</p>
          <ul style={ulStyle}>
            <li style={liStyle}>Zapewnienia, że przetwarzanie danych osobowych jest zgodne z GDPR (podstawa prawna: uzasadniony interes, wykonanie umowy lub obowiązek prawny).</li>
            <li style={liStyle}>Udostępnienia Przetwórcy wszystkich niezbędnych informacji do wypełnienia obowiązków wynikających z tej umowy.</li>
            <li style={liStyle}>Prowadzenia rejestru czynności przetwarzania zgodnie z art. 30 GDPR.</li>
          </ul>
        </>
      )},
      { heading: "5. Bezpieczeństwo danych", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Przetwórca zapewnia ochronę danych osobowych poprzez odpowiednie techniczne i organizacyjne środki, w tym szyfrowanie transmisji (TLS), szyfrowanie pamięci, kontrolę dostępu i regularne kopie zapasowe. W przypadku naruszenia bezpieczeństwa danych Przetwórca niezwłocznie informuje Administratora o zakresie naruszenia i podjętych środkach.
        </p>
      )},
      { heading: "6. Podprzetwórcy", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Przetwórca może powierzyć przetwarzanie danych podprzetwórcom (np. hosting chmurowy, usługi e-mail, bramki płatności). Przetwórca zapewni, że podprzetwórcy będą związani tymi samymi zobowiązaniami ochrony danych co Przetwórca. Aktualna lista podprzetwórców jest dostępna na żądanie.
        </p>
      )},
      { heading: "7. Czas trwania i rozwiązanie", body: (
        <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Niniejsza umowa wchodzi w życie z momentem rejestracji Administratora w usłudze Verifa.sk i obowiązuje przez cały okres korzystania z usługi. Po rozwiązaniu stosunku umownego Przetwórca usunie wszystkie dane osobowe Administratora w ciągu 30 dni, chyba że przepisy prawa stanowią inaczej.
        </p>
      )},
      { heading: "8. Kontakt", body: (
        <>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            W sprawach dotyczących przetwarzania danych osobowych prosimy o kontakt z Przetwórcą:
          </p>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
            Dušan Baran<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        </>
      )},
    ],
  },
};

export default async function DpaPage() {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const content = CONTENT[lang];

  return (
    <div className="content-page" style={{ maxWidth: 800, margin: "0 auto", padding: "80px 24px" }}>
      <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 32 }}>
        {content.title}
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {content.sections.map((section, i) => (
          <section key={i}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{section.heading}</h2>
            {section.body}
          </section>
        ))}

        <section>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 32 }}>
            {content.lastUpdated}: {new Date().toLocaleDateString(LOCALE_MAP[lang])}.
          </p>
        </section>
      </div>
    </div>
  );
}

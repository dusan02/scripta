import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";
import { Lang, LOCALE_MAP } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return generatePageMetadata("privacy", lang);
}

const linkStyle = { color: "var(--accent)", textDecoration: "none" } as const;
const liStyle = { fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 } as const;
const ulStyle = { paddingLeft: 24, display: "flex", flexDirection: "column", gap: 6 } as const;

type Section = { heading: string; body: React.ReactNode };

const CONTENT: Record<Lang, { title: string; sections: Section[]; lastUpdated: string }> = {
  sk: {
    title: "Ochrana osobných údajov",
    sections: [
      {
        heading: "1. Úvod",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk (ďalej len „Prevádzkovateľ&ldquo;) spracúva osobné údaje v súlade s Nariadením Európskeho parlamentu a Rady (EÚ) 2016/679 (ďalej len „GDPR&ldquo;) a zákonom č. 18/2018 Z. z. o ochrane osobných údajov. Tieto zásady popisujú, aké údaje spracúvame, na aký účel a aké práva máte ako subjekt údajov.
          </p>
        ),
      },
      {
        heading: "2. Prevádzkovateľ",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Prevádzkovateľom služby Verifa.sk je:<br />
            <strong>Dušan Baran</strong><br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Česká republika<br />
            IČO: 06119859 (nie je platca DPH)<br />
            Kontakt: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        ),
      },
      {
        heading: "3. Aké údaje spracúvame",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Údaje používateľa (zákazníka):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Meno, priezvisko a e-mailová adresa (pri registrácii)</li>
              <li style={liStyle}>Fakturačné údaje (názov firmy, IČO, DIČ, adresa — pri platbách)</li>
              <li style={liStyle}>Technické údaje (IP adresa, typ prehliadača — z technických dôvodov)</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Údaje o preverovaných firmách a osobách:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>IČO a názov preverovanej firmy</li>
              <li style={liStyle}>Meno a priezvisko štatutárov, spoločníkov a skutočných vlastníkov (z verejných registrov)</li>
              <li style={liStyle}>Finančné a právne údaje firmy (z ORSR, RÚZ, insolvenčných registrov a ďalších)</li>
            </ul>
          </>
        ),
      },
      {
        heading: "4. Účel a právny základ spracúvania",
        body: (
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={liStyle}><strong>Poskytovanie služby</strong> — Art. 6 ods. 1 písm. b) GDPR (plnenie zmluvy)</li>
            <li style={liStyle}><strong>Fakturácia a účtovníctvo</strong> — Art. 6 ods. 1 písm. c) GDPR (právna povinnosť)</li>
            <li style={liStyle}><strong>Ochrana oprávnených záujmov</strong> — Art. 6 ods. 1 písm. f) GDPR (prevencia podvodov, bezpečnosť)</li>
            <li style={liStyle}><strong>Súhlas používateľa</strong> — Art. 6 ods. 1 písm. a) GDPR (marketingové komunikácie — len na základe dobrovoľného súhlasu)</li>
          </ul>
        ),
      },
      {
        heading: "5. Zdroje údajov o firmách",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Údaje o preverovaných firmách sú získavané výhradne z verejne dostupných štátnych registrov Slovenskej republiky (ORSR, ŽRSR, Register úpadcov, RPVS, RÚZ, register DPH a ďalšie). Tieto údaje sú verejné a sprístupnené v zmysle príslušných zákonov SR. Verifa.sk nezbiera osobné údaje z neverejných alebo súkromných zdrojov.
          </p>
        ),
      },
      {
        heading: "6. Doba uchovávania údajov",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}><strong>Účtovné doklady:</strong> 10 rokov (podľa zákona o účtovníctve)</li>
            <li style={liStyle}><strong>Vygenerované reporty:</strong> po dobu platnosti používateľského účtu</li>
            <li style={liStyle}><strong>Prístupové logy:</strong> 12 mesiacov (bezpečnostné dôvody)</li>
            <li style={liStyle}><strong>Marketingový súhlas:</strong> do odvolania súhlasu</li>
          </ul>
        ),
      },
      {
        heading: "7. Práva subjektu údajov",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              V zmysle GDPR máte nasledujúce práva:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Právo na prístup</strong> — môžete si vyžiadať informácie o spracúvaných údajoch</li>
              <li style={liStyle}><strong>Právo na opravu</strong> — môžete požadovať opravu nepresných údajov</li>
              <li style={liStyle}><strong>Právo na vymazanie</strong> — môžete požadovať vymazanie údajov („právo byť zabudnutý&ldquo;)</li>
              <li style={liStyle}><strong>Právo na obmedzenie spracúvania</strong> — môžete požadovať obmedzenie</li>
              <li style={liStyle}><strong>Právo na prenosnosť údajov</strong> — môžete získať údaje v strojovo čitateľnom formáte</li>
              <li style={liStyle}><strong>Právo vzniesť námietku</strong> — môžete namietať proti spracúvaniu</li>
              <li style={liStyle}><strong>Právo odvolať súhlas</strong> — kedykoľvek bez vplyvu na zákonnosť predchádzajúceho spracúvania</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Uplatnenie práv môžete požadovať e-mailom na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
            </p>
          </>
        ),
      },
      {
        heading: "8. Technické a organizačné opatrenia",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}>Šifrovanie prenosu (HTTPS/TLS 1.2+)</li>
            <li style={liStyle}>Hashovanie hesiel (bcrypt)</li>
            <li style={liStyle}>Obmedzený prístup k údajom (principle of least privilege)</li>
            <li style={liStyle}>Pravidelné zálohovanie databázy</li>
            <li style={liStyle}>Logovanie prístupov pre audit</li>
          </ul>
        ),
      },
      {
        heading: "9. Prenos údajov do tretích krajín",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Údaje sú uložené na serveroch v Európskej únii. Platobné spracúvanie zabezpečuje Paddle (Merchant of Record), ktoré môže spracúvať údaje mimo EHP v súlade so Standard Contractual Clauses (SCC). Žiadne iné prenosy do tretích krajín neprebiehajú.
          </p>
        ),
      },
      {
        heading: "10. Cookies",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk používa len nevyhnutné technické cookies (relácia, jazyk, preferencia tmavého/svetlého režimu). Nepoužívame marketingové ani sledovacie cookies tretích strán. Na používanie nevyhnutných cookies nie je potrebný súhlas.
          </p>
        ),
      },
      {
        heading: "11. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pri otázkach týkajúcich sa ochrany osobných údajov nás kontaktujte na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Máte tiež právo podať sťažnosť Úradu na ochranu osobných údajov Slovenskej republiky.
          </p>
        ),
      },
    ],
    lastUpdated: "Posledná aktualizácia",
  },
  en: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "1. Introduction",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk (hereinafter the &ldquo;Controller&rdquo;) processes personal data in accordance with Regulation (EU) 2016/679 of the European Parliament and of the Council (hereinafter &ldquo;GDPR&rdquo;) and Act No. 18/2018 Coll. on the protection of personal data. This policy describes what data we process, for what purpose, and what rights you have as a data subject.
          </p>
        ),
      },
      {
        heading: "2. Controller",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            The controller of the Verifa.sk service is:<br />
            <strong>Dušan Baran</strong><br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Czech Republic<br />
            IČO: 06119859 (not a VAT payer)<br />
            Contact: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        ),
      },
      {
        heading: "3. What Data We Process",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>User (customer) data:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>First name, surname, and email address (upon registration)</li>
              <li style={liStyle}>Billing data (company name, IČO, VAT number, address — upon payment)</li>
              <li style={liStyle}>Technical data (IP address, browser type — for technical reasons)</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Data on verified companies and persons:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>IČO and name of the verified company</li>
              <li style={liStyle}>First name and surname of statutory representatives, partners, and beneficial owners (from public registers)</li>
              <li style={liStyle}>Financial and legal data of the company (from ORSR, RÚZ, insolvency registers, and others)</li>
            </ul>
          </>
        ),
      },
      {
        heading: "4. Purpose and Legal Basis of Processing",
        body: (
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={liStyle}><strong>Provision of the service</strong> — Art. 6(1)(b) GDPR (performance of a contract)</li>
            <li style={liStyle}><strong>Billing and accounting</strong> — Art. 6(1)(c) GDPR (legal obligation)</li>
            <li style={liStyle}><strong>Protection of legitimate interests</strong> — Art. 6(1)(f) GDPR (fraud prevention, security)</li>
            <li style={liStyle}><strong>User consent</strong> — Art. 6(1)(a) GDPR (marketing communications — only on the basis of voluntary consent)</li>
          </ul>
        ),
      },
      {
        heading: "5. Sources of Company Data",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Data on verified companies is obtained exclusively from publicly available state registers of the Slovak Republic (ORSR, ŽRSR, Register of Insolvencies, RPVS, RÚZ, VAT register, and others). This data is public and made available in accordance with the relevant laws of the Slovak Republic. Verifa.sk does not collect personal data from non-public or private sources.
          </p>
        ),
      },
      {
        heading: "6. Data Retention Period",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}><strong>Accounting documents:</strong> 10 years (under the Accounting Act)</li>
            <li style={liStyle}><strong>Generated reports:</strong> for the duration of the user account</li>
            <li style={liStyle}><strong>Access logs:</strong> 12 months (security reasons)</li>
            <li style={liStyle}><strong>Marketing consent:</strong> until withdrawal of consent</li>
          </ul>
        ),
      },
      {
        heading: "7. Data Subject Rights",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Under the GDPR, you have the following rights:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Right of access</strong> — you may request information about the processed data</li>
              <li style={liStyle}><strong>Right to rectification</strong> — you may request the correction of inaccurate data</li>
              <li style={liStyle}><strong>Right to erasure</strong> — you may request the deletion of data (&ldquo;right to be forgotten&rdquo;)</li>
              <li style={liStyle}><strong>Right to restriction of processing</strong> — you may request a restriction</li>
              <li style={liStyle}><strong>Right to data portability</strong> — you may obtain data in a machine-readable format</li>
              <li style={liStyle}><strong>Right to object</strong> — you may object to processing</li>
              <li style={liStyle}><strong>Right to withdraw consent</strong> — at any time without affecting the lawfulness of prior processing</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              You may exercise your rights by email at <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
            </p>
          </>
        ),
      },
      {
        heading: "8. Technical and Organisational Measures",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}>Transmission encryption (HTTPS/TLS 1.2+)</li>
            <li style={liStyle}>Password hashing (bcrypt)</li>
            <li style={liStyle}>Restricted data access (principle of least privilege)</li>
            <li style={liStyle}>Regular database backups</li>
            <li style={liStyle}>Access logging for audit purposes</li>
          </ul>
        ),
      },
      {
        heading: "9. Data Transfers to Third Countries",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Data is stored on servers within the European Union. Payment processing is handled by Paddle (Merchant of Record), which may process data outside the EEA in accordance with Standard Contractual Clauses (SCC). No other transfers to third countries take place.
          </p>
        ),
      },
      {
        heading: "10. Cookies",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk uses only necessary technical cookies (session, language, dark/light mode preference). We do not use third-party marketing or tracking cookies. Consent is not required for the use of necessary cookies.
          </p>
        ),
      },
      {
        heading: "11. Contact",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            For questions regarding the protection of personal data, please contact us at <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. You also have the right to lodge a complaint with the Office for Personal Data Protection of the Slovak Republic.
          </p>
        ),
      },
    ],
    lastUpdated: "Last updated",
  },
  de: {
    title: "Datenschutzerklärung",
    sections: [
      {
        heading: "1. Einleitung",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk (nachfolgend der &ldquo;Verantwortliche&rdquo;) verarbeitet personenbezogene Daten gemäß der Verordnung (EU) 2016/679 des Europäischen Parlaments und des Rates (nachfolgend &ldquo;GDPR&rdquo;) und dem Gesetz Nr. 18/2018 über den Schutz personenbezogener Daten. Diese Richtlinie beschreibt, welche Daten wir verarbeiten, zu welchem Zweck und welche Rechte Sie als betroffene Person haben.
          </p>
        ),
      },
      {
        heading: "2. Verantwortlicher",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verantwortlicher des Dienstes Verifa.sk ist:<br />
            <strong>Dušan Baran</strong><br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Tschechische Republik<br />
            IČO: 06119859 (kein Umsatzsteuerzahler)<br />
            Kontakt: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        ),
      },
      {
        heading: "3. Welche Daten wir verarbeiten",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Nutzer- (Kunden-)daten:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Vorname, Nachname und E-Mail-Adresse (bei Registrierung)</li>
              <li style={liStyle}>Rechnungsdaten (Firmenname, IČO, USt-IdNr., Adresse — bei Zahlungen)</li>
              <li style={liStyle}>Technische Daten (IP-Adresse, Browsertyp — aus technischen Gründen)</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Daten zu überprüften Unternehmen und Personen:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>IČO und Name des überprüften Unternehmens</li>
              <li style={liStyle}>Vor- und Nachname der gesetzlichen Vertreter, Gesellschafter und wirtschaftlich Berechtigten (aus öffentlichen Registern)</li>
              <li style={liStyle}>Finanzielle und rechtliche Daten des Unternehmens (aus ORSR, RÚZ, Insolvenzregistern und anderen)</li>
            </ul>
          </>
        ),
      },
      {
        heading: "4. Zweck und Rechtsgrundlage der Verarbeitung",
        body: (
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={liStyle}><strong>Erbringung der Dienstleistung</strong> — Art. 6 Abs. 1 lit. b) GDPR (Vertragserfüllung)</li>
            <li style={liStyle}><strong>Rechnungsstellung und Buchhaltung</strong> — Art. 6 Abs. 1 lit. c) GDPR (rechtliche Verpflichtung)</li>
            <li style={liStyle}><strong>Schutz berechtigter Interessen</strong> — Art. 6 Abs. 1 lit. f) GDPR (Betrugsprävention, Sicherheit)</li>
            <li style={liStyle}><strong>Einwilligung des Nutzers</strong> — Art. 6 Abs. 1 lit. a) GDPR (Marketingkommunikation — nur auf Basis freiwilliger Einwilligung)</li>
          </ul>
        ),
      },
      {
        heading: "5. Quellen der Unternehmensdaten",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Daten zu überprüften Unternehmen werden ausschließlich aus öffentlich zugänglichen staatlichen Registern der Slowakischen Republik (ORSR, ŽRSR, Insolvenzregister, RPVS, RÚZ, Umsatzsteuerregister und andere) bezogen. Diese Daten sind öffentlich und werden gemäß den entsprechenden Gesetzen der Slowakischen Republik zugänglich gemacht. Verifa.sk sammelt keine personenbezogenen Daten aus nicht-öffentlichen oder privaten Quellen.
          </p>
        ),
      },
      {
        heading: "6. Aufbewahrungsfrist für Daten",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}><strong>Buchhaltungsbelege:</strong> 10 Jahre (gemäß Buchhaltungsgesetz)</li>
            <li style={liStyle}><strong>Generierte Berichte:</strong> für die Dauer des Benutzerkontos</li>
            <li style={liStyle}><strong>Zugriffsprotokolle:</strong> 12 Monate (Sicherheitsgründe)</li>
            <li style={liStyle}><strong>Marketing-Einwilligung:</strong> bis zum Widerruf der Einwilligung</li>
          </ul>
        ),
      },
      {
        heading: "7. Rechte der betroffenen Person",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Gemäß GDPR haben Sie folgende Rechte:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Auskunftsrecht</strong> — Sie können Auskunft über die verarbeiteten Daten verlangen</li>
              <li style={liStyle}><strong>Recht auf Berichtigung</strong> — Sie können die Korrektur unrichtiger Daten verlangen</li>
              <li style={liStyle}><strong>Recht auf Löschung</strong> — Sie können die Löschung von Daten verlangen (&ldquo;Recht auf Vergessenwerden&rdquo;)</li>
              <li style={liStyle}><strong>Recht auf Einschränkung der Verarbeitung</strong> — Sie können eine Einschränkung verlangen</li>
              <li style={liStyle}><strong>Recht auf Datenübertragbarkeit</strong> — Sie können Daten in einem maschinenlesbaren Format erhalten</li>
              <li style={liStyle}><strong>Widerspruchsrecht</strong> — Sie können der Verarbeitung widersprechen</li>
              <li style={liStyle}><strong>Recht auf Widerruf der Einwilligung</strong> — jederzeit ohne Auswirkung auf die Rechtmäßigkeit der bisherigen Verarbeitung</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Sie können Ihre Rechte per E-Mail an <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> geltend machen.
            </p>
          </>
        ),
      },
      {
        heading: "8. Technische und organisatorische Maßnahmen",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}>Übertragungsverschlüsselung (HTTPS/TLS 1.2+)</li>
            <li style={liStyle}>Passwort-Hashing (bcrypt)</li>
            <li style={liStyle}>Eingeschränkter Datenzugriff (Prinzip der minimalen Rechte)</li>
            <li style={liStyle}>Regelmäßige Datenbanksicherungen</li>
            <li style={liStyle}>Zugriffsprotokollierung für Audits</li>
          </ul>
        ),
      },
      {
        heading: "9. Datenübertragung in Drittländer",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Daten werden auf Servern innerhalb der Europäischen Union gespeichert. Die Zahlungsabwicklung erfolgt über Paddle (Merchant of Record), der Daten außerhalb des EWR gemäß den Standard Contractual Clauses (SCC) verarbeiten kann. Es finden keine weiteren Übertragungen in Drittländer statt.
          </p>
        ),
      },
      {
        heading: "10. Cookies",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk verwendet nur notwendige technische Cookies (Sitzung, Sprache, Einstellung Dunkel-/Hell-Modus). Wir verwenden keine Marketing- oder Tracking-Cookies von Drittanbietern. Für die Verwendung notwendiger Cookies ist keine Einwilligung erforderlich.
          </p>
        ),
      },
      {
        heading: "11. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Bei Fragen zum Schutz personenbezogener Daten kontaktieren Sie uns unter <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Sie haben auch das Recht, eine Beschwerde beim Amt für den Schutz personenbezogener Daten der Slowakischen Republik einzureichen.
          </p>
        ),
      },
    ],
    lastUpdated: "Letzte Aktualisierung",
  },
  cz: {
    title: "Ochrana osobních údajů",
    sections: [
      {
        heading: "1. Úvod",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk (dále jen „Správce&ldquo;) zpracovává osobní údaje v souladu s nařízením Evropského parlamentu a Rady (EU) 2016/679 (dále jen „GDPR&ldquo;) a zákonem č. 18/2018 Z. z. o ochraně osobních údajů. Tyto zásady popisují, jaké údaje zpracováváme, za jakým účelem a jaká práva máte jako subjekt údajů.
          </p>
        ),
      },
      {
        heading: "2. Správce",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Správcem služby Verifa.sk je:<br />
            <strong>Dušan Baran</strong><br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Česká republika<br />
            IČO: 06119859 (není plátce DPH)<br />
            Kontakt: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        ),
      },
      {
        heading: "3. Jaké údaje zpracováváme",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Údaje uživatele (zákazníka):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Jméno, příjmení a e-mailová adresa (při registraci)</li>
              <li style={liStyle}>Fakturační údaje (název firmy, IČO, DIČ, adresa — při platbách)</li>
              <li style={liStyle}>Technické údaje (IP adresa, typ prohlížeče — z technických důvodů)</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Údaje o ověřovaných firmách a osobách:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>IČO a název ověřované firmy</li>
              <li style={liStyle}>Jméno a příjmení statutářů, společníků a skutečných majitelů (z veřejných registrů)</li>
              <li style={liStyle}>Finanční a právní údaje firmy (z ORSR, RÚZ, insolvenčních registrů a dalších)</li>
            </ul>
          </>
        ),
      },
      {
        heading: "4. Účel a právní základ zpracování",
        body: (
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={liStyle}><strong>Poskytování služby</strong> — Art. 6 odst. 1 písm. b) GDPR (plnění smlouvy)</li>
            <li style={liStyle}><strong>Fakturace a účetnictví</strong> — Art. 6 odst. 1 písm. c) GDPR (právní povinnost)</li>
            <li style={liStyle}><strong>Ochrana oprávněných zájmů</strong> — Art. 6 odst. 1 písm. f) GDPR (prevence podvodů, bezpečnost)</li>
            <li style={liStyle}><strong>Souhlas uživatele</strong> — Art. 6 odst. 1 písm. a) GDPR (marketingové komunikace — pouze na základě dobrovolného souhlasu)</li>
          </ul>
        ),
      },
      {
        heading: "5. Zdroje údajů o firmách",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Údaje o ověřovaných firmách jsou získávány výhradně z veřejně dostupných státních registrů Slovenské republiky (ORSR, ŽRSR, Registr úpadců, RPVS, RÚZ, registr DPH a další). Tyto údaje jsou veřejné a zpřístupněné v souladu s příslušnými zákony SR. Verifa.sk neshromažďuje osobní údaje z neveřejných nebo soukromých zdrojů.
          </p>
        ),
      },
      {
        heading: "6. Doba uchovávání údajů",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}><strong>Účetní doklady:</strong> 10 let (podle zákona o účetnictví)</li>
            <li style={liStyle}><strong>Vygenerované reporty:</strong> po dobu platnosti uživatelského účtu</li>
            <li style={liStyle}><strong>Přístupové logy:</strong> 12 měsíců (bezpečnostní důvody)</li>
            <li style={liStyle}><strong>Marketingový souhlas:</strong> do odvolání souhlasu</li>
          </ul>
        ),
      },
      {
        heading: "7. Práva subjektu údajů",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              V souladu s GDPR máte následující práva:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Právo na přístup</strong> — můžete si vyžádat informace o zpracovávaných údajích</li>
              <li style={liStyle}><strong>Právo na opravu</strong> — můžete požadovat opravu nepřesných údajů</li>
              <li style={liStyle}><strong>Právo na vymazání</strong> — můžete požadovat vymazání údajů („právo být zapomenut&ldquo;)</li>
              <li style={liStyle}><strong>Právo na omezení zpracování</strong> — můžete požadovat omezení</li>
              <li style={liStyle}><strong>Právo na přenositelnost údajů</strong> — můžete získat údaje ve strojově čitelném formátu</li>
              <li style={liStyle}><strong>Právo vznést námitku</strong> — můžete namítat proti zpracování</li>
              <li style={liStyle}><strong>Právo odvolat souhlas</strong> — kdykoli bez vlivu na zákonnost předchozího zpracování</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Uplatnění práv můžete požadovat e-mailem na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
            </p>
          </>
        ),
      },
      {
        heading: "8. Technická a organizační opatření",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}>Šifrování přenosu (HTTPS/TLS 1.2+)</li>
            <li style={liStyle}>Hashování hesel (bcrypt)</li>
            <li style={liStyle}>Omezený přístup k údajům (principle of least privilege)</li>
            <li style={liStyle}>Pravidelné zálohování databáze</li>
            <li style={liStyle}>Logování přístupů pro audit</li>
          </ul>
        ),
      },
      {
        heading: "9. Přenášení údajů do třetích zemí",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Údaje jsou uloženy na serverech v Evropské unii. Platební zpracování zabezpečuje Paddle (Merchant of Record), který může zpracovávat údaje mimo EHP v souladu se Standard Contractual Clauses (SCC). Žádné další přenosy do třetích zemí neprobíhají.
          </p>
        ),
      },
      {
        heading: "10. Cookies",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk používá pouze nezbytné technické cookies (relace, jazyk, preference tmavého/světlého režimu). Nepoužíváme marketingové ani sledovací cookies třetích stran. Pro používání nezbytných cookies není nutný souhlas.
          </p>
        ),
      },
      {
        heading: "11. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Při otázkách týkajících se ochrany osobních údajů nás kontaktujte na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Máte také právo podat stížnost Úřadu na ochranu osobních údajů Slovenské republiky.
          </p>
        ),
      },
    ],
    lastUpdated: "Poslední aktualizace",
  },
  hu: {
    title: "Adatvédelmi szabályzat",
    sections: [
      {
        heading: "1. Bevezetés",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa.sk (a továbbiakban &ldquo;Adatkezelő&rdquo;) személyes adatokat dolgoz fel az Európai Parlament és a Tanács (EU) 2016/679 rendelete (a továbbiakban &ldquo;GDPR&rdquo;) és a 18/2018. törvény a személyes adatok védelméről szóló rendelkezéseinek megfelelően. Ez a szabályzat leírja, hogy milyen adatokat kezelünk, milyen célból, és milyen jogai vannak Önnek mint érintettnek.
          </p>
        ),
      },
      {
        heading: "2. Adatkezelő",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa.sk szolgáltatás adatkezelője:<br />
            <strong>Dušan Baran</strong><br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Cseh Köztársaság<br />
            IČO: 06119859 (nem áfafizető)<br />
            Kapcsolat: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        ),
      },
      {
        heading: "3. Milyen adatokat kezelünk",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Felhasználói (ügyfél) adatok:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Keresztnév, vezetéknév és e-mail cím (regisztrációkor)</li>
              <li style={liStyle}>Számlázási adatok (cégnév, IČO, adószám, cím — fizetéskor)</li>
              <li style={liStyle}>Technikai adatok (IP-cím, böngésző típusa — technikai okokból)</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Az ellenőrzött cégekre és személyekre vonatkozó adatok:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Az ellenőrzött cég IČO-ja és neve</li>
              <li style={liStyle}>A statutárius képviselők, tagok és tényleges tulajdonosok kereszt- és vezetékneve (nyilvános nyilvántartásokból)</li>
              <li style={liStyle}>A cég pénzügyi és jogi adatai (ORSR, RÚZ, csődnyilvántartások és más forrásokból)</li>
            </ul>
          </>
        ),
      },
      {
        heading: "4. Az adatkezelés célja és jogalapja",
        body: (
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={liStyle}><strong>Szolgáltatás nyújtása</strong> — GDPR 6. cikk (1) bekezdés b) pontja (szerződés teljesítése)</li>
            <li style={liStyle}><strong>Számlázás és könyvelés</strong> — GDPR 6. cikk (1) bekezdés c) pontja (jogi kötelezettség)</li>
            <li style={liStyle}><strong>Jogos érdekek védelme</strong> — GDPR 6. cikk (1) bekezdés f) pontja (csalás megelőzése, biztonság)</li>
            <li style={liStyle}><strong>Felhasználó hozzájárulása</strong> — GDPR 6. cikk (1) bekezdés a) pontja (marketing kommunikáció — csak önkéntes hozzájárulás alapján)</li>
          </ul>
        ),
      },
      {
        heading: "5. A cégre vonatkozó adatok forrásai",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Az ellenőrzött cégekre vonatkozó adatok kizárólag a Szlovák Köztársaság nyilvánosan hozzáférhető állami nyilvántartásaiból (ORSR, ŽRSR, Csődnyilvántartás, RPVS, RÚZ, áfaregiszter és mások) származnak. Ezek az adatok nyilvánosak és a Szlovák Köztársaság vonatkozó törvényei értelmében hozzáférhetők. A Verifa.sk nem gyűjt személyes adatokat nem nyilvános vagy magánforrásokból.
          </p>
        ),
      },
      {
        heading: "6. Az adatok megőrzési ideje",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}><strong>Könyvelési bizonylatok:</strong> 10 év (a számviteli törvény szerint)</li>
            <li style={liStyle}><strong>Generált jelentések:</strong> a felhasználói fiók érvényességének idejére</li>
            <li style={liStyle}><strong>Hozzáférési naplók:</strong> 12 hónap (biztonsági okokból)</li>
            <li style={liStyle}><strong>Marketing hozzájárulás:</strong> a hozzájárulás visszavonásáig</li>
          </ul>
        ),
      },
      {
        heading: "7. Az érintett jogai",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              A GDPR értelmében az alábbi jogokkal rendelkezik:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Hozzáférési jog</strong> — tájékoztatást kérhet a kezelt adatokról</li>
              <li style={liStyle}><strong>Helyesbítéshez való jog</strong> — kérheti a pontatlan adatok helyesbítését</li>
              <li style={liStyle}><strong>Törléshez való jog</strong> — kérheti az adatok törlését (&ldquo;elfeledtetéshez való jog&rdquo;)</li>
              <li style={liStyle}><strong>Az adatkezelés korlátozásához való jog</strong> — korlátozást kérhet</li>
              <li style={liStyle}><strong>Adathordozhatósághoz való jog</strong> — géppel olvasható formátumban kaphatja meg az adatokat</li>
              <li style={liStyle}><strong>Kifogásalkotási jog</strong> — kifogást emelhet az adatkezelés ellen</li>
              <li style={liStyle}><strong>Hozzájárulás visszavonásának joga</strong> — bármikor, a korábbi adatkezelés jogszerűségét nem érintően</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Jogai érvényesítését e-mailben kérhetje a <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> címen.
            </p>
          </>
        ),
      },
      {
        heading: "8. Technikai és szervezési intézkedések",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}>Átviteli titkosítás (HTTPS/TLS 1.2+)</li>
            <li style={liStyle}>Jelszó-hashelés (bcrypt)</li>
            <li style={liStyle}>Korlátozott adathozzáférés (legalacsonyabb jogosultság elve)</li>
            <li style={liStyle}>Rendszeres adatbázis-mentés</li>
            <li style={liStyle}>Hozzáférési naplózás audit céljából</li>
          </ul>
        ),
      },
      {
        heading: "9. Adattovábbítás harmadik országokba",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Az adatok az Európai Unión belüli szervereken tárolódnak. A fizetésfeldolgozást a Paddle (Merchant of Record) kezeli, amely az EGT-n kívül is dolgozhat fel adatokat a Standard Contractual Clauses (SCC) keretében. Más harmadik országokba történő adattovábbítás nem történik.
          </p>
        ),
      },
      {
        heading: "10. Sütik",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa.sk csak szükséges technikai sütiket használ (munkamenet, nyelv, sötét/világos mód beállítása). Nem használunk harmadik féltől származó marketing vagy követő sütiket. A szükséges sütik használatához nem kell hozzájárulás.
          </p>
        ),
      },
      {
        heading: "11. Kapcsolat",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Személyes adatok védelmével kapcsolatos kérdésekben lépjen velünk kapcsolatba a <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> címen. Jogában áll panaszt tenni a Szlovák Köztársaság Személyes Adatok Védelméért Felelős Hivatalánál is.
          </p>
        ),
      },
    ],
    lastUpdated: "Utolsó frissítés",
  },
  pl: {
    title: "Polityka prywatności",
    sections: [
      {
        heading: "1. Wprowadzenie",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk (dalej &ldquo;Administrator&rdquo;) przetwarza dane osobowe zgodnie z Rozporządzeniem Parlamentu Europejskiego i Rady (UE) 2016/679 (dalej &ldquo;GDPR&rdquo;) oraz ustawą nr 18/2018 o ochronie danych osobowych. Niniejsza polityka opisuje, jakie dane przetwarzamy, w jakim celu i jakie prawa przysługują Państwu jako podmiotom danych.
          </p>
        ),
      },
      {
        heading: "2. Administrator",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Administratorem usługi Verifa.sk jest:<br />
            <strong>Dušan Baran</strong><br />
            Kubelíkova 1258/43<br />
            130 00 Praha<br />
            Republika Czeska<br />
            IČO: 06119859 (nie jest płatnikiem VAT)<br />
            Kontakt: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>
          </p>
        ),
      },
      {
        heading: "3. Jakie dane przetwarzamy",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Dane użytkownika (klienta):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Imię, nazwisko i adres e-mail (przy rejestracji)</li>
              <li style={liStyle}>Dane rozliczeniowe (nazwa firmy, IČO, NIP, adres — przy płatnościach)</li>
              <li style={liStyle}>Dane techniczne (adres IP, typ przeglądarki — z powodów technicznych)</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Dane o weryfikowanych firmach i osobach:</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>IČO i nazwa weryfikowanej firmy</li>
              <li style={liStyle}>Imię i nazwisko przedstawicieli statutowych, wspólników i rzeczywistych beneficjentów (z rejestrów publicznych)</li>
              <li style={liStyle}>Dane finansowe i prawne firmy (z ORSR, RÚZ, rejestrów upadłościowych i innych)</li>
            </ul>
          </>
        ),
      },
      {
        heading: "4. Cel i podstawa prawna przetwarzania",
        body: (
          <ul style={{ paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <li style={liStyle}><strong>Świadczenie usługi</strong> — Art. 6 ust. 1 lit. b) GDPR (wykonanie umowy)</li>
            <li style={liStyle}><strong>Fakturowanie i księgowość</strong> — Art. 6 ust. 1 lit. c) GDPR (obowiązek prawny)</li>
            <li style={liStyle}><strong>Ochrona uzasadnionych interesów</strong> — Art. 6 ust. 1 lit. f) GDPR (zapobieganie oszustwom, bezpieczeństwo)</li>
            <li style={liStyle}><strong>Zgoda użytkownika</strong> — Art. 6 ust. 1 lit. a) GDPR (komunikacja marketingowa — wyłącznie na podstawie dobrowolnej zgody)</li>
          </ul>
        ),
      },
      {
        heading: "5. Źródła danych o firmach",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Dane o weryfikowanych firmach są pozyskiwane wyłącznie z publicznie dostępnych rejestrów państwowych Republiki Słowackiej (ORSR, ŽRSR, Rejestr Upadłości, RPVS, RÚZ, rejestr VAT i inne). Dane te są publiczne i udostępniane zgodnie z odpowiednimi ustawami Republiki Słowackiej. Verifa.sk nie zbiera danych osobowych ze źródeł niepublicznych lub prywatnych.
          </p>
        ),
      },
      {
        heading: "6. Okres przechowywania danych",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}><strong>Dokumenty księgowe:</strong> 10 lat (zgodnie z ustawą o rachunkowości)</li>
            <li style={liStyle}><strong>Wygenerowane raporty:</strong> przez okres ważności konta użytkownika</li>
            <li style={liStyle}><strong>Logi dostępu:</strong> 12 miesięcy (powody bezpieczeństwa)</li>
            <li style={liStyle}><strong>Zgoda marketingowa:</strong> do wycofania zgody</li>
          </ul>
        ),
      },
      {
        heading: "7. Prawa podmiotu danych",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Zgodnie z GDPR przysługują Państwu następujące prawa:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Prawo dostępu</strong> — mogą Państwo zażądać informacji o przetwarzanych danych</li>
              <li style={liStyle}><strong>Prawo do sprostowania</strong> — mogą Państwo zażądać poprawienia niedokładnych danych</li>
              <li style={liStyle}><strong>Prawo do usunięcia</strong> — mogą Państwo zażądać usunięcia danych (&ldquo;prawo do bycia zapomnianym&rdquo;)</li>
              <li style={liStyle}><strong>Prawo do ograniczenia przetwarzania</strong> — mogą Państwo zażądać ograniczenia</li>
              <li style={liStyle}><strong>Prawo do przenoszenia danych</strong> — mogą Państwo uzyskać dane w formacie czytelnym maszynowo</li>
              <li style={liStyle}><strong>Prawo do sprzeciwu</strong> — mogą Państwo wnieść sprzeciw wobec przetwarzania</li>
              <li style={liStyle}><strong>Prawo do wycofania zgody</strong> — w dowolnym czasie bez wpływu na zgodność z prawem poprzedniego przetwarzania</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Swoje prawa mogą Państwo wykonać wysyłając e-mail na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
            </p>
          </>
        ),
      },
      {
        heading: "8. Środki techniczne i organizacyjne",
        body: (
          <ul style={ulStyle}>
            <li style={liStyle}>Szyfrowanie transmisji (HTTPS/TLS 1.2+)</li>
            <li style={liStyle}>Hashowanie haseł (bcrypt)</li>
            <li style={liStyle}>Ograniczony dostęp do danych (zasada najmniejszych uprawnień)</li>
            <li style={liStyle}>Regularne kopie zapasowe bazy danych</li>
            <li style={liStyle}>Rejestrowanie dostępu do celów audytu</li>
          </ul>
        ),
      },
      {
        heading: "9. Przekazywanie danych do państw trzecich",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Dane są przechowywane na serwerach w Unii Europejskiej. Przetwarzanie płatności obsługuje Paddle (Merchant of Record), który może przetwarzać dane poza EOG zgodnie ze Standard Contractual Clauses (SCC). Nie odbywają się żadne inne transfery do państw trzecich.
          </p>
        ),
      },
      {
        heading: "10. Cookies",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk używa tylko niezbędnych plików cookie technicznych (sesja, język, preferencja trybu ciemnego/jasnego). Nie używamy plików cookie marketingowych ani śledzących stron trzecich. Zgoda nie jest wymagana do stosowania niezbędnych plików cookie.
          </p>
        ),
      },
      {
        heading: "11. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            W sprawach dotyczących ochrony danych osobowych prosimy o kontakt pod adresem <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Mają Państwo również prawo do złożenia skargi do Urzędu Ochrony Danych Osobowych Republiki Słowackiej.
          </p>
        ),
      },
    ],
    lastUpdated: "Ostatnia aktualizacja",
  },
};

export default async function PrivacyPage() {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const content = CONTENT[lang];

  return (
    <div className="content-page" style={{ maxWidth: 800, margin: "0 auto", padding: "120px 24px 80px" }}>
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

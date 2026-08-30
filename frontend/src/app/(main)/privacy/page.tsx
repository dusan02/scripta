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
            <li style={liStyle}><strong>Údaje používateľského účtu (meno, email, hash hesla):</strong> po dobu existencie účtu + 30 dní po jeho vymazaní</li>
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
              Uplatnenie práv môžete požadovať e-mailom na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Na žiadosť odpovieme bez zbytočného odkladu, najneskôr do 30 dní od jej doručenia. V odôvodnených prípadoch môže byť lehota predĺžená o ďalších 60 dní.
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
        heading: "9. Príjemcovia osobných údajov",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Zoznam sprostredkovateľov:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Paddle.com Market Ltd.</strong> — platobné spracúvanie a fakturácia (UK/USA). Právny základ prenosu: Standard Contractual Clauses (SCC) + UK Addendum.</li>
              <li style={liStyle}><strong>Google Ireland Limited (Google Analytics 4)</strong> — webová analytika, anonymizované údaje o návštevnosti (USA). Právny základ prenosu: EU-US Data Privacy Framework. Analytické cookies (_ga, _ga_*) sa nastavujú len po udelení výslovného súhlasu.</li>
              <li style={liStyle}><strong>Resend, Inc.</strong> — odosielanie transakčných e-mailov (overenie registrácie, reset hesla, notifikácie). USA. Právny základ prenosu: EU-US Data Privacy Framework.</li>
              <li style={liStyle}><strong>Functional Software, Inc. (Sentry)</strong> — monitoring a logovanie chýb aplikácie (IP adresa, verzia prehliadača, záznamy o chybách). USA. Právny základ: Art. 6 ods. 1 písm. f) GDPR (oprávnený záujem). Právny základ prenosu: EU-US Data Privacy Framework.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              So všetkými sprostredkovateľmi máme uzavreté zmluvy o spracúvaní osobných údajov (DPA) v zmysle Art. 28 GDPR.
            </p>
          </>
        ),
      },
      {
        heading: "10. Prenos údajov do tretích krajín",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Údaje sú uložené na serveroch v Európskej únii (Slovensko). Niektorí naši sprostredkovatelia môžu spracúvať údaje mimo EHP (USA, UK). Prenos údajov je zabezpečený prostredníctvom:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>EU-US Data Privacy Framework (rozhodnutie Európskej komisie C(2023) 4745 z 10. júla 2023) — Google, Resend, Sentry</li>
              <li style={liStyle}>Standard Contractual Clauses (SCC) + UK Addendum — Paddle</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Podrobný zoznam príjemcov je uvedený v sekcii 9.
            </p>
          </>
        ),
      },
      {
        heading: "11. Cookies",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Verifa.sk používa nasledujúce typy cookies:
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Nevyhnutné cookies (bez súhlasu):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Session cookie (next-auth.session-token) — prihlásenie, platnosť do zatvorenia prehliadača</li>
              <li style={liStyle}>Jazykové nastavenie — platnosť 1 rok</li>
              <li style={liStyle}>Preferencia tmavého/svetlého režimu — platnosť 1 rok</li>
              <li style={liStyle}>Záznam cookie súhlasu (localStorage) — trvalý</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Analytické cookies (len so súhlasom):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Google Analytics (_ga, _ga_*) — anonymizované štatistiky návštevnosti, platnosť 2 roky. Nastavujú sa len po udelení výslovného súhlasu prostredníctvom cookie banneru.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Analytické cookies môžete kedykoľvek odmietnuť prostredníctvom cookie banneru alebo vymazaním cookies vo vašom prehliadači.
            </p>
          </>
        ),
      },
      {
        heading: "12. Kontakt",
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
            <li style={liStyle}><strong>User account data:</strong> for the duration of the account + 30 days after deletion</li>
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
              You may exercise your rights by email at <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. We will respond to your request without undue delay, no later than 30 days after receipt. In justified cases, the period may be extended by another 60 days.
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
        heading: "9. Recipients of Personal Data",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              A list of subprocessors:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Paddle.com Market Ltd.</strong> — payment processing and invoicing (UK/USA). Legal basis for transfer: Standard Contractual Clauses (SCC) + UK Addendum.</li>
              <li style={liStyle}><strong>Google Ireland Limited (Google Analytics 4)</strong> — web analytics, anonymized traffic data (USA). Legal basis for transfer: EU-US Data Privacy Framework. Analytics cookies (_ga, _ga_*) are set only after explicit consent.</li>
              <li style={liStyle}><strong>Resend, Inc.</strong> — sending transactional emails (registration verification, password reset, notifications). USA. Legal basis for transfer: EU-US Data Privacy Framework.</li>
              <li style={liStyle}><strong>Functional Software, Inc. (Sentry)</strong> — application error monitoring and logging (IP address, browser version, error logs). USA. Legal basis: Art. 6(1)(f) GDPR (legitimate interest). Legal basis for transfer: EU-US Data Privacy Framework.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              We have concluded data processing agreements (DPA) under Art. 28 GDPR with all subprocessors.
            </p>
          </>
        ),
      },
      {
        heading: "10. Data Transfers to Third Countries",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Data is stored on servers in the European Union (Slovakia). Some of our subprocessors may process data outside the EEA (USA, UK). Data transfer is secured through:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>EU-US Data Privacy Framework (European Commission Decision C(2023) 4745 of 10 July 2023) — Google, Resend, Sentry</li>
              <li style={liStyle}>Standard Contractual Clauses (SCC) + UK Addendum — Paddle</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              A detailed list of recipients is provided in section 9.
            </p>
          </>
        ),
      },
      {
        heading: "11. Cookies",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Verifa.sk uses the following types of cookies:
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Necessary cookies (without consent):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Session cookie (next-auth.session-token) — login, valid until browser is closed</li>
              <li style={liStyle}>Language preference — valid for 1 year</li>
              <li style={liStyle}>Dark/light mode preference — valid for 1 year</li>
              <li style={liStyle}>Consent cookie record (localStorage) — permanent</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Analytics cookies (only with consent):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Google Analytics (_ga, _ga_*) — anonymized traffic statistics, valid for 2 years. Set only after explicit consent via the cookie banner.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              You can reject analytics cookies at any time via the cookie banner or by deleting cookies in your browser.
            </p>
          </>
        ),
      },
      {
        heading: "12. Contact",
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
            <li style={liStyle}><strong>Benutzerkontodaten:</strong> für die Dauer des Kontos + 30 Tage nach Löschung</li>
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
              Sie können Ihre Rechte per E-Mail an <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> geltend machen. Wir werden Ihre Anfrage ohne unangemessene Verzögerung, spätestens jedoch innerhalb von 30 Tagen nach Erhalt, beantworten. In begründeten Fällen kann die Frist um weitere 60 Tage verlängert werden.
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
        heading: "9. Empfänger personenbezogener Daten",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Eine Liste der Auftragsverarbeiter:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Paddle.com Market Ltd.</strong> — Zahlungsabwicklung und Rechnungsstellung (UK/USA). Rechtsgrundlage der Übermittlung: Standard Contractual Clauses (SCC) + UK Addendum.</li>
              <li style={liStyle}><strong>Google Ireland Limited (Google Analytics 4)</strong> — Webanalyse, anonymisierte Verkehrsdaten (USA). Rechtsgrundlage der Übermittlung: EU-US Data Privacy Framework. Analyse-Cookies (_ga, _ga_*) werden nur nach ausdrücklicher Einwilligung gesetzt.</li>
              <li style={liStyle}><strong>Resend, Inc.</strong> — Versand von Transaktions-E-Mails (Registrierungsüberprüfung, Passwort-Reset, Benachrichtigungen). USA. Rechtsgrundlage der Übermittlung: EU-US Data Privacy Framework.</li>
              <li style={liStyle}><strong>Functional Software, Inc. (Sentry)</strong> — Anwendungsfehlerüberwachung und Protokollierung (IP-Adresse, Browserversion, Fehlerprotokolle). USA. Rechtsgrundlage: Art. 6 Abs. 1 lit. f) GDPR (berechtigtes Interesse). Rechtsgrundlage der Übermittlung: EU-US Data Privacy Framework.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Wir haben mit allen Auftragsverarbeitern Verträge zur Auftragsverarbeitung (DPA) gemäß Art. 28 GDPR abgeschlossen.
            </p>
          </>
        ),
      },
      {
        heading: "10. Datenübertragung in Drittländer",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Daten werden auf Servern in der Europäischen Union (Slowakei) gespeichert. Einige unserer Auftragsverarbeiter können Daten außerhalb des EWR (USA, UK) verarbeiten. Die Datenübertragung ist gesichert durch:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>EU-US Data Privacy Framework (Beschluss der Europäischen Kommission C(2023) 4745 vom 10. Juli 2023) — Google, Resend, Sentry</li>
              <li style={liStyle}>Standard Contractual Clauses (SCC) + UK Addendum — Paddle</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Eine detaillierte Liste der Empfänger finden Sie in Abschnitt 9.
            </p>
          </>
        ),
      },
      {
        heading: "11. Cookies",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Verifa.sk verwendet die folgenden Arten von Cookies:
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Notwendige Cookies (ohne Einwilligung):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Session-Cookie (next-auth.session-token) — Anmeldung, gültig bis der Browser geschlossen wird</li>
              <li style={liStyle}>Spracheinstellung — gültig für 1 Jahr</li>
              <li style={liStyle}>Dark/Light-Mode-Präferenz — gültig für 1 Jahr</li>
              <li style={liStyle}>Einwilligungs-Cookie-Eintrag (localStorage) — dauerhaft</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Analyse-Cookies (nur mit Einwilligung):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Google Analytics (_ga, _ga_*) — anonymisierte Verkehrsstatistiken, gültig für 2 Jahre. Werden nur nach ausdrücklicher Einwilligung über das Cookie-Banner gesetzt.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Sie können Analyse-Cookies jederzeit über das Cookie-Banner oder durch Löschen der Cookies in Ihrem Browser ablehnen.
            </p>
          </>
        ),
      },
      {
        heading: "12. Kontakt",
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
            <li style={liStyle}><strong>Údaje uživatelského účtu (jméno, email, hash hesla):</strong> po dobu existence účtu + 30 dní po jeho vymazání</li>
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
              Uplatnění práv můžete požadovat e-mailem na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Na žádost odpovíme bez zbytečného odkladu, nejpozději do 30 dnů od jejího doručení. V odůvodněných případech může být lhůta prodloužena o dalších 60 dnů.
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
        heading: "9. Příjemci osobních údajů",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Seznam zpracovatelů:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Paddle.com Market Ltd.</strong> — platební zpracování a fakturace (UK/USA). Právní základ přenosu: Standard Contractual Clauses (SCC) + UK Addendum.</li>
              <li style={liStyle}><strong>Google Ireland Limited (Google Analytics 4)</strong> — webová analytika, anonymizované údaje o návštěvnosti (USA). Právní základ přenosu: EU-US Data Privacy Framework. Analytické cookies (_ga, _ga_*) se nastavují pouze po udělení výslovného souhlasu.</li>
              <li style={liStyle}><strong>Resend, Inc.</strong> — odesílání transakčních e-mailů (ověření registrace, reset hesla, notifikace). USA. Právní základ přenosu: EU-US Data Privacy Framework.</li>
              <li style={liStyle}><strong>Functional Software, Inc. (Sentry)</strong> — monitoring a logování chyb aplikace (IP adresa, verze prohlížeče, záznamy o chybách). USA. Právní základ: Art. 6 odst. 1 písm. f) GDPR (oprávněný zájem). Právní základ přenosu: EU-US Data Privacy Framework.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Se všemi zpracovateli máme uzavřeny smlouvy o zpracování osobních údajů (DPA) ve smyslu Art. 28 GDPR.
            </p>
          </>
        ),
      },
      {
        heading: "10. Přenos údajů do třetích zemí",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Údaje jsou uloženy na serverech v Evropské unii (Slovensko). Někteří naši zpracovatelé mohou zpracovávat údaje mimo EHP (USA, UK). Přenos údajů je zabezpečen prostřednictvím:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>EU-US Data Privacy Framework (rozhodnutí Evropské komise C(2023) 4745 ze dne 10. července 2023) — Google, Resend, Sentry</li>
              <li style={liStyle}>Standard Contractual Clauses (SCC) + UK Addendum — Paddle</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Podrobný seznam příjemců je uveden v sekci 9.
            </p>
          </>
        ),
      },
      {
        heading: "11. Cookies",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Verifa.sk používá následující typy cookies:
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Nezbytné cookies (bez souhlasu):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Session cookie (next-auth.session-token) — přihlášení, platnost do zavření prohlížeče</li>
              <li style={liStyle}>Jazykové nastavení — platnost 1 rok</li>
              <li style={liStyle}>Preference tmavého/světlého režimu — platnost 1 rok</li>
              <li style={liStyle}>Záznam cookie souhlasu (localStorage) — trvalý</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Analytické cookies (pouze se souhlasem):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Google Analytics (_ga, _ga_*) — anonymizované statistiky návštěvnosti, platnost 2 roky. Nastavují se pouze po udělení výslovného souhlasu prostřednictvím cookie banneru.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Analytické cookies můžete kdykoli odmítnout prostřednictvím cookie banneru nebo vymazáním cookies ve vašem prohlížeči.
            </p>
          </>
        ),
      },
      {
        heading: "12. Kontakt",
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
            <li style={liStyle}><strong>Felhasználói fiók adatai:</strong> a fiók fennállásának idejére + a törlés utáni 30 napig</li>
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
              Jogai érvényesítését e-mailben kérhetje a <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> címen. Kérésére indokolatlan késedelem nélkül, de legkésőbb a beérkezéstől számított 30 napon belül válaszolunk. Indokolt esetben a határidő további 60 nappal meghosszabbítható.
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
        heading: "9. Személyes adatok címzettjei",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Az adatfeldolgozók listája:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Paddle.com Market Ltd.</strong> — fizetésfeldolgozás és számlázás (UK/USA). Az adattovábbítás jogalapja: Standard Contractual Clauses (SCC) + UK Addendum.</li>
              <li style={liStyle}><strong>Google Ireland Limited (Google Analytics 4)</strong> — webanalitika, anonimizált forgalmi adatok (USA). Az adattovábbítás jogalapja: EU-US Data Privacy Framework. Az analitikai sütik (_ga, _ga_*) csak kifejezett hozzájárulás után kerülnek beállításra.</li>
              <li style={liStyle}><strong>Resend, Inc.</strong> — tranzakciós e-mailek küldése (regisztráció ellenőrzése, jelszó visszaállítása, értesítések). USA. Az adattovábbítás jogalapja: EU-US Data Privacy Framework.</li>
              <li style={liStyle}><strong>Functional Software, Inc. (Sentry)</strong> — alkalmazáshibák figyelése és naplózása (IP-cím, böngészőverzió, hibanaplók). USA. Jogalap: GDPR 6. cikk (1) bekezdés f) pont (jogos érdek). Az adattovábbítás jogalapja: EU-US Data Privacy Framework.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Minden adatfeldolgozóval adatfeldolgozói szerződést (DPA) kötöttünk a GDPR 28. cikke alapján.
            </p>
          </>
        ),
      },
      {
        heading: "10. Adattovábbítás harmadik országokba",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Az adatok az Európai Unióban (Szlovákia) található szervereken vannak tárolva. Néhány adatfeldolgozónk az EGT-n kívül is dolgozhat fel adatokat (USA, UK). Az adattovábbítás biztonságát az alábbiak garantálják:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>EU-US Data Privacy Framework (Az Európai Bizottság 2023. július 10-i C(2023) 4745 határozata) — Google, Resend, Sentry</li>
              <li style={liStyle}>Standard Contractual Clauses (SCC) + UK Addendum — Paddle</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              A címzettek részletes listáját a 9. rész tartalmazza.
            </p>
          </>
        ),
      },
      {
        heading: "11. Sütik",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              A Verifa.sk az alábbi típusú sütiket használja:
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Szükséges sütik (hozzájárulás nélkül):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Munkamenet süti (next-auth.session-token) — bejelentkezés, érvényes a böngésző bezárásáig</li>
              <li style={liStyle}>Nyelvi beállítás — érvényes 1 évig</li>
              <li style={liStyle}>Sötét/világos mód preferenciája — érvényes 1 évig</li>
              <li style={liStyle}>Hozzájárulási süti rekord (localStorage) — tartós</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Analitikai sütik (csak hozzájárulással):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Google Analytics (_ga, _ga_*) — anonimizált forgalmi statisztikák, érvényes 2 évig. Csak kifejezett hozzájárulás után kerülnek beállításra a süti banneren keresztül.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Az analitikai sütiket bármikor elutasíthatja a süti banneren keresztül, vagy a böngészőjében a sütik törlésével.
            </p>
          </>
        ),
      },
      {
        heading: "12. Kapcsolat",
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
            <li style={liStyle}><strong>Dane konta użytkownika:</strong> przez czas istnienia konta + 30 dni po jego usunięciu</li>
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
              Mogą Państwo realizować swoje prawa za pośrednictwem poczty e-mail na adres <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Na żądanie odpowiemy bez zbędnej zwłoki, nie później niż w ciągu 30 dni od jego doręczenia. W uzasadnionych przypadkach termin ten może zostać przedłużony o kolejne 60 dni.
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
        heading: "9. Odbiorcy danych osobowych",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Lista podmiotów przetwarzających:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}><strong>Paddle.com Market Ltd.</strong> — przetwarzanie płatności i fakturowanie (UK/USA). Podstawa prawna przekazania: Standard Contractual Clauses (SCC) + UK Addendum.</li>
              <li style={liStyle}><strong>Google Ireland Limited (Google Analytics 4)</strong> — analityka internetowa, zanonimizowane dane o ruchu (USA). Podstawa prawna przekazania: EU-US Data Privacy Framework. Pliki cookie analityczne (_ga, _ga_*) są ustawiane tylko po wyrażeniu wyraźnej zgody.</li>
              <li style={liStyle}><strong>Resend, Inc.</strong> — wysyłanie transakcyjnych e-maili (weryfikacja rejestracji, resetowanie hasła, powiadomienia). USA. Podstawa prawna przekazania: EU-US Data Privacy Framework.</li>
              <li style={liStyle}><strong>Functional Software, Inc. (Sentry)</strong> — monitorowanie i logowanie błędów aplikacji (adres IP, wersja przeglądarki, logi błędów). USA. Podstawa prawna: Art. 6 ust. 1 lit. f) GDPR (uzasadniony interes). Podstawa prawna przekazania: EU-US Data Privacy Framework.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Z wszystkimi podmiotami przetwarzającymi zawarliśmy umowy o powierzeniu przetwarzania danych osobowych (DPA) w rozumieniu Art. 28 GDPR.
            </p>
          </>
        ),
      },
      {
        heading: "10. Przekazywanie danych do państw trzecich",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Dane są przechowywane na serwerach w Unii Europejskiej (Słowacja). Niektórzy z naszych podmiotów przetwarzających mogą przetwarzać dane poza EOG (USA, UK). Przekazywanie danych jest zabezpieczone poprzez:
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>EU-US Data Privacy Framework (decyzja Komisji Europejskiej C(2023) 4745 z 10 lipca 2023) — Google, Resend, Sentry</li>
              <li style={liStyle}>Standard Contractual Clauses (SCC) + UK Addendum — Paddle</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Szczegółowa lista odbiorców znajduje się w sekcji 9.
            </p>
          </>
        ),
      },
      {
        heading: "11. Pliki cookie",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Verifa.sk używa następujących typów plików cookie:
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>Niezbędne pliki cookie (bez zgody):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Plik cookie sesji (next-auth.session-token) — logowanie, ważność do zamknięcia przeglądarki</li>
              <li style={liStyle}>Ustawienia językowe — ważność 1 rok</li>
              <li style={liStyle}>Preferencja trybu ciemnego/jasnego — ważność 1 rok</li>
              <li style={liStyle}>Zapis zgody na pliki cookie (localStorage) — stały</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12, marginBottom: 12 }}>
              <strong>Analityczne pliki cookie (tylko za zgodą):</strong>
            </p>
            <ul style={ulStyle}>
              <li style={liStyle}>Google Analytics (_ga, _ga_*) — zanonimizowane statystyki ruchu, ważność 2 lata. Ustawiane tylko po udzieleniu wyraźnej zgody za pośrednictwem banera plików cookie.</li>
            </ul>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              Mogą Państwo w dowolnym momencie odrzucić analityczne pliki cookie za pośrednictwem banera plików cookie lub usuwając pliki cookie w swojej przeglądarce.
            </p>
          </>
        ),
      },
      {
        heading: "12. Kontakt",
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
            {content.lastUpdated}: 12. 8. 2026.
          </p>
        </section>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";
import { Lang, LOCALE_MAP } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const meta = generatePageMetadata("terms", lang);
  return { ...meta, robots: { index: false, follow: false } };
}

const linkStyle = { color: "var(--accent)", textDecoration: "none" } as const;

type Section = { heading: string; body: React.ReactNode };

const CONTENT: Record<Lang, { title: string; sections: Section[]; lastUpdated: string }> = {
  sk: {
    title: "Podmienky používania",
    sections: [
      {
        heading: "1. Úvod",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tieto podmienky používania (ďalej len „Podmienky&ldquo;) upravujú prístup a používanie služby Verifa.sk (ďalej len „Služba&ldquo;), ktorú prevádzkuje:<br /><br />
            <strong>Dušan Baran</strong><br />
            IČ: 06119859<br />
            Kubelíkova 1258/43, 130 00 Praha, Česká republika<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            (ďalej len „Prevádzkovateľ&ldquo;)<br /><br />
            Používaním Služby vyjadrujete súhlas s týmito Podmienkami.
          </p>
        ),
      },
      {
        heading: "2. Popis služby",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk poskytuje automatizovaný Business Risk Report získavaním údajov z verejne dostupných štátnych registrov Slovenskej republiky. Služba je určená pre profesionálne použitie a slúži ako informačný nástroj, nie ako právne alebo daňové poradenstvo.
          </p>
        ),
      },
      {
        heading: "3. Zodpovednosť používateľa",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Používateľ je zodpovedný za všetky údaje, ktoré zadá do systému. Používateľ sa zaväzuje nepoužívať Službu na nelegálne účely, vrátane ale nie obmedzene na: (a) získavanie údajov o osobách bez ich súhlasu, (b) diskrimináciu, (c) porušovanie práv tretích osôb.
          </p>
        ),
      },
      {
        heading: "4. Ochrana osobných údajov (GDPR)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spracúvame osobné údaje v súlade s nariadením GDPR. Údaje získavané zo štátnych registrov sú verejne dostupné. Používateľ má právo na prístup k svojim údajom, ich opravu alebo vymazanie. Viac informácií nájdete v našich <a href="/privacy" style={linkStyle}>Zásadoch ochrany osobných údajov</a> a v <a href="/dpa" style={linkStyle}>Dohode o spracúvaní osobných údajov (DPA)</a>.
          </p>
        ),
      },
      {
        heading: "5. Presnosť údajov",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk sa snaží poskytovať presné a aktuálne údaje, ale nezaručuje ich úplnosť alebo presnosť. Údaje sú získavané z verejných zdrojov a môžu byť zastarané alebo nepresné. Používateľ by mal overiť kľúčové informácie priamo v príslušných registroch.
          </p>
        ),
      },
      {
        heading: "6. Verifa Score",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa Score je hodnotenie vypočítané na základe vlastných algoritmov aplikácie. Skóre (0–100) a kategória rizika (AAA/A/B/C) sú výhradne informatívne a slúžia ako pomocný nástroj pre používateľa. Verifa Score nezastupuje profesionálne právne, finančné ani daňové posúdenie a nemôže byť použité ako jediný podklad pre rozhodovanie. Verifa.sk nezodpovedá za dôsledky rozhodnutí urobených na základe Verifa Score.
          </p>
        ),
      },
      {
        heading: "7. Vylúčenie zodpovednosti",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Služba je poskytovaná „tak, ako je&ldquo;, bez akejkoľvek záruky. Verifa.sk nenahrádza právne, daňové ani iné profesionálne poradenstvo. Verifa.sk nezodpovedá za žiadne škody vyplývajúce z používania alebo nemožnosti použiť Službu.
          </p>
        ),
      },
      {
        heading: "8. Kredity a refundácie",
        body: (
          <>
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
          </>
        ),
      },
      {
        heading: "9. Odstúpenie od zmluvy",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spotrebiteľ má právo odstúpiť od zmluvy do 14 dní od zakúpenia kreditov bez uvedenia dôvodu v súlade s § 7 zákona č. 102/2014 Z.z. o ochrane spotrebiteľa pri predaji na diaľku. Právo na odstúpenie zaniká okamihom, keď spotrebiteľ použije zakúpený kredit na vygenerovanie reportu, čím dôjde k poskytnutiu digitálneho obsahu s jeho výslovným súhlasom (§ 7 ods. 6 písm. l) zákona č. 102/2014 Z.z.). Žiadosť o odstúpenie posielajte na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "10. Rozhodné právo a riešenie sporov",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tieto Podmienky sa riadia právnym poriadkom Slovenskej republiky. Akékoľvek spory budú riešené pred vecne a miestne príslušným súdom Slovenskej republiky. Spotrebiteľ má právo obrátiť sa na platformu RSO (Riešenie sporov online) na <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer" style={linkStyle}>https://ec.europa.eu/odr</a>.
          </p>
        ),
      },
      {
        heading: "11. Zmeny podmienok",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk si vyhradzuje právo zmeniť tieto Podmienky. O podstatných zmenách budeme registrovaných používateľov informovať emailom najmenej 14 dní pred nadobudnutím ich účinnosti. Zmeny budú zverejnené na tejto stránke s uvedením dátumu účinnosti. Pokračovanie v používaní Služby po nadobudnutí účinnosti zmien predstavuje súhlas s novými Podmienkami.
          </p>
        ),
      },
      {
        heading: "12. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ak máte otázky týkajúce sa týchto Podmienok, kontaktujte nás na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
    ],
    lastUpdated: "Posledná aktualizácia",
  },
  en: {
    title: "Terms of Service",
    sections: [
      {
        heading: "1. Introduction",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            These terms of service (hereinafter the &ldquo;Terms&rdquo;) govern the access to and use of the Verifa.sk service (hereinafter the &ldquo;Service&rdquo;), operated by:<br /><br />
            <strong>Dušan Baran</strong><br />
            ID: 06119859<br />
            Kubelíkova 1258/43, 130 00 Prague, Czech Republic<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            (hereinafter the &ldquo;Operator&rdquo;)<br /><br />
            By using the Service, you agree to these Terms.
          </p>
        ),
      },
      {
        heading: "2. Description of the Service",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk provides an automated Business Risk Report by obtaining data from publicly available state registers of the Slovak Republic. The Service is intended for professional use and serves as an informational tool, not as legal or tax advice.
          </p>
        ),
      },
      {
        heading: "3. User Responsibility",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            The User is responsible for all data entered into the system. The User undertakes not to use the Service for illegal purposes, including but not limited to: (a) obtaining data about persons without their consent, (b) discrimination, (c) infringement of the rights of third parties.
          </p>
        ),
      },
      {
        heading: "4. Data Protection (GDPR)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            We process personal data in accordance with the GDPR regulation. Data obtained from state registers is publicly available. The User has the right to access their data, correct it, or have it deleted. For more information, please see our <a href="/privacy" style={linkStyle}>Privacy Policy</a> and <a href="/dpa" style={linkStyle}>Data Processing Agreement (DPA)</a>.
          </p>
        ),
      },
      {
        heading: "5. Data Accuracy",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk endeavours to provide accurate and up-to-date data but does not guarantee its completeness or accuracy. Data is obtained from public sources and may be outdated or inaccurate. The User should verify key information directly in the relevant registers.
          </p>
        ),
      },
      {
        heading: "6. Verifa Score",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa Score is a rating calculated based on the application&rsquo;s proprietary algorithms. The score (0–100) and risk category (AAA/A/B/C) are purely informative and serve as an auxiliary tool for the User. Verifa Score does not replace professional legal, financial, or tax assessment and cannot be used as the sole basis for decision-making. Verifa.sk is not liable for the consequences of decisions made on the basis of Verifa Score.
          </p>
        ),
      },
      {
        heading: "7. Disclaimer of Liability",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            The Service is provided &ldquo;as is&rdquo;, without any warranty. Verifa.sk does not replace legal, tax, or other professional advice. Verifa.sk is not liable for any damages arising from the use of or inability to use the Service.
          </p>
        ),
      },
      {
        heading: "8. Credits and Refunds",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <strong>Trial credit.</strong> Upon registration, the User receives 1 trial credit to verify a company. The trial credit does not expire — use it at any time.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>One-time packages.</strong> The Service offers one-time credit purchases (1×, 10×, 50× Report). Payment is processed via Paddle (Merchant of Record), which handles invoicing and VAT remittance. Credits purchased on a one-time basis <strong>do not expire</strong> — use them at any time.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Consumption.</strong> Credits are consumed on a FIFO basis (oldest credits are used first). One credit = one generated report.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Refund.</strong> If a report cannot be generated due to a technical outage of the registers or a system error, the credit is automatically refunded. If a report fails due to a non-existent IČO or user error, the credit is not refunded.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Payment methods.</strong> We accept card payments (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal, and SEPA bank transfer via Paddle.
            </p>
          </>
        ),
      },
      {
        heading: "9. Withdrawal from the Contract",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            The consumer has the right to withdraw from the contract within 14 days of purchasing credits without giving any reason, in accordance with § 7 of Act No. 102/2014 Coll. on Consumer Protection in Distance Selling. The right of withdrawal expires at the moment the consumer uses the purchased credit to generate a report, thereby providing digital content with their express consent (§ 7 para. 6 letter l) of Act No. 102/2014 Coll.). Send withdrawal requests to <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "10. Governing Law and Dispute Resolution",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            These Terms are governed by the laws of the Slovak Republic. Any disputes shall be resolved before the materially and locally competent court of the Slovak Republic. The consumer has the right to turn to the ODR platform (Online Dispute Resolution) at <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer" style={linkStyle}>https://ec.europa.eu/odr</a>.
          </p>
        ),
      },
      {
        heading: "11. Changes to the Terms",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk reserves the right to change these Terms. We will inform registered users about material changes by email at least 14 days before they become effective. Changes will be published on this page with the effective date. Continued use of the Service after the changes become effective constitutes acceptance of the new Terms.
          </p>
        ),
      },
      {
        heading: "12. Contact",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            If you have any questions regarding these Terms, please contact us at <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
    ],
    lastUpdated: "Last updated",
  },
  de: {
    title: "Nutzungsbedingungen",
    sections: [
      {
        heading: "1. Einleitung",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Diese Nutzungsbedingungen (nachfolgend die &ldquo;Bedingungen&rdquo;) regeln den Zugriff auf und die Nutzung des Dienstes Verifa.sk (nachfolgend der &ldquo;Dienst&rdquo;), betrieben von:<br /><br />
            <strong>Dušan Baran</strong><br />
            ID: 06119859<br />
            Kubelíkova 1258/43, 130 00 Prag, Tschechische Republik<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            (nachfolgend der &ldquo;Betreiber&rdquo;)<br /><br />
            Durch die Nutzung des Dienstes erklären Sie sich mit diesen Bedingungen einverstanden.
          </p>
        ),
      },
      {
        heading: "2. Beschreibung des Dienstes",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk erstellt einen automatisierten Business Risk Report durch die Beschaffung von Daten aus öffentlich zugänglichen staatlichen Registern der Slowakischen Republik. Der Dienst ist für die professionelle Nutzung bestimmt und dient als Informationsinstrument, nicht als Rechts- oder Steuerberatung.
          </p>
        ),
      },
      {
        heading: "3. Verantwortung des Nutzers",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Der Nutzer ist für alle Daten verantwortlich, die er in das System eingibt. Der Nutzer verpflichtet sich, den Dienst nicht für illegale Zwecke zu nutzen, einschließlich, aber nicht beschränkt auf: (a) die Beschaffung von Daten über Personen ohne deren Zustimmung, (b) Diskriminierung, (c) die Verletzung von Rechten Dritter.
          </p>
        ),
      },
      {
        heading: "4. Datenschutz (GDPR)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Wir verarbeiten personenbezogene Daten gemäß der GDPR-Verordnung. Aus staatlichen Registern gewonnene Daten sind öffentlich zugänglich. Der Nutzer hat das Recht auf Zugang zu seinen Daten, deren Berichtigung oder Löschung. Weitere Informationen finden Sie in unserer <a href="/privacy" style={linkStyle}>Datenschutzerklärung</a> und in der <a href="/dpa" style={linkStyle}>Datenverarbeitungsvereinbarung (DPA)</a>.
          </p>
        ),
      },
      {
        heading: "5. Datenrichtigkeit",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk bemüht sich, genaue und aktuelle Daten bereitzustellen, garantiert jedoch nicht deren Vollständigkeit oder Richtigkeit. Die Daten werden aus öffentlichen Quellen bezogen und können veraltet oder ungenau sein. Der Nutzer sollte wesentliche Informationen direkt in den entsprechenden Registern überprüfen.
          </p>
        ),
      },
      {
        heading: "6. Verifa Score",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa Score ist eine Bewertung, die auf der Grundlage proprietärer Algorithmen der Anwendung berechnet wird. Der Score (0–100) und die Risikokategorie (AAA/A/B/C) dienen ausschließlich informativen Zwecken und sind ein Hilfsmittel für den Nutzer. Verifa Score ersetzt keine professionelle rechtliche, finanzielle oder steuerliche Bewertung und kann nicht als alleinige Grundlage für Entscheidungen verwendet werden. Verifa.sk haftet nicht für die Folgen von Entscheidungen, die auf der Grundlage von Verifa Score getroffen wurden.
          </p>
        ),
      },
      {
        heading: "7. Haftungsausschluss",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Der Dienst wird &ldquo;wie besehen&rdquo; ohne jegliche Gewährleistung bereitgestellt. Verifa.sk ersetzt keine Rechts-, Steuer- oder sonstige professionelle Beratung. Verifa.sk haftet nicht für Schäden, die aus der Nutzung oder der Unmöglichkeit der Nutzung des Dienstes entstehen.
          </p>
        ),
      },
      {
        heading: "8. Credits und Erstattungen",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <strong>Test-Credit.</strong> Bei der Registrierung erhält der Nutzer 1 Test-Credit zur Überprüfung eines Unternehmens. Der Test-Credit verfällt nicht — verwenden Sie ihn jederzeit.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Einmalige Pakete.</strong> Der Dienst bietet einmalige Credit-Käufe (1×, 10×, 50× Report) an. Die Zahlung erfolgt über Paddle (Merchant of Record), der die Rechnungsstellung und die Umsatzsteuerabführung übernimmt. Einmalig gekaufte Credits <strong>verfallen nicht</strong> — verwenden Sie sie jederzeit.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Verbrauch.</strong> Credits werden nach dem FIFO-Prinzip verbraucht (die ältesten Credits werden zuerst verwendet). Ein Credit = ein generierter Bericht.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Erstattung.</strong> Wenn ein Bericht aufgrund eines technischen Ausfalls der Register oder eines Systemfehlers nicht generiert werden kann, wird der Credit automatisch erstattet. Wenn ein Bericht aufgrund einer nicht existierenden IČO oder eines Nutzerfehlers fehlschlägt, wird der Credit nicht erstattet.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Zahlungsmethoden.</strong> Wir akzeptieren Kartenzahlungen (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal und SEPA-Banküberweisung über Paddle.
            </p>
          </>
        ),
      },
      {
        heading: "9. Widerrufsrecht",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Der Verbraucher hat das Recht, innerhalb von 14 Tagen nach dem Kauf von Credits ohne Angabe von Gründen gemäß § 7 des Gesetzes Nr. 102/2014 Slg. über den Verbraucherschutz im Fernabsatz vom Vertrag zurückzutreten. Das Widerrufsrecht erlischt in dem Moment, in dem der Verbraucher das gekaufte Credit zur Erstellung eines Berichts verwendet und dadurch digitale Inhalte mit seiner ausdrücklichen Zustimmung bereitgestellt werden (§ 7 Abs. 6 Buchstabe l) des Gesetzes Nr. 102/2014 Slg.). Senden Sie Widerrufsanfragen an <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "10. Anwendbares Recht und Streitbeilegung",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Diese Bedingungen unterliegen den Gesetzen der Slowakischen Republik. Alle Streitigkeiten werden vor dem sachlich und örtlich zuständigen Gericht der Slowakischen Republik beigelegt. Der Verbraucher hat das Recht, sich an die OS-Plattform (Online-Streitbeilegung) unter <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer" style={linkStyle}>https://ec.europa.eu/odr</a> zu wenden.
          </p>
        ),
      },
      {
        heading: "11. Änderungen der Bedingungen",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk behält sich das Recht vor, diese Bedingungen zu ändern. Wir werden registrierte Nutzer mindestens 14 Tage vor deren Inkrafttreten per E-Mail über wesentliche Änderungen informieren. Änderungen werden auf dieser Seite mit dem Datum des Inkrafttretens veröffentlicht. Die fortgesetzte Nutzung des Dienstes nach Inkrafttreten der Änderungen gilt als Zustimmung zu den neuen Bedingungen.
          </p>
        ),
      },
      {
        heading: "12. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Wenn Sie Fragen zu diesen Bedingungen haben, kontaktieren Sie uns unter <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
    ],
    lastUpdated: "Letzte Aktualisierung",
  },
  cz: {
    title: "Podmínky používání",
    sections: [
      {
        heading: "1. Úvod",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tyto podmínky používání (dále jen „Podmínky&ldquo;) upravují přístup a používání služby Verifa.sk (dále jen „Služba&ldquo;), kterou provozuje:<br /><br />
            <strong>Dušan Baran</strong><br />
            IČ: 06119859<br />
            Kubelíkova 1258/43, 130 00 Praha, Česká republika<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            (dále jen „Provozovatel&ldquo;)<br /><br />
            Používáním Služby vyjadřujete souhlas s těmito Podmínkami.
          </p>
        ),
      },
      {
        heading: "2. Popis služby",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk poskytuje automatizovaný Business Risk Report získáváním údajů z veřejně dostupných státních registrů Slovenské republiky. Služba je určena pro profesionální použití a slouží jako informační nástroj, nikoliv jako právní nebo daňové poradenství.
          </p>
        ),
      },
      {
        heading: "3. Odpovědnost uživatele",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Uživatel je odpovědný za všechny údaje, které zadá do systému. Uživatel se zavazuje nepoužívat Službu k nelegálním účelům, včetně ale ne výhradně: (a) získávání údajů o osobách bez jejich souhlasu, (b) diskriminaci, (c) porušování práv třetích osob.
          </p>
        ),
      },
      {
        heading: "4. Ochrana osobních údajů (GDPR)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Zpracováváme osobní údaje v souladu s nařízením GDPR. Údaje získávané ze státních registrů jsou veřejně dostupné. Uživatel má právo na přístup ke svým údajům, jejich opravu nebo vymazání. Více informací naleznete v našich <a href="/privacy" style={linkStyle}>Zásadách ochrany osobních údajů</a> a v <a href="/dpa" style={linkStyle}>Dohodě o zpracování osobních údajů (DPA)</a>.
          </p>
        ),
      },
      {
        heading: "5. Přesnost údajů",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk se snaží poskytovat přesné a aktuální údaje, ale nezaručuje jejich úplnost nebo přesnost. Údaje jsou získávány z veřejných zdrojů a mohou být zastaralé nebo nepřesné. Uživatel by měl ověřit klíčové informace přímo v příslušných registrech.
          </p>
        ),
      },
      {
        heading: "6. Verifa Score",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa Score je hodnocení vypočítané na základě vlastních algoritmů aplikace. Skóre (0–100) a kategorie rizika (AAA/A/B/C) jsou výhradně informativní a slouží jako pomocný nástroj pro uživatele. Verifa Score nenahrazuje profesionální právní, finanční ani daňové posouzení a nemůže být použito jako jediný podklad pro rozhodování. Verifa.sk neodpovídá za důsledky rozhodnutí učiněných na základě Verifa Score.
          </p>
        ),
      },
      {
        heading: "7. Vyloučení odpovědnosti",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Služba je poskytována „tak, jak je&ldquo;, bez jakékoli záruky. Verifa.sk nenahrazuje právní, daňové ani jiné profesionální poradenství. Verifa.sk neodpovídá za žádné škody vyplývající z používání nebo nemožnosti použít Službu.
          </p>
        ),
      },
      {
        heading: "8. Kredity a refundace",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <strong>Zkušební kredit.</strong> Při registraci uživatel dostává 1 zkušební kredit k ověření firmy. Zkušební kredit neexpiruje — použijte ho kdykoli.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Jednorázové balíčky.</strong> Služba nabízí jednorázové nákupy kreditů (1×, 10×, 50× Report). Platba probíhá přes Paddle (Merchant of Record), který zabezpečuje fakturaci a odvod DPH. Kredity zakoupené jednorázově <strong>neexpirují</strong> — použijte je kdykoli.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Čerpání.</strong> Kredity se čerpají v pořadí FIFO (nejstarší kredity se minou jako první). Jeden kredit = jeden vygenerovaný report.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Refundace.</strong> Pokud se report nepodaří vygenerovat z důvodu technického výpadku registrů nebo chyby systému, kredit se automaticky vrátí. Pokud report selže kvůli neexistujícímu IČO nebo chybě uživatele, kredit se nevrací.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Platební metody.</strong> Akceptujeme platby kartou (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal a SEPA bankovní převod prostřednictvím Paddle.
            </p>
          </>
        ),
      },
      {
        heading: "9. Odstoupení od smlouvy",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spotřebitel má právo odstoupit od smlouvy do 14 dnů od zakoupení kreditů bez udání důvodu v souladu s § 7 zákona č. 102/2014 Z.z. o ochraně spotřebitele při prodeji na dálku. Právo na odstoupení zaniká okamžikem, kdy spotřebitel použije zakoupený kredit k vygenerování reportu, čímž dojde k poskytnutí digitálního obsahu s jeho výslovným souhlasem (§ 7 odst. 6 písm. l) zákona č. 102/2014 Z.z.). Žádost o odstoupení zasílejte na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "10. Rozhodné právo a řešení sporů",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tyto Podmínky se řídí právním řádem Slovenské republiky. Veškeré spory budou řešeny před věcně a místně příslušným soudem Slovenské republiky. Spotřebitel má právo obrátit se na platformu RSO (Řešení sporů online) na <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer" style={linkStyle}>https://ec.europa.eu/odr</a>.
          </p>
        ),
      },
      {
        heading: "11. Změny podmínek",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk si vyhrazuje právo změnit tyto Podmínky. O podstatných změnách budeme registrované uživatele informovat e-mailem nejméně 14 dní před nabytím jejich účinnosti. Změny budou zveřejněny na této stránce s uvedením data účinnosti. Pokračování v používání Služby po nabytí účinnosti změn představuje souhlas s novými Podmínkami.
          </p>
        ),
      },
      {
        heading: "12. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pokud máte otázky týkající se těchto Podmínek, kontaktujte nás na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
    ],
    lastUpdated: "Poslední aktualizace",
  },
  hu: {
    title: "Felhasználási feltételek",
    sections: [
      {
        heading: "1. Bevezetés",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ezek a felhasználási feltételek (a továbbiakban &ldquo;Feltételek&rdquo;) szabályozzák a Verifa.sk szolgáltatás (a továbbiakban &ldquo;Szolgáltatás&rdquo;) elérését és használatát, amelyet üzemeltet:<br /><br />
            <strong>Dušan Baran</strong><br />
            Azonosító: 06119859<br />
            Kubelíkova 1258/43, 130 00 Prága, Cseh Köztársaság<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            (a továbbiakban &ldquo;Üzemeltető&rdquo;)<br /><br />
            A Szolgáltatás használatával Ön elfogadja ezeket a Feltételeket.
          </p>
        ),
      },
      {
        heading: "2. A szolgáltatás leírása",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa.sk automatizált Business Risk Reportot készít a Szlovák Köztársaság nyilvánosan elérhető állami nyilvántartásaiból származó adatok felhasználásával. A Szolgáltatás szakmai használatra szolgál, és információs eszközként működik, nem jogi vagy adótanácsadásként.
          </p>
        ),
      },
      {
        heading: "3. A felhasználó felelőssége",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Felhasználó felelős a rendszerbe bevitt összes adatért. A Felhasználó vállalja, hogy nem használja a Szolgáltatást illegális célokra, beleértve de nem kizárólag: (a) személyek adatainak megszerzése azok hozzájárulása nélkül, (b) diszkrimináció, (c) harmadik felek jogainak megsértése.
          </p>
        ),
      },
      {
        heading: "4. Adatvédelem (GDPR)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A személyes adatokat a GDPR rendeletnek megfelelően kezeljük. Az állami nyilvántartásokból származó adatok nyilvánosan hozzáférhetők. A Felhasználónak joga van hozzáférni adataihoz, azokat helyesbíteni vagy törölni. További információkat az <a href="/privacy" style={linkStyle}>Adatvédelmi szabályzatunkban</a> és az <a href="/dpa" style={linkStyle}>Adatkezelési megállapodásban (DPA)</a> talál.
          </p>
        ),
      },
      {
        heading: "5. Adatok pontossága",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa.sk igyekszik pontos és naprakész adatokat szolgáltatni, de nem garantálja azok teljességét vagy pontosságát. Az adatok nyilvános forrásokból származnak, és elavultak vagy pontatlanok lehetnek. A Felhasználónak ellenőriznie kell a kulcsfontosságú információkat közvetlenül a megfelelő nyilvántartásokban.
          </p>
        ),
      },
      {
        heading: "6. Verifa Score",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa Score egy olyan értékelés, amely az alkalmazás saját algoritmusai alapján kerül kiszámításra. A pontszám (0–100) és a kockázati kategória (AAA/A/B/C) kizárólag tájékoztató jellegű, és a Felhasználó számára segédeszközként szolgál. A Verifa Score nem helyettesíti a szakmai jogi, pénzügyi vagy adóértékelést, és nem használható egyedüli döntési alapként. A Verifa.sk nem vállal felelősséget a Verifa Score alapján hozott döntések következményeiért.
          </p>
        ),
      },
      {
        heading: "7. Felelősség kizárása",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Szolgáltatás &ldquo;ahogy van&rdquo; alapon, mindenféle garancia nélkül kerül biztosításra. A Verifa.sk nem helyettesíti a jogi, adzási vagy egyéb szakmai tanácsadást. A Verifa.sk nem vállal felelősséget a Szolgáltatás használatából vagy használatának lehetetlenségéből eredő károkért.
          </p>
        ),
      },
      {
        heading: "8. Kreditek és visszatérítések",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <strong>Próbakredit.</strong> Regisztrációkor a Felhasználó 1 próbakreditet kap egy cég ellenőrzésére. A próbakredit nem jár le — használja bármikor.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Egyszeri csomagok.</strong> A Szolgáltatás egyszeri kreditvásárlásokat kínál (1×, 10×, 50× Report). A fizetés a Paddle-en (Merchant of Record) keresztül történik, amely a számlázást és az áfa befizetését kezeli. Az egyszeri vásárlású kreditek <strong>nem járnak le</strong> — használja őket bármikor.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Felhasználás.</strong> A kreditek FIFO elv szerint kerülnek felhasználásra (a legrégebbi kreditek kerülnek először felhasználásra). Egy kredit = egy generált jelentés.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Visszatérítés.</strong> Ha egy jelentés technikai kimaradás vagy rendszerhiba miatt nem generálható, a kredit automatikusan visszakerül. Ha egy jelentés nem létező IČO vagy felhasználói hiba miatt sikertelen, a kredit nem kerül visszatérítésre.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Fizetési módok.</strong> Elfogadjuk a kártyás fizetéseket (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal és SEPA banki átutalás fizetést a Paddle-en keresztül.
            </p>
          </>
        ),
      },
      {
        heading: "9. Elállás a szerződéstől",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A fogyasztó jogosult a kreditek megvásárlásától számított 14 napon belül indokolás nélkül elállni a szerződéstől a távértékesítés során a fogyasztóvédelemről szóló 102/2014. (Z.z.) sz. törvény 7. §-a alapján. Az elállási jog megszűnik abban a pillanatban, amikor a fogyasztó a megvásárolt kreditet jelentés generálására használja, ezáltal kifejezett beleegyezésével digitális tartalom szolgáltatására kerül sor (a 102/2014. (Z.z.) sz. törvény 7. § (6) bekezdés l) pontja). Az elállási kérelmet az <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> címre küldje.
          </p>
        ),
      },
      {
        heading: "10. Irányadó jog és vitarendezés",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ezekre a Feltételekre a Szlovák Köztársaság jogrendje az irányadó. A vitákat a Szlovák Köztársaság tárgyi és helyi hatáskörrel rendelkező bírósága előtt kell rendezni. A fogyasztó jogosult az ODR platformhoz (Online vitarendezés) fordulni a <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer" style={linkStyle}>https://ec.europa.eu/odr</a> címen.
          </p>
        ),
      },
      {
        heading: "11. A feltételek változásai",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A Verifa.sk fenntartja a jogot a jelen Feltételek megváltoztatására. A lényeges változásokról a regisztrált felhasználókat legalább 14 nappal a hatálybalépés előtt e-mailben értesítjük. A változások ezen az oldalon kerülnek közzétételre a hatálybalépés dátumával együtt. A Szolgáltatás további használata a változások hatálybalépése után az új Feltételek elfogadásának minősül.
          </p>
        ),
      },
      {
        heading: "12. Kapcsolat",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ha kérdése van ezekkel a Feltételekre kapcsolatban, lépjen velünk kapcsolatba a <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> címen.
          </p>
        ),
      },
    ],
    lastUpdated: "Utolsó frissítés",
  },
  pl: {
    title: "Warunki korzystania z usług",
    sections: [
      {
        heading: "1. Wprowadzenie",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Niniejsze warunki korzystania z usług (dalej &ldquo;Warunki&rdquo;) regulują dostęp do usługi Verifa.sk (dalej &ldquo;Usługa&rdquo;) i jej korzystanie, prowadzonej przez:<br /><br />
            <strong>Dušan Baran</strong><br />
            ID: 06119859<br />
            Kubelíkova 1258/43, 130 00 Praga, Czechy<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            (dalej &ldquo;Operator&rdquo;)<br /><br />
            Korzystając z Usługi, wyrażasz zgodę na niniejsze Warunki.
          </p>
        ),
      },
      {
        heading: "2. Opis usługi",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk zapewnia zautomatyzowany Business Risk Report poprzez pozyskiwanie danych z publicznie dostępnych rejestrów państwowych Republiki Słowackiej. Usługa jest przeznaczona do użytku profesjonalnego i służy jako narzędzie informacyjne, a nie jako porada prawna lub podatkowa.
          </p>
        ),
      },
      {
        heading: "3. Odpowiedzialność użytkownika",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Użytkownik ponosi odpowiedzialność za wszystkie dane wprowadzone do systemu. Użytkownik zobowiązuje się do nieużywania Usługi w celach nielegalnych, w tym między innymi: (a) pozyskiwanie danych o osobach bez ich zgody, (b) dyskryminacji, (c) naruszania praw stron trzecich.
          </p>
        ),
      },
      {
        heading: "4. Ochrona danych (GDPR)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Przetwarzamy dane osobowe zgodnie z rozporządzeniem GDPR. Dane pozyskiwane z rejestrów państwowych są publicznie dostępne. Użytkownik ma prawo dostępu do swoich danych, ich sprostowania lub usunięcia. Więcej informacji znajduje się w naszej <a href="/privacy" style={linkStyle}>Polityce prywatności</a> oraz w <a href="/dpa" style={linkStyle}>Umowie o przetwarzaniu danych (DPA)</a>.
          </p>
        ),
      },
      {
        heading: "5. Dokładność danych",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk dąży do dostarczania dokładnych i aktualnych danych, ale nie gwarantuje ich kompletności ani dokładności. Dane są pozyskiwane ze źródeł publicznych i mogą być nieaktualne lub niedokładne. Użytkownik powinien zweryfikować kluczowe informacje bezpośrednio w odpowiednich rejestrach.
          </p>
        ),
      },
      {
        heading: "6. Verifa Score",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa Score to ocena obliczana na podstawie własnych algorytmów aplikacji. Wynik (0–100) i kategoria ryzyka (AAA/A/B/C) są wyłącznie informacyjne i służą jako narzędzie pomocnicze dla Użytkownika. Verifa Score nie zastępuje profesjonalnej oceny prawnej, finansowej ani podatkowej i nie może być używany jako jedyna podstawa do podejmowania decyzji. Verifa.sk nie ponosi odpowiedzialności za konsekwencje decyzji podjętych na podstawie Verifa Score.
          </p>
        ),
      },
      {
        heading: "7. Wyłączenie odpowiedzialności",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Usługa jest świadczona &ldquo;taka, jaka jest&rdquo;, bez jakiejkolwiek gwarancji. Verifa.sk nie zastępuje porady prawnej, podatkowej ani innej profesjonalnej. Verifa.sk nie ponosi odpowiedzialności za jakiekolwiek szkody wynikające z korzystania lub niemożności korzystania z Usługi.
          </p>
        ),
      },
      {
        heading: "8. Kredyty i zwroty",
        body: (
          <>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <strong>Kredyt próbny.</strong> Po rejestracji Użytkownik otrzymuje 1 kredyt próbny do weryfikacji firmy. Kredyt próbny nie wygasa — użyj go w dowolnym czasie.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Pakiety jednorazowe.</strong> Usługa oferuje jednorazowe zakupy kredytów (1×, 10×, 50× Report). Płatność odbywa się przez Paddle (Merchant of Record), który zajmuje się fakturowaniem i odprowadzaniem VAT. Kredyty kupione jednorazowo <strong>nie wygasają</strong> — użyj ich w dowolnym czasie.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Zużycie.</strong> Kredyty są zużywane w kolejności FIFO (najstarsze kredyty są zużywane jako pierwsze). Jeden kredyt = jeden wygenerowany raport.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Zwrot.</strong> Jeśli raport nie może zostać wygenerowany z powodu technicznej awarii rejestrów lub błędu systemu, kredyt jest automatycznie zwracany. Jeśli raport nie powiedzie się z powodu nieistniejącego IČO lub błędu użytkownika, kredyt nie podlega zwrotowi.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 12 }}>
              <strong>Metody płatności.</strong> Akceptujemy płatności kartą (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal oraz przelew bankowy SEPA za pośrednictwem Paddle.
            </p>
          </>
        ),
      },
      {
        heading: "9. Odstąpienie od umowy",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Konsument ma prawo odstąpić od umowy w terminie 14 dni od zakupu kredytów bez podania przyczyny, zgodnie z § 7 ustawy nr 102/2014 Dz.U. o ochronie konsumentów w sprzedaży na odległość. Prawo do odstąpienia od umowy wygasa z chwilą wykorzystania przez konsumenta zakupionego kredytu do wygenerowania raportu, co oznacza dostarczenie treści cyfrowych za jego wyraźną zgodą (§ 7 ust. 6 lit. l) ustawy nr 102/2014 Dz.U.). Prośby o odstąpienie należy kierować na adres <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "10. Prawo właściwe i rozwiązywanie sporów",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Niniejsze Warunki podlegają prawu Republiki Słowackiej. Wszelkie spory będą rozstrzygane przed właściwym rzeczowo i miejscowo sądem Republiki Słowackiej. Konsument ma prawo zwrócić się do platformy ODR (internetowe rozstrzyganie sporów) pod adresem <a href="https://ec.europa.eu/odr" target="_blank" rel="noopener noreferrer" style={linkStyle}>https://ec.europa.eu/odr</a>.
          </p>
        ),
      },
      {
        heading: "11. Zmiany warunków",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Verifa.sk zastrzega sobie prawo do zmiany niniejszych Warunków. O istotnych zmianach będziemy informować zarejestrowanych użytkowników e-mailem co najmniej 14 dni przed ich wejściem w życie. Zmiany będą publikowane na tej stronie z podaniem daty wejścia w życie. Kontynuowanie korzystania z Usługi po wejściu w życie zmian oznacza akceptację nowych Warunków.
          </p>
        ),
      },
      {
        heading: "12. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Jeśli masz pytania dotyczące niniejszych Warunków, skontaktuj się z nami pod adresem <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
    ],
    lastUpdated: "Ostatnia aktualizacja",
  },
};

export default async function TermsPage() {
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
            {content.lastUpdated}: 12. 8. 2026.
          </p>
        </section>
      </div>
    </div>
  );
}

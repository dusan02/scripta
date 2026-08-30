import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";
import { Lang, LOCALE_MAP } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const meta = generatePageMetadata("refund", lang);
  return { ...meta, robots: { index: false, follow: false } };
}

const linkStyle = { color: "var(--accent)", textDecoration: "none" } as const;

type Section = { heading: string; body: React.ReactNode };

const CONTENT: Record<Lang, { title: string; sections: Section[]; lastUpdated: string }> = {
  sk: {
    title: "Refund Policy — Politika vrátenia platby",
    sections: [
      {
        heading: "1. Úvod",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Táto politika vrátenia platby (ďalej len „Refund Policy&ldquo;) upravuje podmienky vrátenia peňazí za kredity zakúpené na platforme Verifa.sk (ďalej len „Služba&ldquo;), ktorú prevádzkuje:<br /><br />
            <strong>Dušan Baran</strong><br />
            IČ: 06119859<br />
            Kubelíkova 1258/43, 130 00 Praha, Česká republika<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            Platby spracúva <strong>Paddle.com (Merchant of Record)</strong>, ktorý zabezpečuje fakturáciu, odvod DPH a spracovanie refundácií.
          </p>
        ),
      },
      {
        heading: "2. Odstúpenie od zmluvy (14-dňová lehota)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spotrebiteľ má právo odstúpiť od zmluvy do <strong>14 dní od zakúpenia kreditov</strong> bez uvedenia dôvodu v súlade s § 7 zákona č. 102/2014 Z.z. o ochrane spotrebiteľa pri predaji na diaľku.<br /><br />
            <strong>Právo na odstúpenie zaniká</strong> okamihom, keď spotrebiteľ použije zakúpený kredit na vygenerovanie reportu, čím dôjde k poskytnutiu digitálneho obsahu s jeho výslovným súhlasom (§ 7 ods. 6 písm. l) zákona č. 102/2014 Z.z.).<br /><br />
            Žiadosť o odstúpenie posielajte na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> s uvedením IČO účtu a čísla transakcie.
          </p>
        ),
      },
      {
        heading: "3. Automatické vrátenie kreditov",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ak sa report <strong>nepodarí vygenerovať</strong> z dôvodu:<br />
            (a) technického výpadku štátnych registrov (ORSR, RUZ, Finančná správa a pod.),<br />
            (b) chyby systému Verifa.sk,<br />
            (c) nedostupnosti zdrojových dát,<br /><br />
            <strong>kredit sa automaticky vráti</strong> na používateľský účet bez nutnosti kontaktovať podporu. Toto automatické vrátenie prebieha zvyčajne do 24 hodín.
          </p>
        ),
      },
      {
        heading: "4. Nárok na vrátenie peňazí (refund)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Nárok na vrátenie peňazí vzniká ak:<br />
            (a) report nebol vygenerovaný a kredit bol spotrebovaný bez výsledku (technická chyba),<br />
            (b) používateľ odstúpil od zmluvy v 14-dňovej lehote a kredit nebol použitý,<br />
            (c) bola uskutočnená duplicitná platba za rovnaký balík kreditov.<br /><br />
            Žiadosť o refund posielajte na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> s uvedením:<br />
            — IČO účtu alebo e-mailovej adresy<br />
            — dátumu transakcie<br />
            — dôvodu žiadosti<br /><br />
            Refund bude spracovaný cez Paddle do <strong>5–10 pracovných dní</strong>.
          </p>
        ),
      },
      {
        heading: "5. Kedy sa kredit nevracia",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Kredit <strong>sa nevracia</strong> ak:<br />
            (a) report bol úspešne vygenerovaný a používateľ ho prijal,<br />
            (b) report zlyhal kvôli neexistujúcemu IČO alebo chybe používateľa (nesprávne zadané údaje),<br />
            (c) kredit bol použitý po uplynutí 14-dňovej lehoty na odstúpenie,<br />
            (d) ide o chargeback zneužitý v rozpore s týmito podmienkami.
          </p>
        ),
      },
      {
        heading: "6. Chargeback",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ak používateľ podá chargeback (vrátenie platby cez banku) bez oprávneného dôvodu uvedeného v tejto Refund Policy, Verifa.sk si vyhradzuje právo:<br />
            (a) zablokovať účet používateľa,<br />
            (b) zadržať zostávajúce kredity,<br />
            (c) zaslať doklady o poskytnutých službách banke a Paddle na obhajobu chargebacku.<br /><br />
            Pred podaním chargebacku vás vyzývame, aby ste najprv kontaktovali <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> — väčšinu sporov vieme vyriešiť priamo.
          </p>
        ),
      },
      {
        heading: "7. Spôsob vrátenia peňazí",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Vratenie peňazí sa realizuje <strong>cez Paddle</strong> na pôvodnú platobnú metódu (karta, PayPal, SEPA). Verifa.sk nemá priamy prístup k platobným údajom — refund spracúva Paddle ako Merchant of Record.<br /><br />
            Čas spracovania: <strong>5–10 pracovných dní</strong> od schválenia žiadosti.
          </p>
        ),
      },
      {
        heading: "8. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pre všetky otázky týkajúce sa refundácií kontaktujte <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Odpovedáme zvyčajne do 24 hodín.
          </p>
        ),
      },
    ],
    lastUpdated: "Posledná aktualizácia",
  },
  en: {
    title: "Refund Policy",
    sections: [
      {
        heading: "1. Introduction",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            This Refund Policy governs the conditions for refunding credits purchased on the Verifa.sk platform (hereinafter the &ldquo;Service&rdquo;), operated by:<br /><br />
            <strong>Dušan Baran</strong><br />
            ID: 06119859<br />
            Kubelíkova 1258/43, 130 00 Prague, Czech Republic<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            Payments are processed by <strong>Paddle.com (Merchant of Record)</strong>, which handles invoicing, VAT remittance, and refund processing.
          </p>
        ),
      },
      {
        heading: "2. Right of Withdrawal (14-day period)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            The consumer has the right to withdraw from the contract within <strong>14 days of purchasing credits</strong> without giving any reason, in accordance with § 7 of Act No. 102/2014 Coll. on Consumer Protection in Distance Selling.<br /><br />
            <strong>The right of withdrawal expires</strong> at the moment the consumer uses the purchased credit to generate a report, thereby providing digital content with their express consent (§ 7 para. 6 letter l) of Act No. 102/2014 Coll.).<br /><br />
            Send withdrawal requests to <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> with your account IČO and transaction ID.
          </p>
        ),
      },
      {
        heading: "3. Automatic Credit Refunds",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            If a report <strong>cannot be generated</strong> due to:<br />
            (a) technical outage of state registers (ORSR, RUZ, Financial Administration, etc.),<br />
            (b) Verifa.sk system error,<br />
            (c) unavailability of source data,<br /><br />
            <strong>the credit is automatically refunded</strong> to the user account without needing to contact support. This automatic refund usually occurs within 24 hours.
          </p>
        ),
      },
      {
        heading: "4. Eligibility for Refund",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A refund is eligible if:<br />
            (a) the report was not generated and the credit was consumed without result (technical error),<br />
            (b) the user withdrew from the contract within the 14-day period and the credit was not used,<br />
            (c) a duplicate payment was made for the same credit package.<br /><br />
            Send refund requests to <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> with:<br />
            — Account IČO or email address<br />
            — Transaction date<br />
            — Reason for request<br /><br />
            Refunds are processed via Paddle within <strong>5–10 business days</strong>.
          </p>
        ),
      },
      {
        heading: "5. Non-Refundable Cases",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A credit <strong>is not refunded</strong> if:<br />
            (a) the report was successfully generated and accepted by the user,<br />
            (b) the report failed due to a non-existent IČO or user error (incorrect data entered),<br />
            (c) the credit was used after the 14-day withdrawal period,<br />
            (d) a chargeback was filed in violation of these terms.
          </p>
        ),
      },
      {
        heading: "6. Chargeback",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            If a user files a chargeback (bank-initiated refund) without a legitimate reason stated in this Refund Policy, Verifa.sk reserves the right to:<br />
            (a) block the user's account,<br />
            (b) withhold remaining credits,<br />
            (c) submit evidence of services rendered to the bank and Paddle to defend the chargeback.<br /><br />
            Before filing a chargeback, we encourage you to contact <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> first — most disputes can be resolved directly.
          </p>
        ),
      },
      {
        heading: "7. Refund Method",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Refunds are processed <strong>via Paddle</strong> to the original payment method (card, PayPal, SEPA). Verifa.sk does not have direct access to payment details — refunds are handled by Paddle as Merchant of Record.<br /><br />
            Processing time: <strong>5–10 business days</strong> from request approval.
          </p>
        ),
      },
      {
        heading: "8. Contact",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            For all refund-related questions, contact <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. We typically respond within 24 hours.
          </p>
        ),
      },
    ],
    lastUpdated: "Last updated",
  },
  de: {
    title: "Rückerstattungsrichtlinie",
    sections: [
      {
        heading: "1. Einleitung",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Diese Rückerstattungsrichtlinie regelt die Bedingungen für die Rückerstattung von auf der Plattform Verifa.sk (nachfolgend der &ldquo;Dienst&ldquo;) gekauften Credits, betrieben von:<br /><br />
            <strong>Dušan Baran</strong><br />
            ID: 06119859<br />
            Kubelíkova 1258/43, 130 00 Prag, Tschechische Republik<br />
            E-Mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            Zahlungen werden von <strong>Paddle.com (Merchant of Record)</strong> abgewickelt, der für Rechnungsstellung, USt-Abführung und Rückerstattungsabwicklung zuständig ist.
          </p>
        ),
      },
      {
        heading: "2. Rücktrittsrecht (14-Tage-Frist)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Der Verbraucher hat das Recht, binnen <strong>14 Tagen ab Kauf der Credits</strong> vom Vertrag zurückzutreten, ohne Angabe von Gründen gemäß § 7 des Gesetzes Nr. 102/2014 GBl. über den Verbraucherschutz beim Fernabsatz.<br /><br />
            <strong>Das Rücktrittsrecht erlischt</strong> in dem Moment, in dem der Verbraucher den gekauften Credit zur Erstellung eines Berichts verwendet, wodurch digitale Inhalte mit ausdrücklicher Zustimmung bereitgestellt werden (§ 7 Abs. 6 Buchst. l) des Gesetzes Nr. 102/2014 GBl.).<br /><br />
            Rücktrittsanfragen an <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> mit Angabe der Konto-IČO und Transaktions-ID.
          </p>
        ),
      },
      {
        heading: "3. Automatische Credit-Rückerstattung",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Wenn ein Bericht <strong>nicht erstellt werden kann</strong> aufgrund:<br />
            (a) technischen Ausfalls staatlicher Register (ORSR, RUZ, Finanzverwaltung usw.),<br />
            (b) Systemfehlers von Verifa.sk,<br />
            (c) Nichtverfügbarkeit von Quelldaten,<br /><br />
            <strong>wird der Credit automatisch erstattet</strong>, ohne den Support zu kontaktieren. Die automatische Erstattung erfolgt in der Regel innerhalb von 24 Stunden.
          </p>
        ),
      },
      {
        heading: "4. Anspruch auf Rückerstattung",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ein Rückerstattungsanspruch besteht, wenn:<br />
            (a) der Bericht nicht erstellt wurde und der Credit ohne Ergebnis verbraucht wurde (technischer Fehler),<br />
            (b) der Nutzer innerhalb der 14-Tage-Frist zurückgetreten ist und der Credit nicht verwendet wurde,<br />
            (c) eine doppelte Zahlung für dasselbe Credit-Paket erfolgte.<br /><br />
            Rückerstattungsanfragen an <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> mit:<br />
            — Konto-IČO oder E-Mail-Adresse<br />
            — Transaktionsdatum<br />
            — Grund der Anfrage<br /><br />
            Rückerstattungen werden über Paddle innerhalb von <strong>5–10 Werktagen</strong> abgewickelt.
          </p>
        ),
      },
      {
        heading: "5. Nicht erstattungsfähige Fälle",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ein Credit <strong>wird nicht erstattet</strong>, wenn:<br />
            (a) der Bericht erfolgreich erstellt und vom Nutzer akzeptiert wurde,<br />
            (b) der Bericht aufgrund nicht existierender IČO oder Nutzerfehlers fehlschlug (falsche Daten eingegeben),<br />
            (c) der Credit nach Ablauf der 14-Tage-Frist verwendet wurde,<br />
            (d) eine Rückbuchung unter Verstoß gegen diese Bedingungen eingereicht wurde.
          </p>
        ),
      },
      {
        heading: "6. Rückbuchung (Chargeback)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Wenn ein Nutzer eine Rückbuchung (bankinitiierte Rückerstattung) ohne berechtigten Grund gemäß dieser Richtlinie einreicht, behält sich Verifa.sk das Recht vor:<br />
            (a) das Konto des Nutzers zu sperren,<br />
            (b) verbleibende Credits einzubehalten,<br />
            (c) Nachweise über erbrachte Leistungen an die Bank und Paddle einzureichen.<br /><br />
            Vor Einreichung einer Rückbuchung empfehlen wir, zuerst <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a> zu kontaktieren — die meisten Streitfälle können direkt gelöst werden.
          </p>
        ),
      },
      {
        heading: "7. Rückerstattungsmethode",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Rückerstattungen werden <strong>über Paddle</strong> auf die ursprüngliche Zahlungsmethode (Karte, PayPal, SEPA) abgewickelt. Verifa.sk hat keinen direkten Zugriff auf Zahlungsdaten — Rückerstattungen werden von Paddle als Merchant of Record abgewickelt.<br /><br />
            Bearbeitungszeit: <strong>5–10 Werktage</strong> nach Genehmigung der Anfrage.
          </p>
        ),
      },
      {
        heading: "8. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Bei allen Fragen zu Rückerstattungen kontaktieren Sie <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Wir antworten in der Regel innerhalb von 24 Stunden.
          </p>
        ),
      },
    ],
    lastUpdated: "Letzte Aktualisierung",
  },
  cz: {
    title: "Refund Policy — Politika vrácení platby",
    sections: [
      {
        heading: "1. Úvod",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Tato refund policy upravuje podmínky vrácení peněz za kredity zakoupené na platformě Verifa.sk, kterou provozuje:<br /><br />
            <strong>Dušan Baran</strong><br />
            IČ: 06119859<br />
            Kubelíkova 1258/43, 130 00 Praha, Česká republika<br />
            E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a><br /><br />
            Platby zpracovává <strong>Paddle.com (Merchant of Record)</strong>.
          </p>
        ),
      },
      {
        heading: "2. Odstoupení od smlouvy (14 dní)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Spotřebitel má právo odstoupit od smlouvy do <strong>14 dnů od nákupu kreditů</strong> bez udání důvodu. Právo zaniká okamžikem použití kreditu na generování reportu. Žádosti na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "3. Automatické vrácení kreditů",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pokud report <strong>nelze vygenerovat</strong> z důvodu technického výpadku registrů nebo chyby systému, <strong>kredit se automaticky vrátí</strong> do 24 hodin.
          </p>
        ),
      },
      {
        heading: "4. Nárok na vrácení peněz",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Nárok vzniká, pokud: (a) report nebyl vygenerován a kredit byl spotřebován, (b) uživatel odstoupil v 14denní lhůtě a kredit nebyl použit, (c) došlo k duplicitní platbě. Žádosti na <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Refund do <strong>5–10 pracovních dnů</strong>.
          </p>
        ),
      },
      {
        heading: "5. Kdy se kredit nevrací",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Kredit se nevrací, pokud: (a) report byl úspěšně vygenerován, (b) chyba byla na straně uživatele (neexistující IČO), (c) kredit byl použit po 14denní lhůtě.
          </p>
        ),
      },
      {
        heading: "6. Chargeback",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Před chargebackem kontaktujte <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Neoprávněný chargeback může vést k zablokování účtu.
          </p>
        ),
      },
      {
        heading: "7. Způsob vrácení",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Vrácení probíhá <strong>přes Paddle</strong> na původní platební metodu. Čas zpracování: <strong>5–10 pracovních dnů</strong>.
          </p>
        ),
      },
      {
        heading: "8. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Dotazy k refundacím: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Odpovídáme do 24 hodin.
          </p>
        ),
      },
    ],
    lastUpdated: "Poslední aktualizace",
  },
  hu: {
    title: "Visszatérítési Irányelvek",
    sections: [
      {
        heading: "1. Bevezetés",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ez a visszatérítési irányelv a Verifa.sk platformon vásárolt kreditek visszatérítésének feltételeit szabályozza. Üzemeltető: <strong>Dušan Baran</strong>, IČ: 06119859, Kubelíkova 1258/43, 130 00 Prague. E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Fizetéseket a <strong>Paddle.com (Merchant of Record)</strong> kezeli.
          </p>
        ),
      },
      {
        heading: "2. Elállási jog (14 nap)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            A fogyasztó <strong>14 napon belül</strong> elállhat a szerződéstől ok megadása nélkül. Az elállási jog a kredit report generálásra való felhasználásának pillanatában megszűnik. Kérelmek: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "3. Automatikus kredit-visszatérítés",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Ha a report <strong>nem generálható</strong> technikai hiba miatt, a kredit <strong>automatikusan visszatérítésre kerül</strong> 24 órán belül.
          </p>
        ),
      },
      {
        heading: "4. Visszatérítési jogosultság",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Visszatérítés jogosult, ha: (a) a report nem generálódott, (b) a felhasználó 14 napon belül elállt és a kredit nem használt, (c) dupla fizetés történt. Kérelmek: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Visszatérítés: <strong>5–10 munkanap</strong>.
          </p>
        ),
      },
      {
        heading: "5. Nem visszatéríthető esetek",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Kredit nem téríthető vissza, ha: (a) a report sikeresen generálódott, (b) hiba a felhasználó részéről (nem létező IČO), (c) a kredit 14 nap után lett használva.
          </p>
        ),
      },
      {
        heading: "6. Chargeback",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Chargeback előtt kontaktálja <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Jogtalan chargeback fióktiltáshoz vezethet.
          </p>
        ),
      },
      {
        heading: "7. Visszatérítési mód",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Visszatérítés <strong>Paddle-en</strong> keresztül az eredeti fizetési módra. Idő: <strong>5–10 munkanap</strong>.
          </p>
        ),
      },
      {
        heading: "8. Kapcsolat",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Kérdések: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Válasz 24 órán belül.
          </p>
        ),
      },
    ],
    lastUpdated: "Utolsó frissítés",
  },
  pl: {
    title: "Polityka Zwrotów",
    sections: [
      {
        heading: "1. Wprowadzenie",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Niniejsza polityka zwrotów reguluje warunki zwrotu środków za kredyty zakupione na platformie Verifa.sk. Operator: <strong>Dušan Baran</strong>, ID: 06119859, Kubelíkova 1258/43, 130 00 Prague. E-mail: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Płatności obsługuje <strong>Paddle.com (Merchant of Record)</strong>.
          </p>
        ),
      },
      {
        heading: "2. Prawo odstąpienia (14 dni)",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Konsument ma prawo odstąpić od umowy w terminie <strong>14 dni od zakupu kredytów</strong> bez podania przyczyny. Prawo wygasa z chwilą wykorzystania kredytu na wygenerowanie raportu. Wnioski: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>.
          </p>
        ),
      },
      {
        heading: "3. Automatyczny zwrot kredytów",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Jeśli raport <strong>nie może zostać wygenerowany</strong> z powodu błędu technicznego, <strong>kredyt jest automatycznie zwracany</strong> w ciągu 24 godzin.
          </p>
        ),
      },
      {
        heading: "4. Uprawnienie do zwrotu",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Zwrot przysługuje, jeśli: (a) raport nie został wygenerowany, (b) konsument odstąpił w terminie 14 dni i kredyt nie był użyty, (c) nastąpiła podwójna płatność. Wnioski: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Zwrot: <strong>5–10 dni roboczych</strong>.
          </p>
        ),
      },
      {
        heading: "5. Przypadki bez zwrotu",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Kredyt nie podlega zwrotowi, jeśli: (a) raport został wygenerowany, (b) błąd ze strony użytkownika (nieistniejące IČO), (c) kredyt użyty po 14 dniach.
          </p>
        ),
      },
      {
        heading: "6. Chargeback",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Przed chargebackiem skontaktuj się z <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Nieuprawniony chargeback może skutkować zablokowaniem konta.
          </p>
        ),
      },
      {
        heading: "7. Metoda zwrotu",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Zwroty są realizowane <strong>przez Paddle</strong> na oryginalną metodę płatności. Czas: <strong>5–10 dni roboczych</strong>.
          </p>
        ),
      },
      {
        heading: "8. Kontakt",
        body: (
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Pytania: <a href="mailto:info@verifa.sk" style={linkStyle}>info@verifa.sk</a>. Odpowiadamy w ciągu 24 godzin.
          </p>
        ),
      },
    ],
    lastUpdated: "Ostatnia aktualizacja",
  },
};

export default async function RefundPage() {
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
            {content.lastUpdated}: 29. 8. 2026.
          </p>
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";

export default function CompanyNotFound({ lang = "sk" }: { lang?: string }) {
  const isCz = lang === "cz";
  const isEn = lang === "en";
  const isDe = lang === "de";

  const title = isCz
    ? "Firma nebyla nalezena"
    : isEn
    ? "Company not found"
    : isDe
    ? "Firma nicht gefunden"
    : "Firma nebola nájdená";

  const desc = isCz
    ? "Hledaná společnost není v naší databázi. Můžete si prověřit libovolnou firmu zadáním jejího IČO."
    : isEn
    ? "The requested company is not in our database. You can verify any company by entering its ID."
    : isDe
    ? "Das gesuchte Unternehmen ist nicht in unserer Datenbank. Sie können jedes Unternehmen durch Eingabe der ID überprüfen."
    : "Hľadaná spoločnosť nie je v našej databáze. Môžete si overiť ľubovoľnú firmu zadaním jej IČO.";

  const btn = isCz
    ? "Ověřit firmu podle IČO"
    : isEn
    ? "Verify company by ID"
    : isDe
    ? "Firma nach ID überprüfen"
    : "Overiť firmu podľa IČO";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div className="max-w-[600px] mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl font-black mb-4" style={{ color: "var(--text)" }}>
          {title}
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--text-secondary)" }}>
          {desc}
        </p>
        <Link
          href={isCz ? "/cs/dashboard" : isEn ? "/en/dashboard" : isDe ? "/de/dashboard" : "/dashboard"}
          className="inline-block px-6 py-3 rounded-lg font-bold text-sm"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
        >
          {btn}
        </Link>
      </div>
    </div>
  );
}

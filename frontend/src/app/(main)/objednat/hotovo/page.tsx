import Link from "next/link";

export default function ObjednatHotovoPage() {
  return (
    <div className="max-w-[520px] mx-auto px-4 sm:px-6 pt-16 pb-16 text-center animate-fade-in">
      <div
        className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center"
        style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-3" style={{ color: "var(--text)" }}>
        Objednávka prijatá
      </h1>
      <p className="text-sm leading-relaxed mb-2" style={{ color: "var(--text-secondary)" }}>
        Platba bola úspešná a váš report sa práve generuje. Po dokončení vám príde
        e-mail s odkazom — zvyčajne do 15 minút.
      </p>
      <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--text-secondary)" }}>
        Zároveň sme vám poslali e-mail s odkazom na nastavenie hesla k vášmu novému
        účtu, kde nájdete report aj po prihlásení.
      </p>
      <Link
        href="/"
        className="inline-block px-6 py-2.5 rounded-lg font-bold text-sm"
        style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
      >
        Späť na hlavnú stránku
      </Link>
    </div>
  );
}

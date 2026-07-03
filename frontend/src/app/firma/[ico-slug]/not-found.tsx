import Link from "next/link";

export default function CompanyNotFound() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div className="max-w-[600px] mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl font-black mb-4" style={{ color: "var(--text)" }}>
          Firma nebola nájdená
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--text-secondary)" }}>
          Hľadaná spoločnosť nie je v našej databáze. Môžete si overiť ľubovoľnú firmu zadaním jej IČO.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 rounded-lg font-bold text-sm"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
        >
          Overiť firmu podľa IČO
        </Link>
      </div>
    </div>
  );
}

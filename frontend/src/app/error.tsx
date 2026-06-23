"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">⚠️</div>
        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: "var(--text)" }}
        >
          Niečo sa pokazilo
        </h1>
        <p
          className="text-sm mb-6"
          style={{ color: "var(--text-secondary)" }}
        >
          {error.message || "Nastala neočakávaná chyba. Skúste to znova."}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="btn-primary"
          >
            Skúsiť znova
          </button>
          <Link href="/" className="btn-secondary">
            Späť na Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

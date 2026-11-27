"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";

export type ErrorLang = "sk" | "en" | "de" | "cs" | "cz" | "hu" | "pl";

const COPY: Record<
  Exclude<ErrorLang, "cz">,
  { title: string; fallback: string; reloading: string; retry: string; home: string; homeHref: string }
> = {
  sk: {
    title: "Niečo sa pokazilo",
    fallback: "Nastala neočakávaná chyba. Skúste to znova.",
    reloading: "Aktualizujeme aplikáciu na najnovšiu verziu…",
    retry: "Skúsiť znova",
    home: "Späť na overenie subjektu",
    homeHref: "/",
  },
  en: {
    title: "Something went wrong",
    fallback: "An unexpected error occurred. Please try again.",
    reloading: "Updating application to the latest version…",
    retry: "Try again",
    home: "Back to home",
    homeHref: "/en",
  },
  de: {
    title: "Etwas ist schiefgelaufen",
    fallback: "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.",
    reloading: "Anwendung wird aktualisiert…",
    retry: "Erneut versuchen",
    home: "Zur Startseite",
    homeHref: "/de",
  },
  cs: {
    title: "Něco se pokazilo",
    fallback: "Nastala neočekávaná chyba. Zkuste to znovu.",
    reloading: "Aktualizujeme aplikaci na nejnovější verzi…",
    retry: "Zkusit znovu",
    home: "Zpět na úvod",
    homeHref: "/cs",
  },
  hu: {
    title: "Hiba történt",
    fallback: "Váratlan hiba történt. Kérjük, próbálja újra.",
    reloading: "Alkalmazás frissítése…",
    retry: "Újra",
    home: "Vissza a főoldalra",
    homeHref: "/hu",
  },
  pl: {
    title: "Coś poszło nie tak",
    fallback: "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.",
    reloading: "Aktualizowanie aplikacji…",
    retry: "Spróbuj ponownie",
    home: "Powrót na stronę główną",
    homeHref: "/pl",
  },
};

function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  const msg = String(error.message || "");
  return /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    msg
  );
}

export default function RouteErrorBoundary({
  error,
  reset,
  lang = "sk",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  lang?: ErrorLang;
}) {
  const [reloading, setReloading] = useState(() => isChunkLoadError(error));
  const normalizedLang = lang === "cz" ? "cs" : lang;
  const copy = COPY[normalizedLang] || COPY.sk;

  useEffect(() => {
    if (isChunkLoadError(error)) {
      try {
        const key = "verifa-chunk-reload:" + window.location.pathname;
        const last = Number(sessionStorage.getItem(key) || "0");
        const now = Date.now();
        if (!last || now - last > 15000) {
          sessionStorage.setItem(key, String(now));
          setReloading(true);
          window.location.reload();
          return;
        }
      } catch {
        // Ignore storage restrictions and fall through to manual retry UI
      }
      setReloading(false);
      return;
    }

    Sentry.captureException(error);
  }, [error]);

  if (reloading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "var(--bg)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {copy.reloading}
        </p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">⚠️</div>
        <h1
          className="text-2xl font-bold tracking-tight mb-2"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          {copy.title}
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          {isChunkLoadError(error) ? copy.fallback : error.message || copy.fallback}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => {
              if (isChunkLoadError(error)) {
                window.location.reload();
              } else {
                reset();
              }
            }}
            className="btn-primary"
          >
            {copy.retry}
          </button>
          <Link href={copy.homeHref} className="btn-secondary">
            {copy.home}
          </Link>
        </div>
      </div>
    </div>
  );
}

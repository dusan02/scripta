"use client";

import Link from "next/link";
import { useLang } from "./LanguageProvider";
import { localizePath } from "@/lib/i18n";

/**
 * Wraps next/link to automatically add the current language prefix.
 * SK is default (no prefix). Other langs: /cs/, /en/, /de/, /hu/, /pl/
 *
 * Usage: <LocalizedLink href="/pricing">...</LocalizedLink>
 * With lang=cz → renders href="/cs/pricing"
 */
export default function LocalizedLink({
  href,
  children,
  ...props
}: {
  href: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}) {
  const { lang } = useLang();
  // Don't localize anchor links (#...), external URLs, or already-localized paths
  const localized =
    href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:")
      ? href
      : localizePath(href, lang);
  return (
    <Link href={localized} {...props}>
      {children}
    </Link>
  );
}
